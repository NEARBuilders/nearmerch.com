import * as crypto from 'crypto';
import { createPlugin } from 'every-plugin';
import { Effect, Layer, Schedule, Cause, Exit } from 'every-plugin/effect';
import { ManagedRuntime } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { contract } from './contract';
import { cleanupAbandonedDrafts } from './jobs/cleanup-drafts';
import { retryPendingConfirmations } from './jobs/retry-confirmations';
import { createMarketplaceRuntime } from './runtime';
import { ReturnAddressSchema, type ConfigureWebhookOutput, type OrderStatus, type PrintfulWebhookEventType, type ProductMetadata, type ProviderWebhookEventType, type TrackingInfo } from './schema';
import { CheckoutService, CheckoutServiceLive } from './services/checkout';
import { CheckoutError } from './services/checkout/errors';
import { ProductService, ProductServiceLive } from './services/products';
import { ProductBuilderService, ProductBuilderServiceLive } from './services/product-builder';
import { AssetService, AssetServiceLive } from './services/assets';
import { StripeService } from './services/stripe';
import { NewsletterService, NewsletterServiceLive } from './services/newsletter';
import { DatabaseLive, OrderStore, OrderStoreLive, ProductStore, ProductStoreLive, ProductTypeStore, ProductTypeStoreLive, CollectionStoreLive, AssetStoreLive } from './store';
import { NewsletterStoreLive } from './store/newsletter';
import { ProviderConfigStore, ProviderConfigStoreLive } from './store/providers';
import { computePrintfulUpdate, parsePrintfulWebhook, verifyPrintfulWebhookSignature } from './services/fulfillment/printful/webhook';
import { handlePingPayWebhookEffect } from './services/payment/pingpay/webhook';
export * from './schema';



export default createPlugin({
  variables: z.object({
    network: z.enum(["mainnet", "testnet"]).default("mainnet"),
    contractId: z.string().default("social.near"),
    nodeUrl: z.string().optional(),
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
    ACCESS_KEY_ID: z.string().optional(),
    SECRET_ACCESS_KEY: z.string().optional(),
    API_DATABASE_URL: z.string().default("file:./marketplace.db"),
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
        ),
      );

      const dbLayer = DatabaseLive(config.secrets.API_DATABASE_URL);

      const storesLayer = Layer.provideMerge(
        Layer.mergeAll(
          ProductStoreLive,
          CollectionStoreLive,
          OrderStoreLive,
          ProviderConfigStoreLive,
          ProductTypeStoreLive,
          NewsletterStoreLive,
          AssetStoreLive,
        ),
        dbLayer,
      );

      const servicesLayer = Layer.provideMerge(
        Layer.mergeAll(
          ProductServiceLive(runtime),
          CheckoutServiceLive(runtime),
          NewsletterServiceLive,
          AssetServiceLive,
          ProductBuilderServiceLive(runtime),
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

        return exit.value;
      }),

      getProduct: builder.getProduct.handler(async ({ input, errors }) => {
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

        return exit.value;
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

        return exit.value;
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

          return exit.value;
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

          return exit.value;
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
              if (error.code === "INVALID_ADDRESS") {
                throw new ORPCError("BAD_REQUEST", {
                  message:
                    error.cause instanceof Error
                      ? error.cause.message
                      : error.message,
                });
              }

              console.error("[createCheckout] Checkout failed:", error.message);
              if (error.cause)
                console.error("[createCheckout] Cause:", error.cause);

              throw new ORPCError("INTERNAL_SERVER_ERROR", {
                message:
                  "Order Failed, please contact support (merch@near.foundation)",
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
          throw new ORPCError("BAD_REQUEST", {
            message:
              error instanceof Error
                ? error.message
                : "Failed to calculate shipping",
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
        async ({ input }) => {
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

          return { order: exit.value };
        },
      ),

      subscribeOrderStatus: builder.subscribeOrderStatus
        .use(requireAuth)
        .handler(
        async function* ({ input, signal }) {
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

              if (order.draftOrderIds && Object.keys(order.draftOrderIds).length > 0) {
                for (const [providerName, externalId] of Object.entries(order.draftOrderIds)) {
                  if (providerName === "manual") continue;

                  const provider = runtime.getProvider(providerName);
                  if (!provider) {
                    console.warn(
                      `[deleteOrders] Provider ${providerName} not found for order ${orderId}`,
                    );
                    continue;
                  }

                  try {
                    await provider.client.cancelOrder({ id: externalId as string });
                    console.log(
                      `[deleteOrders] Cancelled ${providerName} order ${externalId} for order ${orderId}`,
                    );
                  } catch (err) {
                    console.warn(
                      `[deleteOrders] Failed to cancel ${providerName} order ${externalId}:`,
                      err instanceof Error ? err.message : String(err),
                    );
                  }
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
          const draftOrderIdsJson = session.metadata?.draftOrderIds;

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

          await managedRuntime.runPromise(
            Effect.gen(function* () {
              const store = yield* OrderStore;
              yield* store.updateStatus(
                orderId,
                "paid",
                "service:stripe",
                "checkout.session.completed",
                { sessionId: session.id },
              );
            }),
          );

          if (!draftOrderIdsJson) {
            return { received: true };
          }

          try {
            const draftOrderIds = JSON.parse(draftOrderIdsJson) as Record<
              string,
              string
            >;
            const confirmationResults: Record<
              string,
              { success: boolean; error?: string }
            > = {};

            for (const [providerName, draftId] of Object.entries(
              draftOrderIds,
            )) {
              if (providerName === "manual") {
                continue;
              }

              const provider = runtime.getProvider(providerName);
              if (!provider) {
                confirmationResults[providerName] = {
                  success: false,
                  error: "Provider not configured",
                };
                continue;
              }

              const confirmEffect = Effect.tryPromise({
                try: () => provider.client.confirmOrder({ id: draftId }),
                catch: (error) =>
                  new Error(
                    `Failed to confirm order at ${providerName}: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  ),
              }).pipe(
                Effect.retry({
                  times: 3,
                  schedule: Schedule.exponential("100 millis"),
                }),
              );

              try {
                const result = await managedRuntime.runPromise(confirmEffect);
                confirmationResults[providerName] = { success: true };
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                confirmationResults[providerName] = {
                  success: false,
                  error: errorMessage,
                };
              }
            }

            const allSuccess = Object.values(confirmationResults).every(
              (r) => r.success,
            );
            const finalStatus = allSuccess
              ? "processing"
              : "paid_pending_fulfillment";

            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* OrderStore;
                yield* store.updateStatus(
                  orderId,
                  finalStatus,
                  "service:stripe",
                  `fulfillment:${allSuccess ? "confirmed" : "partial"}`,
                  { confirmationResults, allSuccess },
                );
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
          const rawBody =
            (await context.getRawBody?.()) ?? JSON.stringify(input as unknown);

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
              Effect.gen(function* () {
                const store = yield* OrderStore;
                let order = yield* store.findByFulfillmentRef(externalId);
                if (!order) {
                  order = yield* store.find(externalId);
                }
                return order;
              }),
            );

            if (!order) {
              return { received: true };
            }

            const { newStatus, newTracking, shouldRetryConfirmation } = computePrintfulUpdate({
              eventType,
              data,
              currentStatus: order.status,
            });

            if (newStatus && order) {
              const statusToUpdate = newStatus;
              await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* OrderStore;
                  yield* store.updateStatus(
                    order.id,
                    statusToUpdate,
                    "service:printful",
                    eventType,
                    { eventType, externalId, data },
                  );
                }),
              );
            }

            if (shouldRetryConfirmation && order) {
              const draftOrderIds = order.draftOrderIds || {};
              if (Object.keys(draftOrderIds).length > 0) {
                console.log('[Printful Webhook] Retrying draft order confirmation', { orderId: order.id, draftOrderIds });
                const confirmationResults: Record<string, { success: boolean; error?: string }> = {};
                for (const [providerName, draftId] of Object.entries(draftOrderIds)) {
                  if (providerName === 'manual') continue;
                  const provider = runtime.getProvider(providerName);
                  if (!provider) {
                    confirmationResults[providerName] = { success: false, error: 'Provider not configured' };
                    continue;
                  }
                  try {
                    await managedRuntime.runPromise(
                      Effect.tryPromise({
                        try: () => provider.client.confirmOrder({ id: draftId as string }),
                        catch: (e) => new Error(`Failed to confirm: ${e instanceof Error ? e.message : String(e)}`),
                      }).pipe(Effect.retry({ times: 3, schedule: Schedule.exponential('100 millis') })),
                    );
                    confirmationResults[providerName] = { success: true };
                  } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    console.warn('[Printful Webhook] Confirmation retry failed', { providerName, draftId, error: errorMsg });
                    confirmationResults[providerName] = { success: false, error: errorMsg };
                  }
                }
                const allSuccess = Object.values(confirmationResults).every((r) => r.success);
                const finalStatus = allSuccess ? 'processing' : 'paid_pending_fulfillment';
                await managedRuntime.runPromise(
                  Effect.gen(function* () {
                    const store = yield* OrderStore;
                    yield* store.updateStatus(
                      order.id,
                      finalStatus,
                      'service:printful',
                      `fulfillment:retry_${allSuccess ? 'confirmed' : 'partial'}`,
                      { confirmationResults, allSuccess },
                    );
                  }),
                );
              }
            }

            if (newTracking && order) {
              const trackingToUpdate = newTracking;
              await managedRuntime.runPromise(
                Effect.gen(function* () {
                  const store = yield* OrderStore;
                  yield* store.updateTracking(
                    order.id,
                    trackingToUpdate,
                    "service:printful",
                    { eventType, externalId },
                  );
                }),
              );
            }
          } catch (error) {
            if (error instanceof ORPCError) {
              console.error(`[Printful Webhook] ORPC error:`, error);
              throw error;
            }

            // Log other errors but don't throw - return 200 to avoid webhook retries
            console.error(`[Printful Webhook] Processing error:`, error);
          }

          return { received: true };
        },
      ),

      luluWebhook: builder.luluWebhook.handler(async ({ input, context }) => {
        const signature = context.reqHeaders?.get('Lulu-HMAC-SHA256') || '';
        const rawBody = (await context.getRawBody?.()) ?? JSON.stringify(input as unknown);
        
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
            Effect.gen(function* () {
              const store = yield* OrderStore;
              let order = yield* store.findByFulfillmentRef(externalId!);
              if (!order) {
                order = yield* store.find(externalId!);
              }
              return order;
            })
          );

          if (!order) {
            return { received: true };
          }

          // Map Lulu status to internal status
          let newStatus: OrderStatus | undefined = undefined;
          let newTracking: TrackingInfo[] | undefined = undefined;
          let errorDetails: { code?: string; message?: string }[] | undefined = undefined;

          switch (eventType) {
            case 'PRINT_JOB_STATUS_CHANGED': {
              const luluStatus = typeof data.status === 'string' ? data.status : data.status?.name || 'CREATED';
              newStatus = luluService.mapStatus(luluStatus) as OrderStatus;
              
              // Handle error/rejected statuses with detailed logging
              if (luluStatus === 'REJECTED' || luluStatus === 'ERROR') {
                const errors = data.errors || [];
                errorDetails = errors.map(e => ({
                  code: e.code,
                  message: e.message,
                }));
                
                console.error(`[Lulu Webhook] Print job ${luluStatus} for order ${order.id}:`, {
                  externalId,
                  errors: errorDetails,
                  rawData: data,
                });
              }
              
              // Check for tracking information in line items
              if (data.line_items && data.line_items.length > 0) {
                const shippedItems = data.line_items.filter((item) => item.tracking_id);
                if (shippedItems.length > 0) {
                  newTracking = shippedItems.map((item) => ({
                    trackingCode: item.tracking_id || '',
                    trackingUrl: item.tracking_urls?.[0] || '',
                    shipmentMethodName: 'Standard',
                    fulfillmentCountry: data.shipping_address?.country_code,
                  }));
                  newStatus = 'shipped';
                }
              }
              break;
            }

            default:
              break;
          }

          if (newStatus) {
            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* OrderStore;
                yield* store.updateStatus(
                  order.id,
                  newStatus!,
                  'service:lulu',
                  eventType,
                  { eventType, externalId, data, errorDetails }
                );
              })
            );
          }

          if (newTracking) {
            await managedRuntime.runPromise(
              Effect.gen(function* () {
                const store = yield* OrderStore;
                yield* store.updateTracking(
                  order.id,
                  newTracking!,
                  'service:lulu',
                  { eventType, externalId }
                );
              })
            );
          }
        } catch (error) {
          // Log error but return 200 to prevent webhook retries
          console.error('[Lulu Webhook] Processing error:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            eventType,
            externalId,
          });
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
        const body =
          (await context.getRawBody?.()) ?? JSON.stringify(input as unknown);

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
          console.error("[PingPay Webhook] Processing error:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            signature: signature.substring(0, 20) + "...",
            timestamp,
          });
          throw error;
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
                  events: input.events.filter((event): event is PrintfulWebhookEventType => event !== 'PRINT_JOB_STATUS_CHANGED'),
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
            } else {
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
            } else {
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
            } else {
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

      getProviderFieldConfigs: builder.getProviderFieldConfigs
        .use(requireAdmin)
        .handler(async ({ input }) => {
          const { PRINTFUL_PROVIDER_FIELDS } = await import('./services/fulfillment/printful');
          const { LULU_PROVIDER_FIELDS } = await import('./services/fulfillment/lulu');

          const allConfigs = {
            printful: PRINTFUL_PROVIDER_FIELDS,
            lulu: LULU_PROVIDER_FIELDS,
          };

          if (input.provider) {
            return { [input.provider]: allConfigs[input.provider] };
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
            throw new ORPCError('NOT_FOUND', {
              message: error instanceof Error ? error.message : String(error),
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
