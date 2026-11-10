import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { getPluginClient, getTestDb, runMigrations, teardown } from '../setup';
import { clearOrders, clearProducts, createTestOrder, createTestProduct, createTestProductVariant } from '../helpers';

const TEST_USER = 'payment-webhook-test.near';
const WEBHOOK_SECRET = 'whsec_test_secret_key';
const STRIPE_WEBHOOK_SECRET = 'whsec_stripe_test_secret_key';

const shippingAddress = {
  firstName: 'Payment',
  lastName: 'Test',
  email: 'payment-test@example.com',
  addressLine1: '123 Test Street',
  city: 'Los Angeles',
  state: 'CA',
  postCode: '90001',
  country: 'US',
};

function sign(body: string, timestamp: string) {
  return createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

async function createPingPayOrder() {
  const client = await getPluginClient({ nearAccountId: TEST_USER });
  const quote = await client.quote({
    items: [{ productId: 'payment-test-product', variantId: 'payment-test-variant', quantity: 1 }],
    shippingAddress,
  });
  const selectedRates: Record<string, string> = {};
  for (const provider of quote.providerBreakdown) {
    selectedRates[provider.provider] = provider.selectedShipping.rateId;
  }

  return client.createCheckout({
    items: [{ productId: 'payment-test-product', variantId: 'payment-test-variant', quantity: 1 }],
    shippingAddress,
    selectedRates,
    shippingCost: quote.shippingCost,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    paymentProvider: 'pingpay',
  });
}

function makeWebhook(orderId: string, sessionId: string, eventId: string) {
  return {
    id: eventId,
    type: 'payment.success' as const,
    sessionId,
    metadata: { orderId },
    data: {
      sessionId,
      paymentId: `payment-${eventId}`,
      status: 'SUCCESS',
      amount: '1000000',
      assetId: 'NEAR:USDC',
    },
  };
}

async function deliver(payload: ReturnType<typeof makeWebhook>) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers = new Headers({
    'x-ping-signature': sign(body, timestamp),
    'x-ping-timestamp': timestamp,
  });
  const client = await getPluginClient({ nearAccountId: TEST_USER, reqHeaders: headers });
  return client.pingWebhook(payload);
}

function makeStripeEvent(orderId: string, eventId: string) {
  return {
    id: eventId,
    object: 'event',
    api_version: '2026-02-25.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${eventId}`,
        object: 'checkout.session',
        metadata: { orderId },
      },
    },
  };
}

async function deliverStripe(payload: ReturnType<typeof makeStripeEvent>) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const client = await getPluginClient({ nearAccountId: TEST_USER });
  return client.stripeWebhook({
    body,
    signature: `t=${timestamp},v1=${signature}`,
  });
}

describe('payment webhook idempotency and concurrency', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearProducts();
    await getTestDb().delete(schema.paymentWebhookEvents);
    await createTestProduct('payment-test-product', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('payment-test-variant', 'payment-test-product');
  });

  it('does not repeat fulfillment work when the same PingPay event is replayed', async () => {
    const checkout = await createPingPayOrder();
    const payload = makeWebhook(checkout.orderId, checkout.checkoutSessionId, 'ping-event-replay');

    await Promise.all([deliver(payload), deliver(payload)]);
    await deliver(payload);

    const events = await getTestDb()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(and(
        eq(schema.paymentWebhookEvents.provider, 'pingpay'),
        eq(schema.paymentWebhookEvents.eventId, 'ping-event-replay'),
      ));
    const auditLogs = await getTestDb()
      .select()
      .from(schema.orderAuditLogs)
      .where(eq(schema.orderAuditLogs.orderId, checkout.orderId));

    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('completed');
    expect(auditLogs.filter((log) => log.metadata?.reason === 'payment.success')).toHaveLength(1);
  });

  it('allows only one of two concurrent success events to claim an order', async () => {
    const checkout = await createPingPayOrder();
    const payloads = [
      makeWebhook(checkout.orderId, checkout.checkoutSessionId, 'ping-event-concurrent-a'),
      makeWebhook(checkout.orderId, checkout.checkoutSessionId, 'ping-event-concurrent-b'),
    ] as const;

    await Promise.all(payloads.map(deliver));

    const events = await getTestDb()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(eq(schema.paymentWebhookEvents.orderId, checkout.orderId));
    const auditLogs = await getTestDb()
      .select()
      .from(schema.orderAuditLogs)
      .where(eq(schema.orderAuditLogs.orderId, checkout.orderId));

    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.status === 'completed')).toHaveLength(1);
    expect(events.filter((event) => event.status === 'ignored')).toHaveLength(1);
    expect(auditLogs.filter((log) => log.metadata?.reason === 'payment.success')).toHaveLength(1);
  });

  it('leaves a failed payment-success workflow recoverable as paid_pending_fulfillment', async () => {
    const checkout = await createPingPayOrder();
    const payload = makeWebhook(checkout.orderId, checkout.checkoutSessionId, 'ping-event-failure');

    // The manual provider is disabled in the test configuration, so this exercises
    // the real partial-fulfillment recovery state without authorizing a payment twice.
    await deliver(payload);

    const order = await (await getPluginClient({ nearAccountId: TEST_USER })).getOrder({ id: checkout.orderId });
    const event = await getTestDb()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(eq(schema.paymentWebhookEvents.eventId, 'ping-event-failure'));

    expect(order.order.status).toBe('paid_pending_fulfillment');
    expect(event[0]?.status).toBe('completed');
  });

  it('deduplicates concurrent Stripe checkout completion events', async () => {
    const order = await createTestOrder('stripe-webhook-order', {
      status: 'draft_created',
      checkoutProvider: 'stripe',
      checkoutSessionId: 'cs_stripe_webhook_order',
    });
    const payloads = [
      makeStripeEvent(order.id, 'evt_stripe_concurrent_a'),
      makeStripeEvent(order.id, 'evt_stripe_concurrent_b'),
    ] as const;

    await Promise.all(payloads.map(deliverStripe));

    const events = await getTestDb()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(eq(schema.paymentWebhookEvents.orderId, order.id));
    const auditLogs = await getTestDb()
      .select()
      .from(schema.orderAuditLogs)
      .where(eq(schema.orderAuditLogs.orderId, order.id));
    const updatedOrder = await getTestDb()
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));

    expect(updatedOrder[0]?.status).toBe('processing');
    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.status === 'completed')).toHaveLength(1);
    expect(events.filter((event) => event.status === 'ignored')).toHaveLength(1);
    expect(auditLogs.filter((log) => log.metadata?.reason === 'payment.success')).toHaveLength(1);
  });

  it('does not repeat Stripe side effects when the same event is replayed', async () => {
    const order = await createTestOrder('stripe-webhook-replay-order', {
      status: 'draft_created',
      checkoutProvider: 'stripe',
      checkoutSessionId: 'cs_stripe_webhook_replay_order',
    });
    const payload = makeStripeEvent(order.id, 'evt_stripe_replay');

    await Promise.all([deliverStripe(payload), deliverStripe(payload)]);
    await deliverStripe(payload);

    const events = await getTestDb()
      .select()
      .from(schema.paymentWebhookEvents)
      .where(and(
        eq(schema.paymentWebhookEvents.provider, 'stripe'),
        eq(schema.paymentWebhookEvents.eventId, 'evt_stripe_replay'),
      ));
    const auditLogs = await getTestDb()
      .select()
      .from(schema.orderAuditLogs)
      .where(eq(schema.orderAuditLogs.orderId, order.id));

    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('completed');
    expect(auditLogs.filter((log) => log.metadata?.reason === 'payment.success')).toHaveLength(1);
  });
});
