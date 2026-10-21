import { createPlugin } from 'every-plugin';
import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { FulfillmentContract } from '../contract';
import { FulfillmentError } from '../errors';
import { LuluService } from './service';

const mapError = (error: unknown) => {
  if (error instanceof FulfillmentError) {
    switch (error.code) {
      case 'UNSUPPORTED_OPERATION':
        return new ORPCError('NOT_IMPLEMENTED', { message: error.message });
      case 'NOT_FOUND':
        return new ORPCError('NOT_FOUND', { message: error.message });
      default:
        return new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message });
    }
  }
  return error;
};

const run = <T, E>(effect: Effect.Effect<T, E>) =>
  Effect.runPromise(effect.pipe(Effect.mapError(mapError as any))) as Promise<T>;

export default createPlugin({
  variables: z.object({
    baseUrl: z.string().optional(),
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
  }),

  secrets: z.object({
    LULU_CLIENT_KEY: z.string(),
    LULU_CLIENT_SECRET: z.string(),
  }),

  contract: FulfillmentContract,

  initialize: (config) =>
    Effect.gen(function* () {
      const service = new LuluService({
        clientKey: config.secrets.LULU_CLIENT_KEY,
        clientSecret: config.secrets.LULU_CLIENT_SECRET,
        baseUrl: config.variables.baseUrl,
        environment: config.variables.environment,
        books: [],
      });

      console.log('[Lulu Plugin] Initialized successfully');

      return { service };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service } = context;

    return {
      ping: builder.ping.handler(async () => run(service.ping())),

      browseCatalog: builder.browseCatalog.handler(async ({ input }) => run(service.browseCatalog(input))),

      getCatalogProduct: builder.getCatalogProduct.handler(async ({ input }) => run(service.getCatalogProduct(input))),

      getCatalogProductVariants: builder.getCatalogProductVariants.handler(async ({ input }) => run(service.getCatalogProductVariants(input))),

      getVariantPrice: builder.getVariantPrice.handler(async ({ input }) => run(service.getVariantPrice(input))),

      generateMockups: builder.generateMockups.handler(async ({ input }) => run(service.generateMockups(input))),

      getMockupResult: builder.getMockupResult.handler(async ({ input }) => run(service.getMockupResult(input.taskId))),

      createOrder: builder.createOrder.handler(async ({ input }) => run(service.createOrder(input))),

      getOrder: builder.getOrder.handler(async ({ input }) => run(service.getOrder(input.id))),

      confirmOrder: builder.confirmOrder.handler(async ({ input }) => run(service.confirmOrder(input.id))),

      cancelOrder: builder.cancelOrder.handler(async ({ input }) => run(service.cancelOrder(input.id))),

      quoteShipping: builder.quoteShipping.handler(async ({ input }) => run(service.quoteOrder(input))),

      calculateTax: builder.calculateTax.handler(async ({ input }) => run(service.calculateTax(input))),

      getPlacements: builder.getPlacements.handler(async ({ input }) => run(service.getPlacements(input))),
    };
  },
});

export { LuluService } from './service';
export { LuluProviderDetailsSchema, type LuluProviderDetails } from './types';
export { LULU_PROVIDER_FIELDS } from './fields';