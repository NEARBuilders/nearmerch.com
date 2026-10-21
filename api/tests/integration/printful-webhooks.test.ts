import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getPluginClient, runMigrations, teardown, getTestDb } from '../setup';
import { createTestOrder, clearOrders } from '../helpers';
import * as schema from '@/db/schema';
import { createHmac } from 'crypto';

describe('Printful Webhook Integration', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
  });

  const TEST_USER = 'test-user.near';

  const getPrintfulWebhookSecretHex = () => 'a'.repeat(64);
  const signPrintfulWebhook = (body: string) => {
    const secret = Buffer.from(getPrintfulWebhookSecretHex(), 'hex');
    return createHmac('sha256', secret).update(body).digest('hex');
  };

  const createSignedPrintfulWebhookClient = async (payload: unknown, rawBody?: string) => {
    const body = rawBody ?? JSON.stringify(payload);
    const signature = signPrintfulWebhook(body);
    const headers = new Headers();
    headers.set('x-pf-webhook-signature', signature);
    return getPluginClient({ reqHeaders: headers, getRawBody: async () => body });
  };

  describe('Order Status Updates', () => {
    it('should update order to shipped when shipment_sent webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-shipped-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-123',
            carrier: 'USPS',
            service: 'First-Class Mail',
            tracking_number: '9400111899562537866450',
            tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899562537866450',
            created: 1697638507,
            ship_date: '2023-10-18',
            shipped_at: 1697638507,
            reshipment: false,
            items: [
              {
                item_id: 66655731,
                quantity: 1,
              },
            ],
          },
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'fulfilled',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('shipped');
      expect(updatedOrder.order.trackingInfo).toBeDefined();
      expect(updatedOrder.order.trackingInfo?.length).toBeGreaterThan(0);
      
      if (updatedOrder.order.trackingInfo && updatedOrder.order.trackingInfo.length > 0) {
        const tracking = updatedOrder.order.trackingInfo[0]!;
        expect(tracking.trackingCode).toBe('9400111899562537866450');
        expect(tracking.trackingUrl).toContain('usps.com');
        expect(tracking.shipmentMethodName).toBe('First-Class Mail');
      }
    });

    it('should update order to cancelled when order_canceled webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-cancelled-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_canceled',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'canceled',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Customer requested cancellation',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('cancelled');
    });

    it('should log but not crash on order_put_hold webhook', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-hold-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_put_hold',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'onhold',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Quality check required',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('on_hold');
    });

    it('should handle order_failed webhook', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-failed-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_failed',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'failed',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Product out of stock',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);
    });
  });

  describe('Webhook Payload Handling', () => {
    it('should handle webhook with missing external_id gracefully', async () => {
      const client = await getPluginClient();

      const printfulWebhookPayload = {
        type: 'package_shipped',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-456',
            carrier: 'USPS',
            service: 'Priority Mail',
            tracking_number: '1234567890',
            tracking_url: 'https://tracking.example.com',
          },
          order: {
            id: 94188293,
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);
    });

    it('should handle webhook with unknown event type', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-unknown-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'unknown_event_type',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'processing',
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('processing');
    });
  });

  describe('Tracking Information', () => {
    it('should properly parse and store multiple tracking numbers', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-multi-tracking-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 10000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-789',
            carrier: 'FedEx',
            service: 'FedEx Ground',
            tracking_number: '987654321098',
            tracking_url: 'https://www.fedex.com/fedextrack/?tracknumbers=987654321098',
            created: 1697638507,
            ship_date: '2023-10-18',
          },
          order: {
            id: 94188294,
            external_id: orderId,
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('shipped');
      expect(updatedOrder.order.trackingInfo).toBeDefined();
      
      if (updatedOrder.order.trackingInfo) {
        const tracking = updatedOrder.order.trackingInfo[0]!;
        expect(tracking.trackingCode).toBe('987654321098');
        expect(tracking.trackingUrl).toContain('fedex.com');
        expect(tracking.shipmentMethodName).toBe('FedEx Ground');
      }
    });
  });

  describe('shipment_delivered', () => {
    it('should update order to delivered when shipment_delivered webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-delivered-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'shipped',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        trackingInfo: [{
          trackingCode: '1234567890',
          trackingUrl: 'https://tracking.example.com',
          shipmentMethodName: 'Standard',
        }],
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_delivered',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-123',
          },
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'delivered',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('delivered');
    });
  });

  describe('shipment_returned', () => {
    it('should update order to returned when shipment_returned webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-returned-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'delivered',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_returned',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-123',
          },
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'returned',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('returned');
    });
  });

  describe('shipment_canceled', () => {
    it('should update order to partially_cancelled when shipment_canceled webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-partial-cancelled-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_canceled',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'canceled',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Customer requested cancellation',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('partially_cancelled');
    });
  });

  describe('shipment_out_of_stock', () => {
    it('should update order to on_hold when shipment_out_of_stock webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-oos-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_out_of_stock',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'failed',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Item out of stock',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('on_hold');
    });
  });

  describe('shipment_put_hold and shipment_remove_hold', () => {
    it('should update order to on_hold when shipment_put_hold webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-shipment-hold-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_put_hold',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'onhold',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Quality check required',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('on_hold');
    });

    it('should update order to processing when shipment_remove_hold webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-shipment-remove-hold-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'on_hold',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'shipment_remove_hold',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'inprocess',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('processing');
    });
  });

  describe('order_refunded', () => {
    it('should update order to refunded when order_refunded webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-refunded-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'delivered',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_refunded',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'refunded',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
          reason: 'Customer requested refund',
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const order = await client.getOrder({ id: orderId });
      expect(order.order.status).toBe('refunded');
    });

    it('should resolve order by fulfillmentReferenceId (findByFulfillmentRef)', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-by-fulfillment-ref-123';
      const fulfillmentReferenceId = 'o0123456789abcde';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId,
        createdAt: now,
        updatedAt: now,
      });

      const payload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-fulfillment-ref',
            carrier: 'USPS',
            service: 'First-Class Mail',
            tracking_number: '9400111899562537866450',
            tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899562537866450',
          },
          order: {
            id: 123,
            external_id: fulfillmentReferenceId,
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const webhookClient = await createSignedPrintfulWebhookClient(payload);
      const result = await webhookClient.printfulWebhook(payload);
      expect(result.received).toBe(true);

      const updated = await client.getOrder({ id: orderId });
      expect(updated.order.status).toBe('shipped');
      expect(updated.order.trackingInfo?.[0]?.trackingUrl).toContain('usps.com');
    });

    it('should update order to shipped when package_shipped webhook received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });
      const db = getTestDb();
      const orderId = 'test-order-package-shipped-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: 'o-package-shipped-ref',
        createdAt: now,
        updatedAt: now,
      });

      const payload = {
        type: 'package_shipped',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            tracking_number: '1Z999AA10123456784',
            tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
            carrier: 'UPS',
          },
          order: {
            id: 94188299,
            external_id: orderId,
            status: 'fulfilled',
          },
        },
      };

      const webhookClient = await createSignedPrintfulWebhookClient(payload);
      const result = await webhookClient.printfulWebhook(payload);
      expect(result.received).toBe(true);

      const updated = await client.getOrder({ id: orderId });
      expect(updated.order.status).toBe('shipped');
      expect(updated.order.trackingInfo?.[0]?.trackingCode).toBe('1Z999AA10123456784');
    });

    it('should resolve order from shipment.order_external_id when data.order is missing', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });
      const db = getTestDb();
      const orderId = 'test-order-nested-external-id-123';
      const fulfillmentReferenceId = 'o-nested-external-ref';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId,
        createdAt: now,
        updatedAt: now,
      });

      const payload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            order_id: 94188299,
            order_external_id: fulfillmentReferenceId,
            tracking_number: '9400111899562537866450',
            tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899562537866450',
            service: 'First-Class Mail',
          },
        },
      };

      const webhookClient = await createSignedPrintfulWebhookClient(payload);
      const result = await webhookClient.printfulWebhook(payload);
      expect(result.received).toBe(true);

      const updated = await client.getOrder({ id: orderId });
      expect(updated.order.status).toBe('shipped');
      expect(updated.order.trackingInfo?.[0]?.trackingCode).toBe('9400111899562537866450');
    });

    it('should resolve order by Printful draft order id when external_id is missing', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });
      const db = getTestDb();
      const orderId = 'test-order-printful-draft-id-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        draftOrderIds: { printful: '94188299' },
        createdAt: now,
        updatedAt: now,
      });

      const payload = {
        type: 'package_shipped',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            tracking_number: '1Z999AA10123456784',
            tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
            carrier: 'UPS',
          },
          order: {
            id: 94188299,
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const webhookClient = await createSignedPrintfulWebhookClient(payload);
      const result = await webhookClient.printfulWebhook(payload);
      expect(result.received).toBe(true);

      const updated = await client.getOrder({ id: orderId });
      expect(updated.order.status).toBe('shipped');
      expect(updated.order.trackingInfo?.[0]?.trackingCode).toBe('1Z999AA10123456784');
    });
  });

  describe('order_updated', () => {
    it('should update order to shipped when order_updated with fulfilled status received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-updated-fulfilled-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_updated',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'fulfilled',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('shipped');
    });

    it('should update order to processing when order_updated with pending status received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-updated-pending-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'paid',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_updated',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'pending',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('processing');
    });

    it('should update order to on_hold when order_updated with onhold status received', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const db = getTestDb();
      const orderId = 'test-order-updated-onhold-123';
      const now = new Date();

      await db.insert(schema.orders).values({
        id: orderId,
        userId: TEST_USER,
        status: 'processing',
        totalAmount: 5000,
        currency: 'USD',
        fulfillmentReferenceId: `order_${Date.now()}_${TEST_USER}`,
        createdAt: now,
        updatedAt: now,
      });

      const printfulWebhookPayload = {
        type: 'order_updated',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 94188292,
            external_id: orderId,
            store: 11229252,
            status: 'onhold',
            shipping: 'STANDARD',
            created: 1697638507,
            updated: 1697638507,
          },
        },
      };

      const webhookBody = JSON.stringify(printfulWebhookPayload);

      const webhookClient = await createSignedPrintfulWebhookClient(printfulWebhookPayload, webhookBody);
      const result = await webhookClient.printfulWebhook(printfulWebhookPayload);

      expect(result.received).toBe(true);

      const updatedOrder = await client.getOrder({ id: orderId });
      expect(updatedOrder.order.status).toBe('on_hold');
    });
  });

  describe('Signature Verification', () => {
    it('should accept webhooks with valid x-pf-webhook-signature', async () => {
      const payload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          shipment: {
            id: 'test-shipment-sig',
            carrier: 'USPS',
            service: 'First-Class Mail',
            tracking_number: '9400',
            tracking_url: 'https://example.com/track',
          },
          order: {
            id: 1,
            external_id: 'does-not-exist',
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPrintfulWebhook(rawBody);
      const headers = new Headers();
      headers.set('x-pf-webhook-signature', signature);

      const client = await getPluginClient({ reqHeaders: headers, getRawBody: async () => rawBody });
      const result = await client.printfulWebhook(payload);
      expect(result.received).toBe(true);
    });

    it('should reject webhooks with invalid x-pf-webhook-signature', async () => {
      const payload = {
        type: 'shipment_sent',
        created: Math.floor(Date.now() / 1000),
        retries: 0,
        store: 11229252,
        data: {
          order: {
            id: 1,
            external_id: 'does-not-exist',
            store: 11229252,
            status: 'fulfilled',
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const headers = new Headers();
      headers.set('x-pf-webhook-signature', '0'.repeat(64));

      const client = await getPluginClient({ reqHeaders: headers, getRawBody: async () => rawBody });
      await expect(client.printfulWebhook(payload)).rejects.toThrow();
    });
  });
});
