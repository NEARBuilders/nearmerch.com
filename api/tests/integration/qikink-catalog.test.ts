import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import { BrowseCatalogOutputSchema } from '@/services/fulfillment/schema';
import { QikinkService } from '@/services/fulfillment/qikink/service';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const clientId = process.env.QIKINK_CLIENT_ID;
const clientSecret = process.env.QIKINK_CLIENT_SECRET;
const environment = process.env.QIKINK_ENVIRONMENT ?? 'sandbox';
const hasCredentials = Boolean(clientId && clientSecret);

describe('Qikink sandbox catalog', () => {
  it.skipIf(!hasCredentials)('returns a usable catalog after authenticating', async () => {
    const service = new QikinkService({
      clientId: clientId!,
      clientSecret: clientSecret!,
      environment,
    });

    await Effect.runPromise(service.ping());
    const catalog = BrowseCatalogOutputSchema.parse(
      await Effect.runPromise(service.browseCatalog()),
    );

    expect(catalog.products.length).toBeGreaterThan(0);
    expect(catalog.products[0]?.providerName).toBe('qikink');
    expect(catalog.products[0]?.slots?.some((slot) => slot.name === 'Front')).toBe(true);

    const productId = catalog.products[0]!.id;
    const variants = await Effect.runPromise(service.getCatalogProductVariants({ id: productId }));
    expect(variants.variants.length).toBeGreaterThan(0);
    expect(variants.variants[0]?.providerRef).toBeTruthy();
  });
});
