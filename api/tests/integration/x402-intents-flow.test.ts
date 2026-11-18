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
 * facilitator client -> mock Ping Agent Pay facilitator (`/offers`, `/verify`,
 * `/settle`, `/execution`, X-Api-Key) -> mock 1Click API, with the real API
 * procedures and Postgres underneath. Response shapes follow Ping's x402 docs
 * (pingpay.gitbook.io/docs/pingpay-api/agent-pay-facilitator/x402-integration).
 */

const TEST_USER = 'test-user.near';
const PAY_TO = '0x0000000000000000000000000000000000000abc';
const HOST_SECRET = 'test-x402-host-secret';
const FACILITATOR_URL = 'https://ping.test/agentpay/x402';
const API_KEY = 'test-ping-agentpay-key';
const ONE_CLICK_URL = 'https://1click.test';
const ARB = 'eip155:42161';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const BASE = 'eip155:8453';
const NEAR_MAINNET = 'near:mainnet';
const NEAR_USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
/** Set in the Ping dashboard, never in nearmerch code. */
const NEAR_RECIPIENT = 'merchant-dao.test.near';
const REFUND_TO = '0x2222222222222222222222222222222222222222';
const BUYER = '0x3333333333333333333333333333333333333333';

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
        // NEAR tx hashes are base58.
        destinationTxHash: `NearTx${this.next}${'1'.repeat(38)}`,
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
          nearTxHashes: quote.status === 'SUCCESS' ? [quote.destinationTxHash] : [],
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
    if (!quote.originTxHashes.includes(txHash)) quote.originTxHashes.push(txHash);
    quote.status = status;
  }
}

/**
 * Mock Ping Agent Pay x402 facilitator in front of MockOneClick. Destination
 * (USDC on NEAR to the dashboard recipient) comes from "dashboard" settings;
 * /settle receipts for Intents settlement are on near:mainnet.
 */
class MockPingFacilitator {
  offersCalls = 0;
  verifyCalls = 0;
  settleCalls = 0;
  executionCalls: Array<{ depositAddress: string }> = [];
  verifyBodies: Array<{ paymentRequirements: PaymentRequirements }> = [];
  settleBodies: Array<{ paymentRequirements: PaymentRequirements }> = [];
  apiKeys = new Set<string | null>();
  /** Origins Ping advertises (1Click supported). */
  origins = [
    { network: ARB, asset: ARB_USDC },
    { network: BASE, asset: X402_USDC_BASE },
  ];
  /** Test switches. */
  offersStatus = 200;
  settleTransient = 0;
  receiptAmount: 'exact' | 'omit' | 'wrong' = 'exact';
  private recorded = new Map<string, Record<string, unknown>>();
  private executed = new Set<string>();

  constructor(private oneClick: MockOneClick) {}

  async fetch(input: string, init?: RequestInit): Promise<Response> {
    const url = new URL(input);
    const key = new Headers(init?.headers).get('x-api-key');
    this.apiKeys.add(key);
    if (key !== API_KEY) return Response.json({ error: 'API key required', code: 'unauthorized' }, { status: 401 });
    const path = url.pathname.replace('/agentpay/x402', '');

    if (path === '/offers') {
      this.offersCalls += 1;
      if (this.offersStatus !== 200) {
        return Response.json({ error: 'Agent Pay disabled', code: 'agent_pay_disabled' }, { status: this.offersStatus });
      }
      const amountOut = url.searchParams.get('amountOut')!;
      return Response.json({
        x402Version: 2,
        accepts: this.origins.map((origin) => ({
          scheme: 'exact',
          network: origin.network,
          asset: origin.asset,
          amount: '',
          payTo: '',
          maxTimeoutSeconds: 300,
          extra: {
            settlementBackend: 'near-intents',
            assetTransferMethod: 'near-intents',
            paymentFlow: 'upfront',
            destination: { network: NEAR_MAINNET, asset: NEAR_USDC, amount: amountOut, recipient: NEAR_RECIPIENT },
          },
        })),
      });
    }

    const body = JSON.parse(String(init?.body ?? '{}'));
    if (path === '/verify') {
      const result = await this.verify(body);
      return Response.json(result, { status: 'code' in result ? 400 : 200 });
    }
    if (path === '/settle') {
      if (this.settleTransient > 0) {
        this.settleTransient -= 1;
        return Response.json({ error: 'upstream timeout' }, { status: 504 });
      }
      const result = await this.settle(body);
      const terminal = result.success === false && result.errorReason === 'exact_near_intents_payment_failed';
      return Response.json(result, { status: terminal ? 402 : 200 });
    }
    if (path === '/execution') {
      this.executionCalls.push(body);
      const first = !this.executed.has(body.depositAddress);
      this.executed.add(body.depositAddress);
      return Response.json({ execute: first });
    }
    return Response.json({ message: 'unknown route' }, { status: 404 });
  }

  private async verify(body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }) {
    this.verifyCalls += 1;
    this.verifyBodies.push(body);
    const { paymentPayload, paymentRequirements } = body;
    const payload = paymentPayload.payload as { refundTo?: string; slippageTolerance?: number };
    if (!payload.refundTo) return { error: 'refundTo required', code: 'refund_address_required' };
    const destination = paymentRequirements.extra.destination as { amount: string; recipient: string };
    const deadline = new Date(Date.now() + paymentRequirements.maxTimeoutSeconds * 1000).toISOString();
    const response = await this.oneClick.fetch(`${ONE_CLICK_URL}/v0/quote`, {
      method: 'POST',
      body: JSON.stringify({
        dry: false,
        swapType: 'EXACT_OUTPUT',
        depositType: 'ORIGIN_CHAIN',
        originAsset: `nep141:${paymentRequirements.network}-${paymentRequirements.asset.toLowerCase()}.omft.near`,
        destinationAsset: `nep141:${NEAR_USDC}`,
        amount: destination.amount,
        recipient: destination.recipient,
        recipientType: 'INTENTS',
        refundTo: payload.refundTo,
        refundType: 'ORIGIN_CHAIN',
        slippageTolerance: payload.slippageTolerance ?? 100,
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
        operationToken: `ping.${quote.quote.depositAddress}.hmac`,
      },
    };
  }

  private async settle(body: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }) {
    this.settleCalls += 1;
    this.settleBodies.push(body);
    const { paymentPayload, paymentRequirements } = body;
    const deposit = paymentPayload.payload as { depositAddress: string; txHash: string; operationToken: string };
    if (deposit.operationToken !== `ping.${deposit.depositAddress}.hmac`) {
      return { success: false, errorReason: 'invalid_exact_near_intents_token_invalid', transaction: '', network: paymentPayload.accepted.network };
    }
    const operation = `${paymentPayload.accepted.network}:${deposit.depositAddress}`;
    const recorded = this.recorded.get(operation);
    if (recorded) return recorded;

    const destination = paymentRequirements.extra.destination as { network: string; amount: string; recipient: string };
    const status = (await (
      await this.oneClick.fetch(`${ONE_CLICK_URL}/v0/status?depositAddress=${deposit.depositAddress}`)
    ).json()) as {
      status: OneClickStatus;
      quoteResponse: { quoteRequest: { amount: string; recipient: string; refundTo: string } };
      swapDetails: { originChainTxHashes: Array<{ hash: string }>; nearTxHashes: string[] };
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
        network: NEAR_MAINNET,
        transaction: status.swapDetails.nearTxHashes[0]!,
        payer: BUYER,
        ...(this.receiptAmount === 'omit'
          ? {}
          : { amount: this.receiptAmount === 'exact' ? destination.amount : '1' }),
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
    } else if (status.status === 'INCOMPLETE_DEPOSIT') {
      // Short deposit: challenge stays active, top up and retry the same token.
      return {
        success: false,
        errorReason: 'exact_near_intents_insufficient_deposit',
        network: paymentPayload.accepted.network,
        transaction: deposit.txHash,
        extra: { status: 'INCOMPLETE_DEPOSIT' },
      };
    } else {
      return { success: false, errorReason: 'settlement_pending', network: paymentPayload.accepted.network, transaction: deposit.txHash };
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
  options: {
    now?: () => number;
    overrides?: Partial<X402IntentsPayDeps>;
    /** false: intents-only (no Base pay-to). */
    withPhase1?: boolean;
    setup?: (facilitator: MockPingFacilitator) => void;
  } = {},
) {
  const oneClick = new MockOneClick();
  const facilitator = new MockPingFacilitator(oneClick);
  options.setup?.(facilitator);
  const client = await hostClient();
  const deps = createX402IntentsPayDeps(client as never, {
    fetch: ((input: string, init?: RequestInit) => facilitator.fetch(input, init)) as typeof fetch,
  });
  const intents: X402IntentsPayDeps | undefined = deps
    ? { ...deps, ...(options.now ? { now: options.now } : {}), ...options.overrides }
    : undefined;
  const app = createX402PayApp({
    payTo: options.withPhase1 === false ? undefined : PAY_TO,
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
async function quoteFlow(
  app: Awaited<ReturnType<typeof createApp>>['app'],
  orderId: string,
  network: string = ARB,
) {
  const unpaid = await pay(app, orderId);
  expect(unpaid.status).toBe(402);
  const unquoted = requiredOf(unpaid)!.accepts.find(
    (entry) => entry.extra?.assetTransferMethod === 'near-intents' && entry.network === network,
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

function setIntentsEnv() {
  process.env.X402_INTENTS_FACILITATOR_URL = FACILITATOR_URL;
  process.env.X402_INTENTS_FACILITATOR_API_KEY = API_KEY;
}

function clearIntentsEnv() {
  delete process.env.X402_INTENTS_ENABLED;
  delete process.env.X402_INTENTS_FACILITATOR_URL;
  delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
  delete process.env.X402_INTENTS_ORIGINS;
}

describe('x402 near-intents flow via Ping Agent Pay (#238)', () => {
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
    process.env.X402_PAY_TO_ADDRESS = PAY_TO;
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
    process.env.X402_PAY_TO_ADDRESS = PAY_TO;
    await clearOrders();
    await clearProducts();
    await getTestDb().delete(schema.providerConfigs).where(eq(schema.providerConfigs.provider, 'manual'));
  });

  it('AC1: pays from USDC on Arbitrum; the merchant gets the exact amount as USDC on NEAR to the dashboard recipient', async () => {
    const { app, oneClick, facilitator } = await createApp();
    const { client, orderId, totalAmount } = await createOrder();
    const total = usdDollarsToUsdcAtomic(totalAmount);

    const unpaid = await pay(app, orderId);
    const required = requiredOf(unpaid)!;
    // Phase 1 exact/Base entry first, then Ping's unquoted offers.
    expect(required.accepts).toHaveLength(3);
    expect(required.accepts[0]!.extra?.assetTransferMethod).toBe('eip3009');
    const unquoted = required.accepts[1]!;
    expect(unquoted).toEqual({
      scheme: 'exact',
      network: ARB,
      asset: ARB_USDC,
      amount: '',
      payTo: '',
      maxTimeoutSeconds: 300,
      extra: {
        settlementBackend: 'near-intents',
        assetTransferMethod: 'near-intents',
        paymentFlow: 'upfront',
        destination: { network: NEAR_MAINNET, asset: NEAR_USDC, amount: total, recipient: NEAR_RECIPIENT },
      },
    });
    expect(required.accepts[2]).toMatchObject({ network: BASE, asset: X402_USDC_BASE, payTo: '' });

    const { quoted } = await quoteFlow(app, orderId);
    // The 402 offers are cached; one /offers call for both 402s.
    expect(facilitator.offersCalls).toBe(1);
    expect(facilitator.verifyCalls).toBe(1);
    // /verify gets Ping's own offer entry, never the client's `accepted`.
    expect(facilitator.verifyBodies[0]!.paymentRequirements).toEqual(unquoted);
    const [oneClickQuote] = [...oneClick.quotes.values()];
    expect(oneClickQuote!.quoteRequest).toMatchObject({
      swapType: 'EXACT_OUTPUT',
      amount: total,
      recipient: NEAR_RECIPIENT,
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
      network: NEAR_MAINNET,
      transaction: oneClickQuote!.destinationTxHash,
      amount: total,
      extra: { originNetwork: ARB, originTxHash: txHash(1) },
    });
    expect(JSON.stringify(receipt)).not.toContain('operationToken');
    // /settle used our recorded destination with the quoted instrument.
    const settleRequirements = facilitator.settleBodies[0]!.paymentRequirements;
    expect(settleRequirements.extra.destination).toEqual(unquoted.extra.destination);
    expect(settleRequirements.payTo).toBe(quoted.payTo);
    expect(settleRequirements.amount).toBe(quoted.amount);
    // Every Ping call carried the API key; execution was claimed once.
    expect([...facilitator.apiKeys]).toEqual([API_KEY]);
    expect(facilitator.executionCalls).toEqual([{ depositAddress: quoted.payTo }]);

    order = await client.getOrder({ id: orderId });
    expect(order.order.status).toBe('processing');
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const settlement = (order.order.paymentDetails as Record<string, any>).settlement;
    expect(settlement).toMatchObject({
      method: 'near-intents',
      network: NEAR_MAINNET,
      transaction: oneClickQuote!.destinationTxHash,
      amount: total,
      originNetwork: ARB,
      originTxHash: txHash(1),
      depositAddress: quoted.payTo,
    });

    const [operation] = await operationsFor(orderId);
    expect(operation!.state).toBe('executed');
    expect(operation!.duplicate).toBe(false);
  });

  describe('intents-only (no X402_PAY_TO_ADDRESS)', () => {
    beforeEach(() => {
      delete process.env.X402_PAY_TO_ADDRESS;
    });

    it('creates x402 orders, serves only Ping offers, and settles end to end', async () => {
      const { app, oneClick, facilitator } = await createApp({ withPhase1: false });
      const { client, orderId, totalAmount } = await createOrder();

      const unpaid = await pay(app, orderId);
      expect(unpaid.status).toBe(402);
      const required = requiredOf(unpaid)!;
      expect(required.accepts.map((entry) => entry.network)).toEqual([ARB, BASE]);
      expect(required.accepts.every((entry) => entry.extra?.assetTransferMethod === 'near-intents')).toBe(true);
      expect(required.resource.url).toBe(resourceUrl(orderId));

      // A Base eip3009 payment has nothing to settle against: 402 with the offers.
      const eip3009 = await pay(
        app,
        orderId,
        signature(orderId, { ...required.accepts[1]!, extra: { assetTransferMethod: 'eip3009' } }, { signature: '0x' }),
      );
      expect(eip3009.status).toBe(402);
      expect(requiredOf(eip3009)!.error).toBe('unsupported_scheme');
      expect(requiredOf(eip3009)!.accepts).toHaveLength(2);

      // Pay from Base USDC through intents.
      const { quoted } = await quoteFlow(app, orderId, BASE);
      oneClick.deposit(quoted.payTo, txHash(11), 'SUCCESS');
      const paid = await pay(app, orderId, depositHeader(orderId, quoted, txHash(11)));
      expect(paid.status).toBe(200);
      expect(receiptOf(paid)).toMatchObject({ network: NEAR_MAINNET, amount: usdDollarsToUsdcAtomic(totalAmount) });
      expect((await client.getOrder({ id: orderId })).order.status).toBe('processing');
      expect(facilitator.executionCalls).toHaveLength(1);

      // A paid order answers 200 idempotently.
      const again = await pay(app, orderId);
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ orderId, idempotent: true });
    });

    it('answers 503 when Ping offers are unavailable and changes nothing', async () => {
      const { app } = await createApp({ withPhase1: false, setup: (f) => { f.offersStatus = 403; } });
      const { client, orderId } = await createOrder();
      const response = await pay(app, orderId);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'intents_unavailable' });
      expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
    });
  });

  it('serves Phase 1 only when Ping offers fail', async () => {
    const { app } = await createApp({ setup: (f) => { f.offersStatus = 403; } });
    const { orderId } = await createOrder();
    const required = requiredOf(await pay(app, orderId))!;
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]!.extra?.assetTransferMethod).toBe('eip3009');
  });

  it('X402_INTENTS_ORIGINS narrows Ping offers; other origins are rejected before any quote', async () => {
    process.env.X402_INTENTS_ORIGINS = JSON.stringify([BASE]);
    const { app, facilitator } = await createApp();
    const { orderId } = await createOrder();
    const required = requiredOf(await pay(app, orderId))!;
    expect(required.accepts.map((entry) => entry.network)).toEqual([X402_NETWORK, BASE]);

    const arbOffer: PaymentRequirements = { ...required.accepts[1]!, network: ARB, asset: ARB_USDC };
    const rejected = await pay(app, orderId, signature(orderId, arbOffer, { type: 'quote', refundTo: REFUND_TO }));
    expect(rejected.status).toBe(402);
    expect(requiredOf(rejected)!.error).toBe('invalid_network');
    expect(facilitator.verifyCalls).toBe(0);
  });

  it('AC2: a refunded swap (terminal 402 from Ping) marks the order payment_failed', async () => {
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

  it('AC3: INCOMPLETE_DEPOSIT keeps payment_pending, blocks new quotes, and the top-up retry converges to one charge and one fulfillment', async () => {
    const start = Date.now();
    let offset = 0;
    const { app, oneClick, facilitator } = await createApp({ now: () => start + offset });
    const { client, orderId } = await createOrder();
    const { quoted, unquoted } = await quoteFlow(app, orderId);

    oneClick.deposit(quoted.payTo, txHash(3), 'INCOMPLETE_DEPOSIT');
    const pending = await pay(app, orderId, depositHeader(orderId, quoted, txHash(3)));
    expect(pending.status).toBe(402);
    expect(requiredOf(pending)!.error).toBe('settlement_pending');
    expect(receiptOf(pending)).toMatchObject({ success: false, extra: { status: 'INCOMPLETE_DEPOSIT' } });

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

    // Still processing after the top-up: settlement_pending, same state.
    oneClick.deposit(quoted.payTo, txHash(3), 'PROCESSING');
    const processing = await pay(app, orderId, depositHeader(orderId, quoted, txHash(3)));
    expect(requiredOf(processing)!.error).toBe('settlement_pending');

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
    expect(facilitator.executionCalls).toHaveLength(1);
    expect(await auditCount(orderId, 'fulfillment:confirmed')).toBe(1);
    const operations = await operationsFor(orderId);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.state).toBe('executed');
  });

  it('AC3: a 504 from Ping changes nothing and the retry settles', async () => {
    const { app, oneClick, facilitator } = await createApp({ setup: (f) => { f.settleTransient = 1; } });
    const { client, orderId } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);
    oneClick.deposit(quoted.payTo, txHash(12), 'SUCCESS');

    const transient = await pay(app, orderId, depositHeader(orderId, quoted, txHash(12)));
    expect(transient.status).toBe(502);
    expect(await transient.json()).toEqual({ error: 'facilitator_unavailable' });
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
    expect((await operationsFor(orderId))[0]!.state).toBe('quoted');

    const retry = await pay(app, orderId, depositHeader(orderId, quoted, txHash(12)));
    expect(retry.status).toBe(200);
    expect(facilitator.settleCalls).toBe(1);
    expect((await client.getOrder({ id: orderId })).order.status).toBe('processing');
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

  it('accepts a receipt without an amount and records the destination amount', async () => {
    const { app, oneClick } = await createApp({ setup: (f) => { f.receiptAmount = 'omit'; } });
    const { client, orderId, totalAmount } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);
    oneClick.deposit(quoted.payTo, txHash(13), 'SUCCESS');
    expect((await pay(app, orderId, depositHeader(orderId, quoted, txHash(13)))).status).toBe(200);
    const settlement = ((await client.getOrder({ id: orderId })).order.paymentDetails as Record<string, any>).settlement;
    expect(settlement.amount).toBe(usdDollarsToUsdcAtomic(totalAmount));
  });

  it('a receipt for a different amount is not accepted as payment', async () => {
    const { app, oneClick } = await createApp({ setup: (f) => { f.receiptAmount = 'wrong'; } });
    const { client, orderId } = await createOrder();
    const { quoted } = await quoteFlow(app, orderId);
    oneClick.deposit(quoted.payTo, txHash(14), 'SUCCESS');
    const response = await pay(app, orderId, depositHeader(orderId, quoted, txHash(14)));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'settlement_mismatch' });
    expect((await client.getOrder({ id: orderId })).order.status).toBe('payment_pending');
  });

  it('AC4: fee splits are recorded out of band; the merchant destination is the full total', async () => {
    const FEES: FeeConfig[] = [
      { type: 'royalty', label: 'Artist royalty', recipient: 'artist.near', bps: 300 },
      { type: 'affiliate', label: 'Affiliate', recipient: 'affiliate.near', bps: 100 },
    ];
    await createTestProduct('prod_fees', { fulfillmentProvider: 'manual', metadata: { fees: FEES } as never });
    await createTestProductVariant('var_fees', 'prod_fees');
    const { app, oneClick } = await createApp();
    const { client, orderId, totalAmount } = await createOrder('prod_fees', 'var_fees');
    const total = usdDollarsToUsdcAtomic(totalAmount);

    const { unquoted, quoted } = await quoteFlow(app, orderId);
    expect(unquoted.extra.destination).toMatchObject({ amount: total });
    expect(unquoted.extra.appFees).toBeUndefined();

    oneClick.deposit(quoted.payTo, txHash(8), 'SUCCESS');
    expect((await pay(app, orderId, depositHeader(orderId, quoted, txHash(8)))).status).toBe(200);
    const details = (await client.getOrder({ id: orderId })).order.paymentDetails as Record<string, any>;
    expect(details.fees).toEqual(FEES);
    expect(details.settlement.amount).toBe(total);
    expect(details.settlement.fees).toMatchObject({ mode: 'out_of_band', destinationAmount: total });
    expect(details.settlement.fees.splits).toHaveLength(2);
  });

  describe('AC5: X402_INTENTS_ENABLED=false is Phase 1 only', () => {
    it('serves the exact Phase 1 402, byte-identical to a pay app without intents', async () => {
      process.env.X402_INTENTS_ENABLED = 'false';
      const { app, intents } = await createApp();
      expect(intents).toBeUndefined();
      const { orderId } = await createOrder();
      const off = await pay(app, orderId);
      expect(off.status).toBe(402);
      const header = off.headers.get('payment-required')!;
      expect(decodePaymentRequiredHeader(header).accepts).toHaveLength(1);

      const client = await hostClient();
      const phase1 = createX402PayApp({
        payTo: PAY_TO,
        facilitator: phase1Facilitator(),
        syncFacilitatorOnStart: true,
        getOrder: (id) => client.getX402PayQuote({ orderId: id }),
        settleOrder: (id, settlement) => client.settleX402Order({ orderId: id, ...settlement }),
        failOrder: (id, settlement) => client.failX402Order({ orderId: id, ...settlement }),
      });
      const phase1Response = await pay(phase1, orderId);
      expect(phase1Response.headers.get('payment-required')).toBe(header);
      expect(await phase1Response.text()).toBe(await off.text());
    });

    it('is inactive without an API key', async () => {
      delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
      const { intents } = await createApp();
      expect(intents).toBeUndefined();
    });

    it('a near-intents payment is rejected by Phase 1 when the flag is off and the order is untouched', async () => {
      const on = await createApp();
      const { client, orderId } = await createOrder();
      const unquoted = requiredOf(await pay(on.app, orderId))!.accepts[1]!;

      process.env.X402_INTENTS_ENABLED = 'false';
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
      process.env.X402_INTENTS_ENABLED = 'false';
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
