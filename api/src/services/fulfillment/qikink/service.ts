import { nanoid } from 'nanoid';
import { Effect } from 'every-plugin/effect';
import { FulfillmentError } from '../errors';
import type {
  PingOutput,
  BrowseCatalogOutput,
  CatalogProductDetailOutput,
  CatalogVariantsOutput,
  VariantPriceOutput,
  GenerateMockupsOutput,
  GetMockupResultOutput,
  OrderResult,
  FulfillmentOrder,
  CreateOrderInput,
  ShippingQuoteInput,
  ShippingQuoteOutput,
  TaxQuoteOutput,
  TaxQuoteInput,
  GetPlacementsOutput,
} from '../schema';
import {
  findFixtureProduct,
  filterQikinkCatalog,
  listQikinkCatalogCollections,
  mapFixturePlacement,
  mapFixtureProduct,
  mapFixtureVariant,
  stripQikinkPrefix,
} from './catalog';
import { QikinkClient } from './client';
import {
  parseQikinkOrderId,
  quoteQikinkFallbackShipping,
  toQikinkCreateOrderPayload,
  toQikinkShippingAddress,
} from './orders';
import type { QikinkClientConfig, QikinkCreateOrderPayload } from './types';

/** In-process synthetic draft. Qikink has no draft API; confirmOrder is the first HTTP call. */
interface QikinkLocalDraft {
  id: string;
  input: CreateOrderInput;
  payload: QikinkCreateOrderPayload;
  created: number;
  status: FulfillmentOrder['status'];
  qikinkOrderId?: string;
  confirmInFlight?: Promise<OrderResult>;
}

const UNSUPPORTED = (method: string) =>
  new FulfillmentError({
    message: `Qikink provider does not support ${method} yet`,
    code: 'UNSUPPORTED_OPERATION',
    provider: 'qikink',
  });

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

export class QikinkService {
  private readonly client: QikinkClient;
  private readonly catalogCache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly drafts = new Map<string, QikinkLocalDraft>();

  constructor(config: QikinkClientConfig) {
    this.client = new QikinkClient(config);
  }

  ping(): Effect.Effect<PingOutput, FulfillmentError> {
    return Effect.tryPromise({
      try: async () => {
        await this.client.ping();
        return {
          provider: 'qikink',
          status: 'ok' as const,
          timestamp: new Date().toISOString(),
        };
      },
      catch: (error) => {
        if (error instanceof FulfillmentError) {
          return error;
        }
        return new FulfillmentError({
          message: `Qikink connection test failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'SERVICE_UNAVAILABLE',
          provider: 'qikink',
          cause: error,
        });
      },
    });
  }

  browseCatalog(input: { limit?: number; offset?: number; collectionId?: string } = {}): Effect.Effect<BrowseCatalogOutput, FulfillmentError> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const collectionId = input.collectionId;
    return Effect.succeed(
      this.getCached(`browse:${limit}:${offset}:${collectionId ?? ''}`, () => {
        const fixtures = filterQikinkCatalog(collectionId);
        const products = fixtures.map((product) => mapFixtureProduct(product));
        return {
          products: products.slice(offset, offset + limit),
          total: products.length,
          collections: listQikinkCatalogCollections(),
        };
      }),
    );
  }

  getCatalogProduct(input: { id: string }): Effect.Effect<CatalogProductDetailOutput, FulfillmentError> {
    const product = findFixtureProduct(input.id);
    if (!product) {
      return Effect.fail(new FulfillmentError({
        message: `Qikink catalog product ${input.id} not found`,
        code: 'NOT_FOUND',
        provider: 'qikink',
      }));
    }

    return Effect.succeed(
      this.getCached(`product:${stripQikinkPrefix(input.id)}`, () => ({
        product: mapFixtureProduct(product, { includeVariants: true }),
      })),
    );
  }

  getCatalogProductVariants(input: { id: string }): Effect.Effect<CatalogVariantsOutput, FulfillmentError> {
    const product = findFixtureProduct(input.id);
    if (!product) {
      return Effect.fail(new FulfillmentError({
        message: `Qikink catalog product ${input.id} not found`,
        code: 'NOT_FOUND',
        provider: 'qikink',
      }));
    }

    return Effect.succeed(
      this.getCached(`variants:${stripQikinkPrefix(input.id)}`, () => ({
        variants: product.variants.map((variant) => mapFixtureVariant(product, variant)),
      })),
    );
  }

  getPlacements(input: { providerConfig: Record<string, unknown> }): Effect.Effect<GetPlacementsOutput, FulfillmentError> {
    const catalogProductId = input.providerConfig.catalogProductId;
    if (typeof catalogProductId !== 'string' && typeof catalogProductId !== 'number') {
      return Effect.succeed({ placements: [] });
    }

    const product = findFixtureProduct(String(catalogProductId));
    if (!product) {
      return Effect.fail(new FulfillmentError({
        message: `Qikink catalog product ${catalogProductId} not found`,
        code: 'NOT_FOUND',
        provider: 'qikink',
      }));
    }

    return Effect.succeed(
      this.getCached(`placements:${product.key}`, () => ({
        placements: product.placements.map(mapFixturePlacement),
      })),
    );
  }

  getVariantPrice(): Effect.Effect<VariantPriceOutput, FulfillmentError> {
    return Effect.fail(UNSUPPORTED('getVariantPrice'));
  }

  generateMockups(): Effect.Effect<GenerateMockupsOutput, FulfillmentError> {
    return Effect.succeed({ status: 'unsupported', images: [] });
  }

  getMockupResult(): Effect.Effect<GetMockupResultOutput, FulfillmentError> {
    return Effect.succeed({ status: 'unsupported', images: [] });
  }

  createOrder(input: CreateOrderInput): Effect.Effect<OrderResult, FulfillmentError> {
    return Effect.try({
      try: () => {
        const payload = toQikinkCreateOrderPayload(input);
        const draft: QikinkLocalDraft = {
          id: `qk_${nanoid(12)}`,
          input,
          payload,
          created: Date.now(),
          status: 'draft',
        };
        this.drafts.set(draft.id, draft);
        return { id: draft.id, status: draft.status };
      },
      catch: (error) => {
        if (error instanceof FulfillmentError) {
          return error;
        }
        return new FulfillmentError({
          message: `Qikink draft create failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'UNKNOWN',
          provider: 'qikink',
          cause: error,
        });
      },
    });
  }

  getOrder(input: { id: string }): Effect.Effect<{ order: FulfillmentOrder }, FulfillmentError> {
    // Qikink documents GET /api/order but the collection shows no query params
    // and no response body. Keep a local stub over the synthetic draft rather
    // than inventing a lookup contract.
    const draft = this.drafts.get(input.id);
    if (!draft) {
      return Effect.fail(new FulfillmentError({
        message: `Qikink draft ${input.id} not found`,
        code: 'NOT_FOUND',
        provider: 'qikink',
      }));
    }

    return Effect.succeed({
      order: {
        id: draft.qikinkOrderId ?? draft.id,
        externalId: draft.payload.order_number,
        status: draft.status,
        created: draft.created,
        updated: Date.now(),
        recipient: draft.input.recipient,
      },
    });
  }

  confirmOrder(input: { id: string }): Effect.Effect<OrderResult, FulfillmentError> {
    return Effect.tryPromise({
      try: async () => {
        const draft = this.drafts.get(input.id);
        if (!draft) {
          throw new FulfillmentError({
            message: `Qikink draft ${input.id} not found`,
            code: 'NOT_FOUND',
            provider: 'qikink',
          });
        }

        if (draft.qikinkOrderId) {
          return { id: draft.qikinkOrderId, status: draft.status };
        }

        if (draft.confirmInFlight) {
          return draft.confirmInFlight;
        }

        draft.confirmInFlight = this.submitDraft(draft).finally(() => {
          draft.confirmInFlight = undefined;
        });
        return draft.confirmInFlight;
      },
      catch: (error) => {
        if (error instanceof FulfillmentError) {
          return error;
        }
        return new FulfillmentError({
          message: `Qikink confirm failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'UNKNOWN',
          provider: 'qikink',
          cause: error,
        });
      },
    });
  }

  cancelOrder(input: { id: string }): Effect.Effect<OrderResult, FulfillmentError> {
    const draft = this.drafts.get(input.id);
    if (!draft) {
      return Effect.succeed({ id: input.id, status: 'cancelled' });
    }
    if (draft.qikinkOrderId) {
      return Effect.fail(new FulfillmentError({
        message: 'Qikink does not document a cancel-order API; confirmed orders cannot be cancelled here',
        code: 'UNSUPPORTED_OPERATION',
        provider: 'qikink',
      }));
    }
    draft.status = 'cancelled';
    return Effect.succeed({ id: draft.id, status: 'cancelled' });
  }

  quoteShipping(input: ShippingQuoteInput): Effect.Effect<ShippingQuoteOutput, FulfillmentError> {
    return Effect.try({
      try: () => {
        toQikinkShippingAddress(input.recipient);
        return quoteQikinkFallbackShipping(input.currency ?? 'USD');
      },
      catch: (error) => {
        if (error instanceof FulfillmentError) {
          return error;
        }
        return new FulfillmentError({
          message: `Qikink shipping quote failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'UNKNOWN',
          provider: 'qikink',
          cause: error,
        });
      },
    });
  }

  /**
   * TODO: Qikink/India tax still needs to be solved. A simple/flat approach may
   * be considered because this provider is India-only. Do not hardcode or treat
   * any GST/rate as decided.
   */
  calculateTax(_input?: TaxQuoteInput): Effect.Effect<TaxQuoteOutput, FulfillmentError> {
    return Effect.succeed({
      required: false,
      rate: 0,
      shippingTaxable: false,
      exempt: true,
    });
  }

  private async submitDraft(draft: QikinkLocalDraft): Promise<OrderResult> {
    if (draft.qikinkOrderId) {
      return { id: draft.qikinkOrderId, status: draft.status };
    }

    const response = await this.client.createOrder(draft.payload);
    const qikinkOrderId = parseQikinkOrderId(response, draft.payload.order_number);
    draft.qikinkOrderId = qikinkOrderId;
    draft.status = 'processing';
    return { id: qikinkOrderId, status: draft.status };
  }

  private getCached<T>(key: string, factory: () => T): T {
    const hit = this.catalogCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }

    const value = factory();
    this.catalogCache.set(key, { value, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS });
    return value;
  }
}
