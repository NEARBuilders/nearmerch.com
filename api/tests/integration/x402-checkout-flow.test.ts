import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FacilitatorClient } from '@x402/core/server';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { getPluginClient, runMigrations, teardown } from '../setup';
import { clearOrders, clearProducts, createTestProduct, createTestProductVariant } from '../helpers';
import { createX402PayApp } from '@/services/payment/x402/pay-app';
import { usdDollarsToUsdcAtomic } from '@/services/payment/x402/amount';
import { X402_NETWORK, X402_SCHEME, X402_USDC_BASE } from '@/services/payment/x402/constants';
import { X402_HOST_SECRET_HEADER } from '@/services/payment/x402/config';

const TEST_USER = 'test-user.near';
const PAY_TO = '0x0000000000000000000000000000000000000abc';
const HOST_SECRET = 'test-x402-host-secret';

const mockShippingAddress = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  addressLine1: '123 Main St',
  city: 'Los Angeles',
  state: 'CA',
  postCode: '90001',
  country: 'US',
};

const mockCartItems = [
  {
    productId: 'prod_x402',
    variantId: 'var_x402',
    quantity: 1,
  },
];

function mockFacilitator(options?: {
  valid?: boolean;
  settleSuccess?: boolean;
}): FacilitatorClient {
  const valid = options?.valid ?? true;
  const settleSuccess = options?.settleSuccess ?? true;

  return {
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: X402_SCHEME,
            network: X402_NETWORK,
          },
        ],
        extensions: [],
        signers: {},
      };
    },
    async verify() {
      return {
        isValid: valid,
        invalidReason: valid ? undefined : 'insufficient_funds',
        payer: '0x1111111111111111111111111111111111111111',
      };
    },
    async settle() {
      if (!settleSuccess) {
        throw new Error('settlement_failed');
      }
      return {
        success: true,
        transaction: '0xsettlementtx',
        network: X402_NETWORK,
        payer: '0x1111111111111111111111111111111111111111',
      };
    },
  };
}

async function createX402Order() {
  const client = await getPluginClient({ nearAccountId: TEST_USER });
  const quoteResult = await client.quote({
    items: mockCartItems,
    shippingAddress: mockShippingAddress,
  });

  const selectedRates: Record<string, string> = {};
  quoteResult.providerBreakdown.forEach((provider) => {
    selectedRates[provider.provider] = provider.selectedShipping.rateId;
  });

  const checkoutResult = await client.createCheckout({
    items: mockCartItems,
    shippingAddress: mockShippingAddress,
    selectedRates,
    shippingCost: quoteResult.shippingCost,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    paymentProvider: 'x402',
  });

  return { client, checkoutResult };
}

async function getX402HostClient() {
  const reqHeaders = new Headers();
  reqHeaders.set(X402_HOST_SECRET_HEADER, HOST_SECRET);
  return getPluginClient({ reqHeaders });
}

function createPayApp(facilitator: FacilitatorClient) {
  return createX402PayApp({
    payTo: PAY_TO,
    facilitator,
    syncFacilitatorOnStart: true,
    getOrder: async (orderId) => {
      const client = await getX402HostClient();
      return client.getX402PayQuote({ orderId });
    },
    settleOrder: async (orderId, settlement) => {
      const client = await getX402HostClient();
      return client.settleX402Order({ orderId, ...settlement });
    },
    failOrder: async (orderId, settlement) => {
      const client = await getX402HostClient();
      return client.failX402Order({ orderId, ...settlement });
    },
  });
}

function paymentHeader(amount: string) {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: {
      scheme: X402_SCHEME,
      network: X402_NETWORK,
      amount,
      asset: X402_USDC_BASE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 900,
      extra: {},
    },
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: {
        from: '0x1111111111111111111111111111111111111111',
        to: PAY_TO,
        value: amount,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 900),
        nonce: `0x${'11'.repeat(32)}`,
      },
    },
  });
}

describe('x402 checkout flow', () => {
  beforeAll(async () => {
    process.env.X402_ENABLED = 'true';
    process.env.X402_PAY_TO_ADDRESS = PAY_TO;
    process.env.X402_HOST_SECRET = HOST_SECRET;
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearProducts();
    await createTestProduct('prod_x402', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('var_x402', 'prod_x402');
  });

  afterEach(async () => {
    await clearOrders();
    await clearProducts();
  });

  it('creates an x402 order in payment_pending without a hosted checkout URL', async () => {
    const { checkoutResult, client } = await createX402Order();

    expect(checkoutResult.orderId).toBeDefined();
    expect(checkoutResult.checkoutUrl).toBeUndefined();
    expect(checkoutResult.totalAmount).toBeGreaterThan(0);
    expect(checkoutResult.currency).toBe('USD');
    expect(checkoutResult.status).toBe('payment_pending');

    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('payment_pending');
    expect(order.order.checkoutProvider).toBe('x402');
  });

  it('returns a 402 challenge for USDC on Base matching the order total', async () => {
    const { checkoutResult } = await createX402Order();
    const app = createPayApp(mockFacilitator());

    const response = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
    });

    expect(response.status).toBe(402);
    const paymentRequiredHeader =
      response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
    const body = (await response.json()) as {
      accepts?: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string }>;
    };
    const fromHeader = paymentRequiredHeader
      ? decodePaymentRequiredHeader(paymentRequiredHeader)
      : undefined;
    const accept = fromHeader?.accepts?.[0] ?? body.accepts?.[0];
    expect(accept?.scheme).toBe(X402_SCHEME);
    expect(accept?.network).toBe(X402_NETWORK);
    expect(accept?.asset).toBe(X402_USDC_BASE);
    expect(accept?.payTo.toLowerCase()).toBe(PAY_TO.toLowerCase());
    expect(accept?.amount).toBe(usdDollarsToUsdcAtomic(checkoutResult.totalAmount));
  });

  it('settles a valid payment and confirms fulfillment without double-confirming retries', async () => {
    const { checkoutResult, client } = await createX402Order();
    const app = createPayApp(mockFacilitator());
    const amount = usdDollarsToUsdcAtomic(checkoutResult.totalAmount);
    const headers = { 'payment-signature': paymentHeader(amount) };

    const paid = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers,
    });

    expect(paid.status).toBe(200);
    const paidBody = (await paid.json()) as { orderId: string; status: string };
    expect(paidBody.orderId).toBe(checkoutResult.orderId);

    let order = await client.getOrder({ id: checkoutResult.orderId });
    expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(order.order.status);

    const retry = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers,
    });

    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { idempotent?: boolean; status: string };
    expect(retryBody.idempotent).toBe(true);
    expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(retryBody.status);

    order = await client.getOrder({ id: checkoutResult.orderId });
    expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(order.order.status);
  });

  it('does not mutate order state when verification fails', async () => {
    const { checkoutResult, client } = await createX402Order();
    const app = createPayApp(mockFacilitator({ valid: false }));
    const amount = usdDollarsToUsdcAtomic(checkoutResult.totalAmount);

    const response = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers: { 'payment-signature': paymentHeader(amount) },
    });

    expect(response.status).toBe(402);
    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('payment_pending');
  });

  it('marks the order payment_failed when settlement fails', async () => {
    const { checkoutResult, client } = await createX402Order();
    const app = createPayApp(mockFacilitator({ settleSuccess: false }));
    const amount = usdDollarsToUsdcAtomic(checkoutResult.totalAmount);

    const response = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers: { 'payment-signature': paymentHeader(amount) },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('payment_failed');
  });

  it('does not settle a non-payable order', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    const quoteResult = await client.quote({
      items: mockCartItems,
      shippingAddress: mockShippingAddress,
    });
    const selectedRates: Record<string, string> = {};
    quoteResult.providerBreakdown.forEach((provider) => {
      selectedRates[provider.provider] = provider.selectedShipping.rateId;
    });

    const checkoutResult = await client.createCheckout({
      items: mockCartItems,
      shippingAddress: mockShippingAddress,
      selectedRates,
      shippingCost: quoteResult.shippingCost,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      paymentProvider: 'pingpay',
    });

    const app = createPayApp(mockFacilitator());
    const response = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers: {
        'payment-signature': paymentHeader(
          usdDollarsToUsdcAtomic(checkoutResult.totalAmount),
        ),
      },
    });

    expect(response.status).not.toBe(200);
    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('draft_created');
    expect(order.order.checkoutProvider).toBe('pingpay');
  });

  it('rejects unauthenticated internal settle and does not mark the order paid', async () => {
    const { checkoutResult, client } = await createX402Order();

    await expect(
      client.settleX402Order({
        orderId: checkoutResult.orderId,
        transaction: '0xattacker',
      }),
    ).rejects.toThrow();

    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('payment_pending');
  });

  it('does not create an x402 order when pay-to is missing', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    const quoteResult = await client.quote({
      items: mockCartItems,
      shippingAddress: mockShippingAddress,
    });
    const selectedRates: Record<string, string> = {};
    quoteResult.providerBreakdown.forEach((provider) => {
      selectedRates[provider.provider] = provider.selectedShipping.rateId;
    });

    const previous = process.env.X402_PAY_TO_ADDRESS;
    process.env.X402_PAY_TO_ADDRESS = '';

    try {
      await expect(
        client.createCheckout({
          items: mockCartItems,
          shippingAddress: mockShippingAddress,
          selectedRates,
          shippingCost: quoteResult.shippingCost,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          paymentProvider: 'x402',
        }),
      ).rejects.toThrow(/pay-to/i);
    } finally {
      process.env.X402_PAY_TO_ADDRESS = previous;
    }
  });

  it('does not mutate order state for a wrong-asset payment', async () => {
    const { checkoutResult, client } = await createX402Order();
    const facilitator = mockFacilitator({ valid: false });
    facilitator.verify = async () => ({
      isValid: false,
      invalidReason: 'invalid_exact_evm_payload_invalid_asset',
      payer: '0x1111111111111111111111111111111111111111',
    });
    const app = createPayApp(facilitator);
    const amount = usdDollarsToUsdcAtomic(checkoutResult.totalAmount);

    const response = await app.request(`/orders/${checkoutResult.orderId}/pay`, {
      method: 'POST',
      headers: { 'payment-signature': paymentHeader(amount) },
    });

    expect(response.status).toBe(402);
    const order = await client.getOrder({ id: checkoutResult.orderId });
    expect(order.order.status).toBe('payment_pending');
  });
});
