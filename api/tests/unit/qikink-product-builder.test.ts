import { describe, expect, it } from 'vitest';
import {
  catalogBuilderImageId,
  catalogBuilderVariantId,
  enrichBuildInputForProvider,
} from '@/services/product-builder';
import {
  QIKINK_SANDBOX_CATALOG,
  QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
  mapFixtureProduct,
} from '@/services/fulfillment/qikink/catalog';

const fixture = QIKINK_SANDBOX_CATALOG.find((item) => item.key === 'classic-round-neck-tee')!;
const catalogProduct = mapFixtureProduct(fixture, { includeVariants: true });
const catalogVariant = catalogProduct.variants![0]!;

const designFiles = [
  {
    assetId: 't4-asset-front',
    url: 'https://cdn.example.com/front.png',
    slot: 'Front',
  },
];

describe('Qikink buildProduct catalog enrichment', () => {
  it('turns generic catalog-builder ids into qikink fulfillmentConfig fields', () => {
    const prepared = enrichBuildInputForProvider({
      name: 'NEAR Tee',
      providerName: 'qikink',
      currency: 'USD',
      priceOverride: 29,
      files: designFiles,
      variants: [
        {
          name: catalogVariant.id,
          variantRef: catalogVariant.id,
          providerConfig: {
            catalogProductId: catalogProduct.id,
            catalogVariantId: catalogVariant.id,
          },
        },
      ],
    });

    expect(prepared.providerName).toBe('qikink');
    expect(prepared.currency).toBe('USD');
    expect(prepared.files).toEqual(designFiles);

    const variant = prepared.variants[0]!;
    expect(variant.sku).toBe(catalogVariant.providerRef);
    expect(variant.providerConfig).toMatchObject({
      sku: catalogVariant.providerRef,
      searchFromMyProducts: QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
      placementSku: 'Front',
      catalogProductId: catalogProduct.id,
      catalogVariantId: catalogVariant.id,
    });
    expect(variant.providerConfig).not.toHaveProperty('price');
    expect(variant.attributes).toEqual(
      expect.arrayContaining([
        { name: 'Size', value: catalogVariant.size },
        { name: 'Color', value: catalogVariant.color },
      ]),
    );
  });

  it('preserves attached design files for T3 mapping', () => {
    const prepared = enrichBuildInputForProvider({
      name: 'NEAR Tee',
      providerName: 'qikink',
      files: designFiles,
      variants: [
        {
          name: catalogVariant.id,
          variantRef: catalogVariant.id,
          providerConfig: {
            catalogProductId: catalogProduct.id,
            catalogVariantId: catalogVariant.id,
          },
        },
      ],
    });

    expect(prepared.files).toEqual([
      {
        assetId: 't4-asset-front',
        url: 'https://cdn.example.com/front.png',
        slot: 'Front',
      },
    ]);
  });

  it('leaves Printful catalog-builder input unchanged', () => {
    const input = {
      name: 'Printful Tee',
      providerName: 'printful',
      currency: 'USD',
      files: designFiles,
      variants: [
        {
          name: '4012',
          variantRef: '4012',
          providerConfig: {
            catalogProductId: 71,
            catalogVariantId: 4012,
          },
        },
      ],
    };

    expect(enrichBuildInputForProvider(input)).toEqual(input);
  });

  it('leaves Manual builder input unchanged', () => {
    const input = {
      name: 'Manual Sticker',
      providerName: 'manual',
      currency: 'USD',
      files: [],
      variants: [
        {
          name: 'Default',
          variantRef: 'default',
          providerConfig: {},
          sku: 'manual-1',
        },
      ],
    };

    expect(enrichBuildInputForProvider(input)).toEqual(input);
  });
});

describe('catalog builder record ids', () => {
  it('scopes Qikink variant and image ids to the product so a second listing of the same SKU does not collide', () => {
    const first = '01a08453-89dd-7f7c-94ad-48a8bbcd18a3';
    const second = '01a08456-c210-71b8-9774-733d75d17358';
    const variantRef = 'qikink-UOsRgHs-BkCm-XS';

    expect(catalogBuilderVariantId(first, 'qikink', variantRef)).not.toBe(
      catalogBuilderVariantId(second, 'qikink', variantRef),
    );
    expect(catalogBuilderImageId(first, 0, 'qikink')).not.toBe(catalogBuilderImageId(second, 0, 'qikink'));
    expect(catalogBuilderImageId(second, 0, 'qikink')).toBe(`${second}-image-0`);
    expect(catalogBuilderVariantId(second, 'qikink', variantRef)).toBe(
      `${second}-qikink-variant-${variantRef}`,
    );
  });

  it('keeps the original Printful and Lulu catalog-builder ids', () => {
    expect(catalogBuilderVariantId('any-product', 'printful', '4012')).toBe('printful-variant-4012');
    expect(catalogBuilderImageId('any-product', 0, 'printful')).toBe('product-image-0');
    expect(catalogBuilderVariantId('any-product', 'lulu', 'book-1')).toBe('lulu-variant-book-1');
    expect(catalogBuilderImageId('any-product', 0, 'lulu')).toBe('product-image-0');
  });
});
