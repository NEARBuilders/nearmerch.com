import { createPlugin } from 'every-plugin';
import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { FulfillmentContract } from '../contract';
import { FulfillmentError } from '../errors';
import { QikinkService } from './service';

const mapFulfillmentErrorToORPC = (error: FulfillmentError) => {
  switch (error.code) {
    case 'RATE_LIMIT':
      return new ORPCError('TOO_MANY_REQUESTS', {
        message: error.message,
        data: { provider: error.provider, statusCode: error.statusCode },
      });
    case 'INVALID_ADDRESS':
    case 'INVALID_REQUEST':
      return new ORPCError('BAD_REQUEST', {
        message: error.message,
        data: { provider: error.provider, code: error.code },
      });
    case 'AUTHENTICATION_FAILED':
      return new ORPCError('UNAUTHORIZED', {
        message: error.message,
        data: { provider: error.provider },
      });
    case 'SERVICE_UNAVAILABLE':
      return new ORPCError('SERVICE_UNAVAILABLE', {
        message: error.message,
        data: { provider: error.provider },
      });
    case 'NOT_FOUND':
      return new ORPCError('NOT_FOUND', {
        message: error.message,
        data: { provider: error.provider },
      });
    case 'UNSUPPORTED_OPERATION':
      return new ORPCError('NOT_IMPLEMENTED', {
        message: error.message,
        data: { provider: error.provider },
      });
    default:
      return new ORPCError('INTERNAL_SERVER_ERROR', {
        message: error.message,
        data: { provider: error.provider },
      });
  }
};

const wrapHandler = <T>(effect: Effect.Effect<T, FulfillmentError>) =>
  Effect.runPromise(effect.pipe(Effect.mapError(mapFulfillmentErrorToORPC)));

export default createPlugin({
  variables: z.object({
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
    baseUrl: z.string().optional(),
  }),

  secrets: z.object({
    QIKINK_CLIENT_ID: z.string(),
    QIKINK_CLIENT_SECRET: z.string(),
  }),

  contract: FulfillmentContract,

  initialize: (config) =>
    Effect.gen(function* () {
      const service = new QikinkService({
        clientId: config.secrets.QIKINK_CLIENT_ID,
        clientSecret: config.secrets.QIKINK_CLIENT_SECRET,
        environment: config.variables.environment,
        baseUrl: config.variables.baseUrl,
      });

      console.log('[Qikink Plugin] Initialized successfully');

      return { service };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service } = context;

    return {
      ping: builder.ping.handler(async () =>
        wrapHandler(service.ping())
      ),

      browseCatalog: builder.browseCatalog.handler(async ({ input }) =>
        wrapHandler(service.browseCatalog(input))
      ),

      getCatalogProduct: builder.getCatalogProduct.handler(async ({ input }) =>
        wrapHandler(service.getCatalogProduct(input))
      ),

      getCatalogProductVariants: builder.getCatalogProductVariants.handler(async ({ input }) =>
        wrapHandler(service.getCatalogProductVariants(input))
      ),

      getVariantPrice: builder.getVariantPrice.handler(async () =>
        wrapHandler(service.getVariantPrice())
      ),

      generateMockups: builder.generateMockups.handler(async () =>
        wrapHandler(service.generateMockups())
      ),

      getMockupResult: builder.getMockupResult.handler(async () =>
        wrapHandler(service.getMockupResult())
      ),

      createOrder: builder.createOrder.handler(async ({ input }) =>
        wrapHandler(service.createOrder(input))
      ),

      getOrder: builder.getOrder.handler(async ({ input }) =>
        wrapHandler(service.getOrder(input))
      ),

      confirmOrder: builder.confirmOrder.handler(async ({ input }) =>
        wrapHandler(service.confirmOrder(input))
      ),

      cancelOrder: builder.cancelOrder.handler(async ({ input }) =>
        wrapHandler(service.cancelOrder(input))
      ),

      quoteShipping: builder.quoteShipping.handler(async ({ input }) =>
        wrapHandler(service.quoteShipping(input))
      ),

      calculateTax: builder.calculateTax.handler(async ({ input }) =>
        wrapHandler(service.calculateTax(input))
      ),

      getPlacements: builder.getPlacements.handler(async ({ input }) =>
        wrapHandler(service.getPlacements(input))
      ),
    };
  },
});

export { QikinkClient } from './client';
export { QikinkService } from './service';
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
} from './catalog';
export {
  QIKINK_DOCUMENTED_PRINT_TYPE_ID,
  QIKINK_ORDER_CREATE_PATH,
  QIKINK_ORDER_GET_PATH,
  QIKINK_ORDER_NUMBER_MAX_LENGTH,
  QIKINK_DESIGN_CODE_MAX_LENGTH,
  QIKINK_STANDARD_SHIPPING_RATE_AMOUNT,
  QIKINK_STANDARD_SHIPPING_RATE_ID,
  quoteQikinkFallbackShipping,
  toQikinkCreateOrderPayload,
  toQikinkOrderNumber,
  toQikinkPlacementSku,
  toQikinkDesignCode,
  mapQikinkDesignFromItem,
} from './orders';
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
} from './types';
