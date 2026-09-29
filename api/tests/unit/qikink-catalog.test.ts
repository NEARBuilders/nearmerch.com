import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import {
  BrowseCatalogOutputSchema,
  CatalogProductDetailOutputSchema,
  CatalogSlotSchema,
  CatalogVariantsOutputSchema,
  GetPlacementsOutputSchema,
  ProviderCatalogProductSchema,
  ProviderCatalogVariantSchema,
} from '@/services/fulfillment/schema';
import {
  QIKINK_CATALOG_SOURCE,
  QIKINK_SANDBOX_CATALOG,
  QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
  mapFixtureProduct,
  mapFixtureVariant,
  providerConfigFromCatalogSelection,
  qikinkProductId,
  buildQikinkProviderConfig,
} from '@/services/fulfillment/qikink/catalog';
import { QikinkService } from '@/services/fulfillment/qikink/service';

function createService() {
  return new QikinkService({
    clientId: 'unused-for-catalog',
    clientSecret: 'unused-for-catalog',
    environment: 'sandbox',
    fetch: async () => {
      throw new Error('Qikink catalog must not call undocumented HTTP endpoints');
    },
  });
}

describe('Qikink catalog fixture mapping', () => {
  it('uses a curated sandbox fixture because Qikink publishes no catalog API', () => {
    expect(QIKINK_CATALOG_SOURCE).toBe('sandbox-fixture');
    expect(QIKINK_SANDBOX_CATALOG.length).toBeGreaterThan(0);
    expect(QIKINK_SANDBOX_CATALOG.every((product) => product.collectionIds.length > 0)).toBe(true);
  });

  it('maps fixture products into ProviderCatalogProductSchema', () => {
    for (const fixture of QIKINK_SANDBOX_CATALOG) {
      const product = mapFixtureProduct(fixture, { includeVariants: true });
      const parsed = ProviderCatalogProductSchema.parse(product);

      expect(parsed.providerName).toBe('qikink');
      expect(parsed.id).toBe(qikinkProductId(fixture.key));
      expect(parsed.slots?.length).toBeGreaterThan(0);
      expect(parsed.variants?.length).toBeGreaterThan(0);
    }
  });

  it('maps fixture variants with sku on providerRef', () => {
    const fixture = QIKINK_SANDBOX_CATALOG[0]!;
    for (const variant of fixture.variants) {
      const mapped = mapFixtureVariant(fixture, variant);
      const parsed = ProviderCatalogVariantSchema.parse(mapped);

      expect(parsed.providerRef).toBe(variant.sku);
      expect(parsed.size).toBe(variant.size);
      expect(parsed.color).toBe(variant.color);
      expect(parsed.price?.currency).toBe('INR');
      expect(parsed.price?.cost).toBe(fixture.basePriceInr);
    }
  });

  it('maps placements into catalog slots using Qikink placement names', () => {
    const product = mapFixtureProduct(QIKINK_SANDBOX_CATALOG[0]!);
    const slots = product.slots ?? [];

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((slot) => slot.name === 'Front' && slot.required)).toBe(true);

    for (const slot of slots) {
      CatalogSlotSchema.parse(slot);
      expect(slot.acceptedFormats).toEqual(['png', 'jpg', 'jpeg']);
    }
  });

  it('preserves sku, searchFromMyProducts, and placementSku for later orders', () => {
    const fixture = QIKINK_SANDBOX_CATALOG.find((item) => item.key === 'classic-round-neck-tee')!;
    const product = mapFixtureProduct(fixture, { includeVariants: true });
    const variant = product.variants![0]!;
    const config = providerConfigFromCatalogSelection({ product, variant });

    expect(config.sku).toBe(variant.providerRef);
    expect(config.searchFromMyProducts).toBe(QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS);
    expect(config.placementSku).toBe('Front');
    expect(config.catalogProductId).toBe(product.id);
    expect(config.catalogVariantId).toBe(variant.id);
    expect(config.printMethod).toBe(fixture.printMethod);
  });

  it('buildQikinkProviderConfig maps catalog ids into the T2 order fields', () => {
    const fixture = QIKINK_SANDBOX_CATALOG.find((item) => item.key === 'classic-round-neck-tee')!;
    const product = mapFixtureProduct(fixture, { includeVariants: true });
    const variant = product.variants![0]!;
    const config = buildQikinkProviderConfig({
      catalogProductId: product.id,
      catalogVariantId: variant.id,
    });

    expect(config).toMatchObject({
      sku: variant.providerRef,
      searchFromMyProducts: QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
      placementSku: 'Front',
      catalogProductId: product.id,
      catalogVariantId: variant.id,
    });
    expect(config).not.toHaveProperty('price');
  });

  it('maps the merchant My Products raglan with search_from_my_products 1', () => {
    const config = buildQikinkProviderConfig({
      catalogProductId: 'qikink-unisex-oversized-raglan',
      catalogVariantId: 'qikink-UOsRgHs-BkCm-XS',
    });

    expect(config).toMatchObject({
      sku: 'UOsRgHs-BkCm-XS',
      searchFromMyProducts: 1,
      basePriceInr: 378,
      catalogProductId: 'qikink-unisex-oversized-raglan',
    });
  });
});

describe('Qikink catalog service', () => {
  it('browseCatalog returns at least one schema-valid orderable product', async () => {
    const service = createService();
    const result = await Effect.runPromise(service.browseCatalog());
    const parsed = BrowseCatalogOutputSchema.parse(result);

    expect(parsed.total).toBeGreaterThan(0);
    expect(parsed.products.length).toBeGreaterThan(0);
    expect(parsed.products[0]?.providerName).toBe('qikink');
    expect(parsed.products[0]?.slots?.some((slot) => slot.name === 'Front')).toBe(true);
    expect(parsed.collections?.some((collection) => collection.id === 't-shirts')).toBe(true);
    expect(parsed.collections?.every((collection) => collection.productCount > 0)).toBe(true);
  });

  it('browseCatalog can filter products by a Qikink collection', async () => {
    const service = createService();
    const result = BrowseCatalogOutputSchema.parse(
      await Effect.runPromise(service.browseCatalog({ collectionId: 'drinkware' })),
    );

    expect(result.products.map((product) => product.id)).toEqual(['qikink-mug-11oz']);
    expect(result.total).toBe(result.products.length);
    expect(result.collections?.some((collection) => collection.id === 'drinkware')).toBe(true);
  });

  it('paginates the curated catalog', async () => {
    const service = createService();
    const first = await Effect.runPromise(service.browseCatalog({ limit: 1, offset: 0 }));
    const second = await Effect.runPromise(service.browseCatalog({ limit: 1, offset: 1 }));

    expect(first.products).toHaveLength(1);
    expect(second.products).toHaveLength(1);
    expect(first.products[0]?.id).not.toBe(second.products[0]?.id);
    expect(first.total).toBe(QIKINK_SANDBOX_CATALOG.length);
  });

  it('reuses an in-process catalog cache for identical browse queries', async () => {
    const service = createService();
    const first = await Effect.runPromise(service.browseCatalog({ limit: 50, offset: 0 }));
    const second = await Effect.runPromise(service.browseCatalog({ limit: 50, offset: 0 }));

    expect(second).toBe(first);
  });

  it('returns product detail with variants and placements', async () => {
    const service = createService();
    const browse = await Effect.runPromise(service.browseCatalog());
    const productId = browse.products[0]!.id;
    const detail = CatalogProductDetailOutputSchema.parse(
      await Effect.runPromise(service.getCatalogProduct({ id: productId })),
    );

    expect(detail.product.id).toBe(productId);
    expect(detail.product.variants?.length).toBeGreaterThan(0);
    expect(detail.product.slots?.length).toBeGreaterThan(0);
  });

  it('returns variants and placements for a catalog product', async () => {
    const service = createService();
    const productId = qikinkProductId('classic-round-neck-tee');

    const variants = CatalogVariantsOutputSchema.parse(
      await Effect.runPromise(service.getCatalogProductVariants({ id: productId })),
    );
    const placements = GetPlacementsOutputSchema.parse(
      await Effect.runPromise(service.getPlacements({
        providerConfig: { catalogProductId: productId },
      })),
    );

    expect(variants.variants.length).toBeGreaterThan(0);
    expect(variants.variants.every((variant) => variant.providerRef.length > 0)).toBe(true);
    expect(placements.placements.some((slot) => slot.name === 'Front')).toBe(true);
  });

  it('returns NOT_FOUND for an unknown catalog product', async () => {
    const service = createService();

    await expect(
      Effect.runPromise(service.getCatalogProduct({ id: 'qikink-missing-product' })),
    ).rejects.toThrow(/not found/);
  });
});
