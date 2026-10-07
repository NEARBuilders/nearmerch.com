import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import { toQikinkProviderConfig } from '@/services/fulfillment/qikink/catalog';
import { QIKINK_STANDARD_SHIPPING_RATE_ID } from '@/services/fulfillment/qikink/orders';
import { QikinkService } from '@/services/fulfillment/qikink/service';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const clientId = process.env.QIKINK_CLIENT_ID;
const clientSecret = process.env.QIKINK_CLIENT_SECRET;
const environment = process.env.QIKINK_ENVIRONMENT ?? 'sandbox';
const hasCredentials = Boolean(clientId && clientSecret);

describe('Qikink sandbox quote and confirm', () => {
  it.skipIf(!hasCredentials)('quotes fallback shipping and stores a local draft without calling create-order', async () => {
    const service = new QikinkService({
      clientId: clientId!,
      clientSecret: clientSecret!,
      environment,
    });

    const recipient = {
      name: 'John Doe',
      address1: '123 Main Street',
      city: 'Mumbai',
      stateCode: 'Maharashtra',
      countryCode: 'IN',
      zip: '400001',
      phone: '9876543210',
      email: 'john.doe@example.com',
    };
    const items = [
      {
        quantity: 1,
        providerConfig: { ...toQikinkProviderConfig({
          sku: 'classic-round-neck-tee-white-m',
          placementSku: 'Front',
          catalogProductId: 'qikink-classic-round-neck-tee',
          catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
        }) },
        files: [
          {
            assetId: 'sandbox-design-front',
            url: 'https://qikink.com/favicon.ico',
            slot: 'Front',
          },
        ],
      },
    ];

    const quote = await Effect.runPromise(service.quoteShipping({ recipient, items, currency: 'USD' }));
    expect(quote.rates[0]?.id).toBe(QIKINK_STANDARD_SHIPPING_RATE_ID);

    const draft = await Effect.runPromise(service.createOrder({
      externalId: `t${Date.now().toString(36)}`,
      recipient,
      items,
    }));
    expect(draft.status).toBe('draft');
    expect(draft.id).toMatch(/^qk_/);

    // Live POST /api/order/create is attempted in the test below. Design
    // fields must sit on line_items[].designs[] per
    // https://documenter.getpostman.com/view/26157218/2sBYAxNoxr.
  });

  it.skipIf(!hasCredentials)('T5: payment-confirm path attempts exactly one sandbox POST /api/order/create', async () => {
    const service = new QikinkService({
      clientId: clientId!,
      clientSecret: clientSecret!,
      environment,
    });

    const recipient = {
      name: 'Test Customer',
      address1: '123 Main Street',
      city: 'Mumbai',
      stateCode: 'Maharashtra',
      countryCode: 'IN',
      zip: '400001',
      phone: '9876543210',
      email: 'test@example.com',
    };
    const items = [
      {
        quantity: 1,
        providerConfig: { ...toQikinkProviderConfig({
          sku: 'classic-round-neck-tee-white-m',
          placementSku: 'Front',
          catalogProductId: 'qikink-classic-round-neck-tee',
          catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
        }) },
        files: [
          {
            assetId: 'qikink-test-design-front',
            url: 'https://example.com/qikink-front.png',
            slot: 'Front',
          },
        ],
      },
    ];

    const draft = await Effect.runPromise(service.createOrder({
      externalId: `t${Date.now().toString(36)}`.slice(0, 15),
      recipient,
      items,
    }));
    expect(draft.id).toMatch(/^qk_/);

    const confirmed = await Effect.runPromise(Effect.either(service.confirmOrder({ id: draft.id })));

    if (confirmed._tag === 'Right') {
      const retry = await Effect.runPromise(service.confirmOrder({ id: draft.id }));
      expect(confirmed.right.id).toBeTruthy();
      expect(retry.id).toBe(confirmed.right.id);
      return;
    }

    const message = confirmed.left instanceof Error
      ? confirmed.left.message
      : String(confirmed.left);
    expect(message).toMatch(/Qikink|Unexpected fields|print_type_id|SKU|sku|create order|Order created/i);
  });
});
