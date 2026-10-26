import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import type {
  Attribute,
  ProviderWebhookEventType,
  ProviderTestScenario,
  ProductOption,
  ProductMetadata,
  ManualProviderSettings as ManualProviderSettingsType,
  SiteSettings,
} from "../schema";
import type { FulfillmentFile } from "../services/fulfillment/schema";

export interface FulfillmentConfig {
  providerName: string;
  providerConfig: Record<string, unknown>;
  files: FulfillmentFile[];
}

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    type: text("type").notNull(),
    name: text("name"),
    storageKey: text("storage_key"),
    size: integer("size"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("assets_type_idx").on(table.type),
    index("assets_url_idx").on(table.url),
    index("assets_storage_key_idx").on(table.storageKey),
  ],
);

export const productTypes = pgTable("product_types", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    publicKey: text("public_key").notNull().unique(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("USD"),
    brand: text("brand"),
    productTypeSlug: text("product_type_slug").references(
      () => productTypes.slug,
      { onDelete: "set null" },
    ),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    options: jsonb("options").$type<ProductOption[]>(),
    thumbnailImage: text("thumbnail_image"),
    featured: boolean("featured").notNull().default(false),
    metadata: jsonb("metadata").$type<ProductMetadata>(),

    fulfillmentProvider: text("fulfillment_provider").notNull(),
    externalProductId: text("external_product_id"),
    source: text("source").notNull(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "set null" }),
    lastSyncedAt: timestamp("last_synced_at", {
      withTimezone: true,
      mode: "date",
    }),
    listed: boolean("listed").notNull().default(true),
    priceLocked: boolean("price_locked").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("source_idx").on(table.source),
    index("external_product_idx").on(table.externalProductId),
    index("fulfillment_provider_idx").on(table.fulfillmentProvider),
    index("listed_idx").on(table.listed),
    index("public_key_idx").on(table.publicKey),
    index("slug_idx").on(table.slug),
    index("external_provider_idx").on(
      table.externalProductId,
      table.fulfillmentProvider,
    ),
    index("products_type_slug_idx").on(table.productTypeSlug),
    index("featured_idx").on(table.featured),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type").notNull(),
    placement: text("placement"),
    style: text("style"),
    variantIds: jsonb("variant_ids").$type<string[]>(),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("product_id_idx").on(table.productId),
    index("type_idx").on(table.type),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("USD"),

    attributes: jsonb("attributes").$type<Attribute[]>(),
    externalVariantId: text("external_variant_id"),
    fulfillmentConfig: jsonb("fulfillment_config").$type<FulfillmentConfig>(),

    inStock: boolean("in_stock").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("variant_product_idx").on(table.productId),
    index("variant_sku_idx").on(table.sku),
    index("variant_external_idx").on(table.externalVariantId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    image: text("image"),
    badge: text("badge"),
    featuredProductId: text("featured_product_id").references(
      () => products.id,
      { onDelete: "set null" },
    ),
    carouselTitle: text("carousel_title"),
    carouselDescription: text("carousel_description"),
    showInCarousel: boolean("show_in_carousel").notNull().default(true),
    carouselOrder: integer("carousel_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("collections_carousel_idx").on(
      table.showInCarousel,
      table.carouselOrder,
    ),
  ],
);

export const productCollections = pgTable(
  "product_collections",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionSlug: text("collection_slug")
      .notNull()
      .references(() => collections.slug, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.collectionSlug] }),
    index("pc_product_idx").on(table.productId),
    index("pc_collection_idx").on(table.collectionSlug),
  ],
);

export const syncState = pgTable(
  "sync_state",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    lastSuccessAt: timestamp("last_success_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorAt: timestamp("last_error_at", {
      withTimezone: true,
      mode: "date",
    }),
    errorMessage: text("error_message"),
    syncStartedAt: timestamp("sync_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    errorData: jsonb("error_data").$type<Record<string, any>>(),
  },
  (table) => [
    index("sync_started_idx").on(table.syncStartedAt),
    index("sync_updated_idx").on(table.updatedAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("pending"),

    subtotal: integer("subtotal"),
    shippingCost: integer("shipping_cost"),
    taxAmount: integer("tax_amount"),
    vatAmount: integer("vat_amount"),
    totalAmount: integer("total_amount").notNull(),
    currency: text("currency").notNull().default("USD"),

    taxRequired: boolean("tax_required"),
    taxRate: integer("tax_rate"),
    taxShippingTaxable: boolean("tax_shipping_taxable"),
    taxExempt: boolean("tax_exempt").default(false),
    customerTaxId: text("customer_tax_id"),

    checkoutSessionId: text("checkout_session_id"),
    checkoutProvider: text("checkout_provider"),
    draftOrderIds: jsonb("draft_order_ids").$type<Record<string, string>>(),
    paymentDetails: jsonb("payment_details").$type<Record<string, unknown>>(),

    shippingMethod: text("shipping_method"),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>(),

    fulfillmentOrderId: text("fulfillment_order_id"),
    fulfillmentReferenceId: text("fulfillment_reference_id"),
    trackingInfo: jsonb("tracking_info").$type<TrackingInfo[]>(),
    deliveryEstimate: jsonb("delivery_estimate").$type<DeliveryEstimate>(),

    isDeleted: boolean("is_deleted").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("orders_user_idx").on(table.userId),
    index("orders_checkout_session_idx").on(table.checkoutSessionId),
    index("orders_fulfillment_ref_idx").on(table.fulfillmentReferenceId),
    index("orders_status_idx").on(table.status),
    index("orders_deleted_idx").on(table.isDeleted),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id"),

    productName: text("product_name").notNull(),
    variantName: text("variant_name"),

    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),

    attributes: jsonb("attributes").$type<Attribute[]>(),
    fulfillmentProvider: text("fulfillment_provider"),
    fulfillmentConfig: jsonb("fulfillment_config").$type<FulfillmentConfig>(),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    index("order_items_product_idx").on(table.productId),
    index("order_items_variant_idx").on(table.variantId),
  ],
);

export const orderAuditLogs = pgTable(
  "order_audit_logs",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(), // e.g., 'service:printful', 'admin:efiz.near', 'user:efiz.near'
    action: text("action").notNull(), // e.g., 'status_change', 'tracking_update', 'fulfillment_update', 'delete'
    field: text("field"), // which field changed (nullable)
    oldValue: text("old_value"), // previous value (nullable)
    newValue: text("new_value"), // new value (nullable)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(), // additional context (webhook payload, etc.)
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_order_idx").on(table.orderId),
    index("audit_actor_idx").on(table.actor),
    index("audit_action_idx").on(table.action),
    index("audit_created_idx").on(table.createdAt),
  ],
);

export interface ShippingAddress {
  companyName?: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postCode: string;
  country: string;
  email: string;
  phone?: string;
  taxId?: string;
}

export interface TrackingInfo {
  trackingCode: string;
  trackingUrl: string;
  shipmentMethodName: string;
  shipmentMethodUid?: string;
  fulfillmentCountry?: string;
  fulfillmentStateProvince?: string;
  fulfillmentFacilityId?: string;
}

export interface DeliveryEstimate {
  minDeliveryDate: string;
  maxDeliveryDate: string;
}

export const providerConfigs = pgTable("provider_configs", {
  provider: text("provider").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  webhookUrl: text("webhook_url"),
  webhookUrlOverride: text("webhook_url_override"),
  enabledEvents: jsonb("enabled_events").$type<ProviderWebhookEventType[]>(),
  publicKey: text("public_key"),
  secretKey: text("secret_key"),
  settings: jsonb("settings").$type<ManualProviderSettingsType>(),
  lastConfiguredAt: timestamp("last_configured_at", {
    withTimezone: true,
    mode: "date",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const providerTestStates = pgTable(
  "provider_test_states",
  {
    provider: text("provider").primaryKey(),
    testProductId: text("test_product_id"),
    selectedRates: jsonb("selected_rates").$type<Record<string, string>>(),
    scenario: jsonb("scenario").$type<ProviderTestScenario>(),
    latestOrderId: text("latest_order_id"),
    latestStepResults: jsonb("latest_step_results").$type<Record<string, unknown>>(),
    latestWebhookPayloads: jsonb("latest_webhook_payloads").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("provider_test_states_updated_idx").on(table.updatedAt),
  ],
);



export const siteSettings = pgTable("site_settings", {
  id: text("id").primaryKey(),
  settings: jsonb("settings").$type<SiteSettings>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const merchBoxRequests = pgTable(
  "merch_box_requests",
  {
    id: text("id").primaryKey(),
    nearAccountId: text("near_account_id").notNull(),
    items: jsonb("items").$type<Array<{ article: string; qty: number; cost: number }>>().notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reviewed: boolean("reviewed").notNull().default(false),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    reviewedBy: text("reviewed_by"),
  },
  (table) => [
    index("merch_box_requests_account_idx").on(table.nearAccountId),
    index("merch_box_requests_created_idx").on(table.createdAt),
    index("merch_box_requests_reviewed_idx").on(table.reviewed),
  ],
);

export const newsletterSubscriptions = pgTable(
  "newsletter_subscriptions",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("newsletter_email_idx").on(table.email),
    index("newsletter_active_idx").on(table.active),
  ],
);

/**
 * x402 near-intents operations (issue #238). One row per facilitator quote,
 * keyed network:depositAddress[:memo]. Kept for at least refundDeadline + 24 h
 * so a retried deposit settles with the recorded entry and facilitator, and a
 * replayed executed operation is answered from the record. The operationToken
 * is never stored.
 */
export const x402IntentsOperations = pgTable(
  "x402_intents_operations",
  {
    operationKey: text("operation_key").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    originNetwork: text("origin_network").notNull(),
    originAsset: text("origin_asset").notNull(),
    depositAddress: text("deposit_address").notNull(),
    depositMemo: text("deposit_memo"),
    facilitatorUrl: text("facilitator_url").notNull(),
    requirements: jsonb("requirements").$type<Record<string, unknown>>().notNull(),
    feePlan: jsonb("fee_plan").$type<Record<string, unknown>>().notNull(),
    refundDeadline: timestamp("refund_deadline", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    state: text("state").notNull().default("quoted"),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    settleResponse: jsonb("settle_response").$type<Record<string, unknown>>(),
    lastErrorReason: text("last_error_reason"),
    duplicate: boolean("duplicate").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("x402_intents_operations_order_idx").on(table.orderId),
    index("x402_intents_operations_state_idx").on(table.state),
  ],
);
