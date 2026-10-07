export * from './schema';
export * from './contract';

export { PrintfulService } from './printful/service';

export { LuluService } from './lulu/service';

export { ManualService } from './manual/service';
export {
  MANUAL_PROVIDER_FIELDS,
  ManualProviderSettingsSchema,
  type ManualProviderSettings,
  type ManualProviderFields,
} from './manual/types';

export { QikinkClient } from './qikink/client';
export { QikinkService } from './qikink/service';
export {
  QIKINK_CATALOG_SOURCE,
  QIKINK_MY_PRODUCTS_TEST_SKU,
  QIKINK_SANDBOX_CATALOG,
  QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS,
  mapFixtureProduct,
  mapFixtureVariant,
  providerConfigFromCatalogSelection,
  toQikinkProviderConfig,
  buildQikinkProviderConfig,
} from './qikink/catalog';
export {
  QIKINK_ORDER_CREATE_PATH,
  QIKINK_ORDER_GET_PATH,
  QIKINK_ORDER_NUMBER_MAX_LENGTH,
  QIKINK_STANDARD_SHIPPING_RATE_AMOUNT,
  QIKINK_STANDARD_SHIPPING_RATE_ID,
  quoteQikinkFallbackShipping,
  toQikinkCreateOrderPayload,
} from './qikink/orders';
export {
  QIKINK_API_DOCS_URL,
  QIKINK_BASE_URLS,
  QIKINK_PROVIDER_FIELDS,
  QikinkProviderDetailsSchema,
  resolveQikinkBaseUrl,
  resolveQikinkEnvironment,
  type QikinkClientConfig,
  type QikinkCreateOrderPayload,
  type QikinkDesign,
  type QikinkEnvironment,
  type QikinkFetch,
  type QikinkProviderConfig,
  type QikinkProviderDetails,
  type QikinkProviderFields,
} from './qikink/types';
