import { createPlugin } from 'every-plugin';
import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { FulfillmentContract } from '../contract';
import { FulfillmentError } from '../errors';
import { ManualService } from './service';
import { ManualProviderSettingsSchema } from './types';

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

const run = <T>(effect: Effect.Effect<T, FulfillmentError>) =>
  Effect.runPromise(effect.pipe(Effect.mapError(mapError))) as Promise<T>;

export default createPlugin({
  variables: z.object({}),

  secrets: z.object({
    MANUAL_FULFILLMENT_FROM_EMAIL: z.string().optional(),
  }),

  contract: FulfillmentContract,

  initialize: () =>
    Effect.gen(function* () {
      const service = new ManualService();

      console.log('[Manual Plugin] Initialized successfully');

      return { service };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service } = context;

    return {
      ping: builder.ping.handler(async () => run(service.ping())),

      browseCatalog: builder.browseCatalog.handler(async () =>
        run(service.browseCatalog())
      ),

      getCatalogProduct: builder.getCatalogProduct.handler(async () =>
        run(service.getCatalogProduct())
      ),

      getCatalogProductVariants: builder.getCatalogProductVariants.handler(async () =>
        run(service.getCatalogProductVariants())
      ),

      getVariantPrice: builder.getVariantPrice.handler(async () =>
        run(service.getVariantPrice())
      ),

      generateMockups: builder.generateMockups.handler(async () =>
        run(service.generateMockups())
      ),

      getMockupResult: builder.getMockupResult.handler(async () =>
        run(service.getMockupResult())
      ),

      createOrder: builder.createOrder.handler(async ({ input }) =>
        run(service.createOrder(input))
      ),

      getOrder: builder.getOrder.handler(async ({ input }) =>
        run(service.getOrder(input))
      ),

      confirmOrder: builder.confirmOrder.handler(async ({ input }) =>
        run(service.confirmOrder(input))
      ),

      cancelOrder: builder.cancelOrder.handler(async ({ input }) =>
        run(service.cancelOrder(input))
      ),

      quoteShipping: builder.quoteShipping.handler(async () =>
        run(service.quoteShipping())
      ),

      calculateTax: builder.calculateTax.handler(async () =>
        run(service.calculateTax())
      ),

      getPlacements: builder.getPlacements.handler(async () =>
        run(service.getPlacements())
      ),
    };
  },
});

export { ManualService } from './service';
export {
  ManualProviderSettingsSchema,
  type ManualProviderSettings,
} from './types';