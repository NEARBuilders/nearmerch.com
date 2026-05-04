import {
  PrintfulClient as PrintfulSDK,
  CatalogItem,
  type Address,
  type Order,
  type Shipment,
  type Variant
} from 'printful-sdk-js-v2';
import { Effect, Schedule } from 'every-plugin/effect';
import { FulfillmentError } from '../errors';

export type { Address, CatalogItem, Order, Shipment, Variant } from 'printful-sdk-js-v2';

export interface TechniquePrice {
  technique: string;
  price: number;
  discountedPrice: number;
}

export interface PlacementPrice {
  placement: string;
  technique: string;
  price: number;
  discountedPrice: number;
}

export interface VariantPricing {
  techniques: TechniquePrice[];
  placements: PlacementPrice[];
  currency: string;
}

export interface PrintfulProviderConfig {
  catalogVariantId: number;
  catalogProductId: number;
  technique?: string;
  techniquePrice?: number;
  placementPricing?: Record<string, number>;
  fulfillmentCost?: number;
}

export interface PrintfulSyncProduct {
  id: number;
  external_id: string;
  name: string;
  variants: number;
  synced: number;
  thumbnail_url: string | null;
  is_ignored: boolean;
}

export interface PrintfulSyncVariant {
  id: number;
  external_id: string;
  sync_product_id: number;
  name: string;
  synced: boolean;
  variant_id: number;
  retail_price: string | null;
  currency: string;
  product: {
    variant_id: number;
    product_id: number;
    image: string;
    name: string;
  };
  files: Array<{
    id: number;
    type: string;
    url: string | null;
    preview_url?: string | null;
    thumbnail_url?: string | null;
    filename?: string;
    mime_type?: string;
    status?: string;
  }>;
}

export interface PrintfulSyncProductsResult {
  sync_products: PrintfulSyncProduct[];
  paging: { total: number; offset: number; limit: number };
}

export interface PrintfulSyncProductDetail {
  sync_product: PrintfulSyncProduct;
  sync_variants: PrintfulSyncVariant[];
}

export class PrintfulClient {
  private sdk: PrintfulSDK;
  private catalogVariantCache = new Map<number, Variant>();

  constructor(
    private readonly apiKey: string,
    private readonly storeId: string,
    private readonly baseUrl = 'https://api.printful.com'
  ) {
    this.sdk = new PrintfulSDK({ TOKEN: apiKey });
  }

  get catalogV2() { return this.sdk.catalogV2; }
  get ordersV2() { return this.sdk.ordersV2; }
  get mockupGeneratorV2() { return this.sdk.mockupGeneratorV2; }
  get storesV2() { return this.sdk.storesV2; }
  get webhookV2() { return this.sdk.webhookV2; }

  getStoreId(): string { return this.storeId; }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options?: { timeoutMs?: number; retries?: number; }
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const retries = options?.retries ?? 5;

    const retrySchedule = Schedule.exponential('1 second').pipe(
      Schedule.intersect(Schedule.recurs(retries))
    ) as unknown as Schedule.Schedule<number>;

    const execute = Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const data = await operation();
          return data;
        },
        catch: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('429') || message.includes('Too Many Requests') || message.includes('Rate limit')) {
            return FulfillmentError.fromHttpStatus(429, 'printful', message, error);
          }
          const statusCode = error instanceof Error && 'status' in error ? (error as any).status : 500;
          return FulfillmentError.fromHttpStatus(statusCode, 'printful', message, error);
        },
      }) as Effect.Effect<T, FulfillmentError>;
      return result;
    }).pipe(
      Effect.timeout(`${timeoutMs} millis`),
      Effect.retry({
        times: retries,
        schedule: retrySchedule,
        while: (error) => error instanceof FulfillmentError && error.isRetryable,
      }),
      Effect.catchAll((error) => {
        if (error instanceof FulfillmentError) return Effect.fail(error);
        return Effect.fail(new Error(`${operationName} failed: ${error}`));
      })
    ) as Effect.Effect<T, Error>;

    return await Effect.runPromise(execute);
  }

  // ─── Sync Products (V1 API) ───

  async getSyncProducts(limit = 100, offset = 0): Promise<PrintfulSyncProductsResult> {
    return this.executeWithRetry(
      async () => {
        const response = await fetch(
          `${this.baseUrl}/store/products?limit=${limit}&offset=${offset}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'X-PF-Store-Id': this.storeId,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Printful V1 API error: ${response.status}`);
        }

        const raw: any = await response.json();

        const result = raw.result;
        const paging = raw.paging;

        let sync_products: PrintfulSyncProduct[];
        if (Array.isArray(result)) {
          sync_products = result;
        } else if (result?.sync_products && Array.isArray(result.sync_products)) {
          sync_products = result.sync_products;
        } else {
          sync_products = [];
        }

        return {
          sync_products,
          paging: paging || { total: sync_products.length, offset, limit },
        };
      },
      `getSyncProducts(offset=${offset})`
    );
  }

  async getSyncProduct(id: number | string): Promise<PrintfulSyncProductDetail> {
    return this.executeWithRetry(
      async () => {
        const response = await fetch(
          `${this.baseUrl}/store/products/${id}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'X-PF-Store-Id': this.storeId,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Printful V1 API error: ${response.status}`);
        }

        const data = await response.json() as { result: PrintfulSyncProductDetail };
        return data.result;
      },
      `getSyncProduct(${id})`
    );
  }

  // ─── Catalog (V2 SDK) ───

  async browseCatalog(limit = 50, offset = 0): Promise<{
    products: Array<{
      id: number;
      name: string;
      brand?: string;
      model?: string;
      image?: string;
      variants_count?: number;
    }>;
    total: number;
  }> {
    const result = await this.executeWithRetry(
      () => this.sdk.catalogV2.getProducts(undefined, undefined, limit, undefined, offset),
      'browseCatalog'
    );
    const data = result as { data?: any[]; paging?: { total: number } };
    const products = (data.data || []).map((p: any) => ({
      id: p.id,
      name: p.name ?? '',
      brand: p.brand ?? undefined,
      model: p.model ?? undefined,
      image: p.image ?? undefined,
      variants_count: p.variants_count ?? 0,
    }));
    return { products, total: data.paging?.total ?? products.length };
  }

  async getCatalogProduct(productId: number): Promise<{
    id: number;
    name: string;
    brand?: string;
    model?: string;
    description?: string;
    image?: string;
    techniques?: string[];
    placements?: string[];
    placementTechniques?: Record<string, string>;
    primaryPlacement?: { name: string; technique: string };
  } | null> {
    try {
      const result = await this.executeWithRetry(
        () => this.sdk.catalogV2.getProductById(productId),
        `getCatalogProduct(${productId})`
      );
      const data = result as { data?: any };
      if (!data?.data) return null;
      const product = data.data;
      const techniques = new Set<string>();
      const orderedPlacements: string[] = [];
      const placementTechniques: Record<string, string> = {};
      let primaryPlacement: { name: string; technique: string } | undefined;

      if (Array.isArray(product.placements)) {
        for (const p of product.placements) {
          if (p.placement) {
            orderedPlacements.push(p.placement);
            if (p.technique) {
              placementTechniques[p.placement] = p.technique;
            }
            if (!primaryPlacement && p.placement !== 'mockup' && p.technique) {
              primaryPlacement = { name: p.placement, technique: p.technique };
            }
          }
        }
      }

      if (product.variants && Array.isArray(product.variants)) {
        for (const variant of product.variants) {
          if (variant.techniques && Array.isArray(variant.techniques)) variant.techniques.forEach((t: string) => techniques.add(t));
          if (variant.placements && Array.isArray(variant.placements)) variant.placements.forEach((p: string) => {
            if (!orderedPlacements.includes(p)) orderedPlacements.push(p);
          });
        }
      }
      return {
        id: product.id ?? productId,
        name: product.name ?? '',
        brand: product.brand ?? undefined,
        model: product.model ?? undefined,
        description: product.description ?? undefined,
        image: product.image ?? undefined,
        techniques: techniques.size > 0 ? Array.from(techniques) : undefined,
        placements: orderedPlacements.length > 0 ? orderedPlacements : undefined,
        placementTechniques: Object.keys(placementTechniques).length > 0 ? placementTechniques : undefined,
        primaryPlacement,
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(`[PrintfulClient] Catalog product ${productId} not available: ${errorMessage}. Variant fulfillment files will lack technique metadata — orders will need to resolve techniques at creation time.`);
      return null;
    }
  }

  async getCatalogProductVariants(productId: number): Promise<Variant[]> {
    const result = await this.executeWithRetry(
      () => this.sdk.catalogV2.getProductVariantsById(productId),
      `getCatalogProductVariants(${productId})`
    );
    const data = result as { data?: Variant[] };
    return (data?.data ?? []) as Variant[];
  }

  async getVariantPrice(variantId: number): Promise<VariantPricing | null> {
    try {
      const result = await this.executeWithRetry(
        () => this.sdk.catalogV2.getVariantPricesById(variantId),
        `getVariantPrice(${variantId})`
      );
      const data = result as { data?: any };
      if (!data?.data) return null;
      return this.parsePricingResponse(data.data);
    } catch (e) {
      console.log(`[PrintfulClient] Variant price ${variantId} not available: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async getVariantPricesBatch(variantIds: number[]): Promise<Map<number, VariantPricing>> {
    const results = new Map<number, VariantPricing>();
    await Effect.runPromise(
      Effect.forEach(variantIds, (variantId) =>
        Effect.tryPromise({
          try: async () => {
            const price = await this.getVariantPrice(variantId);
            if (price) results.set(variantId, price);
          },
          catch: () => {},
        })
      , { concurrency: 5 })
    );
    return results;
  }

  async getProductPrices(productId: number): Promise<VariantPricing | null> {
    try {
      const result = await this.executeWithRetry(
        () => this.sdk.catalogV2.getProductPricesById(productId),
        `getProductPrices(${productId})`
      );
      const data = result as { data?: any };
      if (!data?.data) return null;
      return this.parsePricingResponse(data.data);
    } catch (e) {
      console.warn(`[PrintfulClient] Product prices ${productId} not available: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private parsePricingResponse(d: any): VariantPricing {
    const techniques: TechniquePrice[] = [];
    if (Array.isArray(d.variant?.techniques)) {
      for (const t of d.variant.techniques) {
        techniques.push({
          technique: t.technique_key,
          price: parseFloat(t.price ?? '0'),
          discountedPrice: parseFloat(t.discounted_price ?? '0'),
        });
      }
    }

    const placements: PlacementPrice[] = [];
    if (Array.isArray(d.product?.placements)) {
      for (const p of d.product.placements) {
        if (p.id && p.technique_key) {
          placements.push({
            placement: p.id,
            technique: p.technique_key,
            price: parseFloat(p.price ?? '0'),
            discountedPrice: parseFloat(p.discounted_price ?? '0'),
          });
        }
      }
    }

    return { techniques, placements, currency: d.currency ?? 'USD' };
  }

  async getCatalogVariant(variantId: number): Promise<Variant | null> {
    if (this.catalogVariantCache.has(variantId)) return this.catalogVariantCache.get(variantId)!;
    try {
      const result = await this.executeWithRetry(
        () => this.sdk.catalogV2.getVariantById(variantId),
        `getCatalogVariant(${variantId})`
      );
      const variant = (result?.data ?? null) as Variant | null;
      if (variant) this.catalogVariantCache.set(variantId, variant);
      return variant;
    } catch (e) {
      if (e instanceof FulfillmentError && e.code === 'RATE_LIMIT') throw e;
      console.log(`[PrintfulClient] Catalog variant ${variantId} not available: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async getCatalogVariantsBatch(variantIds: number[], concurrency = 6): Promise<Map<number, Variant>> {
    const results = new Map<number, Variant>();
    const uniqueIds = [...new Set(variantIds)].filter(id => {
      if (this.catalogVariantCache.has(id)) {
        results.set(id, this.catalogVariantCache.get(id)!);
        return false;
      }
      return true;
    });
    if (uniqueIds.length === 0) return results;

    const variantResults = await Effect.runPromise(
      Effect.all(
        uniqueIds.map(id =>
          Effect.tryPromise({
            try: async () => {
              const response = await this.sdk.catalogV2.getVariantById(id);
              return { id, variant: (response?.data ?? null) as Variant | null };
            },
            catch: () => ({ id, variant: null }),
          }).pipe(
            Effect.timeout('3000 millis'),
            Effect.catchAll(() => Effect.succeed({ id, variant: null as Variant | null }))
          )
        ),
        { concurrency }
      )
    );

    for (const { id, variant } of variantResults) {
      if (variant) {
        results.set(id, variant);
        this.catalogVariantCache.set(id, variant);
      }
    }
    return results;
  }

  // ─── Orders (V2 SDK) ───

  async createOrder(orderInput: {
    external_id?: string;
    shipping?: string;
    recipient: Address;
    order_items: CatalogItem[];
  }): Promise<Order> {
    const result = await this.executeWithRetry(
      () => this.sdk.ordersV2.createOrder(this.storeId, orderInput),
      'createOrder'
    );
    return result.data as Order;
  }

  async confirmOrder(orderId: string | number): Promise<void> {
    await this.executeWithRetry(
      () => this.sdk.ordersV2.confirmOrder(orderId, this.storeId),
      `confirmOrder(${orderId})`
    );
  }

  async deleteOrder(orderId: string | number): Promise<void> {
    await this.executeWithRetry(
      () => this.sdk.ordersV2.deleteOrder(orderId, this.storeId),
      `deleteOrder(${orderId})`
    );
  }

  async getOrder(orderId: string): Promise<Order> {
    const result = await this.executeWithRetry(
      () => this.sdk.ordersV2.getOrder(orderId, this.storeId),
      `getOrder(${orderId})`
    );
    return result.data as Order;
  }

  async getOrderShipments(orderId: string): Promise<Shipment[]> {
    const result = await this.executeWithRetry(
      () => this.sdk.ordersV2.getShipments(orderId, this.storeId),
      `getOrderShipments(${orderId})`
    );
    return (result?.data ?? []) as Shipment[];
  }

  // ─── Shipping Rates (V2 SDK) ───

  async calculateShippingRates(params: {
    recipient: { country_code: string; state_code?: string; city?: string; zip?: string };
    items: Array<{ catalog_variant_id: number; quantity: number }>;
    currency?: string;
  }): Promise<Array<{
    shipping: string;
    shipping_method_name: string;
    rate: string;
    currency: string;
    min_delivery_days?: number;
    max_delivery_days?: number;
    min_delivery_date?: string;
    max_delivery_date?: string;
  }>> {
    const result = await this.executeWithRetry(
      () => this.sdk.shippingRatesV2.calculateShppingRates(
        this.storeId,
        undefined,
        {
          recipient: params.recipient as any,
          order_items: params.items.map(item => ({
            source: CatalogItem.source.CATALOG,
            catalog_variant_id: item.catalog_variant_id,
            quantity: item.quantity,
          })) as any[],
          currency: params.currency || 'USD',
        } as any
      ),
      'calculateShippingRates'
    );
    const data = result as { data?: any[] };
    return (data?.data ?? []) as any[];
  }

  // ─── Order Estimation (V2 SDK) ───

  async estimateOrder(params: {
    recipient: { country_code: string; zip: string; state_code?: string };
    items: Array<{
      catalog_variant_id: number;
      quantity: number;
      designFiles?: Array<{ placement: string; url: string; technique?: string }>;
    }>;
    currency?: string;
    timeoutMs?: number;
    requestTimeoutMs?: number;
    retries?: number;
  }): Promise<{
    subtotal: number;
    shipping: number;
    tax: number;
    vat: number;
    total: number;
    currency: string;
  }> {
    const orderItems = params.items.map(item => {
      const placements = (item.designFiles || [])
        .filter(df => df.technique)
        .map(df => ({
          placement: df.placement,
          technique: df.technique!,
          layers: [{ type: 'file' as const, url: df.url }],
        }));
      return {
        source: CatalogItem.source.CATALOG,
        catalog_variant_id: item.catalog_variant_id,
        quantity: item.quantity,
        ...(placements.length > 0 ? { placements } : {}),
      };
    });

    const requestBody = {
      recipient: {
        country_code: params.recipient.country_code,
        zip: params.recipient.zip,
        state_code: params.recipient.state_code,
      },
      order_items: orderItems,
      retail_costs: params.currency ? { currency: params.currency } : undefined,
    };

    const timeoutMs = params.timeoutMs ?? 30000;
    const requestTimeoutMs = params.requestTimeoutMs ?? timeoutMs;
    const retries = params.retries ?? 5;

    const result = await this.executeWithRetry(
      () => this.sdk.ordersV2.createOrderEstimationTask(this.storeId, requestBody),
      'createOrderEstimationTask',
      { timeoutMs: requestTimeoutMs, retries }
    );

    const task = result.data as { id: string; status: string };
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const pollResult = await this.executeWithRetry(
        () => this.sdk.ordersV2.getOrderEstimationTask(task.id, this.storeId),
        `getOrderEstimationTask(${task.id})`,
        { timeoutMs: requestTimeoutMs, retries }
      );
      const estimation = pollResult.data as {
        id: string;
        status: string;
        costs?: {
          subtotal: string;
          shipping: string;
          tax: string;
          vat: string;
          total: string;
          currency: string;
        };
        failure_reasons?: Array<{ message: string }>;
      };
      if (estimation.status === 'completed' && estimation.costs) {
        return {
          subtotal: parseFloat(estimation.costs.subtotal) || 0,
          shipping: parseFloat(estimation.costs.shipping) || 0,
          tax: parseFloat(estimation.costs.tax) || 0,
          vat: parseFloat(estimation.costs.vat) || 0,
          total: parseFloat(estimation.costs.total) || 0,
          currency: estimation.costs.currency || 'USD',
        };
      }
      if (estimation.status === 'failed') {
        throw new Error(`Order estimation failed: ${estimation.failure_reasons?.map(r => r.message).join(', ')}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Order estimation timed out after ${timeoutMs}ms`);
  }

  // ─── Webhooks ───

  async configureWebhooks(params: {
    defaultUrl: string;
    events: Array<{ type: string }>;
    expiresAt?: string | null;
  }): Promise<{
    defaultUrl: string;
    expiresAt: string | null;
    events: Array<{ type: string; url: string | null }>;
    publicKey: string;
    secretKey: string;
  }> {
    const response = await this.executeWithRetry(
      () => this.sdk.webhookV2.createWebhook(
        { default_url: params.defaultUrl, expires_at: params.expiresAt || null, events: params.events } as unknown as Record<string, unknown>,
        this.storeId
      ),
      'configureWebhooks'
    );
    const data = response as unknown as {
      data: {
        default_url: string;
        expires_at: string | null;
        events: Array<{ type: string; url: string | null }>;
        public_key: string;
        secret_key: string;
      };
    };
    return {
      defaultUrl: data.data.default_url,
      expiresAt: data.data.expires_at,
      events: data.data.events,
      publicKey: data.data.public_key,
      secretKey: data.data.secret_key,
    };
  }

  async disableWebhooks(): Promise<void> {
    await this.executeWithRetry(
      () => this.sdk.webhookV2.disableWebhook(this.storeId),
      'disableWebhooks'
    );
  }

  async getWebhookConfig(): Promise<{
    defaultUrl: string;
    expiresAt: string | null;
    events: Array<{ type: string; url: string | null }>;
    publicKey: string;
  } | null> {
    try {
      const response = await this.executeWithRetry(
        () => this.sdk.webhookV2.getWebhooks(this.storeId),
        'getWebhookConfig'
      );
      const data = response as unknown as {
        data: { default_url: string; expires_at: string | null; events: Array<{ type: string; url: string | null }>; public_key: string; };
      };
      if (!data?.data?.default_url) return null;
      return { defaultUrl: data.data.default_url, expiresAt: data.data.expires_at, events: data.data.events, publicKey: data.data.public_key };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && (error as any).status === 404) return null;
      throw error;
    }
  }
}
