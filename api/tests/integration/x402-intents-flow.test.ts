import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { getPluginClient, getTestDb, runMigrations, teardown } from '../setup';
import { clearOrders, clearProducts, createTestProduct, createTestProductVariant } from '../helpers';
import * as schema from '@/db/schema';
import type { FeeConfig } from '@/schema';
import { createX402PayApp } from '@/services/payment/x402/pay-app';
import { usdDollarsToUsdcAtomic } from '@/services/payment/x402/amount';
import { X402_NETWORK, X402_SCHEME, X402_USDC_BASE } from '@/services/payment/x402/constants';
import { X402_HOST_SECRET_HEADER } from '@/services/payment/x402/config';
import { createX402IntentsPayDeps } from '@/services/payment/x402/intents/host-deps';
import type { X402IntentsPayDeps } from '@/services/payment/x402/intents/types';

/**
 * #238 end-to-end: pay app (Phase 1 + near-intents middleware) -> real HTTP
 * facilitator client -> mock near-intents facilitator -> mock 1Click API,
 * with the real API procedures and Postgres underneath.
 */

const TEST_USER = 'test-user.near';
const PAY_TO = '0x0000000000000000000000000000000000000abc';
const HOST_SECRET = 'test-x402-host-secret';
const FACILITATOR_URL = 'https://intents-facilitator.test';
const ONE_CLICK_URL = 'https://1click.test';
const ARB = 'eip155:42161';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const REFUND_TO = '0x2222222222222222222222222222222222222222';
const BUYER = '0x3333333333333333333333333333333333333333';
const ORIGINS = [
  { network: ARB, asset: ARB_USDC, decimals: 6, maxTimeoutSeconds: 300, usdPegged: true },
];

const shippingAddress = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  addressLine1: '123 Main St',
  city: 'Los Angeles',
  state: 'CA',
  postCode: '90001',
  country: 'US',
};

type OneClickStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'PROCESSING'
  | 'INCOMPLETE_DEPOSIT'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

type OneClickQuote = {
  depositAddress: string;
  amountIn: string;
  quoteRequest: Record<string, unknown> & { amount: string; recipient: string; refundTo: string };
  status: OneClickStatus;
  originTxHashes: string[];
  destinationTxHash: string;
};

/** In-memory 1Click API: POST /v0/quote and GET /v0/status. */
class MockOneClick {
  quotes = new Map<string, OneClickQuote>();
  statusCalls = 0;
  private next = 0;

  async fetch(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input);
    if (url.pathname === '/v0/quote' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      this.next += 1;
      const depositAddress = `0x${this.next.toString(16).padStart(40, 'd')}`;
      // EXACT_OUTPUT: amountIn covers amountOut plus a 0.5% spread.
      const amountIn = String(Math.ceil(Number(body.amount) * 1.005));
      this.quotes.set(depositAddress, {
        depositAddress,
        amountIn,
        quoteRequest: body,
        status: 'PENDING_DEPOSIT',
        originTxHashes: [],
        destinationTxHash: `0x${this.next.toString(16).padStart(64, 'b')}`,
      });
      return Response.json({
        quote: { depositAddress, amountIn, amountOut: body.amount, deadline: body.deadline },
        quoteRequest: body,
      });
    }
    if (url.pathname === '/v0/status') {
      this.statusCalls += 1;
      const quote = this.quotes.get(url.searchParams.get('depositAddress') ?? '');
      if (!quote) return Response.json({ message: 'not found' }, { status: 404 });
      return Response.json({
        status: quote.status,
        quoteResponse: { quoteRequest: quote.quoteRequest },
        swapDetails: {
          originChainTxHashes: quote.originTxHashes.map((hash) => ({ hash })),
          destinationChainTxHashes:
            quote.status === 'SUCCESS' ? [{ hash: quote.destinationTxHash }] : [],
          amountOut: quote.status === 'SUCCESS' ? quote.quoteRequest.amount : undefined,
          refundedAmount: quote.status === 'REFUNDED' ? quote.amountIn : undefined,
        },
      });
    }
    return Response.json({ message: 'unknown route' }, { status: 404 });
  }

  /** Simulate the buyer's deposit landing at 1Click and the swap reaching `status`. */
  deposit(depositAddress: string, txHash: string, status: OneClickStatus) {
    const quote = this.quotes.get(depositAddress)!;
    quote.originTxHashes.push(txHash);
    quote.status = status;
  }
}

/**
 * Mock near-intents facilitator (spec #3370) in front of MockOneClick:
 * /verify mints a quote, /settle reads 1Click status. Records one result per
 * operation like a real facilitator.
 */
class MockIntentsFacilitator {
  verifyCalls = 0;
  settleCalls = 0;
  verifyBodies: Array<{ paymentRequirements: PaymentRequirements }> = [];
  settleBodies: Array<{ paymentRequirements: PaymentRequirements }> = [];
  private recorded = new Map<string, Record<string, unknown>>();

  constructor(private oneClick: MockOneClick) {}

  async fetch(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (url.pathname === '/verify') return Response.json(await this.verify(body));
    if (url.pathname === '/settle') {
      const result = await this.settle(body);
      // Real facilitators answer failures with a non-2xx; the client must keep the body.
      return Response.json(result, { status: result.success ? 200 : 400 });
    }
    return Response.json({ message: 'unknown route' }, { status: 404 });
  }

  private async verify(body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }) {
    this.verifyCalls += 1;
    this.verifyBodies.push(body);
    const { paymentPayload, paymentRequirements } = body;
    const payload = paymentPayload.payload as { refundTo: string; slippageTolerance?: number };
    const destination = paymentRequirements.extra.destination as {
      amount: string;
      recipient: string;
    };
    const deadline = new Date(
      Date.now() + paymentRequirements.maxTimeoutSeconds * 1000,
    ).toISOString();
    const response = await this.oneClick.fetch(`${ONE_CLICK_URL}/v0/quote`, {
      method: 'POST',
      body: JSON.stringify({
        dry: false,
        swapType: 'EXACT_OUTPUT',
        depositType: 'ORIGIN_CHAIN',
        depositMode: 'SIMPLE',
        originAsset: `nep141:arb-${paymentRequirements.asset.toLowerCase()}.omft.near`,
        destinationAsset: `nep141:base-${X402_USDC_BASE.toLowerCase()}.omft.near`,
        amount: destination.amount,
        recipient: destination.recipient,
        recipientType: 'DESTINATION_CHAIN',
        refundTo: payload.refundTo,
        refundType: 'ORIGIN_CHAIN',
        slippageTolerance: payload.slippageTolerance ?? 100,
        appFees: paymentRequirements.extra.appFees,
        deadline,
      }),
    });
    const quote = (await response.json()) as { quote: { depositAddress: string; amountIn: string } };
    return {
      isValid: true,
      payer: payload.refundTo,
      extra: {
        depositAddress: quote.quote.depositAddress,
        amountIn: quote.quote.amountIn,
        refundDeadline: deadline,
        operationToken: `k1.${Math.floor(Date.parse(deadline) / 1000) + 86400}.mac-${quote.quote.depositAddress}`,
      },
    };
  }

  private async settle(body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }) {
    this.settleCalls += 1;
    this.settleBodies.push(body);
    const { paymentPayload, paymentRequirements } = body;
    const deposit = paymentPayload.payload as {
      depositAddress: string;
      txHash: string;
      operationToken: string;
    };
    const operation = `${paymentPayload.accepted.network}:${deposit.depositAddress}`;
    const recorded = this.recorded.get(operation);
    if (recorded) return recorded;

    const destination = paymentRequirements.extra.destination as {
      network: string;
      amount: string;
      recipient: string;
    };
    const status = (await (
      await this.oneClick.fetch(
        `${ONE_CLICK_URL}/v0/status?depositAddress=${deposit.depositAddress}`,
      )
    ).json()) as {
      status: OneClickStatus;
      quoteResponse: { quoteRequest: { amount: string; recipient: string; refundTo: string } };
      swapDetails: {
        originChainTxHashes: Array<{ hash: string }>;
        destinationChainTxHashes: Array<{ hash: string }>;
      };
    };
    const quoteRequest = status.quoteResponse.quoteRequest;
    if (quoteRequest.amount !== destination.amount || quoteRequest.recipient !== destination.recipient) {
      return { success: false, errorReason: 'invalid_exact_near_intents_quote_mismatch', transaction: '', network: paymentPayload.accepted.network };
    }
    if (!status.swapDetails.originChainTxHashes.some((tx) => tx.hash === deposit.txHash)) {
      return { success: false, errorReason: 'invalid_exact_near_intents_deposit_not_found', transaction: deposit.txHash, network: paymentPayload.accepted.network };
    }

    let result: Record<string, unknown>;
    if (status.status === 'SUCCESS') {
      result = {
        success: true,
        network: destination.network,
        transaction: status.swapDetails.destinationChainTxHashes[0]!.hash,
        payer: BUYER,
        amount: destination.amount,
        extra: { originNetwork: paymentPayload.accepted.network, originTxHash: deposit.txHash },
      };
    } else if (status.status === 'REFUNDED' || status.status === 'FAILED') {
      result = {
        success: false,
        errorReason: 'exact_near_intents_payment_failed',
        network: paymentPayload.accepted.network,
        transaction: deposit.txHash,
        payer: BUYER,
        extra: { status: status.status, refundTo: quoteRequest.refundTo },
      };
    } else {
      // Non-terminal (INCOMPLETE_DEPOSIT, PROCESSING, ...): nothing recorded.
      return {
        success: false,
        errorReason: 'settlement_pending',
        network: paymentPayload.accepted.network,
        transaction: deposit.txHash,
      };
    }
    this.recorded.set(operation, result);
    return result;
  }
}

function phase1Facilitator(): FacilitatorClient {
  return {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: X402_SCHEME, network: X402_NETWORK }], extensions: [], signers: {} };
    },
    async verify() {
      throw new Error('Phase 1 facilitator must not be called on the intents path');
    },
    async settle() {
      throw new Error('Phase 1 facilitator must not be called on the intents path');
    },
  };
}

async function hostClient() {
  const reqHeaders = new Headers();
  reqHeaders.set(X402_HOST_SECRET_HEADER, HOST_SECRET);
  return getPluginClient({ reqHeaders });
}

async function createApp(
  options: { now?: () => number; overrides?: Partial<X402IntentsPayDeps> } = {},
) {
  const oneClick = new MockOneClick();
  const facilitator = new MockIntentsFacilitator(oneClick);
  const client = await hostClient();
  const deps = createX402IntentsPayDeps(client as never, {
    fetch: ((input: string, init?: RequestInit) => facilitator.fetch(input, init)) as typeof fetch,
  });
  const intents: X402IntentsPayDeps | undefined = deps
    ? { ...deps, ...(options.now ? { now: options.now } : {}), ...options.overrides }
    : undefined;
  const app = createX402PayApp({
    payTo: PAY_TO,
    facilitator: phase1Facilitator(),
    syncFacilitatorOnStart: true,
    getOrder: (orderId) => client.getX402PayQuote({ orderId }),
    settleOrder: (orderId, settlement) => client.settleX402Order({ orderId, ...settlement }),
    failOrder: (orderId, settlement) => client.failX402Order({ orderId, ...settlement }),
    intents,
  });
  return { app, oneClick, facilitator, intents };
}

async function createOrder(productId = 'prod_intents', variantId = 'var_intents') {
  const client = await getPluginClient({ nearAccountId: TEST_USER });
  const items = [{ productId, variantId, quantity: 1 }];
  const quote = await client.quote({ items, shippingAddress });
  const selectedRates: Record<string, string> = {};
  quote.providerBreakdown.forEach((provider) => {
    selectedRates[provider.provider] = provider.selectedShipping.rateId;
  });
  const checkout = await client.createCheckout({
    items,
    shippingAddress,
    selectedRates,
    shippingCost: quote.shippingCost,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    paymentProvider: 'x402',
  });
  return { client, orderId: checkout.orderId, totalAmount: checkout.totalAmount };
}

const resourceUrl = (orderId: string) => `http://localhost/orders/${orderId}/pay`;

function pay(app: Awaited<ReturnType<typeof createApp>>['app'], orderId: string, header?: string) {
  return app.request(`/orders/${orderId}/pay`, {
    method: 'POST',
    headers: header ? { 'payment-signature': header } : {},
  });
}

function requiredOf(response: Response) {
  const header = response.headers.get('payment-required');
  return header ? decodePaymentRequiredHeader(header) : undefined;
}

function receiptOf(response: Response) {
  const header = response.headers.get('payment-response');
  return header ? (decodePaymentResponseHeader(header) as unknown as Record<string, any>) : undefined;
}

function signature(orderId: string, accepted: PaymentRequirements, payload: Record<string, unknown>) {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: { url: resourceUrl(orderId), description: '', mimeType: 'application/json' },
    accepted,
    payload,
  } as PaymentPayload);
}

/** Unpaid 402 -> quote round trip. Returns the unquoted and quoted entries. */
async function quoteFlow(app: Awaited<ReturnType<typeof createApp>>['app'], orderId: string) {
  const unpaid = await pay(app, orderId);
  expect(unpaid.status).toBe(402);
  const unquoted = requiredOf(unpaid)!.accepts.find(
    (entry) => entry.extra?.assetTransferMethod === 'near-intents',
  )!;
  expect(unquoted).toBeDefined();

  const quoted402 = await pay(
    app,
    orderId,
    signature(orderId, unquoted, { type: 'quote', refundTo: REFUND_TO }),
  );
  expect(quoted402.status).toBe(402);
  const quoted = requiredOf(quoted402)!.accepts[0]!;
  return { unquoted, quoted };
}

function depositHeader(orderId: string, quoted: PaymentRequirements, txHash: string) {
  return signature(orderId, quoted, {
    type: 'deposit',
    operationToken: quoted.extra.operationToken,
    depositAddress: quoted.payTo,
    txHash,
  });
}

const txHash = (n: number) => `0x${n.toString(16).padStart(64, 'a')}`;

async function auditCount(orderId: string, reason: string) {
  const rows = await getTestDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orderAuditLogs)
    .where(
      and(
        eq(schema.orderAuditLogs.orderId, orderId),
        sql`${schema.orderAuditLogs.metadata}->>'reason' = ${reason}`,
      ),
    );
  return rows[0]!.count;
}

async function operationsFor(orderId: string) {
  return getTestDb()
    .select()
    .from(schema.x402IntentsOperations)
    .where(eq(schema.x402IntentsOperations.orderId, orderId));
}

const PAID = ['paid', 'processing', 'paid_pending_fulfillment'];

function setIntentsEnv(feeMode: 'out_of_band' | 'app_fees' = 'out_of_band') {
  process.env.X402_INTENTS_ENABLED = 'true';
  process.env.X402_INTENTS_FACILITATOR_URL = FACILITATOR_URL;
  process.env.X402_INTENTS_ORIGINS = JSON.stringify(ORIGINS);
  process.env.X402_INTENTS_FEE_MODE = feeMode;
}

function clearIntentsEnv() {
  delete process.env.X402_INTENTS_ENABLED;
  delete process.env.X402_INTENTS_FACILITATOR_URL;
  delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
  delete process.env.X402_INTENTS_ORIGINS;
  delete process.env.X402_INTENTS_FEE_MODE;
}

describe('x402 near-intents flow (#238)', () => {
  beforeAll(async () => {
    process.env.X402_ENABLED = 'true';
    process.env.X402_PAY_TO_ADDRESS = PAY_TO;
    process.env.X402_HOST_SECRET = HOST_SECRET;
    process.env.X402_NETWORK = X402_NETWORK;
    await runMigrations();
  });

  afterAll(async () => {
    clearIntentsEnv();
    await teardown();
  });

  beforeEach(async () => {
    setIntentsEnv();
    await clearOrders();
    await clearProducts();
    // Manual fulfillment enabled so a paid order can reach `processing` (fulfillment:confirmed).
    await getTestDb()
      .insert(schema.providerConfigs)
      .values({ provider: 'manual', enabled: true, settings: { notificationEmails: ['ops@example.com'] } as never })
      .onConflictDoUpdate({ target: schema.providerConfigs.provider, set: { enabled: true, settings: { notificationEmails: ['ops@example.com'] } as never } });
    await createTestProduct('prod_intents', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('var_intents', 'prod_intents');
  });

  afterEach(async () => {
    clearIntentsEnv();
    await clearOrders();
    await clearProducts();
    await getTestDb().delete(schema.providerConfigs).where(eq(schema.providerConfigs.provider, 'manual'));
  });

  it('AC1: pays from USDC on Arbitrum; order reaches processing with fulfillment confirmed and the merchant gets the exact destination amount on Base', async () => {
    const { app, oneClick, facilitator } = await createApp();
    const { client, orderId, totalAmount } = await createOrder();
    const total = usdDollarsToUsdcAtomic(totalAmount);

    const unpaid = await pay(app, orderId);
    const required = requiredOf(unpaid)!;
    // Phase 1 exact/Base entry first, then one unquoted entry per origin.
    expect(required.accepts).toHaveLength(2);
    expect(required.accepts[0]!.extra?.assetTransferMethod).toBe('eip3009');
    const unquoted = required.accepts[1]!;
    expect(unquoted).toMatchObject({
      scheme: 'exact',
      network: ARB,
      asset: ARB_USDC,
      amount: '',
      payTo: '',
      maxTimeoutSeconds: 300,
      extra: {
        assetTransferMethod: 'near-intents',
        paymentFlow: 'upfront',
        indicativeAmount: total,
        destination: { network: X402_NETWORK, asset: X402_USDC_BASE, amount: total, recipient: PAY_TO },
      },
    });

    const { quoted } = await quoteFlow(app, orderId);
    expect(facilitator.verifyCalls).toBe(1);
    // /verify gets the server's unquoted entry, never the client's `accepted`.
    expect(facilitator.verifyBodies[0]!.paymentRequirements).toEqual(unquoted);
    const [oneClickQuote] = [...oneClick.quotes.values()];
    expect(oneClickQuote!.quoteRequest).toMatchObject({
      swapType: 'EXACT_OUTPUT',
      amount: total,
      recipient: PAY_TO,
      refundTo: REFUND_TO,
      refundType: 'ORIGIN_CHAIN',
    });
    expect(quoted.payTo).toBe(oneClickQuote!.depositAddress);
    expect(quoted.amount).toBe(oneClickQuote!.amountIn);
    expect(quoted.extra.operationToken).toEqual(expect.any(String));
    expect(quoted.extra.refundDeadline).toEqual(expect.any(String));

    // The quote changes nothing on the order.
    let order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('payment_pending');

    oneClick.deposit(quoted.payTo, txHash(1), 'SUCCESS');
    const paid = await pay(app, orderId, depositHeader(orderId, quoted, txHash(1)));
    expect(paid.status).toBe(200);
    const body = (await paid.json()) as { orderId: string; status: string };
    expect(body.orderId).toBe(orderId);
    expect(body.status).toBe('processing');

    const receipt = receiptOf(paid)!;
    expect(receipt).toMatchObject({
      success: true,
      network: X402_NETWORK,
      amount: total,
      extra: { originNetwork: ARB, originTxHash: txHash(1) },
    });
    expect(JSON.stringify(receipt)).not.toContain('operationToken');
    // /settle used the recorded unquoted entry.
    expect(facilitator.settleBodies[0]!.paymentRequirements).toEqual(unquoted);

    order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('processing');
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const settlement = (order.order.paymentDetails as Record<string, any>).settlement;
    expect(settlement).toMatchObject({
      method: 'near-intents',
      network: X402_NETWORK,
      amount: total,
      originNetwork: ARB,
      originTxHash: txHash(1),
      depositAddress: quoted.payTo,
    });

    const [operation] = await operationsFor(orderId);
    expect(operation!.state).toBe('executed');
    expect(operation!.duplicate).toBe(false);
  });

  it('AC2: a refunded swap returns funds to refundTo and marks the order payment_failed', async () => {
    const { app, oneClick } = await createApp();
    const { client, orderId } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);

    oneClick.deposit(quoted.payTo, txHash(2), 'REFUNDED');
    const failed = await pay(app, orderId, depositHeader(orderId, quoted, txHash(2)));
    expect(failed.status).toBe(402);
    expect(requiredOf(failed)!.error).toBe('exact_near_intents_payment_failed');
    expect(receiptOf(failed)).toMatchObject({
      success: false,
      errorReason: 'exact_near_intents_payment_failed',
      extra: { status: 'REFUNDED', refundTo: REFUND_TO },
    });

    const order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('payment_failed');
    expect(order.order.paymentDetails?.settlePending).not.toBe(true);
    const [operation] = await operationsFor(orderId);
    expect(operation!.state).toBe('failed');

    // Replays return the recorded failure without another facilitator call.
    const replay = await pay(app, orderId, depositHeader(orderId, quoted, txHash(2)));
    expect(replay.status).toBe(402);
    expect(requiredOf(replay)!.error).toBe('exact_near_intents_payment_failed');
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_failed');
  });

  it('AC3: settlement_pending keeps payment_pending, blocks new quotes, and retries converge to one charge and one fulfillment', async () => {
    const start = Date.now();
    let offset = 0;
    const { app, oneClick, facilitator } = await createApp({ now: () => start + offset });
    const { client, orderId } = await createOrder();
    const { quoted, unquoted } = await quoteFlow(app, orderId);

    oneClick.deposit(quoted.payTo, txHash(3), 'INCOMPLETE_DEPOSIT');
    const pending = await pay(app, orderId, depositHeader(orderId, quoted, txHash(3)));
    expect(pending.status).toBe(402);
    expect(requiredOf(pending)!.error).toBe('settlement_pending');
    expect(receiptOf(pending)).toMatchObject({ success: false, errorReason: 'settlement_pending' });

    let order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('payment_pending');
    expect(order.order.paymentDetails?.settlePending).toBe(true);
    expect((await operationsFor(orderId))[0]!.state).toBe('pending');

    // No second quote may be funded while one is pending.
    const verifyCalls = facilitator.verifyCalls;
    const newQuote = await pay(
      app,
      orderId,
      signature(orderId, unquoted, { type: 'quote', refundTo: REFUND_TO }),
    );
    expect(newQuote.status).toBe(403);
    expect(facilitator.verifyCalls).toBe(verifyCalls);
    // The unpaid 402 stops offering intents entries while pending.
    expect(requiredOf(await pay(app, orderId))?.accepts.some(
      (entry) => entry.extra?.assetTransferMethod === 'near-intents',
    ) ?? false).toBe(false);

    // Retry past the 900 s Phase 1 window with the same token; swap completes.
    offset = 1_000_000;
    oneClick.deposit(quoted.payTo, txHash(3), 'SUCCESS');
    const [first, second] = await Promise.all([
      pay(app, orderId, depositHeader(orderId, quoted, txHash(3))),
      pay(app, orderId, depositHeader(orderId, quoted, txHash(3))),
    ]);
    const statuses = [first.status, second.status].sort();
    // One settles; the concurrent one sees the in-flight claim or the recorded result.
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);

    order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('processing');
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    expect(await auditCount(orderId, 'payment.success')).toBe(1);

    // Later replay: recorded result, no facilitator call, no second fulfillment.
    const settleCalls = facilitator.settleCalls;
    const replay = await pay(app, orderId, depositHeader(orderId, quoted, txHash(3)));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      orderId,
      idempotent: true,
      reason: 'exact_near_intents_operation_executed',
    });
    expect(facilitator.settleCalls).toBe(settleCalls);
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const operations = await operationsFor(orderId);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.state).toBe('executed');
  });

  it('AC3: a deposit that is not found changes nothing and can be retried', async () => {
    const { app, oneClick } = await createApp();
    const { client, orderId } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);

    const notFound = await pay(app, orderId, depositHeader(orderId, quoted, txHash(4)));
    expect(notFound.status).toBe(402);
    expect(requiredOf(notFound)!.error).toBe('invalid_exact_near_intents_deposit_not_found');
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
    expect((await operationsFor(orderId))[0]!.state).toBe('quoted');

    oneClick.deposit(quoted.payTo, txHash(4), 'SUCCESS');
    const paid = await pay(app, orderId, depositHeader(orderId, quoted, txHash(4)));
    expect(paid.status).toBe(200);
    expect((await client.getOrder({ id: orderId })).order.status).toBe('processing');
  });

  it('AC3: a second funded quote is delivered but recorded as a duplicate, never a second payment', async () => {
    const { app, oneClick } = await createApp();
    const { client, orderId } = await createOrder();
    const first = await quoteFlow(app, orderId);
    const second = await quoteFlow(app, orderId);
    expect(second.quoted.payTo).not.toBe(first.quoted.payTo);

    oneClick.deposit(first.quoted.payTo, txHash(5), 'SUCCESS');
    oneClick.deposit(second.quoted.payTo, txHash(6), 'SUCCESS');
    expect((await pay(app, orderId, depositHeader(orderId, first.quoted, txHash(5)))).status).toBe(200);
    const dup = await pay(app, orderId, depositHeader(orderId, second.quoted, txHash(6)));
    expect(dup.status).toBe(200);
    expect(await dup.json()).toMatchObject({ idempotent: true });

    expect(await auditCount(orderId, 'payment.success')).toBe(1);
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const operations = await operationsFor(orderId);
    const byAddress = new Map(operations.map((op) => [op.depositAddress, op]));
    expect(byAddress.get(first.quoted.payTo)!.duplicate).toBe(false);
    expect(byAddress.get(second.quoted.payTo)!.duplicate).toBe(true);
    const settlement = ((await client.getOrder({ id: orderId })).order.paymentDetails as Record<string, any>).settlement;
    expect(settlement.originTxHash).toBe(txHash(5));
  });

  describe('AC4: fee splits on a fee\'d product', () => {
    const FEES: FeeConfig[] = [
      { type: 'royalty', label: 'Artist royalty', recipient: 'artist.near', bps: 300 },
      { type: 'affiliate', label: 'Affiliate', recipient: 'affiliate.near', bps: 100 },
    ];

    async function createFeedOrder(fees: FeeConfig[]) {
      await createTestProduct('prod_fees', { fulfillmentProvider: 'manual', metadata: { fees } as never });
      await createTestProductVariant('var_fees', 'prod_fees');
      return createOrder('prod_fees', 'var_fees');
    }

    it('app_fees: splits go to 1Click appFees, the merchant gets total minus splits, and the plan is recorded on the order', async () => {
      setIntentsEnv('app_fees');
      const { app, oneClick, facilitator } = await createApp();
      const { client, orderId, totalAmount } = await createFeedOrder(FEES);
      const total = BigInt(usdDollarsToUsdcAtomic(totalAmount));
      const royalty = (total * 300n) / 10000n;
      const affiliate = (total * 100n) / 10000n;
      const destinationAmount = String(total - royalty - affiliate);

      const { unquoted, quoted } = await quoteFlow(app, orderId);
      expect(unquoted.extra).toMatchObject({
        indicativeAmount: String(total),
        destination: { amount: destinationAmount },
        appFees: [
          { recipient: 'artist.near', fee: 300 },
          { recipient: 'affiliate.near', fee: 100 },
        ],
      });
      const [oneClickQuote] = [...oneClick.quotes.values()];
      expect(oneClickQuote!.quoteRequest).toMatchObject({
        amount: destinationAmount,
        appFees: [
          { recipient: 'artist.near', fee: 300 },
          { recipient: 'affiliate.near', fee: 100 },
        ],
      });

      oneClick.deposit(quoted.payTo, txHash(7), 'SUCCESS');
      const paid = await pay(app, orderId, depositHeader(orderId, quoted, txHash(7)));
      expect(paid.status).toBe(200);
      expect(receiptOf(paid)!.amount).toBe(destinationAmount);
      expect(facilitator.settleBodies[0]!.paymentRequirements.extra.appFees).toHaveLength(2);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('processing');
      const details = order.order.paymentDetails as Record<string, any>;
      expect(details.fees).toEqual(FEES);
      expect(details.settlement.amount).toBe(destinationAmount);
      expect(details.settlement.fees).toMatchObject({
        mode: 'app_fees',
        totalAmount: String(total),
        destinationAmount,
        splits: [
          { type: 'royalty', recipient: 'artist.near', bps: 300, amount: String(royalty) },
          { type: 'affiliate', recipient: 'affiliate.near', bps: 100, amount: String(affiliate) },
        ],
      });
      expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    });

    it('out_of_band (default): merchant gets the full total, splits are recorded for reconciliation', async () => {
      const { app, oneClick } = await createApp();
      const { client, orderId, totalAmount } = await createFeedOrder(FEES);
      const total = usdDollarsToUsdcAtomic(totalAmount);

      const { unquoted, quoted } = await quoteFlow(app, orderId);
      expect(unquoted.extra.destination).toMatchObject({ amount: total });
      expect(unquoted.extra.appFees).toBeUndefined();
      expect([...oneClick.quotes.values()][0]!.quoteRequest.appFees).toBeUndefined();

      oneClick.deposit(quoted.payTo, txHash(8), 'SUCCESS');
      expect((await pay(app, orderId, depositHeader(orderId, quoted, txHash(8)))).status).toBe(200);
      const details = (await client.getOrder({ id: orderId })).order.paymentDetails as Record<string, any>;
      expect(details.settlement.amount).toBe(total);
      expect(details.settlement.fees).toMatchObject({ mode: 'out_of_band', destinationAmount: total });
      expect(details.settlement.fees.splits).toHaveLength(2);
    });

    it('app_fees above the 500 bps 1Click cap falls back to out_of_band', async () => {
      setIntentsEnv('app_fees');
      const { app } = await createApp();
      const { orderId, totalAmount } = await createFeedOrder([
        { type: 'royalty', label: 'Artist royalty', recipient: 'artist.near', bps: 600 },
      ]);
      const { unquoted } = await quoteFlow(app, orderId);
      expect(unquoted.extra.appFees).toBeUndefined();
      expect(unquoted.extra.destination).toMatchObject({ amount: usdDollarsToUsdcAtomic(totalAmount) });
    });
  });

  describe('AC5: flag off is Phase 1 only', () => {
    async function unpaidSnapshot(intentsEnabled: string | undefined) {
      clearIntentsEnv();
      if (intentsEnabled !== undefined) {
        // Everything else configured; only the flag differs.
        setIntentsEnv();
        process.env.X402_INTENTS_ENABLED = intentsEnabled;
      }
      const { app, intents } = await createApp();
      const { orderId } = await createOrder();
      const response = await pay(app, orderId);
      const header = response.headers.get('payment-required')!;
      const decoded = decodePaymentRequiredHeader(header);
      return {
        intents,
        status: response.status,
        body: await response.text(),
        header,
        decoded: { ...decoded, resource: { ...decoded.resource, url: '' } },
        orderId,
      };
    }

    it('serves the exact Phase 1 402 when X402_INTENTS_ENABLED is unset or false', async () => {
      const unset = await unpaidSnapshot(undefined);
      await clearOrders();
      const off = await unpaidSnapshot('false');

      for (const snapshot of [unset, off]) {
        expect(snapshot.intents).toBeUndefined();
        expect(snapshot.status).toBe(402);
        expect(snapshot.decoded.accepts).toHaveLength(1);
        expect(snapshot.decoded.accepts[0]!.extra?.assetTransferMethod).toBe('eip3009');
      }
      expect(off.decoded).toEqual(unset.decoded);
      expect(off.body).toBe(unset.body);

      // Byte-identical to a pay app built without the intents option at all.
      const client = await hostClient();
      const phase1 = createX402PayApp({
        payTo: PAY_TO,
        facilitator: phase1Facilitator(),
        syncFacilitatorOnStart: true,
        getOrder: (orderId) => client.getX402PayQuote({ orderId }),
        settleOrder: (orderId, settlement) => client.settleX402Order({ orderId, ...settlement }),
        failOrder: (orderId, settlement) => client.failX402Order({ orderId, ...settlement }),
      });
      const phase1Response = await pay(phase1, off.orderId);
      expect(phase1Response.headers.get('payment-required')).toBe(off.header);
      expect(await phase1Response.text()).toBe(off.body);
    });

    it('a near-intents payment is rejected by Phase 1 when the flag is off and the order is untouched', async () => {
      const on = await createApp();
      const { client, orderId } = await createOrder();
      const unquoted = requiredOf(await pay(on.app, orderId))!.accepts[1]!;

      clearIntentsEnv();
      const { app, facilitator } = await createApp();
      const response = await pay(
        app,
        orderId,
        signature(orderId, unquoted, { type: 'quote', refundTo: REFUND_TO }),
      );
      expect(response.status).toBe(402);
      expect(requiredOf(response)!.accepts).toHaveLength(1);
      expect(facilitator.verifyCalls).toBe(0);
      expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
      expect(await operationsFor(orderId)).toHaveLength(0);
    });

    it('does not record fee splits on x402 orders when the flag is off', async () => {
      clearIntentsEnv();
      const { client, orderId } = await createOrder();
      const details = (await client.getOrder({ id: orderId })).order.paymentDetails as Record<string, any> | null;
      expect(details?.fees).toBeUndefined();
    });
  });

  it('a failed host API call after a successful swap returns 502 without state change, and the retry settles once', async () => {
    let failSettle = true;
    let settleOperation: X402IntentsPayDeps['settleOperation'] | undefined;
    const { app, oneClick, intents } = await createApp({
      overrides: {
        settleOperation: async (input) => {
          if (failSettle) {
            failSettle = false;
            throw new Error('api unavailable');
          }
          return settleOperation!(input);
        },
      },
    });
    const real = createX402IntentsPayDeps((await hostClient()) as never)!;
    settleOperation = real.settleOperation;
    expect(intents).toBeDefined();

    const { client, orderId } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);
    oneClick.deposit(quoted.payTo, txHash(10), 'SUCCESS');

    const first = await pay(app, orderId, depositHeader(orderId, quoted, txHash(10)));
    expect(first.status).toBe(502);
    expect(await first.json()).toEqual({ error: 'intents_unavailable' });
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');

    const retry = await pay(app, orderId, depositHeader(orderId, quoted, txHash(10)));
    expect(retry.status).toBe(200);
    expect(PAID).toContain((await client.getOrder({ id: orderId })).order.status);
    expect(await auditCount(orderId, 'payment.success')).toBe(1);
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const [operation] = await operationsFor(orderId);
    expect(operation!.state).toBe('executed');
    expect(operation!.duplicate).toBe(false);
  });

  it('an order lookup failure on an intents payload returns 502 and changes nothing', async () => {
    const { app } = await createApp();
    const { client, orderId } = await createOrder();
    const { unquoted } = await quoteFlow(app, orderId);
    const { app: broken } = await createApp({
      overrides: {
        getOrderContext: async () => {
          throw new Error('api unavailable');
        },
      },
    });

    const response = await pay(
      broken,
      orderId,
      signature(orderId, unquoted, { type: 'quote', refundTo: REFUND_TO }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'intents_unavailable' });
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
  });

  it('rejects a deposit for another order\'s operation and an unknown origin', async () => {
    const { app } = await createApp();
    const a = await createOrder();
    const { quoted } = await quoteFlow(app, a.orderId);
    const b = await createOrder();

    const crossOrder = await pay(app, b.orderId, depositHeader(b.orderId, quoted, txHash(9)));
    expect(crossOrder.status).toBe(402);
    expect(requiredOf(crossOrder)!.error).toBe('invalid_exact_near_intents_token_invalid');
    expect((await b.client.getOrder({ id: b.orderId })).order.status).toBe('payment_pending');

    const unknownOrigin: PaymentRequirements = { ...quoted, network: 'eip155:10', payTo: `0x${'9'.repeat(40)}` };
    const rejected = await pay(app, b.orderId, depositHeader(b.orderId, unknownOrigin, txHash(9)));
    expect(rejected.status).toBe(402);
    expect(requiredOf(rejected)!.error).toBe('invalid_network');
  });
});
