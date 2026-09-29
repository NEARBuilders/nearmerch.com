import { describe, expect, it } from 'vitest';
import { Effect, Layer } from 'every-plugin/effect';
import { CheckoutService, CheckoutServiceLive } from '@/services/checkout';
import { EmailService } from '@/services/email';
import { buildQikinkProviderConfig } from '@/services/fulfillment/qikink/catalog';
import {
  QIKINK_ORDER_CREATE_PATH,
  QIKINK_ORDER_NUMBER_MAX_LENGTH,
  QIKINK_STANDARD_SHIPPING_RATE_ID,
} from '@/services/fulfillment/qikink/orders';
import { QikinkService } from '@/services/fulfillment/qikink/service';
import { processPaymentSuccessEffect } from '@/services/payment/payment-success';
import { QIKINK_PROVIDER_TEST_ADDRESS } from '@/services/provider-tests';
import { OrderStore, ProductStore, ProviderConfigStore } from '@/store';

const DESIGN_FILE = {
  assetId: 'qikink-test-design-front',
  url: 'https://example.com/qikink-front.png',
  slot: 'Front',
};

const QIKINK_PRODUCT = {
  id: 'prod_qikink_t5',
  slug: 'qikink-classic-round-neck-tee',
  title: 'Classic Round Neck Tee',
  createdAt: new Date().toISOString(),
  listed: true,
  price: 25,
  currency: 'USD',
  tags: [],
  options: [],
  images: [],
  collections: [],
  featured: false,
  priceLocked: false,
  variants: [
    {
      id: 'var_qikink_white_m',
      name: 'White / M',
      sku: 'classic-round-neck-tee-white-m',
      price: 25,
      currency: 'USD',
      attributes: [
        { name: 'Size', value: 'M' },
        { name: 'Color', value: 'White' },
      ],
      fulfillmentConfig: {
        providerName: 'qikink',
        providerConfig: {
          ...buildQikinkProviderConfig({
            catalogProductId: 'qikink-classic-round-neck-tee',
            catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
          }),
        },
        files: [DESIGN_FILE],
      },
      inStock: true,
    },
  ],
  designFiles: [DESIGN_FILE],
  fulfillmentProvider: 'qikink',
  source: 'qikink',
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function wrapQikinkClient(service: QikinkService) {
  return {
    quoteShipping: (input: Parameters<QikinkService['quoteShipping']>[0]) =>
      Effect.runPromise(service.quoteShipping(input)),
    createOrder: (input: Parameters<QikinkService['createOrder']>[0]) =>
      Effect.runPromise(service.createOrder(input)),
    confirmOrder: (input: Parameters<QikinkService['confirmOrder']>[0]) =>
      Effect.runPromise(service.confirmOrder(input)),
    calculateTax: (input?: Parameters<QikinkService['calculateTax']>[0]) =>
      Effect.runPromise(service.calculateTax(input)),
  };
}

function createRuntime(service: QikinkService) {
  return {
    getProvider: (name: string) => {
      if (name !== 'qikink') return null;
      return {
        name: 'qikink',
        client: wrapQikinkClient(service),
      };
    },
    getPaymentProvider: (name: string) => {
      if (name !== 'pingpay' && name !== 'stripe') return null;
      return {
        name,
        client: {
          createCheckout: async () => ({
            sessionId: 'sess_qikink_t5',
            url: 'https://pay.example/sess_qikink_t5',
          }),
        },
      };
    },
    getExclusiveCheckProvider: () => null,
    getStorageProvider: () => null,
    fulfillmentConfig: {},
    providers: [{ name: 'qikink' }],
    paymentProviders: [],
    exclusiveCheckProviders: [],
    storageProviders: [],
    shutdown: async () => {},
  } as any;
}

function createMemoryOrderStore() {
  const orders = new Map<string, any>();

  const get = (id: string) => {
    const order = orders.get(id);
    if (!order) throw new Error(`Order ${id} not found`);
    return order;
  };

  return {
    create: (input: any) =>
      Effect.sync(() => {
        const id = 'order_qikink_t5';
        const order = {
          id,
          userId: input.userId,
          status: 'pending',
          items: (input.items ?? []).map((item: any, index: number) => ({
            id: `${id}-item-${index}`,
            orderId: id,
            ...item,
          })),
          subtotal: input.subtotal,
          shippingCost: input.shippingCost,
          taxAmount: input.taxAmount,
          vatAmount: input.vatAmount,
          taxRequired: input.taxRequired,
          taxRate: input.taxRate,
          taxShippingTaxable: input.taxShippingTaxable,
          taxExempt: input.taxExempt,
          totalAmount: input.totalAmount,
          currency: input.currency,
          shippingAddress: input.shippingAddress,
          fulfillmentReferenceId: 'oqkinkorder001',
          draftOrderIds: {},
        };
        orders.set(id, order);
        return { ...order };
      }),
    find: (id: string) => Effect.sync(() => {
      const order = orders.get(id);
      return order ? { ...order } : null;
    }),
    updatePaymentDetails: (id: string, paymentDetails: unknown) =>
      Effect.sync(() => {
        const order = get(id);
        order.paymentDetails = paymentDetails;
        return { ...order };
      }),
    updateCheckout: (id: string, checkoutSessionId: string, checkoutProvider: string) =>
      Effect.sync(() => {
        const order = get(id);
        order.checkoutSessionId = checkoutSessionId;
        order.checkoutProvider = checkoutProvider;
        return { ...order };
      }),
    updateDraftOrderIds: (id: string, draftOrderIds: Record<string, string>) =>
      Effect.sync(() => {
        const order = get(id);
        order.draftOrderIds = draftOrderIds;
        return { ...order };
      }),
    updateStatus: (id: string, status: string) =>
      Effect.sync(() => {
        const order = get(id);
        order.status = status;
        return { ...order };
      }),
    createAuditLog: () => Effect.sync(() => undefined),
  } as any;
}

const productStore = {
  find: (identifier: string) =>
    Effect.succeed(
      identifier === QIKINK_PRODUCT.id || identifier === QIKINK_PRODUCT.slug
        ? QIKINK_PRODUCT
        : null,
    ),
} as any;

function paymentSupportLayer(orderStore: ReturnType<typeof createMemoryOrderStore>) {
  return Layer.mergeAll(
    Layer.succeed(OrderStore, orderStore),
    Layer.succeed(ProviderConfigStore, {
      getConfig: () => Effect.succeed(null),
    } as any),
    Layer.succeed(EmailService, {
      sendNotification: () => Effect.sync(() => undefined),
    }),
  );
}

describe('Qikink checkout through existing NearMerch payment path', () => {
  it('quotes qikink-standard, drafts locally, and confirms exactly one Qikink order after payment', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        if (url.endsWith('/api/token')) {
          return jsonResponse({ Accesstoken: 'token-1', expires_in: 3600 });
        }
        if (url.endsWith(QIKINK_ORDER_CREATE_PATH)) {
          return jsonResponse({ order_id: 'qk-sandbox-1' });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const runtime = createRuntime(service);
    const orderStore = createMemoryOrderStore();
    const appLayer = CheckoutServiceLive(runtime).pipe(
      Layer.provide(Layer.succeed(ProductStore, productStore)),
      Layer.provide(Layer.succeed(OrderStore, orderStore)),
    );

    const cartItems = [{
      productId: QIKINK_PRODUCT.slug,
      variantId: QIKINK_PRODUCT.variants[0]!.id,
      quantity: 2,
    }];

    const { quote, checkout, unpaidCreateCalls, order } = await Effect.runPromise(
      Effect.gen(function* () {
        const checkoutService = yield* CheckoutService;
        const quoteResult = yield* checkoutService.getQuote(cartItems, QIKINK_PROVIDER_TEST_ADDRESS);
        const checkoutResult = yield* checkoutService.createCheckout({
          userId: 't5-buyer.near',
          items: cartItems,
          address: QIKINK_PROVIDER_TEST_ADDRESS,
          selectedRates: { qikink: QIKINK_STANDARD_SHIPPING_RATE_ID },
          shippingCost: quoteResult.shippingCost,
          successUrl: 'https://nearmerch.com/success',
          cancelUrl: 'https://nearmerch.com/cancel',
          paymentProvider: 'pingpay',
        });
        const unpaidCreate = calls.filter((call) => call.url.endsWith(QIKINK_ORDER_CREATE_PATH));
        const createdOrder = yield* orderStore.find(checkoutResult.orderId);

        return {
          quote: quoteResult,
          checkout: checkoutResult,
          unpaidCreateCalls: unpaidCreate,
          order: createdOrder,
        };
      }).pipe(Effect.provide(appLayer)) as Effect.Effect<any>,
    );

    expect(order?.draftOrderIds?.qikink).toMatch(/^qk_/);
    expect(unpaidCreateCalls).toHaveLength(0);

    const paid = await Effect.runPromise(
      processPaymentSuccessEffect({
        runtime,
        order,
        actor: 'service:pingpay',
        metadata: { simulated: true, eventType: 'payment.success' },
      }).pipe(Effect.provide(paymentSupportLayer(orderStore))),
    );

    expect(QIKINK_PRODUCT.listed).toBe(true);
    expect(QIKINK_PRODUCT.fulfillmentProvider).toBe('qikink');
    expect(QIKINK_PRODUCT.currency).toBe('USD');

    expect(quote.providerBreakdown).toHaveLength(1);
    expect(quote.providerBreakdown[0]?.provider).toBe('qikink');
    expect(quote.providerBreakdown[0]?.selectedShipping.rateId).toBe(QIKINK_STANDARD_SHIPPING_RATE_ID);
    expect(quote.shippingCost).toBe(0);
    expect(quote.currency).toBe('USD');
    expect(quote.taxBreakdown).toMatchObject({ required: false, exempt: true, taxAmount: 0 });

    expect(checkout.draftOrderIds.qikink).toMatch(/^qk_/);
    expect(unpaidCreateCalls).toHaveLength(0);

    expect(paid.allProviderConfirmationsSucceeded).toBe(true);
    expect(paid.confirmationResults.qikink).toEqual({ success: true });
    expect(paid.order.status).toBe('processing');

    const orderCalls = calls.filter((call) => call.url.endsWith(QIKINK_ORDER_CREATE_PATH));
    expect(orderCalls).toHaveLength(1);

    const payload = JSON.parse(orderCalls[0]!.body!);
    expect(payload.order_number.length).toBeLessThanOrEqual(QIKINK_ORDER_NUMBER_MAX_LENGTH);
    expect(payload.gateway).toBe('Prepaid');
    expect(payload.qikink_shipping).toBe('1');
    expect(payload.total_order_value).toBe('320');
    expect(payload.line_items).toEqual([
      {
        search_from_my_products: 0,
        sku: 'classic-round-neck-tee-white-m',
        quantity: '2',
        price: '160',
        print_type_id: 1,
        designs: [
          {
            design_code: 'qikink-test-design-f',
            width_inches: '',
            height_inches: '',
            placement_sku: 'fr',
            design_link: DESIGN_FILE.url,
            mockup_link: DESIGN_FILE.url,
          },
        ],
      },
    ]);
    expect(payload.line_items[0]).not.toHaveProperty('design_code');
    expect(payload.shipping_address).toMatchObject({
      first_name: 'Test',
      last_name: 'Customer',
      address1: '123 Main Street',
      phone: '9876543210',
      email: 'test@example.com',
      city: 'Mumbai',
      zip: '400001',
      province: 'Maharashtra',
      country_code: 'IN',
    });

    const draftId = checkout.draftOrderIds.qikink;
    expect(draftId).toBeTruthy();
    const retry = await wrapQikinkClient(service).confirmOrder({
      id: draftId!,
    });
    expect(retry).toEqual({ id: 'qk-sandbox-1', status: 'processing' });
    expect(calls.filter((call) => call.url.endsWith(QIKINK_ORDER_CREATE_PATH))).toHaveLength(1);
  });

  it('never calls POST /api/order/create for unpaid checkout', async () => {
    const calls: string[] = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error('unpaid checkout must not call Qikink');
      },
    });

    const runtime = createRuntime(service);
    const orderStore = createMemoryOrderStore();
    const appLayer = CheckoutServiceLive(runtime).pipe(
      Layer.provide(Layer.succeed(ProductStore, productStore)),
      Layer.provide(Layer.succeed(OrderStore, orderStore)),
    );

    const cartItems = [{
      productId: QIKINK_PRODUCT.id,
      variantId: QIKINK_PRODUCT.variants[0]!.id,
      quantity: 1,
    }];

    const checkout = await Effect.runPromise(
      Effect.gen(function* () {
        const checkoutService = yield* CheckoutService;
        const quote = yield* checkoutService.getQuote(cartItems, QIKINK_PROVIDER_TEST_ADDRESS);
        return yield* checkoutService.createCheckout({
          userId: 't5-buyer.near',
          items: cartItems,
          address: QIKINK_PROVIDER_TEST_ADDRESS,
          selectedRates: { qikink: quote.providerBreakdown[0]!.selectedShipping.rateId },
          shippingCost: quote.shippingCost,
          successUrl: 'https://nearmerch.com/success',
          cancelUrl: 'https://nearmerch.com/cancel',
          paymentProvider: 'stripe',
        });
      }).pipe(Effect.provide(appLayer)),
    );

    expect(checkout.draftOrderIds.qikink).toMatch(/^qk_/);
    expect(calls.some((url) => url.includes(QIKINK_ORDER_CREATE_PATH))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('quotes unlisted provider-test Qikink products used by the admin harness', async () => {
    const unlistedProduct = {
      ...QIKINK_PRODUCT,
      listed: false,
      source: 'provider-test:qikink',
    };
    const harnessStore = {
      find: (identifier: string) =>
        Effect.succeed(
          identifier === unlistedProduct.id || identifier === unlistedProduct.slug
            ? unlistedProduct
            : null,
        ),
    } as any;

    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        throw new Error('quote must not call Qikink');
      },
    });

    const appLayer = CheckoutServiceLive(createRuntime(service)).pipe(
      Layer.provide(Layer.succeed(ProductStore, harnessStore)),
      Layer.provide(Layer.succeed(OrderStore, createMemoryOrderStore())),
    );

    const quote = await Effect.runPromise(
      Effect.gen(function* () {
        const checkoutService = yield* CheckoutService;
        return yield* checkoutService.getQuote(
          [{ productId: unlistedProduct.slug, variantId: unlistedProduct.variants[0]!.id, quantity: 1 }],
          QIKINK_PROVIDER_TEST_ADDRESS,
        );
      }).pipe(Effect.provide(appLayer)),
    );

    expect(quote.providerBreakdown[0]?.selectedShipping.rateId).toBe(QIKINK_STANDARD_SHIPPING_RATE_ID);
  });

  it('rejects Qikink quote/checkout when the Indian phone requirement is missing', async () => {
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        throw new Error('address validation must not call Qikink');
      },
    });

    const runtime = createRuntime(service);
    const appLayer = CheckoutServiceLive(runtime).pipe(
      Layer.provide(Layer.succeed(ProductStore, productStore)),
      Layer.provide(Layer.succeed(OrderStore, createMemoryOrderStore())),
    );

    await expect(Effect.runPromise(
      Effect.gen(function* () {
        const checkoutService = yield* CheckoutService;
        return yield* checkoutService.getQuote(
          [{ productId: QIKINK_PRODUCT.slug, quantity: 1 }],
          {
            ...QIKINK_PROVIDER_TEST_ADDRESS,
            phone: undefined,
          },
        );
      }).pipe(Effect.provide(appLayer)),
    )).rejects.toThrow(/Phone number is required for Qikink delivery/);
  });
});
