import {
  NOT_FOUND,
  FORBIDDEN,
  UNAUTHORIZED,
  BAD_REQUEST,
} from "every-plugin/errors";
import { oc, eventIterator } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import {
  CollectionSchema,
  ConfigureWebhookInputSchema,
  ConfigureWebhookOutputSchema,
  CreateCheckoutInputSchema,
  CreateCheckoutOutputSchema,
  ProductMetadataSchema,
  SubscribeNewsletterInputSchema,
  SubscribeNewsletterOutputSchema,
  OrderStatusEventSchema,
  OrderStatusSchema,
  OrderWithItemsSchema,
  ProductImageSchema,
  ProductSchema,
  ProductTypeSchema,
  ProviderConfigSchema,
  QuoteItemInputSchema,
  QuoteOutputSchema,
  ShippingAddressSchema,
  WebhookResponseSchema,
  UpdateOrderStatusInputSchema,
  UpdateOrderStatusOutputSchema,
  DeleteOrdersInputSchema,
  DeleteOrdersOutputSchema,
  GetOrderAuditLogOutputSchema,
  AssetSchema,
} from "./schema";
import { SyncProgressEventSchema, ProviderCatalogProductSchema, CatalogSlotSchema, ProviderCatalogVariantSchema } from "./services/fulfillment/schema";

export const contract = oc.router({
  ping: oc
    .route({
      method: "GET",
      path: "/ping",
      summary: "Health check",
      description: "Simple ping endpoint to verify the API is responding.",
      tags: ["Health"],
    })
    .output(
      z.object({
        status: z.literal("ok"),
        timestamp: z.string().datetime(),
      }),
    ),

  subscribeNewsletter: oc
    .route({
      method: "POST",
      path: "/newsletter/subscribe",
      summary: "Subscribe to newsletter",
      description:
        "Stores a newsletter subscription email. Idempotent for duplicates.",
      tags: ["Newsletter"],
    })
    .input(SubscribeNewsletterInputSchema)
    .output(SubscribeNewsletterOutputSchema)
    .errors({ BAD_REQUEST }),

  getProducts: oc
    .route({
      method: "GET",
      path: "/products",
      summary: "List all products",
      description: "Returns a list of all available products.",
      tags: ["Products"],
    })
    .input(
      z.object({
        productTypeSlug: z.string().optional(),
        collectionSlugs: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        featured: z.boolean().optional(),
        limit: z.number().int().positive().max(500).default(50),
        offset: z.number().int().min(0).default(0),
        includeUnlisted: z.boolean().optional(),
      }),
    )
    .output(
      z.object({
        products: z.array(ProductSchema),
        total: z.number(),
      }),
    ),

  getProduct: oc
    .route({
      method: "GET",
      path: "/products/{id}",
      summary: "Get product by ID",
      description: "Returns a single product by its ID.",
      tags: ["Products"],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ product: ProductSchema }))
    .errors({ NOT_FOUND }),

  searchProducts: oc
    .route({
      method: "GET",
      path: "/products/search",
      summary: "Search products",
      description: "Search products by query string.",
      tags: ["Products"],
    })
    .input(
      z.object({
        query: z.string(),
        limit: z.number().int().positive().max(100).default(20),
      }),
    )
    .output(
      z.object({
        products: z.array(ProductSchema),
      }),
    ),

  getFeaturedProducts: oc
    .route({
      method: "GET",
      path: "/products/featured",
      summary: "Get featured products",
      description: "Returns a curated list of featured products.",
      tags: ["Products"],
    })
    .input(
      z.object({
        limit: z.number().int().positive().max(20).default(8),
      }),
    )
    .output(
      z.object({
        products: z.array(ProductSchema),
      }),
    ),

  getCollections: oc
    .route({
      method: "GET",
      path: "/collections",
      summary: "List all collections",
      description: "Returns a list of all product collections/categories.",
      tags: ["Collections"],
    })
    .output(
      z.object({
        collections: z.array(CollectionSchema),
      }),
    ),

  getCollection: oc
    .route({
      method: "GET",
      path: "/collections/{slug}",
      summary: "Get collection by slug",
      description: "Returns a collection with its products.",
      tags: ["Collections"],
    })
    .input(z.object({ slug: z.string() }))
    .output(
      z.object({
        collection: CollectionSchema,
        products: z.array(ProductSchema),
      }),
    )
    .errors({ NOT_FOUND }),

  getCarouselCollections: oc
    .route({
      method: "GET",
      path: "/collections/carousel",
      summary: "Get carousel collections",
      description:
        "Returns collections configured to show in the carousel, with featured products.",
      tags: ["Collections"],
    })
    .output(
      z.object({
        collections: z.array(CollectionSchema),
      }),
    ),

  updateCollection: oc
    .route({
      method: "PUT",
      path: "/collections/{slug}",
      summary: "Update collection settings",
      description: "Updates collection details and carousel settings.",
      tags: ["Collections"],
    })
    .input(
      z.object({
        slug: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        badge: z.string().optional(),
        carouselTitle: z.string().optional(),
        carouselDescription: z.string().optional(),
        showInCarousel: z.boolean().optional(),
        carouselOrder: z.number().optional(),
      }),
    )
    .output(
      z.object({
        collection: CollectionSchema.nullable(),
      }),
    ),

  updateCollectionFeaturedProduct: oc
    .route({
      method: "POST",
      path: "/collections/{slug}/featured-product",
      summary: "Update collection featured product",
      description: "Sets the featured product for a collection carousel slide.",
      tags: ["Collections"],
    })
    .input(
      z.object({
        slug: z.string(),
        productId: z.string().nullable(),
      }),
    )
    .output(
      z.object({
        collection: CollectionSchema.nullable(),
      }),
    ),

  createCheckout: oc
    .route({
      method: "POST",
      path: "/checkout",
      summary: "Create checkout session",
      description: "Creates a new checkout session for purchasing a product.",
      tags: ["Checkout"],
    })
    .input(CreateCheckoutInputSchema)
    .output(CreateCheckoutOutputSchema)
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  quote: oc
    .route({
      method: "POST",
      path: "/quote",
      summary: "Get shipping quote for cart",
      description: "Calculates shipping costs by provider for cart items.",
      tags: ["Checkout"],
    })
    .input(
      z.object({
        items: z.array(QuoteItemInputSchema).min(1),
        shippingAddress: ShippingAddressSchema,
      }),
    )
    .output(QuoteOutputSchema)
    .errors({ BAD_REQUEST }),

  getOrders: oc
    .route({
      method: "GET",
      path: "/orders",
      summary: "List user orders",
      description: "Returns a list of orders for the authenticated user.",
      tags: ["Orders"],
    })
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(10),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .output(
      z.object({
        orders: z.array(OrderWithItemsSchema),
        total: z.number(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  getOrder: oc
    .route({
      method: "GET",
      path: "/orders/{id}",
      summary: "Get order by ID",
      description: "Returns a single order by its ID.",
      tags: ["Orders"],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ order: OrderWithItemsSchema }))
    .errors({ NOT_FOUND, FORBIDDEN, UNAUTHORIZED }),

  getOrderByCheckoutSession: oc
    .route({
      method: "GET",
      path: "/orders/by-session/{sessionId}",
      summary: "Get order by checkout session ID",
      description: "Returns an order by its Stripe checkout session ID.",
      tags: ["Orders"],
    })
    .input(z.object({ sessionId: z.string() }))
    .output(z.object({ order: OrderWithItemsSchema.nullable() })),

  subscribeOrderStatus: oc
    .route({
      method: "GET",
      path: "/orders/status/subscribe/{sessionId}",
      summary: "Subscribe to order status updates",
      description:
        "SSE endpoint for real-time order status updates. Streams status changes until terminal state.",
      tags: ["Orders"],
    })
    .input(z.object({ sessionId: z.string() }))
    .output(eventIterator(OrderStatusEventSchema)),

  getAllOrders: oc
    .route({
      method: "GET",
      path: "/admin/orders",
      summary: "List all orders (Admin)",
      description:
        "Returns a list of all orders. Requires admin authentication.",
      tags: ["Admin"],
    })
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
        offset: z.number().int().min(0).default(0),
        status: OrderStatusSchema.optional(),
        search: z.string().optional(),
      }),
    )
    .output(
      z.object({
        orders: z.array(OrderWithItemsSchema),
        total: z.number(),
      }),
    )
    .errors({ UNAUTHORIZED }),

  getOrderAuditLog: oc
    .route({
      method: "GET",
      path: "/orders/{id}/audit-log",
      summary: "Get order audit log",
      description:
        "Returns the audit log for a specific order. Accessible by order owner or admin.",
      tags: ["Orders"],
    })
    .input(z.object({ id: z.string() }))
    .output(GetOrderAuditLogOutputSchema)
    .errors({ NOT_FOUND, FORBIDDEN, UNAUTHORIZED }),

  updateOrderStatus: oc
    .route({
      method: "POST",
      path: "/admin/orders/{id}/status",
      summary: "Update order status (Admin)",
      description:
        "Manually updates the status of an order. Logs the change in audit log.",
      tags: ["Admin"],
    })
    .input(UpdateOrderStatusInputSchema)
    .output(UpdateOrderStatusOutputSchema)
    .errors({ NOT_FOUND, UNAUTHORIZED }),

  deleteOrders: oc
    .route({
      method: "POST",
      path: "/admin/orders/delete",
      summary: "Delete orders (Admin)",
      description:
        "Soft-deletes multiple orders. Drafts are hard-deleted. Other statuses are soft-deleted and logged.",
      tags: ["Admin"],
    })
    .input(DeleteOrdersInputSchema)
    .output(DeleteOrdersOutputSchema)
    .errors({ UNAUTHORIZED }),

  stripeWebhook: oc
    .route({
      method: "POST",
      path: "/webhooks/stripe",
      summary: "Stripe webhook",
      description: "Handles Stripe webhook events for payment processing.",
      tags: ["Webhooks"],
    })
    .input(
      z.object({
        body: z.string(),
        signature: z.string(),
      }),
    )
    .output(WebhookResponseSchema),

  printfulWebhook: oc
    .route({
      method: "POST",
      path: "/webhooks/printful",
      summary: "Printful webhook",
      description: "Handles Printful webhook events for order status updates.",
      tags: ["Webhooks"],
    })
    .input(z.unknown())
    .output(WebhookResponseSchema),

  luluWebhook: oc
    .route({
      method: 'POST',
      path: '/webhooks/lulu',
      summary: 'Lulu webhook',
      description: 'Handles Lulu webhook events for order status updates.',
      tags: ['Webhooks'],
    })
    .input(z.unknown())
    .output(WebhookResponseSchema),

  pingWebhook: oc
    .route({
      method: "POST",
      path: "/webhooks/ping",
      summary: "Ping webhook",
      description: "Handles Ping webhook events for payment processing.",
      tags: ["Webhooks"],
    })
    .input(z.unknown())
    .output(WebhookResponseSchema),

  updateProductListing: oc
    .route({
      method: "POST",
      path: "/products/{id}/listing",
      summary: "Update product listing status",
      description:
        "Updates whether a product is listed (visible) in the store.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        listed: z.boolean(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),
  cleanupAbandonedDrafts: oc
    .route({
      method: "POST",
      path: "/cron/cleanup-drafts",
      summary: "Cleanup abandoned draft orders",
      description:
        "Cancels draft orders older than 24 hours. Intended to be called by a cron job daily.",
      tags: ["Jobs"],
    })
    .input(
      z.object({
        maxAgeHours: z.number().int().positive().default(24).optional(),
      }),
    )
    .output(
      z.object({
        totalProcessed: z.number(),
        cancelled: z.number(),
        partiallyCancelled: z.number(),
        failed: z.number(),
        errors: z.array(
          z.object({
            orderId: z.string(),
            provider: z.string(),
            error: z.string(),
          }),
        ),
      }),
    ),

  retryPendingConfirmations: oc
    .route({
      method: "POST",
      path: "/cron/retry-confirmations",
      summary: "Retry pending fulfillment confirmations",
      description:
        "Retries Printful draft order confirmations for orders stuck in paid_pending_fulfillment. Intended to be called by a cron job every 5-10 minutes.",
      tags: ["Jobs"],
    })
    .input(
      z.object({
        olderThanMinutes: z.number().int().positive().default(5).optional(),
      }),
    )
    .output(
      z.object({
        totalProcessed: z.number(),
        confirmed: z.number(),
        stillPending: z.number(),
        failed: z.number(),
        errors: z.array(
          z.object({
            orderId: z.string(),
            provider: z.string(),
            error: z.string(),
          }),
        ),
      }),
    ),

  getNearPrice: oc
    .route({
      method: "GET",
      path: "/near-price",
      summary: "Get current NEAR price",
      description:
        "Returns the current NEAR token price in USD from CoinGecko.",
      tags: ["Pricing"],
    })
    .output(
      z.object({
        price: z.number(),
        currency: z.literal("USD"),
        source: z.string(),
        cachedAt: z.number(),
      }),
    ),

  getProviderConfig: oc
    .route({
      method: "GET",
      path: "/admin/providers/{provider}",
      summary: "Get provider configuration",
      description:
        "Returns the configuration for a fulfillment provider including webhook settings.",
      tags: ["Admin", "Providers"],
    })
    .input(z.object({ provider: z.enum(['printful', 'lulu']) }))
    .output(z.object({ config: ProviderConfigSchema.nullable() }))
    .errors({ UNAUTHORIZED }),

  configureWebhook: oc
    .route({
      method: "POST",
      path: "/admin/providers/{provider}/webhook",
      summary: "Configure provider webhook",
      description:
        "Configures webhook URL and events for a fulfillment provider.",
      tags: ["Admin", "Providers"],
    })
    .input(ConfigureWebhookInputSchema)
    .output(ConfigureWebhookOutputSchema)
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  disableWebhook: oc
    .route({
      method: "DELETE",
      path: "/admin/providers/{provider}/webhook",
      summary: "Disable provider webhook",
      description: "Disables webhook notifications for a fulfillment provider.",
      tags: ["Admin", "Providers"],
    })
    .input(z.object({ provider: z.enum(['printful', 'lulu']) }))
    .output(z.object({ success: z.boolean() }))
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  testProvider: oc
    .route({
      method: "POST",
      path: "/admin/providers/{provider}/test",
      summary: "Test provider connection",
      description: "Tests the connection to a fulfillment provider.",
      tags: ["Admin", "Providers"],
    })
    .input(z.object({ provider: z.enum(['printful', 'lulu']) }))
    .output(z.object({
      success: z.boolean(),
      message: z.string().optional(),
      timestamp: z.string().datetime(),
    }))
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  getProviderFieldConfigs: oc
    .route({
      method: "GET",
      path: "/admin/providers/field-configs",
      summary: "Get provider field configurations",
      description:
        "Returns field configurations for each fulfillment provider, used to display product details.",
      tags: ["Admin", "Providers"],
    })
    .input(z.object({ provider: z.enum(['printful', 'lulu']).optional() }))
    .output(z.record(z.string(), z.any()))
    .errors({ UNAUTHORIZED }),

  syncProducts: oc
    .route({
      method: "POST",
      path: "/admin/products/sync",
      summary: "Sync products from Printful",
      description:
        "Triggers a sync of Printful store products into the local product catalog. Returns SSE progress events.",
      tags: ["Admin", "Products"],
    })
    .input(z.object({ provider: z.enum(['printful']).default('printful') }))
    .output(eventIterator(SyncProgressEventSchema))
    .errors({ UNAUTHORIZED }),

  getCategories: oc
    .route({
      method: "GET",
      path: "/categories",
      summary: "List all categories (collections)",
      description:
        "Returns a list of all product collections for categorization.",
      tags: ["Collections"],
    })
    .output(
      z.object({
        categories: z.array(CollectionSchema),
      }),
    ),

  createCategory: oc
    .route({
      method: "POST",
      path: "/categories",
      summary: "Create a category (collection)",
      description: "Creates a new collection for categorizing products.",
      tags: ["Collections"],
    })
    .input(
      z.object({
        name: z.string(),
        slug: z.string(),
        description: z.string().optional(),
        image: z.string().optional(),
      }),
    )
    .output(
      z.object({
        category: CollectionSchema,
      }),
    ),

  deleteCategory: oc
    .route({
      method: "DELETE",
      path: "/categories/{id}",
      summary: "Delete a category (collection)",
      description: "Deletes a collection.",
      tags: ["Collections"],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  updateProductCategories: oc
    .route({
      method: "POST",
      path: "/products/{id}/categories",
      summary: "Update product categories",
      description: "Updates the collections a product belongs to.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        categoryIds: z.array(z.string()),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),

  updateProductTags: oc
    .route({
      method: "POST",
      path: "/products/{id}/tags",
      summary: "Update product tags",
      description: "Updates the tags on a product.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        tags: z.array(z.string()),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),

  updateProductFeatured: oc
    .route({
      method: "POST",
      path: "/products/{id}/featured",
      summary: "Update product featured status",
      description: "Updates whether a product is featured.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        featured: z.boolean(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),

  updateProductType: oc
    .route({
      method: "POST",
      path: "/products/{id}/product-type",
      summary: "Update product type",
      description: "Updates the product type of a product.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        productTypeSlug: z.string().nullable(),
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),

  updateProductMetadata: oc
    .route({
      method: "POST",
      path: "/products/{id}/metadata",
      summary: "Update product metadata",
      description:
        "Updates the project metadata for a product including creator account and fee splits.",
      tags: ["Products"],
    })
    .input(
      z.object({
        id: z.string(),
        metadata: ProductMetadataSchema,
      }),
    )
    .output(
      z.object({
        success: z.boolean(),
        product: ProductSchema.optional(),
      }),
    ),

  checkPurchaseGateAccess: oc
    .route({
      method: "POST",
      path: "/purchase-gates/check-access",
      summary: "Check purchase gate access",
      description: "Checks if a NEAR account can purchase a product gated by a plugin.",
      tags: ["Purchase Gates"],
    })
    .input(
      z.object({
        pluginId: z.string(),
        nearAccountId: z.string(),
      }),
    )
    .output(
      z.object({
        hasAccess: z.boolean(),
      }),
    ),

  getProductTypes: oc
    .route({
      method: "GET",
      path: "/product-types",
      summary: "List all product types",
      description: "Returns a list of all product types for categorization.",
      tags: ["Product Types"],
    })
    .output(
      z.object({
        productTypes: z.array(ProductTypeSchema),
      }),
    ),

  createProductType: oc
    .route({
      method: "POST",
      path: "/product-types",
      summary: "Create a product type",
      description: "Creates a new product type for categorizing products.",
      tags: ["Product Types"],
    })
    .input(
      z.object({
        slug: z.string(),
        label: z.string(),
        description: z.string().optional(),
        displayOrder: z.number().optional(),
      }),
    )
    .output(
      z.object({
        productType: ProductTypeSchema,
      }),
    ),

  updateProductTypeItem: oc
    .route({
      method: "PUT",
      path: "/product-types/{slug}",
      summary: "Update a product type",
      description: "Updates an existing product type.",
      tags: ["Product Types"],
    })
    .input(
      z.object({
        slug: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        displayOrder: z.number().optional(),
      }),
    )
    .output(
      z.object({
        productType: ProductTypeSchema.nullable(),
      }),
    ),

  deleteProductType: oc
    .route({
      method: "DELETE",
      path: "/product-types/{slug}",
      summary: "Delete a product type",
      description: "Deletes a product type.",
      tags: ["Product Types"],
    })
    .input(z.object({ slug: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ─── Admin: Catalog Browsing ───

  browseProviderCatalog: oc
    .route({
      method: "GET",
      path: "/admin/catalog",
      summary: "Browse provider catalog",
      description: "Browses the catalog of a fulfillment provider (blanks/products).",
      tags: ["Admin", "Catalog"],
    })
    .input(z.object({
      provider: z.enum(["printful", "lulu"]),
      limit: z.number().int().positive().max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .output(z.object({
      products: z.array(ProviderCatalogProductSchema),
      total: z.number(),
    }))
    .errors({ UNAUTHORIZED }),

  getProviderCatalogProduct: oc
    .route({
      method: "GET",
      path: "/admin/catalog/{provider}/{id}",
      summary: "Get provider catalog product",
      description: "Gets details for a specific catalog product from a provider.",
      tags: ["Admin", "Catalog"],
    })
    .input(z.object({
      provider: z.enum(["printful", "lulu"]),
      id: z.string(),
    }))
    .output(z.object({
      product: ProviderCatalogProductSchema,
    }))
    .errors({ NOT_FOUND, UNAUTHORIZED }),

  getProviderCatalogVariants: oc
    .route({
      method: "GET",
      path: "/admin/catalog/{provider}/{id}/variants",
      summary: "Get provider catalog product variants",
      description: "Gets variants for a specific catalog product from a provider.",
      tags: ["Admin", "Catalog"],
    })
    .input(z.object({
      provider: z.enum(["printful", "lulu"]),
      id: z.string(),
    }))
    .output(z.object({
      variants: z.array(ProviderCatalogVariantSchema),
    }))
    .errors({ UNAUTHORIZED }),

  getProviderPlacements: oc
    .route({
      method: "POST",
      path: "/admin/fulfillment/placements",
      summary: "Get available placements for a catalog product",
      description: "Returns the available placement slots (e.g. front, back, sleeve) for a given provider and catalog product. Provider-agnostic — routes through the fulfillment provider's implementation.",
      tags: ["Admin", "Fulfillment"],
    })
    .input(z.object({
      provider: z.enum(["printful", "lulu"]),
      catalogProductId: z.string(),
    }))
    .output(z.object({
      placements: z.array(CatalogSlotSchema),
    }))
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  // ─── Admin: Assets ───

  requestAssetUpload: oc
    .route({
      method: "POST",
      path: "/admin/assets/upload",
      summary: "Request a presigned upload URL",
      description: "Returns a presigned URL for direct upload to storage, plus an asset ID. After uploading to the presigned URL, call confirmAssetUpload to finalize the asset record.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({
      filename: z.string().min(1),
      contentType: z.string().default("image/png"),
      prefix: z.string().optional(),
    }))
    .output(z.object({
      presignedUrl: z.string().url(),
      assetId: z.string(),
      publicUrl: z.string().url(),
      key: z.string(),
    }))
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  confirmAssetUpload: oc
    .route({
      method: "POST",
      path: "/admin/assets/upload/confirm",
      summary: "Confirm an asset upload",
      description: "After uploading to the presigned URL, call this to create the asset record with the storage key and public URL.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({
      key: z.string().min(1),
      publicUrl: z.string().url(),
      assetId: z.string(),
      filename: z.string().optional(),
      contentType: z.string().optional(),
      size: z.number().optional(),
    }))
    .output(AssetSchema)
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  getAssetSignedUrl: oc
    .route({
      method: "POST",
      path: "/admin/assets/{id}/signed-url",
      summary: "Get a signed URL for an asset",
      description: "Returns a time-limited signed URL for accessing a private asset.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({
      id: z.string(),
      expiresIn: z.number().int().positive().max(86400).default(3600),
    }))
    .output(z.object({
      url: z.string().url(),
      expiresIn: z.number(),
    }))
    .errors({ NOT_FOUND, UNAUTHORIZED }),

  createAsset: oc
    .route({
      method: "POST",
      path: "/admin/assets",
      summary: "Create an asset",
      description: "Creates a new asset record with a URL.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({
      url: z.string().url(),
      type: z.string(),
      name: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .output(AssetSchema)
    .errors({ UNAUTHORIZED }),

  listAssets: oc
    .route({
      method: "GET",
      path: "/admin/assets",
      summary: "List assets",
      description: "Lists all assets with optional type filter.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({
      type: z.string().optional(),
      limit: z.number().int().positive().max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .output(z.object({
      assets: z.array(AssetSchema),
      total: z.number(),
    }))
    .errors({ UNAUTHORIZED }),

  deleteAsset: oc
    .route({
      method: "DELETE",
      path: "/admin/assets/{id}",
      summary: "Delete an asset",
      description: "Deletes an asset by ID.",
      tags: ["Admin", "Assets"],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .errors({ UNAUTHORIZED }),

  // ─── Admin: Product Update ───

  updateProduct: oc
    .route({
      method: "PATCH",
      path: "/admin/products/{id}",
      summary: "Update a product",
      description: "Updates product details including name, description, price, images, and thumbnail. Only provided fields are updated.",
      tags: ["Admin", "Products"],
    })
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      price: z.number().positive().optional(),
      priceLocked: z.boolean().optional(),
      images: z.array(ProductImageSchema).optional(),
      thumbnailImage: z.string().nullable().optional(),
    }))
    .output(z.object({
      success: z.boolean(),
      product: ProductSchema.optional(),
    }))
    .errors({ NOT_FOUND, UNAUTHORIZED }),

  // ─── Admin: Product Builder ───

  buildProduct: oc
    .route({
      method: "POST",
      path: "/admin/products/build",
      summary: "Build a product",
      description: "Creates a product with the given variants, files, and provider config. Caller constructs providerConfig per variant (opaque to the builder).",
      tags: ["Admin", "Products"],
    })
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      providerName: z.string(),
      image: z.string().optional(),
      variants: z.array(z.object({
        name: z.string(),
        variantRef: z.string(),
        providerConfig: z.record(z.string(), z.unknown()),
        attributes: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
        price: z.number().optional(),
        currency: z.string().optional(),
        sku: z.string().optional(),
      })).min(1),
      files: z.array(z.object({
        assetId: z.string(),
        url: z.string(),
        slot: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })),
      assetId: z.string().optional(),
      priceOverride: z.number().optional(),
      currency: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .output(ProductSchema)
    .errors({ BAD_REQUEST, UNAUTHORIZED }),

  generateProductMockups: oc
    .route({
      method: "POST",
      path: "/admin/products/{id}/mockups",
      summary: "Generate mockups for a product",
      description: "Triggers mockup generation for an existing product.",
      tags: ["Admin", "Products"],
    })
    .input(z.object({
      id: z.string(),
      styleIds: z.array(z.number()).optional(),
    }))
    .output(ProductSchema)
    .errors({ NOT_FOUND, UNAUTHORIZED }),
});
