import type {
  CatalogCollection,
  CatalogSlot,
  ProviderCatalogProduct,
  ProviderCatalogVariant,
} from '../schema';
import type { QikinkProviderConfig } from './types';

/**
 * Qikink catalog source.
 *
 * Official Postman collection (https://documenter.getpostman.com/view/26157218/2sBYAxNoxr)
 * documents HTTPS bases, form-urlencoded token exchange at POST /api/token, rate limits,
 * Create Order (POST /api/order/create), and Get Order (GET /api/order).
 * No list-products, product-detail, variant, placement, or shipping-rate endpoints
 * are published there.
 *
 * This curated sandbox fixture exists so admin `browseProviderCatalog({ provider: 'qikink' })`
 * can return orderable products without inventing those missing endpoints.
 *
 * Product names and INR base prices come from Qikink's published catalog:
 * https://qikink.com/print-on-demand-products/
 * Placement names come from Qikink's order help (Front, Back, pockets, sleeves).
 * Artwork formats come from Qikink's sample-order help (JPEG/PNG).
 *
 * Variant `sku` values are fixture identifiers for `search_from_my_products: 0` sandbox
 * orders. They are not claimed to be live Qikink dashboard SKUs (sandbox cannot see those).
 */
export const QIKINK_CATALOG_SOURCE = 'sandbox-fixture' as const;

export const QIKINK_ID_PREFIX = 'qikink-';

/** Sandbox cannot see dashboard "My Products"; create-order must send design fields. */
export const QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS = 0 as const;

/**
 * Merchant Qikink My Products row used by the admin provider-test harness.
 * search_from_my_products: 1 looks this SKU up on My Products (no designs[]).
 */
export const QIKINK_MY_PRODUCTS_TEST_SKU = {
  name: 'Unisex Oversized Raglan',
  variation: 'Black Charcoal Melange - XS',
  productSku: 'UOsRgHs-BkCm-XS',
  designSku: 'ereneyes',
  storeSku: 'v-9Ryj3ieHaVZW0M8OPRAhubTergzY-HeV',
  basePriceInr: 378,
} as const;

/**
 * Sandbox create-order 400s when SKU-description line items omit `print_type_id`.
 * The official create-order example uses `print_type_id: 1`
 * (https://documenter.getpostman.com/view/26157218/2sBYAxNoxr).
 * My Products line items (`search_from_my_products: 1`) reject that field.
 */

const IMAGE_FORMATS = ['png', 'jpg', 'jpeg'] as const;

export interface QikinkFixtureVariant {
  sku: string;
  name: string;
  size: string;
  color: string;
  colorCode: string | null;
}

export interface QikinkFixturePlacement {
  name: string;
  label: string;
  required: boolean;
}

export interface QikinkFixtureProduct {
  key: string;
  name: string;
  description: string;
  printMethod: string;
  basePriceInr: number;
  image?: string;
  collectionIds: string[];
  searchFromMyProducts?: 0 | 1;
  variants: QikinkFixtureVariant[];
  placements: QikinkFixturePlacement[];
}

/**
 * Qikink storefront collections from their published catalog
 * (https://qikink.com/print-on-demand-products/) and add-product dashboard.
 * There is no collections HTTP API, so this is the curated source of truth.
 */
export const QIKINK_CATALOG_COLLECTIONS: Array<{
  id: string;
  name: string;
  description: string;
}> = [
  { id: 'new-products', name: 'New Products', description: 'Newest blanks from the Qikink catalog.' },
  { id: 't-shirts', name: 'T-Shirts', description: 'Round-neck, oversized, and crew tees.' },
  { id: 'hoodies-jackets', name: 'Hoodies & Jackets', description: 'Pullovers, sweatshirts, and jackets.' },
  { id: 'aop-apparel', name: 'AOP Apparel', description: 'All-over print apparel.' },
  { id: 'kids-clothing', name: 'Kids Clothing', description: 'Kids tees and everyday kidswear.' },
  { id: 'headwear', name: 'Headwear', description: 'Caps and other headwear.' },
  { id: 'drinkware', name: 'Drinkware', description: 'Mugs and drinkware.' },
  { id: 'bags', name: 'Bags', description: 'Tote bags and everyday bags.' },
];

const APPAREL_SIZES = ['S', 'M', 'L', 'XL'] as const;
const APPAREL_COLORS = [
  { color: 'White', colorCode: '#FFFFFF' },
  { color: 'Black', colorCode: '#000000' },
] as const;

const TEE_PLACEMENTS: QikinkFixturePlacement[] = [
  { name: 'Front', label: 'Front', required: true },
  { name: 'Back', label: 'Back', required: false },
  { name: 'Left Pocket', label: 'Left Pocket', required: false },
  { name: 'Right Pocket', label: 'Right Pocket', required: false },
  { name: 'Left Sleeve', label: 'Left Sleeve', required: false },
  { name: 'Right Sleeve', label: 'Right Sleeve', required: false },
];

function apparelVariants(productKey: string, productName: string): QikinkFixtureVariant[] {
  return APPAREL_COLORS.flatMap(({ color, colorCode }) =>
    APPAREL_SIZES.map((size) => ({
      sku: `${productKey}-${color.toLowerCase()}-${size.toLowerCase()}`,
      name: `${productName} / ${color} / ${size}`,
      size,
      color,
      colorCode,
    })),
  );
}

/**
 * Small curated set from Qikink's published pricing table, not the full 350+ catalog.
 */
export const QIKINK_SANDBOX_CATALOG: QikinkFixtureProduct[] = [
  {
    key: 'unisex-oversized-raglan',
    name: 'Unisex Oversized Raglan',
    description: 'Black Charcoal Melange XS raglan from Qikink My Products (design SKU ereneyes).',
    printMethod: 'DTG',
    basePriceInr: QIKINK_MY_PRODUCTS_TEST_SKU.basePriceInr,
    image: 'https://qikink-stores.s3.ap-south-1.amazonaws.com/assets/mockups/350/1fe3c23a-b035-4215-b44a-42966c9936c7.webp',
    collectionIds: ['t-shirts', 'new-products'],
    searchFromMyProducts: 1,
    variants: [
      {
        sku: QIKINK_MY_PRODUCTS_TEST_SKU.productSku,
        name: `${QIKINK_MY_PRODUCTS_TEST_SKU.name} / ${QIKINK_MY_PRODUCTS_TEST_SKU.variation}`,
        size: 'XS',
        color: 'Black Charcoal Melange',
        colorCode: null,
      },
    ],
    placements: TEE_PLACEMENTS,
  },
  {
    key: 'classic-round-neck-tee',
    name: 'Classic Round Neck Tee',
    description: 'Unisex classic round-neck t-shirt. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'DTG',
    basePriceInr: 160,
    image: 'https://qikink-stores.s3.ap-south-1.amazonaws.com/assets/mockups/6/f787f104-9e35-4cad-acab-05be0c7f322d.jpg',
    collectionIds: ['t-shirts'],
    variants: apparelVariants('classic-round-neck-tee', 'Classic Round Neck Tee'),
    placements: TEE_PLACEMENTS,
  },
  {
    key: 'pullover-hoodie',
    name: 'Pullover Hoodie',
    description: 'Unisex pullover hoodie. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'DTG',
    basePriceInr: 430,
    collectionIds: ['hoodies-jackets'],
    variants: apparelVariants('pullover-hoodie', 'Pullover Hoodie'),
    placements: [
      { name: 'Front', label: 'Front', required: true },
      { name: 'Back', label: 'Back', required: false },
    ],
  },
  {
    key: 'tote-bag',
    name: 'Tote Bag',
    description: 'Canvas tote bag. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'DTG',
    basePriceInr: 130,
    collectionIds: ['bags'],
    variants: [
      {
        sku: 'tote-bag-natural-one-size',
        name: 'Tote Bag / Natural / One Size',
        size: 'One Size',
        color: 'Natural',
        colorCode: null,
      },
    ],
    placements: [{ name: 'Front', label: 'Front', required: true }],
  },
  {
    key: 'mug-11oz',
    name: 'Mug (11oz)',
    description: '11oz mug. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'sublimation',
    basePriceInr: 180,
    collectionIds: ['drinkware'],
    variants: [
      {
        sku: 'mug-11oz-white-one-size',
        name: 'Mug (11oz) / White / One Size',
        size: 'One Size',
        color: 'White',
        colorCode: '#FFFFFF',
      },
    ],
    placements: [{ name: 'Front', label: 'Front', required: true }],
  },
  {
    key: 'female-crew-tee',
    name: 'Female Crew T-Shirt',
    description: 'Women\'s crew t-shirt. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'DTG',
    basePriceInr: 160,
    image: 'https://qikink-stores.s3.ap-south-1.amazonaws.com/assets/mockups/6/f787f104-9e35-4cad-acab-05be0c7f322d.jpg',
    collectionIds: ['t-shirts'],
    variants: apparelVariants('female-crew-tee', 'Female Crew T-Shirt'),
    placements: TEE_PLACEMENTS,
  },
  {
    key: 'aop-t-shirt',
    name: 'AOP T-Shirt',
    description: 'All-over print t-shirt. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'sublimation',
    basePriceInr: 330,
    collectionIds: ['aop-apparel'],
    variants: apparelVariants('aop-t-shirt', 'AOP T-Shirt'),
    placements: [
      { name: 'Front', label: 'Front', required: true },
      { name: 'Back', label: 'Back', required: false },
    ],
  },
  {
    key: 'kids-t-shirt',
    name: 'Kids T-Shirt',
    description: 'Kids t-shirt. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'DTG',
    basePriceInr: 120,
    collectionIds: ['kids-clothing'],
    variants: apparelVariants('kids-t-shirt', 'Kids T-Shirt'),
    placements: TEE_PLACEMENTS,
  },
  {
    key: 'baseball-cap',
    name: 'Baseball Cap',
    description: 'Embroidered baseball cap. Sandbox fixture — Qikink publishes no catalog API.',
    printMethod: 'embroidery',
    basePriceInr: 200,
    collectionIds: ['headwear'],
    variants: [
      {
        sku: 'baseball-cap-black-one-size',
        name: 'Baseball Cap / Black / One Size',
        size: 'One Size',
        color: 'Black',
        colorCode: '#000000',
      },
      {
        sku: 'baseball-cap-white-one-size',
        name: 'Baseball Cap / White / One Size',
        size: 'One Size',
        color: 'White',
        colorCode: '#FFFFFF',
      },
    ],
    placements: [{ name: 'Front', label: 'Front', required: true }],
  },
];

export function filterQikinkCatalog(collectionId?: string): QikinkFixtureProduct[] {
  if (!collectionId) {
    return QIKINK_SANDBOX_CATALOG;
  }
  return QIKINK_SANDBOX_CATALOG.filter((product) => product.collectionIds.includes(collectionId));
}

export function listQikinkCatalogCollections(): CatalogCollection[] {
  return QIKINK_CATALOG_COLLECTIONS.map((collection) => {
    const products = filterQikinkCatalog(collection.id);
    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      image: products.find((product) => product.image)?.image ?? null,
      productCount: products.length,
    };
  }).filter((collection) => collection.productCount > 0);
}

export function stripQikinkPrefix(id: string): string {
  return id.startsWith(QIKINK_ID_PREFIX) ? id.slice(QIKINK_ID_PREFIX.length) : id;
}

export function qikinkProductId(productKey: string): string {
  return `${QIKINK_ID_PREFIX}${productKey}`;
}

export function qikinkVariantId(sku: string): string {
  return `${QIKINK_ID_PREFIX}${sku}`;
}

export function findFixtureProduct(id: string): QikinkFixtureProduct | undefined {
  const key = stripQikinkPrefix(id);
  return QIKINK_SANDBOX_CATALOG.find((product) => product.key === key);
}

export function findFixtureVariant(skuOrId: string): {
  product: QikinkFixtureProduct;
  variant: QikinkFixtureVariant;
} | undefined {
  const sku = stripQikinkPrefix(skuOrId);
  for (const product of QIKINK_SANDBOX_CATALOG) {
    const variant = product.variants.find((item) => item.sku === sku);
    if (variant) {
      return { product, variant };
    }
  }
  return undefined;
}

export function mapFixturePlacement(placement: QikinkFixturePlacement): CatalogSlot {
  return {
    name: placement.name,
    label: placement.label,
    required: placement.required,
    acceptedFormats: [...IMAGE_FORMATS],
  };
}

export function mapFixtureVariant(
  product: QikinkFixtureProduct,
  variant: QikinkFixtureVariant,
): ProviderCatalogVariant {
  return {
    id: qikinkVariantId(variant.sku),
    name: variant.name,
    size: variant.size,
    color: variant.color,
    colorCode: variant.colorCode,
    image: null,
    providerRef: variant.sku,
    price: {
      cost: product.basePriceInr,
      currency: 'INR',
    },
  };
}

export function mapFixtureProduct(
  product: QikinkFixtureProduct,
  options?: { includeVariants?: boolean },
): ProviderCatalogProduct {
  return {
    id: qikinkProductId(product.key),
    name: product.name,
    brand: 'Qikink',
    model: product.printMethod,
    description: product.description,
    image: product.image ?? null,
    providerName: 'qikink',
    slots: product.placements.map(mapFixturePlacement),
    variants: options?.includeVariants
      ? product.variants.map((variant) => mapFixtureVariant(product, variant))
      : undefined,
  };
}

export function toQikinkProviderConfig(input: {
  sku: string;
  placementSku: string;
  catalogProductId: string;
  catalogVariantId: string;
  searchFromMyProducts?: 0 | 1;
  printMethod?: string;
  printTypeId?: number;
  basePriceInr?: number;
}): QikinkProviderConfig {
  return {
    sku: input.sku,
    searchFromMyProducts: input.searchFromMyProducts ?? QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
    placementSku: input.placementSku,
    catalogProductId: input.catalogProductId,
    catalogVariantId: input.catalogVariantId,
    ...(input.printMethod ? { printMethod: input.printMethod } : {}),
    ...(typeof input.printTypeId === 'number' ? { printTypeId: input.printTypeId } : {}),
    ...(typeof input.basePriceInr === 'number' ? { basePriceInr: input.basePriceInr } : {}),
  };
}

export function providerConfigFromCatalogSelection(input: {
  product: ProviderCatalogProduct;
  variant: ProviderCatalogVariant;
  placementSku?: string;
}): QikinkProviderConfig {
  const requiredSlot = input.product.slots?.find((slot) => slot.required);
  const placementSku = input.placementSku ?? requiredSlot?.name ?? input.product.slots?.[0]?.name;
  if (!placementSku) {
    throw new Error(`Qikink catalog product ${input.product.id} has no placement SKU`);
  }

  const fixture = findFixtureProduct(input.product.id);
  return toQikinkProviderConfig({
    sku: input.variant.providerRef,
    placementSku,
    catalogProductId: input.product.id,
    catalogVariantId: input.variant.id,
    printMethod: input.product.model ?? undefined,
    searchFromMyProducts: fixture?.searchFromMyProducts,
    ...(fixture?.searchFromMyProducts === 1 ? { basePriceInr: fixture.basePriceInr } : {}),
  });
}

/**
 * T4 entry point: turn the generic catalog-builder ids into the T2 Qikink
 * providerConfig (sku, searchFromMyProducts, placementSku, catalog ids).
 * Placement comes from the fixture (Front on the current tee), not from a
 * retail price and not from an invented Qikink API.
 */
export function buildQikinkProviderConfig(input: {
  catalogProductId: string;
  catalogVariantId: string;
  placementSku?: string;
}): QikinkProviderConfig {
  return resolveQikinkCatalogSelection(input).providerConfig;
}

export function resolveQikinkCatalogSelection(input: {
  catalogProductId: string;
  catalogVariantId: string;
  placementSku?: string;
}): {
  product: ProviderCatalogProduct;
  variant: ProviderCatalogVariant;
  providerConfig: QikinkProviderConfig;
} {
  const fixture = findFixtureProduct(input.catalogProductId);
  if (!fixture) {
    throw new Error(`Qikink catalog product ${input.catalogProductId} not found`);
  }

  const product = mapFixtureProduct(fixture, { includeVariants: true });
  const requested = stripQikinkPrefix(input.catalogVariantId);
  const variant = product.variants?.find((item) =>
    item.id === input.catalogVariantId
    || item.providerRef === requested
    || stripQikinkPrefix(item.id) === requested,
  );
  if (!variant) {
    throw new Error(`Qikink catalog variant ${input.catalogVariantId} not found`);
  }

  return {
    product,
    variant,
    providerConfig: providerConfigFromCatalogSelection({
      product,
      variant,
      placementSku: input.placementSku,
    }),
  };
}
