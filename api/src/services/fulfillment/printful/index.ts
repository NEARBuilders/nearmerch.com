import { createPlugin } from 'every-plugin';
import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { FulfillmentContract } from '../contract';
import { FulfillmentError } from '../errors';
import { PrintfulService } from './service';

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
    baseUrl: z.string().default('https://api.printful.com'),
  }),

  secrets: z.object({
    PRINTFUL_API_KEY: z.string(),
    PRINTFUL_STORE_ID: z.string(),
    PRINTFUL_WEBHOOK_SECRET: z.string().optional(),
  }),

  contract: FulfillmentContract,

  initialize: (config) =>
    Effect.gen(function* () {
      const service = new PrintfulService(
        config.secrets.PRINTFUL_API_KEY,
        config.secrets.PRINTFUL_STORE_ID,
        config.variables.baseUrl
      );

      console.log('[Printful Plugin] Initialized successfully');

      return {
        service,
        webhookSecret: config.secrets.PRINTFUL_WEBHOOK_SECRET,
      };
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

      getVariantPrice: builder.getVariantPrice.handler(async ({ input }) =>
        wrapHandler(service.getVariantPrice(input))
      ),

      generateMockups: builder.generateMockups.handler(async ({ input }) =>
        wrapHandler(service.generateMockups(input))
      ),

      getMockupResult: builder.getMockupResult.handler(async ({ input }) =>
        wrapHandler(service.getMockupResult(input.taskId))
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
        wrapHandler(service.calculateTax(input))),

      getPlacements: builder.getPlacements.handler(async ({ input }) =>
        wrapHandler(service.getPlacements(input))),
    };
  },
});

export { PrintfulService } from './service';
export { PrintfulProviderDetailsSchema, type PrintfulProviderDetails } from './types';
export { PRINTFUL_PROVIDER_FIELDS } from './fields';
