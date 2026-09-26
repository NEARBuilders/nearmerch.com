import * as crypto from 'crypto';
import { createPlugin } from 'every-plugin';
import { Effect, Layer, Cause, Exit } from 'every-plugin/effect';
import { ManagedRuntime } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { contract } from './contract';
import { cleanupAbandonedDrafts } from './jobs/cleanup-drafts';
import { retryPendingConfirmations } from './jobs/retry-confirmations';
import { createMarketplaceRuntime } from './runtime';
import { ReturnAddressSchema, ManualWebhookPayloadSchema, type ConfigureWebhookOutput, type PrintfulWebhookEventType, type ProductMetadata, type ProviderWebhookEventType, type Product } from './schema';

function sanitizeProductForPublic<T extends Product>(product: T): T {
  if (product.metadata?.providerDetails?.manual) {
    const { manual: _, ...restProviderDetails } = product.metadata.providerDetails;
    const { providerDetails: __, ...restMetadata } = product.metadata;
    return {
      ...product,
      metadata: { ...restMetadata, providerDetails: restProviderDetails },
    };
  }
  return product;
}
import { CheckoutService, CheckoutServiceLive } from './services/checkout';
import { CheckoutError } from './services/checkout/errors';
import { EmailService, EmailServiceLive } from './services/email';
import { ProductService, ProductServiceLive } from './services/products';
import { ProductBuilderService, ProductBuilderServiceLive } from './services/product-builder';
import { AssetService, AssetServiceLive } from './services/assets';
import { StripeService } from './services/stripe';
import { NewsletterService, NewsletterServiceLive } from './services/newsletter';
import { MerchBoxService, MerchBoxServiceLive } from './services/merch-box';
import { MerchBoxStoreLive } from './store/merch-box';
import { DatabaseLive, OrderStore, OrderStoreLive, ProductStore, ProductStoreLive, ProductTypeStore, ProductTypeStoreLive, CollectionStoreLive, AssetStoreLive, ProviderTestStateStore, ProviderTestStateStoreLive } from './store';
import { NewsletterStoreLive } from './store/newsletter';
import { ProviderConfigStore, ProviderConfigStoreLive } from './store/providers';
import { parsePrintfulWebhook, verifyPrintfulWebhookSignature } from './services/fulfillment/printful/webhook';
import { verifyPingPayWebhookSignature } from './services/payment/pingpay/service';
import { handlePingPayWebhookEffect } from './services/payment/pingpay/webhook';
import { processPaymentSuccessEffect } from './services/payment/payment-success';
import { processManualWebhookEffect } from './services/webhooks/manual';
import { verifyManualWebhookSignature } from './services/webhooks/manual-auth';
import { logWebhookProcessingError, readWebhookBody } from './services/webhooks/common/route';
import { runProviderTestStepEffect, saveProviderTestScenarioEffect } from './services/provider-tests';
import { findOrderByFulfillmentRefEffect, processLuluWebhookEffect, processPrintfulWebhookEffect } from './services/fulfillment/webhook';
import { isProviderOrderAlreadyGone } from './utils/provider-order-cancel';
export * from './schema';



export default createPlugin({
  variables: z.object({
    network: z.enum(["mainnet", "testnet"]).default("mainnet"),
    contractId: z.string().default("social.near"),
    nodeUrl: z.string().optional(),
    hostUrl: z.string().url().optional(),
    returnAddress: ReturnAddressSchema.optional(),
    luluEnvironment: z.enum(['sandbox', 'production']).default('production'),
    storageProvider: z.enum(["r2", "s3"]).optional(),
    storageBucket: z.string().optional(),
    storageEndpoint: z.string().optional(),
    storagePublicUrl: z.string().optional(),
    storageRegion: z.string().default("us-east-1"),
  }),

  secrets: z.object({
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    PRINTFUL_API_KEY: z.string().optional(),
    PRINTFUL_STORE_ID: z.string().optional(),
    PRINTFUL_WEBHOOK_SECRET: z.string().optional(),
    LULU_CLIENT_KEY: z.string().optional(),
    LULU_CLIENT_SECRET: z.string().optional(),
    PING_API_KEY: z.string().optional(),
    PING_WEBHOOK_SECRET: z.string().optional(),
    MANUAL_WEBHOOK_SECRET: z.string().optional(),
    ACCESS_KEY_ID: z.string().optional(),
    SECRET_ACCESS_KEY: z.string().optional(),
    MANUAL_FULFILLMENT_FROM_EMAIL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    API_DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5433/api"),
    API_DATABASE_AUTH_TOKEN: z.string().optional(),
  }),

  context: z.object({
    nearAccountId: z.string().optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
    user: z.object({
      id: z.string(),
      role: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
    }).nullable(),
  }),

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const nearNodeUrl =
        config.variables.nodeUrl ||
        (config.variables.network === "testnet"
          ? "https://rpc.testnet.near.org"
          : "https://rpc.mainnet.near.org");

      const stripeService =
        config.secrets.STRIPE_SECRET_KEY && config.secrets.STRIPE_WEBHOOK_SECRET
          ? new StripeService(
              config.secrets.STRIPE_SECRET_KEY,
              config.secrets.STRIPE_WEBHOOK_SECRET,
            )
          : null;

      const runtime = yield* Effect.promise(() =>
        createMarketplaceRuntime(
          {
            printful:
              config.secrets.PRINTFUL_API_KEY &&
              config.secrets.PRINTFUL_STORE_ID
                ? {
                    apiKey: config.secrets.PRINTFUL_API_KEY,
                    storeId: config.secrets.PRINTFUL_STORE_ID,
                    webhookSecret: config.secrets.PRINTFUL_WEBHOOK_SECRET,
                  }
                : undefined,
            lulu:
              config.secrets.LULU_CLIENT_KEY && config.secrets.LULU_CLIENT_SECRET
                ? {
                  clientKey: config.secrets.LULU_CLIENT_KEY,
                  clientSecret: config.secrets.LULU_CLIENT_SECRET,
                  environment: config.variables.luluEnvironment,
                }
                : undefined,
            manual: {
              notificationEmails: [],
              fromEmail: config.secrets.MANUAL_FULFILLMENT_FROM_EMAIL,
            },
          },
          {
            stripe:
              config.secrets.STRIPE_SECRET_KEY &&
              config.secrets.STRIPE_WEBHOOK_SECRET
                ? {
                    secretKey: config.secrets.STRIPE_SECRET_KEY,
                    webhookSecret: config.secrets.STRIPE_WEBHOOK_SECRET,
                  }
                : undefined,
            ping: {
              apiKey: config.secrets.PING_API_KEY,
              webhookSecret: config.secrets.PING_WEBHOOK_SECRET,
            },
          },
          {
            nodeUrl: nearNodeUrl,
          },
          config.variables.storageProvider && config.secrets.ACCESS_KEY_ID && config.secrets.SECRET_ACCESS_KEY && config.variables.storageBucket
            ? {
                provider: config.variables.storageProvider as 'r2' | 's3',
                accessKeyId: config.secrets.ACCESS_KEY_ID,
                secretAccessKey: config.secrets.SECRET_ACCESS_KEY,
                bucket: config.variables.storageBucket,
                endpoint: config.variables.storageEndpoint,
                publicUrl: config.variables.storagePublicUrl,
                region: config.variables.storageRegion,
              }
            : undefined,
          {
            hostUrl: config.variables.hostUrl,
          },
        ),
      );

      const dbLayer = DatabaseLive(config.secrets.API_DATABASE_URL);

      const emailServiceLayer = EmailServiceLive({
        fromEmail: config.secrets.MANUAL_FULFILLMENT_FROM_EMAIL || 'orders@nearmerch.com',
        resendApiKey: config.secrets.RESEND_API_KEY,
      });

      const storesLayer = Layer.provideMerge(
        Layer.mergeAll(
          ProductStoreLive,
          CollectionStoreLive,
          OrderStoreLive,
          ProviderConfigStoreLive,
          ProviderTestStateStoreLive,
          ProductTypeStoreLive,
          NewsletterStoreLive,
          AssetStoreLive,
          MerchBoxStoreLive,
        ),
        dbLayer,
      );

      const merchBoxServiceLayer = MerchBoxServiceLive;

      const servicesLayer = Layer.provideMerge(
        Layer.mergeAll(
          ProductServiceLive(runtime),
          CheckoutServiceLive(runtime),
          NewsletterServiceLive,
          AssetServiceLive,
          ProductBuilderServiceLive(runtime),
          emailServiceLayer,
          merchBoxServiceLayer,
        ),
        storesLayer,
      );

      const combinedLayer = Layer.mergeAll(storesLayer, servicesLayer);

      const managedRuntime = ManagedRuntime.make(combinedLayer);

      // Cache for NEAR price
      const nearPriceCache: { price: number | null; cachedAt: number } = {
        price: null,
        cachedAt: 0,
      };

      console.log("[Marketplace] Plugin initialized");
      console.log(
        `[Marketplace] Providers: ${runtime.providers.map((p) => p.name).join(", ") || "none"}`,
      );
      console.log(
        `[Marketplace] Stripe: ${stripeService ? "configured" : "not configured"}`,
      );

      return {
        stripeService,
        runtime,
        managedRuntime,
        secrets: config.secrets,
        nearPriceCache,
        luluEnvironment: config.variables.luluEnvironment,
      };
    }),

  shutdown: (context) =>
    Effect.tryPromise({
      try: async () => {
        await context.runtime.shutdown();
        await context.managedRuntime.dispose();
      },
      catch: (e) =>
        new Error(
          `Shutdown failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
    }),

  createRouter: (context, builder) => {
    const { stripeService, runtime, managedRuntime, secrets, nearPriceCache, luluEnvironment } = context;

    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.nearAccountId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "nearAccountId" },
        });
      }
      return next({
        context: {
          nearAccountId: context.nearAccountId,
        },
      });
    });

    const requireAdmin = builder.middleware(async ({ context, next }) => {
      if (!context.nearAccountId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "nearAccountId" },
        });
      }

      if (context.user?.role !== "admin") {
        throw new ORPCError("FORBIDDEN", {
          message: "Admin access required",
          data: { requiredRole: "admin" },
        });
      }

      return next({
        context: {
          nearAccountId: context.nearAccountId,
          user: context.user,
        },
      });
    });

    const getPurchaseGatePluginId = (
      metadata: ProductMetadata | undefined,
    ): string | undefined => metadata?.purchaseGate?.pluginId;

    const checkPurchaseGateAccess = async (
      pluginId: string,
      nearAccountId: string,
    ): Promise<boolean> => {
      const provider = runtime.getExclusiveCheckProvider(pluginId);

      if (!provider) {
        console.error(`[checkPurchaseGateAccess] Provider not found: ${pluginId}`);
        return false;
      }

      try {
        const result = await provider.client.checkAccess({
          nearAccountId,
          config: {},
        });
        return result.hasAccess;
      } catch (error) {
        console.error(`[checkPurchaseGateAccess] Provider check failed for ${pluginId}:`, error);
        return false;
      }
    };

    return {
      ping: builder.ping.handler(async () => {
        return {
          status: "ok" as const,
          timestamp: new Date().toISOString(),
        };
      }),

      subscribeNewsletter: builder.subscribeNewsletter.handler(
        async ({ input }) => {
          const email = input.email.trim().toLowerCase();
          if (!email) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Please enter a valid email address",
            });
          }

          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* NewsletterService;
              return yield* service.subscribe(email);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return {
            success: true,
            status: exit.value.status,
          };
        },
      ),

      submitMerchBoxRequest: builder.submitMerchBoxRequest
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* MerchBoxService;
              return yield* service.submitRequest({
                nearAccountId: context.nearAccountId!,
                items: input.items,
                notes: input.notes ?? null,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("BAD_REQUEST", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      checkVanguardSbt: builder.checkVanguardSbt
        .use(requireAuth)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* MerchBoxService;
              return yield* service.checkSbt({
                nearAccountId: input.nearAccountId,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            throw new ORPCError("BAD_REQUEST", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      getMerchBoxRequests: builder.getMerchBoxRequests
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* MerchBoxService;
              return yield* service.getRequests({
                limit: input.limit,
                offset: input.offset,
                reviewed: input.reviewed,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      markMerchBoxRequestReviewed: builder.markMerchBoxRequestReviewed
        .use(requireAdmin)
        .handler(async ({ input, context }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* MerchBoxService;
              yield* service.markReviewed({
                id: input.id,
                reviewedBy: context.nearAccountId || 'admin',
              });
              return { success: true };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      getProducts: builder.getProducts.handler(async ({ input }) => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.getProducts(input);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        const value = exit.value;
        return {
          ...value,
          products: value.products.map(sanitizeProductForPublic),
        };
      }),

      getProduct: builder.getProduct.handler(async ({ input, errors, context }) => {
        const isAdmin = context?.user?.role === "admin";
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            const result = yield* service.getProduct(input.id);
            if (!result.product.listed && !isAdmin) {
              return yield* Effect.fail(
                new Error(`Product not found: ${input.id}`),
              );
            }
            return result;
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          if (
            error instanceof Error &&
            error.message.includes("Product not found")
          ) {
            throw errors.NOT_FOUND({
              message: "This product is no longer available.",
              data: { resource: "product", resourceId: input.id },
            });
          }
          throw error;
        }

        return { product: sanitizeProductForPublic(exit.value.product) };
      }),

      getAdminProduct: builder.getAdminProduct
        .use(requireAdmin)
        .handler(async ({ input, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.getProduct(input.id);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            if (
              error instanceof Error &&
              error.message.includes("Product not found")
            ) {
              throw errors.NOT_FOUND({
                message: error.message,
                data: { resource: "product", resourceId: input.id },
              });
            }
            throw error;
          }

          return { product: exit.value.product };
        }),

      searchProducts: builder.searchProducts.handler(async ({ input }) => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.searchProducts(input);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        const value = exit.value;
        return {
          ...value,
          products: value.products.map(sanitizeProductForPublic),
        };
      }),

      getFeaturedProducts: builder.getFeaturedProducts.handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.getFeaturedProducts(input.limit);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const value = exit.value;
          return {
            ...value,
            products: value.products.map(sanitizeProductForPublic),
          };
        },
      ),

      getCollections: builder.getCollections.handler(async () => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.getCollections();
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      getCollection: builder.getCollection.handler(
        async ({ input, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.getCollection(input.slug);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            if (
              error instanceof Error &&
              error.message.includes("Collection not found")
            ) {
              throw errors.NOT_FOUND({
                message: error.message,
                data: { resource: "collection", resourceId: input.slug },
              });
            }
            throw error;
          }

          const value = exit.value;
          return {
            ...value,
            products: value.products.map(sanitizeProductForPublic),
          };
        },
      ),

      getCarouselCollections: builder.getCarouselCollections.handler(
        async () => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.getCarouselCollections();
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),
      updateCollection: builder.updateCollection
        .use(requireAdmin)
        .handler(async ({ input }) => {
        const { slug, ...data } = input;
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.updateCollection(slug, data);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      updateCollectionFeaturedProduct:
        builder.updateCollectionFeaturedProduct
          .use(requireAdmin)
          .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.updateCollectionFeaturedProduct(
                input.slug,
                input.productId,
              );
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      getNearPrice: builder.getNearPrice.handler(async () => {
        const COINGECKO_URL =
          "https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd";
        const CACHE_TTL = 60 * 1000; // 60 seconds
        const FALLBACK_PRICE = 3.5;

        const now = Date.now();
        if (nearPriceCache.price && now - nearPriceCache.cachedAt < CACHE_TTL) {
          return {
            price: nearPriceCache.price,
            currency: "USD" as const,
            source: "coingecko",
            cachedAt: nearPriceCache.cachedAt,
          };
        }

        try {
          const response = await fetch(COINGECKO_URL);
          if (!response.ok) {
            throw new Error("Failed to fetch NEAR price");
          }
          const data = (await response.json()) as { near: { usd: number } };
          const price = data.near.usd;

          nearPriceCache.price = price;
          nearPriceCache.cachedAt = now;

          return {
            price,
            currency: "USD" as const,
            source: "coingecko",
            cachedAt: now,
          };
        } catch (error) {
          console.error(
            "[getNearPrice] Failed to fetch from CoinGecko:",
            error,
          );
          return {
            price: nearPriceCache.price || FALLBACK_PRICE,
            currency: "USD" as const,
            source: nearPriceCache.price ? "coingecko" : "fallback",
            cachedAt: nearPriceCache.cachedAt || now,
          };
        }
      }),

      updateProductListing: builder.updateProductListing
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.updateProductListing(
                input.id,
                input.listed,
              );
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),
      createCheckout: builder.createCheckout
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const gatedPluginsExit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const productStore = yield* ProductStore;
              const pluginIds = new Set<string>();

              for (const item of input.items) {
                const product = yield* productStore.find(item.productId);

                if (!product) {
                  throw new ORPCError("NOT_FOUND", {
                    message: `Product not found: ${item.productId}`,
                    data: { resource: "product", resourceId: item.productId },
                  });
                }

                const pluginId = getPurchaseGatePluginId(product.metadata);
                if (pluginId) {
                  pluginIds.add(pluginId);
                }
              }

              return Array.from(pluginIds);
            }),
          );

          if (Exit.isFailure(gatedPluginsExit)) {
            const error = Cause.squash(gatedPluginsExit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          for (const pluginId of gatedPluginsExit.value) {
            const hasAccess = await checkPurchaseGateAccess(
              pluginId,
              context.nearAccountId,
            );

            if (!hasAccess) {
              throw new ORPCError("FORBIDDEN", {
                message: "Your account does not have access to purchase one or more gated items",
                data: { pluginId },
              });
            }
          }

          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* CheckoutService;
              return yield* service.createCheckout({
                userId: context.nearAccountId,
                items: input.items,
                address: input.shippingAddress,
                selectedRates: input.selectedRates,
                shippingCost: input.shippingCost,
                successUrl: input.successUrl,
                cancelUrl: input.cancelUrl,
                paymentProvider: input.paymentProvider,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }

            // Don't leak provider/internal details to the UI.
            if (error instanceof CheckoutError) {
              if (
                error.code === "INVALID_ADDRESS" ||
                error.code === "VARIANT_UNAVAILABLE"
              ) {
                throw new ORPCError("BAD_REQUEST", {
                  message:
                    error.cause instanceof Error
                      ? error.cause.message
                      : error.message,
                });
              }

              if (error.code === "QUOTE_FAILED") {
                throw new ORPCError("BAD_REQUEST", {
                  message:
                    error.cause instanceof Error
                      ? error.cause.message
                      : "Shipping is not available to this destination",
                });
              }

              console.error("[createCheckout] Checkout failed:", error.message);
              if (error.cause)
                console.error("[createCheckout] Cause:", error.cause);

              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message:
                  "Order Failed, please contact support (orders@nearmerch.com)",
              });
            }

            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const result = exit.value;
          return {
            checkoutSessionId: result.checkoutSessionId,
            checkoutUrl: result.checkoutUrl,
            orderId: result.orderId,
          };
        }),

      quote: builder.quote.handler(async ({ input }) => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* CheckoutService;
            return yield* service.getQuote(input.items, input.shippingAddress);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          // Extract user-friendly message from CheckoutError cause
          let message = "Failed to calculate shipping";
          if (error instanceof CheckoutError && error.cause instanceof Error) {
            message = error.cause.message;
          } else if (error instanceof Error) {
            message = error.message;
          }
          throw new ORPCError("BAD_REQUEST", {
            message,
          });
        }

        return exit.value;
      }),

      getOrders: builder.getOrders
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              return yield* store.findByUser(context.nearAccountId!, input);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const result = exit.value;
          return {
            orders: result.orders,
            total: result.total,
          };
        }),

      getOrder: builder.getOrder
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              return yield* store.find(input.id);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw errors.NOT_FOUND({
              message: "Order not found",
              data: { resource: "order", resourceId: input.id },
            });
          }

          const order = exit.value;

          if (!order) {
            throw errors.NOT_FOUND({
              message: "Order not found",
              data: { resource: "order", resourceId: input.id },
            });
          }

          if (order.userId !== context.nearAccountId) {
            throw errors.FORBIDDEN({
              message: "You do not have permission to access this order",
              data: { action: "read" },
            });
          }

          return { order };
        }),

      getOrderByCheckoutSession: builder.getOrderByCheckoutSession
        .use(requireAuth)
        .handler(
        async ({ input, context, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              return yield* store.findByCheckoutSession(input.sessionId);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const order = exit.value;

          if (order && order.userId !== context.nearAccountId) {
            throw errors.FORBIDDEN({
              message: "You do not have permission to access this order",
              data: { action: "read" },
            });
          }

          return { order };
        },
      ),

      subscribeOrderStatus: builder.subscribeOrderStatus
        .use(requireAuth)
        .handler(
        async function* ({ input, signal, context, errors }) {
          const TERMINAL_STATUSES = [
            "shipped",
            "delivered",
            "cancelled",
            "failed",
            "returned",
            "refunded",
            "on_hold",
            "partially_cancelled",
          ];
          const POLL_INTERVAL = 500;

          let lastStatus: string | undefined;
          let lastTrackingJson: string | undefined;

          while (!signal?.aborted) {
            const order = await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* OrderStore;
                return yield* store.findByCheckoutSession(input.sessionId);
              }),
            );

            if (!order) {
              await new Promise((r) => setTimeout(r, POLL_INTERVAL));
              continue;
            }

            if (order.userId !== context.nearAccountId) {
              throw errors.FORBIDDEN({
                message: "You do not have permission to access this order",
                data: { action: "read" },
              });
            }

            const currentTrackingJson = JSON.stringify(
              order.trackingInfo || [],
            );
            const hasStatusChange = order.status !== lastStatus;
            const hasTrackingChange = currentTrackingJson !== lastTrackingJson;

            if (hasStatusChange || hasTrackingChange) {
              lastStatus = order.status;
              lastTrackingJson = currentTrackingJson;

              yield {
                status: order.status,
                trackingInfo: order.trackingInfo,
                updatedAt: order.updatedAt,
              };

              if (TERMINAL_STATUSES.includes(order.status)) {
                return;
              }
            }

            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          }
        },
      ),

      getAllOrders: builder.getAllOrders
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              return yield* store.findAll({
                limit: input.limit,
                offset: input.offset,
                status: input.status,
                search: input.search,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const result = exit.value;
          return {
            orders: result.orders,
            total: result.total,
          };
        }),

      getOrderAuditLog: builder.getOrderAuditLog
        .use(requireAuth)
        .handler(async ({ input, context, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;

              // First verify the order exists
              const order = yield* store.find(input.id);
              if (!order) {
                return null;
              }

              // Check authorization - must be admin or order owner
              const isAdmin = context.user?.role === "admin";
              const isOwner = order.userId === context.nearAccountId;

              if (!isAdmin && !isOwner) {
                return { forbidden: true };
              }

              const logs = yield* store.getAuditLog(input.id);
              return { logs, isAdmin };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const result = exit.value;

          if (result === null) {
            throw errors.NOT_FOUND({
              message: "Order not found",
              data: { resource: "order", resourceId: input.id },
            });
          }

          if ("forbidden" in result && result.forbidden) {
            throw errors.FORBIDDEN({
              message:
                "You do not have permission to access this order's audit log",
              data: { action: "read_audit_log" },
            });
          }

          // Filter logs for non-admin users - only show status_change and tracking_update
          const logs = result.logs || [];
          const filteredLogs = result.isAdmin
            ? logs
            : logs.filter(
                (log) =>
                  log.action === "status_change" ||
                  log.action === "tracking_update",
              );

          return { logs: filteredLogs };
        }),

      updateOrderStatus: builder.updateOrderStatus
        .use(requireAdmin)
        .handler(async ({ input, context }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* OrderStore;

              // Check if order exists and is not deleted
              const order = yield* store.find(input.orderId);
              if (!order) {
                return { notFound: true };
              }

              // Update status with admin actor
              const adminActor = `admin:${context.nearAccountId || "unknown"}`;
              const updatedOrder = yield* store.updateStatus(
                input.orderId,
                input.status,
                adminActor,
                input.reason,
                { adminEdited: true },
              );

              return { order: updatedOrder };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          const result = exit.value;

          if ("notFound" in result && result.notFound) {
            throw new ORPCError("NOT_FOUND", {
              message: "Order not found",
              data: { resource: "order", resourceId: input.orderId },
            });
          }

          if (!result.order) {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: "Failed to update order status",
            });
          }

          return {
            success: true,
            order: result.order,
          };
        }),

      deleteOrders: builder.deleteOrders
        .use(requireAdmin)
        .handler(async ({ input, context }) => {
          // Only unpaid/abandoned drafts should cancel provider fulfillment on delete.
          // Paid/processing/shipped IDs are live production orders (see order-paid confirmOrder).
          const providerCancellableOnDelete = new Set([
            "draft_created",
            "pending",
            "payment_pending",
            "expired",
          ]);
          const actor = `admin:${context.nearAccountId || "unknown"}`;
          const errors: { orderId: string; error: string }[] = [];
          let deleted = 0;

          for (const orderId of input.orderIds) {
            try {
              const order = await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* OrderStore;
                  return yield* store.find(orderId);
                }),
              );

              if (!order) {
                errors.push({ orderId, error: "Order not found" });
                continue;
              }

              const shouldCancelProviderOrders = providerCancellableOnDelete.has(
                order.status,
              );

              if (
                shouldCancelProviderOrders &&
                order.draftOrderIds &&
                Object.keys(order.draftOrderIds).length > 0
              ) {
                let cancelFailed = false;

                for (const [providerName, externalId] of Object.entries(
                  order.draftOrderIds,
                )) {
                  if (providerName === "manual") continue;

                  const provider = runtime.getProvider(providerName);
                  if (!provider) {
                    const message = `Provider ${providerName} not found`;
                    console.warn(
                      `[deleteOrders] ${message} for order ${orderId}`,
                    );
                    errors.push({ orderId, error: message });
                    cancelFailed = true;
                    continue;
                  }

                  try {
                    await provider.client.cancelOrder({
                      id: externalId as string,
                    });
                    console.log(
                      `[deleteOrders] Cancelled ${providerName} order ${externalId} for order ${orderId}`,
                    );
                  } catch (err) {
                    const message =
                      err instanceof Error ? err.message : String(err);

                    // Already gone at the provider = cleanup goal met (idempotent).
                    if (isProviderOrderAlreadyGone(message)) {
                      console.log(
                        `[deleteOrders] ${providerName} order ${externalId} already gone for order ${orderId}; treating cancel as success`,
                      );
                      continue;
                    }

                    console.warn(
                      `[deleteOrders] Failed to cancel ${providerName} order ${externalId}:`,
                      message,
                    );
                    errors.push({
                      orderId,
                      error: `Failed to cancel ${providerName} order ${externalId}: ${message}`,
                    });
                    cancelFailed = true;
                  }
                }

                // Do not delete abandoned drafts if provider cancel did not succeed.
                if (cancelFailed) {
                  continue;
                }
              }

              const deleteResult = await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* OrderStore;
                  return yield* store.deleteOrders([orderId], actor);
                }),
              );

              if (deleteResult.deleted > 0) {
                deleted++;
              } else {
                errors.push(...deleteResult.errors);
              }
            } catch (err) {
              errors.push({
                orderId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          return {
            success: true,
            deleted,
            errors,
          };
        }),

      stripeWebhook: builder.stripeWebhook.handler(async ({ input }) => {
        if (!stripeService) {
          throw new Error("Stripe is not configured");
        }

        const event = await managedRuntime.runPromise(
          stripeService.verifyWebhookSignature(input.body, input.signature),
        );

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const orderId = session.metadata?.orderId;

          if (!orderId) {
            return { received: true };
          }

          const order = await managedRuntime.runPromise(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              return yield* store.find(orderId);
            }),
          );

          if (!order) {
            return { received: true };
          }

          if (order.status !== "draft_created" && order.status !== "pending") {
            return { received: true };
          }

          try {
            const paidResult = await managedRuntime.runPromise(
              processPaymentSuccessEffect({
                runtime,
                order,
                actor: 'service:stripe',
                metadata: { sessionId: session.id, eventType: 'checkout.session.completed' },
              }),
            );
          } catch (error) {
            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* OrderStore;
                yield* store.updateStatus(
                  orderId,
                  "paid_pending_fulfillment",
                  "service:stripe",
                  "fulfillment:failed",
                  {
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                );
              }),
            );
          }
        }

        return { received: true };
      }),

      printfulWebhook: builder.printfulWebhook.handler(
        async ({ input, context }) => {
          const signature =
            context.reqHeaders?.get("x-pf-webhook-signature") || "";
          const rawBody = await readWebhookBody({ input, getRawBody: context.getRawBody });

          try {
            // Secret source of truth: DB (configured via admin UI). Env is a fallback.
            const webhookSecret = await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* ProviderConfigStore;
                return (
                  (yield* store.getSecretKey("printful")) ||
                  secrets.PRINTFUL_WEBHOOK_SECRET
                );
              }),
            );

            if (webhookSecret) {
              verifyPrintfulWebhookSignature({
                rawBody,
                signature,
                webhookSecretHex: webhookSecret,
              });
            }

            const { eventType, externalId, catalogProductId, data } =
              parsePrintfulWebhook(rawBody);

            if (eventType === 'catalog_price_changed' && catalogProductId) {
              console.log(
                `[Printful Webhook] Catalog price changed for product: ${catalogProductId}`,
              );
              try {
                const { PrintfulService: PFSvc } = await import('./services/fulfillment/printful/service');
                const pfService = new PFSvc(
                  secrets.PRINTFUL_API_KEY!,
                  secrets.PRINTFUL_STORE_ID!,
                );
                const productStore = await managedRuntime.runPromise(
                  Effect.gen(function* () {
                    return yield* ProductStore;
                  }),
                );
                await pfService.handleCatalogPriceChange(String(catalogProductId), productStore);
              } catch (error) {
                console.warn(
                  `[Printful Webhook] Failed to handle catalog_price_changed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              return { received: true };
            }

            if (!externalId) {
              return { received: true };
            }

            console.log(
              `[Printful Webhook] Processing event: ${eventType}, external_id: ${externalId}`,
            );

            const order = await managedRuntime.runPromise(
              findOrderByFulfillmentRefEffect(externalId),
            );

            if (!order) {
              return { received: true };
            }

            await managedRuntime.runPromise(
              processPrintfulWebhookEffect({
                runtime,
                order,
                eventType,
                data,
                actor: 'service:printful',
                metadata: { eventType, externalId, data },
              }),
            );
          } catch (error) {
            if (error instanceof ORPCError) {
              console.error(`[Printful Webhook] ORPC error:`, error);
              throw error;
            }

            // Log other errors but don't throw - return 200 to avoid webhook retries
            logWebhookProcessingError({ provider: 'Printful', error });
          }

          return { received: true };
        },
      ),

      luluWebhook: builder.luluWebhook.handler(async ({ input, context }) => {
        const signature = context.reqHeaders?.get('Lulu-HMAC-SHA256') || '';
        const rawBody = await readWebhookBody({ input, getRawBody: context.getRawBody });
        
        let eventType: string | undefined;
        let externalId: string | undefined;
        
        try {
          const luluProvider = runtime.getProvider('lulu');
          if (!luluProvider) {
            console.error('[Lulu Webhook] Lulu provider not configured');
            return { received: true };
          }

          // Import LuluService for webhook handling
          const { LuluService } = await import('./services/fulfillment/lulu/service');
          const luluService = new LuluService({
            clientKey: secrets.LULU_CLIENT_KEY || '',
            clientSecret: secrets.LULU_CLIENT_SECRET || '',
            environment: luluEnvironment,
          });

          const isValid = await managedRuntime.runPromise(
            luluService.verifyWebhookSignature(rawBody, signature)
          );
          if (!isValid) {
            console.error('[Lulu Webhook] Invalid signature');
            throw new ORPCError('UNAUTHORIZED', { message: 'Invalid webhook signature' });
          }

          const { eventType: parsedEventType, data } = luluService.parseWebhookPayload(rawBody);
          eventType = parsedEventType;
          externalId = data.external_id;

          if (!externalId) {
            return { received: true };
          }

          console.log(`[Lulu Webhook] Processing event: ${eventType}, external_id: ${externalId}`);

          // Find the order by fulfillment reference
          const order = await managedRuntime.runPromise(
            findOrderByFulfillmentRefEffect(externalId!)
          );

          if (!order) {
            return { received: true };
          }

          await managedRuntime.runPromise(
            processLuluWebhookEffect({
              order,
              eventType,
              data,
              actor: 'service:lulu',
              luluService,
              metadata: { eventType, externalId, data },
            })
          );
        } catch (error) {
          if (error instanceof ORPCError) {
            throw error;
          }

          // Log error but return 200 to prevent webhook retries
          logWebhookProcessingError({ provider: 'Lulu', error, details: { eventType, externalId } });
        }

        return { received: true };
      }),

      manualWebhook: builder.manualWebhook.handler(async ({ input, context }) => {
        const isAdmin = Boolean(
          context.nearAccountId && context.user?.role === 'admin',
        );

        if (!isAdmin) {
          const signature = context.reqHeaders?.get('x-manual-signature') ?? '';
          const body = await readWebhookBody({
            input,
            getRawBody: context.getRawBody,
          });

          if (
            !verifyManualWebhookSignature(
              body,
              signature,
              secrets.MANUAL_WEBHOOK_SECRET,
            )
          ) {
            throw new ORPCError('UNAUTHORIZED', {
              message: 'Invalid or missing manual webhook authorization',
            });
          }
        }

        const parsed = ManualWebhookPayloadSchema.parse(input);

        const order = await managedRuntime.runPromise(
          Effect.gen(function* () {
            const store = yield* OrderStore;
            if (parsed.orderId) {
              const byId = yield* store.find(parsed.orderId);
              if (byId) {
                return byId;
              }
            }

            if (parsed.externalId) {
              const byRef = yield* store.findByFulfillmentRef(parsed.externalId);
              if (byRef) {
                return byRef;
              }
            }

            return null;
          }),
        );

        if (!order) {
          return { received: true };
        }

        try {
          await managedRuntime.runPromise(
            processManualWebhookEffect({
              order,
              actor: 'service:manual',
              status: parsed.status,
              trackingInfo: parsed.trackingInfo,
              metadata: { eventType: 'ORDER_STATUS_CHANGED', ...(parsed.metadata ?? {}) },
            }),
          );
        } catch (error) {
          logWebhookProcessingError({ provider: 'Manual', error, details: { orderId: order.id } });
        }

        return { received: true };
      }),

      pingWebhook: builder.pingWebhook.handler(async ({ input, context }) => {
        console.log("[PingPay Webhook] Starting to process webhook");
        const pingProvider = runtime.getPaymentProvider("pingpay");
        if (!pingProvider) {
          console.error("[PingPay Webhook] PingPay provider not configured");
          throw new Error("PingPay provider not configured");
        }

        const signature = context.reqHeaders?.get("x-ping-signature") || "";
        const timestamp = context.reqHeaders?.get("x-ping-timestamp") || "";
        const body = await readWebhookBody({ input, getRawBody: context.getRawBody });

        try {
          await managedRuntime.runPromise(
            verifyPingPayWebhookSignature(body, timestamp, signature, secrets.PING_WEBHOOK_SECRET),
          );
        } catch (error) {
          if (error instanceof ORPCError) {
            throw error;
          }

          throw new ORPCError('UNAUTHORIZED', {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        try {
          await managedRuntime.runPromise(
            handlePingPayWebhookEffect({
              runtime,
              pingProvider,
              signature,
              timestamp,
              body,
            }),
          );

          console.log("[PingPay Webhook] Webhook processed successfully");
          return { received: true };
        } catch (error) {
          if (error instanceof ORPCError) {
            throw error;
          }

          logWebhookProcessingError({ provider: 'PingPay', error, details: { signature: signature.substring(0, 20) + "...", timestamp } });
          return { received: true };
        }
      }),

      cleanupAbandonedDrafts: builder.cleanupAbandonedDrafts.handler(
        async ({ input, context }) => {
          const cronSecret = context.reqHeaders?.get("x-cron-secret");
          const expectedSecret = process.env.CRON_SECRET;

          if (!expectedSecret || cronSecret !== expectedSecret) {
            throw new ORPCError("UNAUTHORIZED", {
              message: "Invalid or missing cron secret",
            });
          }

          const maxAgeHours = input?.maxAgeHours || 24;
          const exit = await managedRuntime.runPromiseExit(
            cleanupAbandonedDrafts(runtime, maxAgeHours),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      retryPendingConfirmations: builder.retryPendingConfirmations.handler(
        async ({ input, context }) => {
          const cronSecret = context.reqHeaders?.get("x-cron-secret");
          const expectedSecret = process.env.CRON_SECRET;

          if (!expectedSecret || cronSecret !== expectedSecret) {
            throw new ORPCError("UNAUTHORIZED", {
              message: "Invalid or missing cron secret",
            });
          }

          const olderThanMinutes = input?.olderThanMinutes || 5;
          const exit = await managedRuntime.runPromiseExit(
            retryPendingConfirmations(runtime, olderThanMinutes),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      getProviderConfig: builder.getProviderConfig
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* ProviderConfigStore;
              return yield* store.getConfig(input.provider);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return { config: exit.value };
        }),

      configureWebhook: builder.configureWebhook
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const webhookUrl = input.webhookUrlOverride || '';

          let result: ConfigureWebhookOutput;
          let providerSecretKey: string | null = null;
          try {
            if (input.provider === 'printful') {
              const printfulProvider = runtime.getProvider('printful');
              if (!printfulProvider) {
                throw new ORPCError('BAD_REQUEST', { message: 'Printful provider not configured' });
              }

              const { PrintfulService } = await import('./services/fulfillment/printful/service');
              const printfulService = new PrintfulService(
                secrets.PRINTFUL_API_KEY!,
                secrets.PRINTFUL_STORE_ID!
              );

              const printfulResult = await managedRuntime.runPromise(
                printfulService.configureWebhooks({
                  defaultUrl: webhookUrl,
                  events: (input.events ?? []).filter((event): event is PrintfulWebhookEventType => event !== 'PRINT_JOB_STATUS_CHANGED'),
                  expiresAt: input.expiresAt,
                })
              );
              result = {
                success: true,
                webhookUrl: printfulResult.webhookUrl,
                enabledEvents: printfulResult.enabledEvents as ProviderWebhookEventType[],
                publicKey: printfulResult.publicKey,
                expiresAt: printfulResult.expiresAt,
              };
              providerSecretKey = printfulResult.secretKey;
            } else if (input.provider === 'lulu') {
              const luluProvider = runtime.getProvider('lulu');
              if (!luluProvider) {
                throw new ORPCError('BAD_REQUEST', { message: 'Lulu provider not configured' });
              }

              if (!secrets.LULU_CLIENT_KEY || !secrets.LULU_CLIENT_SECRET) {
                throw new ORPCError('BAD_REQUEST', { message: 'Lulu credentials are not configured' });
              }

              const { LuluService } = await import('./services/fulfillment/lulu/service');
              const luluService = new LuluService({
                clientKey: secrets.LULU_CLIENT_KEY,
                clientSecret: secrets.LULU_CLIENT_SECRET,
                environment: luluEnvironment,
              });

              const luluResult = await managedRuntime.runPromise(
                luluService.configureWebhook(webhookUrl)
              );
              result = {
                success: true,
                webhookUrl: luluResult.webhookUrl,
                enabledEvents: ['PRINT_JOB_STATUS_CHANGED'],
                publicKey: luluResult.publicKey,
                expiresAt: luluResult.expiresAt,
              };
            } else if (input.provider === 'manual') {
              result = {
                success: true,
                webhookUrl: '',
                enabledEvents: [],
                publicKey: null,
                expiresAt: null,
                settings: input.settings,
              };
            } else {
              throw new ORPCError('BAD_REQUEST', { message: `Unknown provider: ${input.provider}` });
            }
          } catch (error) {
            console.error(`[configureWebhook] Failed to configure ${input.provider} webhooks:`, error);
            if (error instanceof ORPCError) throw error;
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : 'Failed to configure webhook',
            });
          }

          try {
            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* ProviderConfigStore;
                yield* store.upsertConfig({
                  provider: input.provider,
                  enabled: true,
                  webhookUrl: result.webhookUrl,
                  webhookUrlOverride: webhookUrl,
                  enabledEvents: result.enabledEvents,
                  publicKey: result.publicKey,
                  secretKey: providerSecretKey,
                  settings: result.settings ?? undefined,
                  lastConfiguredAt: Date.now(),
                  expiresAt: result.expiresAt,
                });
              }),
            );
          } catch (error) {
            console.error(
              "[configureWebhook] Failed to save webhook config:",
              error,
            );
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to save webhook configuration",
            });
          }

          return {
            success: true,
            webhookUrl: result.webhookUrl,
            enabledEvents: result.enabledEvents,
            publicKey: result.publicKey,
            expiresAt: result.expiresAt,
          };
        }),

      disableWebhook: builder.disableWebhook
        .use(requireAdmin)
        .handler(async ({ input }) => {
          try {
            if (input.provider === 'printful') {
              const printfulProvider = runtime.getProvider('printful');
              if (!printfulProvider) {
                throw new ORPCError('BAD_REQUEST', { message: 'Printful provider not configured' });
              }

              const { PrintfulService } = await import('./services/fulfillment/printful/service');
              const printfulService = new PrintfulService(
                secrets.PRINTFUL_API_KEY!,
                secrets.PRINTFUL_STORE_ID!
              );

              await managedRuntime.runPromise(printfulService.disableWebhooks());
            } else if (input.provider === 'lulu') {
              const luluProvider = runtime.getProvider('lulu');
              if (!luluProvider || !secrets.LULU_CLIENT_KEY || !secrets.LULU_CLIENT_SECRET) {
                throw new ORPCError('BAD_REQUEST', { message: 'Lulu provider not configured' });
              }

              const existingConfig = await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* ProviderConfigStore;
                  return yield* store.getConfig('lulu');
                })
              );

              const { LuluService } = await import('./services/fulfillment/lulu/service');
              const luluService = new LuluService({
                clientKey: secrets.LULU_CLIENT_KEY,
                clientSecret: secrets.LULU_CLIENT_SECRET,
                environment: luluEnvironment,
              });

              await managedRuntime.runPromise(luluService.disableWebhooks(existingConfig?.webhookUrl));
            } else if (input.provider === 'manual') {
              // Manual provider has no webhook to disable — no-op
            } else {
              throw new ORPCError('BAD_REQUEST', { message: `Unknown provider: ${input.provider}` });
            }
          } catch (error) {
            console.error(`[disableWebhook] Failed to disable ${input.provider} webhooks:`, error);
            if (error instanceof ORPCError) throw error;
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : 'Failed to disable webhook',
            });
          }

          try {
            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* ProviderConfigStore;
                yield* store.clearWebhookConfig(input.provider);
              }),
            );
          } catch (error) {
            console.error(
              "[disableWebhook] Failed to clear webhook config:",
              error,
            );
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to clear webhook configuration",
            });
          }

          return { success: true };
        }),

      testProvider: builder.testProvider
        .use(requireAdmin)
        .handler(async ({ input }) => {
          try {
            let result: { provider: string; status: string; timestamp: string };
            if (input.provider === 'printful') {
              const printfulProvider = runtime.getProvider('printful');
              if (!printfulProvider) {
                throw new ORPCError('BAD_REQUEST', { message: 'Printful provider not configured' });
              }

              const { PrintfulService } = await import('./services/fulfillment/printful/service');
              const printfulService = new PrintfulService(
                secrets.PRINTFUL_API_KEY!,
                secrets.PRINTFUL_STORE_ID!
              );
              result = await managedRuntime.runPromise(printfulService.ping());
            } else if (input.provider === 'lulu') {
              if (!runtime.getProvider('lulu') || !secrets.LULU_CLIENT_KEY || !secrets.LULU_CLIENT_SECRET) {
                throw new ORPCError('BAD_REQUEST', { message: 'Lulu provider not configured' });
              }

              const { LuluService } = await import('./services/fulfillment/lulu/service');
              const luluService = new LuluService({
                clientKey: secrets.LULU_CLIENT_KEY,
                clientSecret: secrets.LULU_CLIENT_SECRET,
                environment: luluEnvironment,
              });
              result = await managedRuntime.runPromise(luluService.ping());
} else if (input.provider === 'manual') {
               const manualProvider = runtime.getProvider('manual');
               if (!manualProvider) {
                 throw new ORPCError('BAD_REQUEST', { message: 'Manual provider not configured' });
               }
               result = await manualProvider.client.ping();
            } else {
              throw new ORPCError('BAD_REQUEST', { message: `Unknown provider: ${input.provider}` });
            }

            return {
              success: true,
              timestamp: result.timestamp,
              message: `${result.provider}: ${result.status}`,
            };
          } catch (error) {
            return {
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Connection test failed",
              timestamp: new Date().toISOString(),
            };
          }
        }),

      getProviderTestState: builder.getProviderTestState
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* ProviderTestStateStore;
              return yield* store.getState(input.provider);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return { state: exit.value };
        }),

      saveProviderTestScenario: builder.saveProviderTestScenario
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              return yield* saveProviderTestScenarioEffect({
                provider: input.provider,
                scenario: input.scenario,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return { state: exit.value };
        }),

      runProviderTestStep: builder.runProviderTestStep
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              return yield* runProviderTestStepEffect({
                runtime,
                provider: input.provider,
                step: input.step,
              });
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      getProviderFieldConfigs: builder.getProviderFieldConfigs
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const { PRINTFUL_PROVIDER_FIELDS } = await import('./services/fulfillment/printful');
          const { LULU_PROVIDER_FIELDS } = await import('./services/fulfillment/lulu');
          const { MANUAL_PROVIDER_FIELDS } = await import('./services/fulfillment/manual');

          const allConfigs = {
            printful: PRINTFUL_PROVIDER_FIELDS,
            lulu: LULU_PROVIDER_FIELDS,
            manual: MANUAL_PROVIDER_FIELDS,
          };

          if (input.provider) {
            return { [input.provider]: allConfigs[input.provider as keyof typeof allConfigs] };
          }

          return allConfigs;
        }),

      syncProducts: builder.syncProducts
        .use(requireAdmin)
        .handler(
          async function* ({ input, signal }) {
            const provider = runtime.getProvider(input.provider);
            if (!provider) {
              throw new ORPCError('BAD_REQUEST', {
                message: `Provider ${input.provider} not configured`,
              });
            }

            if (!provider.service) {
              throw new ORPCError('BAD_REQUEST', {
                message: `Provider ${input.provider} does not support sync`,
              });
            }

            const upsertProduct = async (product: any, syncedAt?: Date) => {
              return await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* ProductStore;
                  return yield* store.upsert(product, syncedAt);
                })
              );
            };

            const syncGenerator = provider.service.syncProducts(upsertProduct, signal);

            for await (const event of syncGenerator) {
              yield event;
            }
          },
        ),

      getCategories: builder.getCategories.handler(async () => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.getCategories();
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      createCategory: builder.createCategory
        .use(requireAdmin)
        .handler(async ({ input }) => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.createCategory(input);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      deleteCategory: builder.deleteCategory
        .use(requireAdmin)
        .handler(async ({ input }) => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const service = yield* ProductService;
            return yield* service.deleteCategory(input.id);
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      updateProductCategories: builder.updateProductCategories
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.updateProductCollections(
                input.id,
                input.categoryIds,
              );
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProductTags: builder.updateProductTags
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.updateProductTags(input.id, input.tags);
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProductFeatured: builder.updateProductFeatured
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductService;
              return yield* service.updateProductFeatured(
                input.id,
                input.featured,
              );
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProductType: builder.updateProductType
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const productStore = yield* ProductStore;
              const product = yield* productStore.updateProductType(
                input.id,
                input.productTypeSlug,
              );
              if (!product) {
                return { success: false };
              }
              return { success: true, product };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProductMetadata: builder.updateProductMetadata
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const productStore = yield* ProductStore;
              const product = yield* productStore.updateMetadata(
                input.id,
                input.metadata,
              );
              if (!product) {
                return { success: false };
              }
              return { success: true, product };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProduct: builder.updateProduct
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const productStore = yield* ProductStore;
              const product = yield* productStore.updateProduct(input.id, {
                name: input.name,
                description: input.description,
                price: input.price,
                priceLocked: input.priceLocked,
                variants: input.variants,
                images: input.images,
                thumbnailImage: input.thumbnailImage,
              });
              if (!product) {
                return { success: false };
              }
              return { success: true, product };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        }),

      checkPurchaseGateAccess: builder.checkPurchaseGateAccess.handler(
        async ({ input }) => {
          const hasAccess = await checkPurchaseGateAccess(
            input.pluginId,
            input.nearAccountId,
          );

          return { hasAccess };
        },
      ),

      getProductTypes: builder.getProductTypes.handler(async () => {
        const exit = await managedRuntime.runPromiseExit(
          Effect.gen(function* () {
            const store = yield* ProductTypeStore;
            const productTypes = yield* store.findAll();
            return { productTypes };
          }),
        );

        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          if (error instanceof ORPCError) {
            throw error;
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : String(error),
          });
        }

        return exit.value;
      }),

      createProductType: builder.createProductType
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* ProductTypeStore;
              const productType = yield* store.create(input);
              return { productType };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      updateProductTypeItem: builder.updateProductTypeItem
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* ProductTypeStore;
              const productType = yield* store.update(input.slug, {
                label: input.label,
                description: input.description,
                displayOrder: input.displayOrder,
              });
              return { productType };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      deleteProductType: builder.deleteProductType
        .use(requireAdmin)
        .handler(
        async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const store = yield* ProductTypeStore;
              const success = yield* store.delete(input.slug);
              return { success };
            }),
          );

          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) {
              throw error;
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          return exit.value;
        },
      ),

      // ─── Admin: Catalog Browsing ───

      browseProviderCatalog: builder.browseProviderCatalog
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const provider = runtime.getProvider(input.provider);
          if (!provider) {
            throw new ORPCError('NOT_FOUND', {
              message: `Provider ${input.provider} not configured`,
            });
          }
          return await provider.client.browseCatalog({
            limit: input.limit,
            offset: input.offset,
          });
        }),

      getProviderCatalogProduct: builder.getProviderCatalogProduct
        .use(requireAdmin)
        .handler(async ({ input, errors }) => {
          const provider = runtime.getProvider(input.provider);
          if (!provider) {
            throw new ORPCError('NOT_FOUND', {
              message: `Provider ${input.provider} not configured`,
            });
          }
          try {
            return await provider.client.getCatalogProduct({ id: input.id });
          } catch {
            throw errors.NOT_FOUND({
              message: `Catalog product ${input.id} not found`,
              data: { resource: 'catalog_product', resourceId: input.id },
            });
          }
        }),

      getProviderCatalogVariants: builder.getProviderCatalogVariants
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const provider = runtime.getProvider(input.provider);
          if (!provider) {
            throw new ORPCError('NOT_FOUND', {
              message: `Provider ${input.provider} not configured`,
            });
          }
          return await provider.client.getCatalogProductVariants({ id: input.id });
        }),

      getProviderPlacements: builder.getProviderPlacements
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const provider = runtime.getProvider(input.provider);
          if (!provider) {
            throw new ORPCError('NOT_FOUND', {
              message: `Provider ${input.provider} not configured`,
            });
          }
          try {
            const result = await provider.client.getPlacements({ providerConfig: { catalogProductId: input.catalogProductId } });
            return { placements: result.placements };
          } catch {
            return { placements: [] };
          }
        }),

      // ─── Admin: Assets ───

      requestAssetUpload: builder.requestAssetUpload
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const storageProvider = runtime.getStorageProvider();
          if (!storageProvider) {
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: 'Storage provider not configured',
            });
          }
          return await storageProvider.client.requestUpload(input);
        }),

      confirmAssetUpload: builder.confirmAssetUpload
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* AssetService;
              const contentType = input.contentType || 'image/png';
              const assetType = contentType.startsWith('image/') ? 'image' : contentType === 'application/pdf' ? 'pdf' : 'file';
              return yield* service.create({
                id: input.assetId,
                url: input.publicUrl,
                type: assetType,
                name: input.filename,
                storageKey: input.key,
                size: input.size,
              });
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return exit.value;
        }),

      getAssetSignedUrl: builder.getAssetSignedUrl
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* AssetService;
              const asset = yield* service.get(input.id);
              if (!asset) {
                return yield* Effect.fail(new Error('Asset not found'));
              }
              if (!asset.storageKey) {
                return yield* Effect.fail(new Error('Asset has no storage key'));
              }
              const storageProvider = runtime.getStorageProvider();
              if (!storageProvider) {
                return yield* Effect.fail(new Error('Storage provider not configured'));
              }
              const storageKey = asset.storageKey;
              return yield* Effect.tryPromise(async () =>
                storageProvider.client.getSignedUrl({ key: storageKey, expiresIn: input.expiresIn ?? 3600 })
              );
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            console.error('[confirmAssetUpload] Failed:', error instanceof Error ? error.message : String(error), error instanceof Error ? error.cause : '');
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: `Failed to create asset: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
          return exit.value;
        }),

      createAsset: builder.createAsset
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* AssetService;
              return yield* service.create(input);
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return exit.value;
        }),

      listAssets: builder.listAssets
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* AssetService;
              return yield* service.list(input);
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return exit.value;
        }),

      deleteAsset: builder.deleteAsset
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* AssetService;
              yield* service.delete(input.id);
              return { success: true };
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            throw new ORPCError('INTERNAL_SERVER_ERROR', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return exit.value;
        }),

      // ─── Admin: Product Builder ───

      buildProduct: builder.buildProduct
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductBuilderService;
              return yield* service.build(input);
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) throw error;
            throw new ORPCError('BAD_REQUEST', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return exit.value;
        }),

      generateProductMockups: builder.generateProductMockups
        .use(requireAdmin)
        .handler(async ({ input, errors }) => {
          const exit = await managedRuntime.runPromiseExit(
            Effect.gen(function* () {
              const service = yield* ProductBuilderService;
              return yield* service.triggerMockups(input.id, input.styleIds);
            }),
          );
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            if (error instanceof ORPCError) throw error;
            throw errors.NOT_FOUND({
              message: error instanceof Error ? error.message : String(error),
              data: { resource: 'product', resourceId: input.id },
            });
          }
          return exit.value;
        }),
    };
  },
});
