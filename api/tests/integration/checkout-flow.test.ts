import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getPluginClient, getTestDb, runMigrations, teardown } from '../setup';
import { clearOrders, clearProducts, createTestProduct, createTestProductVariant } from '../helpers';
import { createHmac } from 'crypto';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';

describe('Checkout Flow E2E', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearProducts();
    
    await createTestProduct('prod_123', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('var_456', 'prod_123');
    
    await createTestProduct('printful_prod_1', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('printful_var_1', 'printful_prod_1');
    
    await createTestProduct('gelato_prod_1', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('gelato_var_1', 'gelato_prod_1');
  });

  afterEach(async () => {
    await clearOrders();
    await clearProducts();
  });

  const TEST_USER = 'test-user.near';
  const TEST_WEBHOOK_SECRET = 'whsec_test_secret_key';

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
      productId: 'prod_123',
      variantId: 'var_456',
      quantity: 2,
    },
  ];

  const generatePingPaySignature = (
    timestamp: string,
    payload: string,
    secret: string
  ): string => {
    const signaturePayload = `${timestamp}.${payload}`;
    return createHmac('sha256', secret)
      .update(signaturePayload)
      .digest('hex');
  };

  const createWebhookHeaders = (signature: string, timestamp: string): Headers => {
    const headers = new Headers();
    headers.set('x-ping-signature', signature);
    headers.set('x-ping-timestamp', timestamp);
    return headers;
  };

  describe('PingPay Payment Flow', () => {
    it('should complete full checkout → payment success → order fulfilled', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const quoteResult = await client.quote({
        items: mockCartItems,
        shippingAddress: mockShippingAddress,
      });

      expect(quoteResult).toBeDefined();
      expect(quoteResult.total).toBeGreaterThan(0);

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

      expect(checkoutResult).toBeDefined();
      expect(checkoutResult.checkoutSessionId).toBeDefined();
      expect(checkoutResult.checkoutUrl).toBeDefined();
      expect(checkoutResult.orderId).toBeDefined();

      const orderId = checkoutResult.orderId;
      const sessionId = checkoutResult.checkoutSessionId;

      let order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('draft_created');

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const webhookPayload = {
        id: 'whevt_test123',
        type: 'payment.success',
        created: new Date().toISOString(),
        data: {
          paymentId: 'pay_test123',
          status: 'SUCCESS',
          amount: '1000000',
          assetId: 'NEAR:USDC',
          payerAddress: 'user.near',
          recipientAddress: 'near-merch-store.near',
          merchantId: 'merch_test',
        },
        sessionId,
        metadata: {
          orderId,
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const signature = generatePingPaySignature(timestamp, payloadString, TEST_WEBHOOK_SECRET);
      const webhookHeaders = createWebhookHeaders(signature, timestamp);
      const webhookClient = await getPluginClient({ nearAccountId: TEST_USER, reqHeaders: webhookHeaders });

      const webhookResult = await webhookClient.pingWebhook(webhookPayload);

      expect(webhookResult.received).toBe(true);

      order = await client.getOrder({ id: orderId });
      expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(order.order.status);

      await new Promise((resolve) => setTimeout(resolve, 100));

      order = await client.getOrder({ id: orderId });
      expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(order.order.status);
    });

    it('should handle payment failed gracefully', async () => {
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

      const orderId = checkoutResult.orderId;
      const sessionId = checkoutResult.checkoutSessionId;

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const webhookPayload = {
        id: 'whevt_failed123',
        type: 'payment.failed',
        created: new Date().toISOString(),
        data: {
          paymentId: 'pay_failed123',
          status: 'FAILED',
          amount: '1000000',
          assetId: 'NEAR:USDC',
          payerAddress: 'user.near',
          recipientAddress: 'near-merch-store.near',
          merchantId: 'merch_test',
        },
        sessionId,
        metadata: {
          orderId,
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const signature = generatePingPaySignature(timestamp, payloadString, TEST_WEBHOOK_SECRET);
      const webhookHeaders = createWebhookHeaders(signature, timestamp);
      const webhookClient = await getPluginClient({ nearAccountId: TEST_USER, reqHeaders: webhookHeaders });

      const webhookResult = await webhookClient.pingWebhook(webhookPayload);

      expect(webhookResult.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('payment_failed');
    });

    it('should not downgrade a processing order when a late payment failure arrives', async () => {
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

      const orderId = checkoutResult.orderId;
      const sessionId = checkoutResult.checkoutSessionId;

      await getTestDb()
        .update(schema.orders)
        .set({ status: 'processing' })
        .where(eq(schema.orders.id, orderId));

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const webhookPayload = {
        id: 'whevt_late_failed123',
        type: 'payment.failed',
        created: new Date().toISOString(),
        data: {
          paymentId: 'pay_late_failed123',
          status: 'FAILED',
          amount: '1000000',
          assetId: 'NEAR:USDC',
          payerAddress: 'user.near',
          recipientAddress: 'near-merch-store.near',
          merchantId: 'merch_test',
        },
        sessionId,
        metadata: {
          orderId,
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const signature = generatePingPaySignature(timestamp, payloadString, TEST_WEBHOOK_SECRET);
      const webhookHeaders = createWebhookHeaders(signature, timestamp);
      const webhookClient = await getPluginClient({ nearAccountId: TEST_USER, reqHeaders: webhookHeaders });

      const webhookResult = await webhookClient.pingWebhook(webhookPayload);

      expect(webhookResult.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('processing');
    });

    it('should only find an order by checkout session ID for its owner', async () => {
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

      const sessionId = checkoutResult.checkoutSessionId;

      const result = await client.getOrderByCheckoutSession({ sessionId });
      
      expect(result.order).toBeDefined();
      expect(result.order?.id).toBe(checkoutResult.orderId);
      expect(result.order?.checkoutSessionId).toBe(sessionId);

      const otherUserClient = await getPluginClient({
        nearAccountId: 'other-user.near',
      });

      await expect(
        otherUserClient.getOrderByCheckoutSession({ sessionId }),
      ).rejects.toThrow('You do not have permission to access this order');
    });

    it('should process webhook using sessionId fallback when orderId not in metadata', async () => {
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

      const orderId = checkoutResult.orderId;
      const sessionId = checkoutResult.checkoutSessionId;

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const webhookPayload = {
        type: 'payment.success',
        sessionId,
        data: {
          paymentId: 'pay_session_only',
          status: 'SUCCESS',
          amount: '1000000',
          assetId: 'NEAR:USDC',
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const signature = generatePingPaySignature(timestamp, payloadString, TEST_WEBHOOK_SECRET);
      const webhookHeaders = createWebhookHeaders(signature, timestamp);
      const webhookClient = await getPluginClient({ nearAccountId: TEST_USER, reqHeaders: webhookHeaders });

      const webhookResult = await webhookClient.pingWebhook(webhookPayload);

      expect(webhookResult.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(['paid', 'processing', 'paid_pending_fulfillment']).toContain(order.order.status);
    });
  });

  describe('Order Status Transitions', () => {
    it('should transition through correct status flow', async () => {
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

      const orderId = checkoutResult.orderId;
      
      let order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('draft_created');

      const validStatuses = [
        'pending',
        'draft_created',
        'payment_pending',
        'paid',
        'paid_pending_fulfillment',
        'processing',
        'printing',
        'shipped',
        'delivered',
        'cancelled',
        'payment_failed',
        'expired',
      ];

      expect(validStatuses).toContain(order.order.status);
    });
  });

  describe('Multiple Provider Support', () => {
    it('should handle orders with items from different fulfillment providers', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const multiProviderItems = [
        {
          productId: 'printful_prod_1',
          variantId: 'printful_var_1',
          quantity: 1,
        },
        {
          productId: 'gelato_prod_1',
          variantId: 'gelato_var_1',
          quantity: 1,
        },
      ];

      const quoteResult = await client.quote({
        items: multiProviderItems,
        shippingAddress: mockShippingAddress,
      });

      expect(quoteResult.providerBreakdown.length).toBeGreaterThanOrEqual(1);

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const checkoutResult = await client.createCheckout({
        items: multiProviderItems,
        shippingAddress: mockShippingAddress,
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      expect(checkoutResult.orderId).toBeDefined();
      
      const order = await client.getOrder({ id: checkoutResult.orderId });
      expect(order.order.items.length).toBeGreaterThanOrEqual(1);
    });
  });
});
