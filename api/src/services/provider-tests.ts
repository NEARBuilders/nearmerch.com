import { Effect } from 'every-plugin/effect';
import type { MarketplaceRuntime } from '../runtime';
import type {
  OrderWithItems,
  OrderStatus,
  ProviderName,
  ProviderTestRun,
  ProviderTestScenario,
  ProviderTestState,
  ProviderTestStep,
  Product,
  ProductImage,
  ProductWithImages,
  QuoteItemInput,
  ShippingAddress,
} from '../schema';
import { CheckoutService } from './checkout';
import { EmailService } from './email';
import { parsePrintfulWebhook } from './fulfillment/printful/webhook';
import { LuluService } from './fulfillment/lulu/service';
import { processLuluWebhookEffect, processPrintfulWebhookEffect } from './fulfillment/webhook';
import { processPaymentSuccessEffect } from './payment/payment-success';
import { OrderStore, ProductStore, ProviderConfigStore, ProviderTestStateStore } from '../store';
import { processManualWebhookEffect } from './webhooks/manual';
import { QIKINK_MY_PRODUCTS_TEST_SKU, toQikinkProviderConfig } from './fulfillment/qikink/catalog';

const DEFAULT_ADDRESS: ShippingAddress = {
  firstName: 'Test',
  lastName: 'Customer',
  addressLine1: '123 Test St',
  city: 'Portland',
  state: 'OR',
  postCode: '97201',
  country: 'US',
  email: 'test@example.com',
};

/** Qikink orders require phone + pincode; the US harness address would fail quote/checkout. */
export const QIKINK_PROVIDER_TEST_ADDRESS: ShippingAddress = {
  firstName: 'Test',
  lastName: 'Customer',
  addressLine1: '123 Main Street',
  city: 'Mumbai',
  state: 'Maharashtra',
  postCode: '400001',
  country: 'IN',
  email: 'test@example.com',
  phone: '9876543210',
};

export function defaultShippingAddressForProvider(provider: ProviderName): ShippingAddress {
  if (provider === 'qikink') {
    return QIKINK_PROVIDER_TEST_ADDRESS;
  }
  return DEFAULT_ADDRESS;
}

type ProviderTestProductStore = {
  findById: (id: string) => Effect.Effect<Product | null, Error>;
  findBySource: (source: string) => Effect.Effect<Product | null, Error>;
  findBySlug: (slug: string) => Effect.Effect<Product | null, Error>;
  upsert: (product: ProductWithImages) => Effect.Effect<Product & { isNew: boolean }, Error>;
  updateProduct: (
    id: string,
    data: {
      name?: string;
      description?: string | null;
      price?: number;
      priceLocked?: boolean;
      variants?: Array<{ id: string; price: number }>;
      images?: ProductImage[];
      thumbnailImage?: string | null;
    },
  ) => Effect.Effect<Product | null, Error>;
  updateListing: (id: string, listed: boolean) => Effect.Effect<Product | null, Error>;
};

type ProviderTestStateStoreLike = {
  getState: (provider: ProviderName) => Effect.Effect<ProviderTestState | null, Error>;
  upsertState: (input: {
    provider: ProviderName;
    testProductId?: string | null;
    selectedRates?: Record<string, string> | null;
    scenario?: ProviderTestScenario | null;
    latestOrderId?: string | null;
    latestStepResults?: Record<string, unknown>;
    latestWebhookPayloads?: Record<string, unknown>;
  }) => Effect.Effect<ProviderTestState, Error>;
};

function testSlug(provider: ProviderName) {
  return `provider-test-${provider}`;
}

function testSource(provider: ProviderName) {
  return `provider-test:${provider}`;
}

function normalizeScenario(provider: ProviderName, scenario?: ProviderTestScenario | null): ProviderTestScenario {
  return {
    quantity: scenario?.quantity ?? 1,
    shippingAddress: scenario?.shippingAddress ?? defaultShippingAddressForProvider(provider),
    selectedRates: scenario?.selectedRates,
    successUrl: scenario?.successUrl ?? `https://nearmerch.com/admin/providers?provider=${provider}`,
    cancelUrl: scenario?.cancelUrl ?? `https://nearmerch.com/admin/providers?provider=${provider}`,
    product: scenario?.product ?? {},
    requestOverrides: scenario?.requestOverrides ?? {},
    payloadOverrides: scenario?.payloadOverrides ?? {},
    paymentProvider: (scenario as Record<string, unknown> | undefined)?.paymentProvider as 'stripe' | 'pingpay' | undefined,
  };
}

function defaultProduct(provider: ProviderName, scenario: ProviderTestScenario): ProductWithImages {
  const productOverrides = scenario.product ?? {};
  const price = typeof productOverrides.price === 'number' ? productOverrides.price : 25;
  const currency = typeof productOverrides.currency === 'string' ? productOverrides.currency : 'USD';
  const productId = `${testSlug(provider)}-product`;
  const variantId = `${testSlug(provider)}-variant`;

  return {
    id: productId,
    publicKey: `${provider}-test-key`,
    slug: testSlug(provider),
    name: productOverrides.name ?? (provider === 'qikink' ? QIKINK_MY_PRODUCTS_TEST_SKU.name : `${provider} provider test product`),
    description: productOverrides.description,
    price,
    currency,
    brand: productOverrides.brand,
    productTypeSlug: productOverrides.productTypeSlug,
    tags: productOverrides.tags ?? [],
    options: productOverrides.options ?? [],
    images: productOverrides.images ?? [],
    thumbnailImage: productOverrides.images?.[0]?.url,
    variants:
      productOverrides.variants ?? [
        {
          id: variantId,
          name: provider === 'qikink'
            ? `${QIKINK_MY_PRODUCTS_TEST_SKU.name} / ${QIKINK_MY_PRODUCTS_TEST_SKU.variation}`
            : `${provider} default variant`,
          sku: provider === 'qikink' ? QIKINK_MY_PRODUCTS_TEST_SKU.productSku : undefined,
          price,
          currency,
          attributes: [],
          fulfillmentConfig:
            provider === 'manual'
              ? undefined
              : provider === 'qikink'
                ? {
                    providerName: 'qikink',
                    providerConfig: {
                      ...toQikinkProviderConfig({
                        sku: QIKINK_MY_PRODUCTS_TEST_SKU.productSku,
                        placementSku: 'Front',
                        catalogProductId: 'qikink-unisex-oversized-raglan',
                        catalogVariantId: `qikink-${QIKINK_MY_PRODUCTS_TEST_SKU.productSku}`,
                        searchFromMyProducts: 1,
                        basePriceInr: QIKINK_MY_PRODUCTS_TEST_SKU.basePriceInr,
                      }),
                      storeSku: QIKINK_MY_PRODUCTS_TEST_SKU.storeSku,
                      designSku: QIKINK_MY_PRODUCTS_TEST_SKU.designSku,
                    },
                    files: productOverrides.designFiles ?? [],
                  }
                : {
                    providerName: provider,
                    providerConfig: {},
                    files: productOverrides.designFiles ?? [],
                  },
          inStock: true,
        },
      ],
    designFiles: productOverrides.designFiles ?? [],
    fulfillmentProvider: productOverrides.fulfillmentProvider ?? provider,
    externalProductId: productOverrides.externalProductId,
    source: testSource(provider),
    metadata: {
      fees: [],
      ...(productOverrides.metadata ?? {}),
    },
  };
}

function getQuoteItems(product: Product, scenario: ProviderTestScenario): QuoteItemInput[] {
  const variantId = product.variants[0]?.id;
  return [{
    productId: product.slug,
    ...(variantId ? { variantId } : {}),
    quantity: scenario.quantity ?? 1,
  }];
}

export function deriveSelectedRates(
  providerBreakdown: Array<{ provider: string; selectedShipping: { rateId: string }; availableRates?: Array<{ rateId: string }> }>,
  scenarioSelectedRates?: Record<string, string>,
) {
  const normalizedSelectedRates = scenarioSelectedRates && Object.keys(scenarioSelectedRates).length > 0
    ? scenarioSelectedRates
    : undefined;

  if (normalizedSelectedRates) {
    for (const [providerName, selectedRateId] of Object.entries(normalizedSelectedRates)) {
      const breakdown = providerBreakdown.find((entry) => entry.provider === providerName);
      if (!breakdown) {
        throw new Error(`Selected rate provided for unknown provider ${providerName}`);
      }

      const matchingRate = breakdown.availableRates?.find((rate) => rate.rateId === selectedRateId);
      if (!matchingRate) {
        throw new Error(`Selected rate ${selectedRateId} is no longer available for provider ${providerName}`);
      }
    }

    for (const breakdown of providerBreakdown) {
      const selectedRateId = normalizedSelectedRates[breakdown.provider];
      if (!selectedRateId) {
        throw new Error(`Missing selected rate for provider ${breakdown.provider}`);
      }
    }

    return normalizedSelectedRates;
  }

  return Object.fromEntries(
    providerBreakdown.map((breakdown) => [breakdown.provider, breakdown.selectedShipping.rateId]),
  );
}

export function assertOwnedTestProduct(product: Product, provider: ProviderName) {
  const expectedSource = testSource(provider);
  if (product.source !== expectedSource) {
    throw new Error(`Refusing to use non-test product ${product.id} for ${provider} provider tests`);
  }
}

export async function resolveTestProduct(options: {
  provider: ProviderName;
  scenario: ProviderTestScenario;
  productStore: ProviderTestProductStore;
  stateStore: ProviderTestStateStoreLike;
}) {
  const { provider, scenario, productStore, stateStore } = options;
  const currentState = (await Effect.runPromise(stateStore.getState(provider))) as ProviderTestState | null;
  const existingId = currentState?.testProductId;
  const baseProduct = defaultProduct(provider, scenario);

  const persistNewProduct = async (product: ProductWithImages) => {
    const created = (await Effect.runPromise(productStore.upsert(product))) as Product & { isNew: boolean };
    await Effect.runPromise(productStore.updateListing(created.id, false));
    await Effect.runPromise(stateStore.upsertState({ provider, testProductId: created.id, scenario }));
    return created;
  };

  const syncExistingProduct = async (existing: Product) => {
    // Qikink checkout needs T2/T4 providerConfig + design files. updateProduct only
    // syncs prices/images, so re-upsert the full harness product for this provider.
    if (provider === 'qikink') {
      const upserted = (await Effect.runPromise(productStore.upsert({
        ...baseProduct,
        id: existing.id,
        slug: existing.slug,
      }))) as Product & { isNew: boolean };
      await Effect.runPromise(productStore.updateListing(existing.id, false));
      await Effect.runPromise(stateStore.upsertState({ provider, testProductId: existing.id, scenario }));
      return upserted;
    }

    const updated = await Effect.runPromise(
      productStore.updateProduct(existing.id, {
        name: baseProduct.name,
        description: baseProduct.description,
        price: baseProduct.price,
        priceLocked: false,
        variants: baseProduct.variants.map((variant) => ({ id: variant.id, price: variant.price })),
        images: baseProduct.images,
        thumbnailImage: baseProduct.thumbnailImage,
      }),
    );

    if (!updated) {
      throw new Error(`Failed to update test product ${existing.id}`);
    }

    await Effect.runPromise(productStore.updateListing(updated.id, false));
    await Effect.runPromise(stateStore.upsertState({ provider, testProductId: updated.id, scenario }));
    return updated;
  };

  if (existingId) {
    const existing = await Effect.runPromise(productStore.findById(existingId)) as Product | null;
    if (existing) {
      assertOwnedTestProduct(existing, provider);
      return await syncExistingProduct(existing);
    }
  }

  const bySource = await Effect.runPromise(productStore.findBySource(testSource(provider))) as Product | null;
  if (bySource) {
    assertOwnedTestProduct(bySource, provider);
    return await syncExistingProduct(bySource);
  }

  const slugCollision = await Effect.runPromise(productStore.findBySlug(testSlug(provider))) as Product | null;
  if (slugCollision) {
    assertOwnedTestProduct(slugCollision, provider);
    return await syncExistingProduct(slugCollision);
  }

  return await persistNewProduct(baseProduct);
}

function mergeStepResults(state: ProviderTestState | null, step: ProviderTestStep, payload: unknown) {
  return {
    ...(state?.latestStepResults ?? {}),
    [step]: payload,
  };
}

function mergeWebhookPayloads(state: ProviderTestState | null, step: ProviderTestStep, payload: unknown) {
  return {
    ...(state?.latestWebhookPayloads ?? {}),
    [step]: payload,
  };
}

function toRun(provider: ProviderName, step: ProviderTestStep, state: ProviderTestState | null, result?: Record<string, unknown>, error?: string): ProviderTestRun {
  return {
    provider,
    step,
    success: !error,
    timestamp: new Date().toISOString(),
    state,
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
}

function makeManualWebhookPayload(order: OrderWithItems, scenario: ProviderTestScenario) {
  return {
    type: 'ORDER_STATUS_CHANGED',
    orderId: order.id,
    status: (scenario.payloadOverrides?.provider_webhook as { status?: string } | undefined)?.status ?? 'processing',
  };
}

function makePrintfulWebhookPayload(order: OrderWithItems, scenario: ProviderTestScenario) {
  const override = (scenario.payloadOverrides?.provider_webhook as Record<string, unknown> | undefined) || {};
  return {
    type: (override.type as string) ?? 'order_updated',
    data: {
      order: {
        external_id: order.fulfillmentReferenceId ?? order.id,
        status: (override as { status?: string }).status ?? 'fulfilled',
      },
      shipment: {
        tracking_number: 'TEST-TRACKING',
        tracking_url: 'https://tracking.example.com/test',
        service: 'Standard',
      },
    },
  };
}

function makeLuluWebhookPayload(order: OrderWithItems, scenario: ProviderTestScenario) {
  const override = (scenario.payloadOverrides?.provider_webhook as Record<string, unknown> | undefined) || {};
  return {
    topic: (override.topic as string) ?? 'PRINT_JOB_STATUS_CHANGED',
    data: {
      id: order.fulfillmentOrderId ?? order.id,
      external_id: order.fulfillmentReferenceId ?? order.id,
      status: (override.status as string) ?? 'SHIPPED',
      created_at: new Date().toISOString(),
      line_items: [
        {
          tracking_id: 'TEST-TRACKING',
          tracking_urls: ['https://tracking.example.com/test'],
          carrier_name: 'Test Carrier',
        },
      ],
      shipping_address: {
        country_code: order.shippingAddress?.country,
      },
    },
  };
}

function getScenarioSelectedRates(state: ProviderTestState | null, scenario: ProviderTestScenario) {
  return scenario.selectedRates ?? state?.selectedRates ?? state?.scenario?.selectedRates;
}

export function runProviderTestStepEffect(options: {
  runtime: MarketplaceRuntime;
  provider: ProviderName;
  step: ProviderTestStep;
}): Effect.Effect<ProviderTestRun, unknown, OrderStore | ProductStore | ProviderTestStateStore | CheckoutService | ProviderConfigStore | EmailService> {
  const { runtime, provider, step } = options;

  return Effect.gen(function* () {
    const productStore = yield* ProductStore;
    const orderStore = yield* OrderStore;
    const stateStore = yield* ProviderTestStateStore;
    const checkoutService = yield* CheckoutService;

    const existingState = (yield* stateStore.getState(provider)) as ProviderTestState | null;
    const scenario = normalizeScenario(provider, existingState?.scenario);
    const productEffect = Effect.tryPromise({
      try: () => resolveTestProduct({ provider, scenario, productStore, stateStore }),
      catch: (error) => new Error(`Failed to resolve test product: ${error}`),
    });
    const product = (yield* productEffect) as Product;

    const baseState = existingState ?? (yield* stateStore.upsertState({ provider, testProductId: product.id, scenario }));
    const persistedSelectedRates = getScenarioSelectedRates(baseState, scenario);

    try {
      switch (step) {
        case 'connection': {
          const providerRuntime = runtime.getProvider(provider);
          if (!providerRuntime) {
            throw new Error(`Provider ${provider} is not configured`);
          }

          const ping = yield* Effect.tryPromise({
            try: () => providerRuntime.client.ping(),
            catch: (error) => new Error(`Connection test failed: ${error}`),
          });

          const result = {
            request: { provider },
            response: ping,
          };

          const state = yield* stateStore.upsertState({
            provider,
            testProductId: product.id,
            scenario,
            latestOrderId: baseState?.latestOrderId ?? null,
            latestStepResults: mergeStepResults(baseState, step, result),
            latestWebhookPayloads: baseState?.latestWebhookPayloads,
          });

          return toRun(provider, step, state, result);
        }

        case 'quote': {
          const items = getQuoteItems(product, scenario);
          const address = scenario.shippingAddress ?? defaultShippingAddressForProvider(provider);
          const quote = yield* checkoutService.getQuote(items, address);
          const selectedRates = deriveSelectedRates(quote.providerBreakdown, scenario.selectedRates);
          const result = {
            request: { items, shippingAddress: address },
            response: quote,
            selectedRate: quote.providerBreakdown[0]?.selectedShipping ?? null,
            selectedRates,
          };

          const state = yield* stateStore.upsertState({
            provider,
            testProductId: product.id,
            selectedRates,
            scenario: {
              ...scenario,
              selectedRates,
            },
            latestOrderId: baseState?.latestOrderId ?? null,
            latestStepResults: mergeStepResults(baseState, step, result),
            latestWebhookPayloads: baseState?.latestWebhookPayloads,
          });

          return toRun(provider, step, state, result);
        }

        case 'checkout': {
          if (baseState?.latestOrderId) {
            try {
              yield* orderStore.deleteOrders([baseState.latestOrderId], 'admin:provider-test');
            } catch {
              // ignore stale order cleanup failures
            }
          }

          const items = getQuoteItems(product, scenario);
          const address = scenario.shippingAddress ?? defaultShippingAddressForProvider(provider);
          const quote = yield* checkoutService.getQuote(items, address);
          const selectedRates = deriveSelectedRates(quote.providerBreakdown, persistedSelectedRates);

          const checkout = yield* checkoutService.createCheckout({
            userId: 'provider-test',
            items,
            address,
            selectedRates,
            shippingCost: quote.shippingCost,
            successUrl: scenario.successUrl ?? `https://nearmerch.com/admin/providers?provider=${provider}`,
            cancelUrl: scenario.cancelUrl ?? `https://nearmerch.com/admin/providers?provider=${provider}`,
            paymentProvider: ((scenario as Record<string, unknown>).paymentProvider as 'stripe' | 'pingpay' | undefined) ?? 'pingpay',
          });

          const order = yield* orderStore.find(checkout.orderId);

          const result = {
            request: { items, shippingAddress: address, selectedRates },
            response: checkout,
            order,
            selectedRates,
          };

          const state = yield* stateStore.upsertState({
            provider,
            testProductId: product.id,
            selectedRates,
            scenario: {
              ...scenario,
              selectedRates,
            },
            latestOrderId: checkout.orderId,
            latestStepResults: mergeStepResults(baseState, step, result),
            latestWebhookPayloads: baseState?.latestWebhookPayloads,
          });

          return toRun(provider, step, state, result);
        }

        case 'payment_webhook': {
          const orderId = baseState?.latestOrderId;
          if (!orderId) {
            throw new Error('No test order exists yet');
          }

          const order = yield* orderStore.find(orderId);
          if (!order) {
            throw new Error('Test order not found');
          }

          const payload = {
            eventType: 'payment.success',
            orderId: order.id,
            sessionId: order.checkoutSessionId ?? order.id,
          };

          const paidResult = yield* processPaymentSuccessEffect({
            runtime,
            order,
            actor: 'admin:provider-test',
            metadata: { simulated: true, payload },
          });

          const result = {
            request: payload,
            response: {
              paymentResult: {
                allProviderConfirmationsSucceeded: paidResult.allProviderConfirmationsSucceeded,
                confirmationResults: paidResult.confirmationResults,
              },
              finalStatus: paidResult.order.status,
            },
            order: paidResult.order,
          };

          const state = yield* stateStore.upsertState({
            provider,
            testProductId: product.id,
            selectedRates: baseState?.selectedRates ?? persistedSelectedRates,
            scenario,
            latestOrderId: order.id,
            latestStepResults: mergeStepResults(baseState, step, result),
            latestWebhookPayloads: mergeWebhookPayloads(baseState, step, payload),
          });

          return toRun(provider, step, state, result);
        }

        case 'provider_webhook': {
          const orderId = baseState?.latestOrderId;
          if (!orderId) {
            throw new Error('No test order exists yet');
          }

          const order = yield* orderStore.find(orderId);
          if (!order) {
            throw new Error('Test order not found');
          }

          let payload: Record<string, unknown>;
          let updatedOrder = order;

          if (provider === 'printful') {
            const rawPayload = makePrintfulWebhookPayload(order, scenario);
            payload = rawPayload as Record<string, unknown>;
            const parsed = parsePrintfulWebhook(JSON.stringify(rawPayload));
            const result = yield* processPrintfulWebhookEffect({
              runtime,
              order,
              eventType: parsed.eventType,
              data: parsed.data,
              actor: 'admin:provider-test',
              metadata: { simulated: true, payload: rawPayload },
            });
            updatedOrder = result.order;
          } else if (provider === 'lulu') {
            const rawPayload = makeLuluWebhookPayload(order, scenario);
            payload = rawPayload as Record<string, unknown>;
            const luluService = new LuluService({ clientKey: '', clientSecret: '', environment: 'sandbox' });
            const parsed = luluService.parseWebhookPayload(JSON.stringify(rawPayload));
            const result = yield* processLuluWebhookEffect({
              order,
              eventType: parsed.eventType,
              data: parsed.data,
              actor: 'admin:provider-test',
              luluService,
              metadata: { simulated: true, payload: rawPayload },
            });
            updatedOrder = result.order;
          } else {
            const rawPayload = makeManualWebhookPayload(order, scenario);
            payload = rawPayload;
            const manualResult = yield* processManualWebhookEffect({
              order,
              actor: 'admin:provider-test',
              status: rawPayload.status as OrderStatus,
              metadata: { simulated: true, payload: rawPayload },
            });
            updatedOrder = manualResult.order;
          }

          const result = {
            request: payload,
            response: { order: updatedOrder },
            order: updatedOrder,
          };

          const state = yield* stateStore.upsertState({
            provider,
            testProductId: product.id,
            scenario,
            latestOrderId: order.id,
            latestStepResults: mergeStepResults(baseState, step, result),
            latestWebhookPayloads: mergeWebhookPayloads(baseState, step, payload),
          });

          return toRun(provider, step, state, result);
        }
      }

      throw new Error(`Unsupported provider test step: ${step}`);
    } catch (error) {
      const state = yield* stateStore.upsertState({
        provider,
        testProductId: product.id,
        selectedRates: baseState?.selectedRates ?? persistedSelectedRates,
        scenario,
        latestOrderId: baseState?.latestOrderId ?? null,
        latestStepResults: mergeStepResults(baseState, step, { error: error instanceof Error ? error.message : String(error) }),
        latestWebhookPayloads: baseState?.latestWebhookPayloads,
      });

      return toRun(provider, step, state, undefined, error instanceof Error ? error.message : String(error));
    }
  });
}

export function saveProviderTestScenarioEffect(options: {
  provider: ProviderName;
  scenario: ProviderTestScenario;
}): Effect.Effect<ProviderTestState, unknown, ProviderTestStateStore | ProductStore> {
  const { provider, scenario } = options;

  return Effect.gen(function* () {
    const stateStore = yield* ProviderTestStateStore;
    const productStore = yield* ProductStore;
    const normalized = normalizeScenario(provider, scenario);
    const productEffect = Effect.tryPromise({
      try: () => resolveTestProduct({ provider, scenario: normalized, productStore, stateStore }),
      catch: (error) => new Error(`Failed to save provider test scenario: ${error}`),
    });
    const product = (yield* productEffect) as Product;

    return yield* stateStore.upsertState({
      provider,
      testProductId: product.id,
      selectedRates: normalized.selectedRates,
      scenario: normalized,
    });
  });
}
