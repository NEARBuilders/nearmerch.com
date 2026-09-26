import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  clearOrders,
  clearProducts,
  createTestProduct,
  createTestProductVariant,
} from '../helpers';
import { getPluginClient, getTestDb, runMigrations, teardown } from '../setup';

const TEST_USER = 'variant-test.near';

const shippingAddress = {
  firstName: 'Variant',
  lastName: 'Tester',
  email: 'variant@example.com',
  addressLine1: '123 Test Street',
  city: 'Los Angeles',
  state: 'CA',
  postCode: '90001',
  country: 'US',
};

const checkoutInput = (productId: string, variantId?: string) => ({
  items: [{ productId, ...(variantId ? { variantId } : {}), quantity: 1 }],
  shippingAddress,
  selectedRates: {},
  shippingCost: 0,
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
  paymentProvider: 'pingpay' as const,
});

describe('checkout variant availability', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearProducts();
  });

  it('rejects an explicitly selected unavailable variant when quoting', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    await createTestProduct('quote-unavailable', { fulfillmentProvider: 'manual' });
    await createTestProductVariant('quote-unavailable-variant', 'quote-unavailable', {
      inStock: false,
    });

    await expect(
      client.quote({
        items: [
          {
            productId: 'quote-unavailable',
            variantId: 'quote-unavailable-variant',
            quantity: 1,
          },
        ],
        shippingAddress,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Variant is unavailable: quote-unavailable-variant',
    });
  });

  it('rejects an explicitly selected unavailable variant before creating an order', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    await createTestProduct('checkout-unavailable', { fulfillmentProvider: 'manual' });
    await createTestProductVariant(
      'checkout-unavailable-variant',
      'checkout-unavailable',
      { inStock: false },
    );

    await expect(
      client.createCheckout(
        checkoutInput('checkout-unavailable', 'checkout-unavailable-variant'),
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Variant is unavailable: checkout-unavailable-variant',
    });

    expect(await getTestDb().select().from(schema.orders)).toHaveLength(0);
  });

  it('uses an available default when the first variant is unavailable', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    await createTestProduct('default-available', {
      price: 5000,
      fulfillmentProvider: 'manual',
    });
    await createTestProductVariant('default-unavailable', 'default-available', {
      price: 9000,
      inStock: false,
    });
    await createTestProductVariant('default-in-stock', 'default-available', {
      price: 2300,
      inStock: true,
    });

    const quote = await client.quote({
      items: [{ productId: 'default-available', quantity: 1 }],
      shippingAddress,
    });
    expect(quote.subtotal).toBe(23);

    const checkout = await client.createCheckout(
      checkoutInput('default-available'),
    );
    const order = await client.getOrder({ id: checkout.orderId });

    expect(order.order.items[0]?.variantId).toBe('default-in-stock');
  });

  it('rejects quote and checkout when every variant is unavailable', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    await createTestProduct('all-unavailable', {
      name: 'All Unavailable',
      fulfillmentProvider: 'manual',
    });
    await createTestProductVariant('unavailable-small', 'all-unavailable', {
      inStock: false,
    });
    await createTestProductVariant('unavailable-large', 'all-unavailable', {
      inStock: false,
    });

    const expectedError = {
      code: 'BAD_REQUEST',
      message: 'No variants are available for All Unavailable',
    };

    await expect(
      client.quote({
        items: [{ productId: 'all-unavailable', quantity: 1 }],
        shippingAddress,
      }),
    ).rejects.toMatchObject(expectedError);
    await expect(
      client.createCheckout(checkoutInput('all-unavailable')),
    ).rejects.toMatchObject(expectedError);

    expect(await getTestDb().select().from(schema.orders)).toHaveLength(0);
  });

  it('continues to use the base price for products without variants', async () => {
    const client = await getPluginClient({ nearAccountId: TEST_USER });
    await createTestProduct('variantless-product', {
      price: 4200,
      fulfillmentProvider: 'manual',
    });

    const quote = await client.quote({
      items: [{ productId: 'variantless-product', quantity: 1 }],
      shippingAddress,
    });

    expect(quote.subtotal).toBe(42);
  });
});
