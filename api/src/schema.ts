import { z } from "every-plugin/zod";
import {
  PrintfulProviderDetailsSchema,
  type PrintfulProviderDetails,
} from './services/fulfillment/printful/types';
import {
  LuluProviderDetailsSchema,
  type LuluProviderDetails,
} from './services/fulfillment/lulu/types';
import { FulfillmentFileSchema as FulfillmentFileSchemaBase } from './services/fulfillment/schema';

export {
  PrintfulProviderDetailsSchema,
  LuluProviderDetailsSchema,
  type PrintfulProviderDetails,
  type LuluProviderDetails,
};

export const FulfillmentFileSchema = FulfillmentFileSchemaBase;

export const AttributeSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const ProductOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  values: z.array(z.string()),
  position: z.number(),
});

export const FulfillmentConfigSchema = z.object({
  providerName: z.string(),
  providerConfig: z.record(z.string(), z.unknown()),
  files: z.array(FulfillmentFileSchema),
});

export const ProductImageTypeSchema = z.enum([
  "primary",
  "mockup",
  "preview",
  "detail",
  "catalog",
]);

export const MockupConfigSchema = z.object({
  styles: z.array(z.string()).optional(),
  placements: z.array(z.string()).optional(),
  format: z.enum(["jpg", "png"]).optional(),
  generateOnSync: z.boolean().optional(),
});

export const ProductImageSchema = z.object({
  id: z.string(),
  url: z.string(),
  type: ProductImageTypeSchema,
  altText: z.string().optional(),
  placement: z.string().optional(),
  style: z.string().optional(),
  variantIds: z.array(z.string()).optional(),
  order: z.number().default(0),
});

export const ProductVariantSchema = z.object({
  id: z.string(),
  title: z.string(),
  sku: z.string().optional(),
  price: z.number(),
  compareAtPrice: z.number().optional(),
  currency: z.string().default("USD"),
  attributes: z.array(AttributeSchema),
  imageIds: z.array(z.string()).optional(),
  externalVariantId: z.string().optional(),
  fulfillmentConfig: FulfillmentConfigSchema.optional(),
  availableForSale: z.boolean().default(true),
  inventoryQuantity: z.number().optional(),
  fulfillmentCost: z.number().optional(),
});

export const CollectionFeaturedProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  price: z.number(),
  thumbnailImage: z.string().optional(),
});

export const CollectionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  badge: z.string().optional(),
  features: z.array(z.string()).optional(),
  featuredProductId: z.string().optional(),
  featuredProduct: CollectionFeaturedProductSchema.optional(),
  carouselTitle: z.string().optional(),
  carouselDescription: z.string().optional(),
  showInCarousel: z.boolean().default(true),
  carouselOrder: z.number().default(0),
});

export const ProductTypeSchema = z.object({
  slug: z.string(),
  label: z.string(),
  description: z.string().optional(),
  displayOrder: z.number().default(0),
});

export type ProductType = z.infer<typeof ProductTypeSchema>;

export const FeeConfigSchema = z.object({
  type: z.enum(["royalty", "affiliate", "platform", "custom"]),
  label: z.string(),
  recipient: z.string(),
  bps: z.number().int().min(0).max(10000),
});

export type FeeConfig = z.infer<typeof FeeConfigSchema>;

export const ProductDownloadSchema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  kind: z.enum(["free", "paid"]).default("free"),
  fileName: z.string().optional(),
});

export type ProductDownload = z.infer<typeof ProductDownloadSchema>;

export const ProviderDetailsSchema = z.object({
  printful: PrintfulProviderDetailsSchema.optional(),
  lulu: LuluProviderDetailsSchema.optional(),
});

export type ProviderDetails = z.infer<typeof ProviderDetailsSchema>;

export const PurchaseGatePluginIdSchema = z.enum(["legion-holder"]);

export const PurchaseGateSchema = z.object({
  pluginId: PurchaseGatePluginIdSchema.optional(),
});

export type PurchaseGatePluginId = z.infer<typeof PurchaseGatePluginIdSchema>;
export type PurchaseGate = z.infer<typeof PurchaseGateSchema>;

export const ReferralConfigSchema = z.object({
  enabled: z.boolean().default(false),
  feeBps: z.number().int().min(0).max(10000).default(2000),
});

export const AffiliateMetadataSchema = z.object({
  referral: ReferralConfigSchema.optional(),
});

export type ReferralConfig = z.infer<typeof ReferralConfigSchema>;
export type AffiliateMetadata = z.infer<typeof AffiliateMetadataSchema>;

export const ProductMetadataSchema = z.object({
  creatorAccountId: z.string().optional(),
  fees: z.array(FeeConfigSchema).default([]),
  providerDetails: ProviderDetailsSchema.optional(),
  downloads: z.array(ProductDownloadSchema).optional(),
  purchaseGate: PurchaseGateSchema.optional(),
  affiliate: AffiliateMetadataSchema.optional(),
});

export type ProductMetadata = z.infer<typeof ProductMetadataSchema>;

export const ProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  lastSyncedAt: z.string().datetime().optional(),
  handle: z.string().optional(),
  description: z.string().optional(),
  price: z.number(),
  currency: z.string().default("USD"),
  brand: z.string().optional(),
  productType: ProductTypeSchema.optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  collections: z.array(CollectionSchema).default([]),
  options: z.array(ProductOptionSchema).default([]),
  images: z.array(ProductImageSchema).default([]),
  variants: z.array(ProductVariantSchema).default([]),
  designFiles: z.array(FulfillmentFileSchema).default([]),
  thumbnailImage: z.string().optional(),
  fulfillmentProvider: z.string().default("manual"),
  externalProductId: z.string().optional(),
  source: z.string().optional(),
  vendor: z.string().optional(),
  listed: z.boolean().default(true),
  priceLocked: z.boolean().default(false),
  assetId: z.string().optional(),
  metadata: ProductMetadataSchema.optional(),
});

export type Product = z.infer<typeof ProductSchema>;
export type ProductVariant = z.infer<typeof ProductVariantSchema>;
export type ProductOption = z.infer<typeof ProductOptionSchema>;
export type Attribute = z.infer<typeof AttributeSchema>;
export type ProductImage = z.infer<typeof ProductImageSchema>;
export type ProductImageType = z.infer<typeof ProductImageTypeSchema>;
export type MockupConfig = z.infer<typeof MockupConfigSchema>;
export type Collection = z.infer<typeof CollectionSchema>;
export type CollectionFeaturedProduct = z.infer<
  typeof CollectionFeaturedProductSchema
>;
export type FulfillmentConfig = z.infer<typeof FulfillmentConfigSchema>;

const emptyStringToUndefined = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const OptionalNonEmptyTrimmedString = z
  .preprocess(emptyStringToUndefined, z.string().min(1).optional())
  .optional();

const RequiredNonEmptyTrimmedString = z.string().trim().min(1);

export const ShippingAddressSchema = z.object({
  companyName: OptionalNonEmptyTrimmedString,
  firstName: RequiredNonEmptyTrimmedString,
  lastName: RequiredNonEmptyTrimmedString,
  addressLine1: RequiredNonEmptyTrimmedString,
  addressLine2: OptionalNonEmptyTrimmedString,
  city: RequiredNonEmptyTrimmedString,
  state: OptionalNonEmptyTrimmedString,
  postCode: RequiredNonEmptyTrimmedString,
  country: z.string().trim().length(2),
  email: z.string().trim().email(),
  phone: OptionalNonEmptyTrimmedString,
  taxId: OptionalNonEmptyTrimmedString,
});

export const DeliveryEstimateSchema = z.object({
  minDeliveryDate: z.string(),
  maxDeliveryDate: z.string(),
});

export const OrderStatusSchema = z.enum([
  "pending",
  "draft_created",
  "payment_pending",
  "paid",
  "paid_pending_fulfillment",
  "payment_failed",
  "expired",
  "processing",
  "on_hold",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
  "partially_cancelled",
  "failed",
  "refunded",
]);

export const TrackingInfoSchema = z.object({
  trackingCode: z.string(),
  trackingUrl: z.string(),
  shipmentMethodName: z.string(),
  shipmentMethodUid: z.string().optional(),
  fulfillmentCountry: z.string().optional(),
  fulfillmentStateProvince: z.string().optional(),
  fulfillmentFacilityId: z.string().optional(),
});

export const OrderItemSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  productId: z.string(),
  variantId: z.string().optional(),
  productName: z.string(),
  variantName: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  attributes: z.array(AttributeSchema).optional(),
  fulfillmentProvider: z.string().optional(),
  fulfillmentConfig: z.record(z.string(), z.unknown()).optional(),
});

export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: OrderStatusSchema,
  totalAmount: z.number(),
  currency: z.string(),
  checkoutSessionId: z.string().optional(),
  checkoutProvider: z.enum(["stripe", "near", "pingpay"]).optional(),
  draftOrderIds: z.record(z.string(), z.string()).optional(),
  paymentDetails: z.record(z.string(), z.unknown()).optional(),
  shippingMethod: z.string().optional(),
  shippingAddress: ShippingAddressSchema.optional(),
  fulfillmentOrderId: z.string().optional(),
  fulfillmentReferenceId: z.string().optional(),
  trackingInfo: z.array(TrackingInfoSchema).optional(),
  deliveryEstimate: DeliveryEstimateSchema.optional(),
  items: z.array(OrderItemSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type DeliveryEstimate = z.infer<typeof DeliveryEstimateSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type TrackingInfo = z.infer<typeof TrackingInfoSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;

export const CheckoutItemInputSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  referralAccountId: z.string().trim().min(1).optional(),
});

export const CreateCheckoutInputSchema = z.object({
  items: z.array(CheckoutItemInputSchema),
  shippingAddress: ShippingAddressSchema,
  selectedRates: z.record(z.string(), z.string()),
  shippingCost: z.number(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  paymentProvider: z.enum(["stripe", "pingpay"]).default("stripe"),
});

export const CreateCheckoutOutputSchema = z.object({
  checkoutSessionId: z.string(),
  checkoutUrl: z.string().url(),
  orderId: z.string(),
});

export type CreateCheckoutInput = z.infer<typeof CreateCheckoutInputSchema>;
export type CreateCheckoutOutput = z.infer<typeof CreateCheckoutOutputSchema>;
export type CheckoutItemInput = z.infer<typeof CheckoutItemInputSchema>;

export const WebhookResponseSchema = z.object({
  received: z.boolean(),
});

export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;

export const SubscribeNewsletterInputSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const NewsletterSubscribeStatusSchema = z.enum([
  "subscribed",
  "already_subscribed",
]);

export const SubscribeNewsletterOutputSchema = z.object({
  success: z.boolean(),
  status: NewsletterSubscribeStatusSchema,
});

export type SubscribeNewsletterInput = z.infer<
  typeof SubscribeNewsletterInputSchema
>;
export type NewsletterSubscribeStatus = z.infer<
  typeof NewsletterSubscribeStatusSchema
>;
export type SubscribeNewsletterOutput = z.infer<
  typeof SubscribeNewsletterOutputSchema
>;

export const ReturnAddressSchema = ShippingAddressSchema;

export type ReturnAddress = z.infer<typeof ReturnAddressSchema>;

export const CreateOrderItemInputSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  productName: z.string(),
  variantName: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  attributes: z.array(AttributeSchema).optional(),
  fulfillmentProvider: z.string().optional(),
  fulfillmentConfig: FulfillmentConfigSchema.optional(),
});

export const CreateOrderInputSchema = z.object({
  userId: z.string(),
  items: z.array(CreateOrderItemInputSchema),
  subtotal: z.number().optional(),
  shippingCost: z.number().optional(),
  taxAmount: z.number().optional(),
  vatAmount: z.number().optional(),
  taxRequired: z.boolean().optional(),
  taxRate: z.number().optional(),
  taxShippingTaxable: z.boolean().optional(),
  taxExempt: z.boolean().optional(),
  customerTaxId: z.string().optional(),
  totalAmount: z.number(),
  currency: z.string(),
  shippingMethod: z.string().optional(),
});

export const ProductVariantInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string().optional(),
  price: z.number(),
  currency: z.string(),
  attributes: z.array(AttributeSchema),
  externalVariantId: z.string().optional(),
  fulfillmentConfig: FulfillmentConfigSchema.optional(),
  inStock: z.boolean().optional(),
  fulfillmentCost: z.number().optional(),
});

export const ProductWithImagesSchema = z.object({
  id: z.string(),
  publicKey: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  price: z.number(),
  currency: z.string(),
  brand: z.string().optional(),
  productTypeSlug: z.string().optional(),
  tags: z.array(z.string()).default([]),
  options: z.array(ProductOptionSchema),
  images: z.array(ProductImageSchema),
  thumbnailImage: z.string().optional(),
  variants: z.array(ProductVariantInputSchema),
  designFiles: z.array(FulfillmentFileSchema).default([]),
  fulfillmentProvider: z.string(),
  externalProductId: z.string().optional(),
  source: z.string(),
  assetId: z.string().optional(),
  metadata: ProductMetadataSchema.optional(),
});

export const ProductCriteriaSchema = z.object({
  productTypeSlug: z.string().optional(),
  collectionSlugs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  featured: z.boolean().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  includeUnlisted: z.boolean().optional(),
});

export const AssetSchema = z.object({
  id: z.string(),
  url: z.string(),
  type: z.string(),
  name: z.string().nullable(),
  storageKey: z.string().nullable(),
  size: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Asset = z.infer<typeof AssetSchema>;

export const OrderWithItemsSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: OrderStatusSchema,
  currentStatusNote: z.string().optional(),
  currentStatusNoteActor: z.string().optional(),
  currentStatusNoteCreatedAt: z.string().datetime().optional(),
  subtotal: z.number().optional(),
  shippingCost: z.number().optional(),
  taxAmount: z.number().optional(),
  vatAmount: z.number().optional(),
  taxRequired: z.boolean().optional(),
  taxRate: z.number().optional(),
  taxShippingTaxable: z.boolean().optional(),
  taxExempt: z.boolean().optional(),
  customerTaxId: z.string().optional(),
  totalAmount: z.number(),
  currency: z.string(),
  checkoutSessionId: z.string().optional(),
  checkoutProvider: z.enum(["stripe", "near", "pingpay"]).optional(),
  draftOrderIds: z.record(z.string(), z.string()).optional(),
  paymentDetails: z.record(z.string(), z.unknown()).optional(),
  shippingMethod: z.string().optional(),
  shippingAddress: ShippingAddressSchema.optional(),
  fulfillmentOrderId: z.string().optional(),
  fulfillmentReferenceId: z.string().optional(),
  trackingInfo: z.array(TrackingInfoSchema).optional(),
  deliveryEstimate: DeliveryEstimateSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  items: z.array(OrderItemSchema),
});

export type CreateOrderItemInput = z.infer<typeof CreateOrderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type ProductVariantInput = z.infer<typeof ProductVariantInputSchema>;
export type ProductWithImages = z.infer<typeof ProductWithImagesSchema>;
export type ProductCriteria = z.infer<typeof ProductCriteriaSchema>;
export type OrderWithItems = z.infer<typeof OrderWithItemsSchema>;

export const QuoteItemInputSchema = z.object({
  productId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
});

export const ProviderShippingOptionSchema = z.object({
  provider: z.string(),
  rateId: z.string(),
  rateName: z.string(),
  shippingCost: z.number(),
  currency: z.string(),
  taxAmount: z.number().optional(),
  vat: z.number().optional(),
  minDeliveryDays: z.number().optional(),
  maxDeliveryDays: z.number().optional(),
});

export const ProviderBreakdownSchema = z.object({
  provider: z.string(),
  itemCount: z.number(),
  subtotal: z.number(),
  selectedShipping: ProviderShippingOptionSchema,
  availableRates: z.array(ProviderShippingOptionSchema),
});

export const TaxBreakdownSchema = z.object({
  required: z.boolean(),
  rate: z.number(),
  shippingTaxable: z.boolean(),
  exempt: z.boolean(),
  vat: z.number().optional(),
});

export const QuoteOutputSchema = z.object({
  subtotal: z.number(),
  shippingCost: z.number(),
  tax: z.number(),
  vat: z.number(),
  taxBreakdown: TaxBreakdownSchema.optional(),
  total: z.number(),
  currency: z.string(),
  providerBreakdown: z.array(ProviderBreakdownSchema),
  estimatedDelivery: z
    .object({
      minDays: z.number().optional(),
      maxDays: z.number().optional(),
    })
    .optional(),
});

export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;
export type ProviderShippingOption = z.infer<
  typeof ProviderShippingOptionSchema
>;
export type ProviderBreakdown = z.infer<typeof ProviderBreakdownSchema>;
export type TaxBreakdown = z.infer<typeof TaxBreakdownSchema>;
export type QuoteOutput = z.infer<typeof QuoteOutputSchema>;

export const PrintfulWebhookEventTypeSchema = z.enum([
  "shipment_sent",
  "shipment_delivered",
  "shipment_returned",
  "shipment_canceled",
  "shipment_out_of_stock",
  "shipment_put_hold",
  "shipment_put_hold_approval",
  "shipment_remove_hold",
  "order_created",
  "order_updated",
  "order_failed",
  "order_canceled",
  "order_put_hold",
  "order_put_hold_approval",
  "order_remove_hold",
  "order_refunded",
  "catalog_stock_updated",
  "catalog_price_changed",
  "mockup_task_finished",
]);

export const PrintfulEventConfigSchema = z.object({
  type: PrintfulWebhookEventTypeSchema,
  url: z.string().nullable().optional(),
  params: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const LuluWebhookEventTypeSchema = z.enum(['PRINT_JOB_STATUS_CHANGED']);

export const ProviderNameSchema = z.enum(['printful', 'lulu']);
export const ProviderWebhookEventTypeSchema = z.union([
  PrintfulWebhookEventTypeSchema,
  LuluWebhookEventTypeSchema,
]);

export const ProviderConfigSchema = z.object({
  provider: ProviderNameSchema,
  enabled: z.boolean(),
  webhookUrl: z.string().nullable(),
  webhookUrlOverride: z.string().nullable(),
  enabledEvents: z.array(ProviderWebhookEventTypeSchema),
  publicKey: z.string().nullable(),
  secretKey: z.string().nullable(),
  lastConfiguredAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ConfigureWebhookInputSchema = z.object({
  provider: ProviderNameSchema,
  webhookUrlOverride: z.string().url().nullable().optional(),
  events: z.array(ProviderWebhookEventTypeSchema).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const ConfigureWebhookOutputSchema = z.object({
  success: z.boolean(),
  webhookUrl: z.string(),
  publicKey: z.string().nullable(),
  enabledEvents: z.array(ProviderWebhookEventTypeSchema),
  expiresAt: z.number().nullable(),
});

export type PrintfulWebhookEventType = z.infer<
  typeof PrintfulWebhookEventTypeSchema
>;
export type LuluWebhookEventType = z.infer<typeof LuluWebhookEventTypeSchema>;
export type PrintfulEventConfig = z.infer<typeof PrintfulEventConfigSchema>;
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type ProviderWebhookEventType = z.infer<typeof ProviderWebhookEventTypeSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ConfigureWebhookInput = z.infer<typeof ConfigureWebhookInputSchema>;
export type ConfigureWebhookOutput = z.infer<
  typeof ConfigureWebhookOutputSchema
>;

export const OrderStatusEventSchema = z.object({
  status: OrderStatusSchema,
  trackingInfo: z.array(TrackingInfoSchema).optional(),
  updatedAt: z.string().datetime(),
});

export type OrderStatusEvent = z.infer<typeof OrderStatusEventSchema>;

export const OrderAuditLogActionSchema = z.enum([
  "status_change",
  "tracking_update",
  "fulfillment_update",
  "admin_edit",
  "delete",
]);

export const OrderAuditLogSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  actor: z.string(), // e.g., 'service:printful', 'admin:efiz.near', 'user:efiz.near'
  action: OrderAuditLogActionSchema,
  field: z.string().optional(),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type OrderAuditLogAction = z.infer<typeof OrderAuditLogActionSchema>;
export type OrderAuditLog = z.infer<typeof OrderAuditLogSchema>;

export const UpdateOrderStatusInputSchema = z.object({
  orderId: z.string(),
  status: OrderStatusSchema,
  reason: z.string().optional(),
});

export const UpdateOrderStatusOutputSchema = z.object({
  success: z.boolean(),
  order: OrderWithItemsSchema,
});

export const DeleteOrdersInputSchema = z.object({
  orderIds: z.array(z.string()).min(1),
});

export const DeleteOrdersOutputSchema = z.object({
  success: z.boolean(),
  deleted: z.number(),
  errors: z.array(
    z.object({
      orderId: z.string(),
      error: z.string(),
    }),
  ),
});

export const GetOrderAuditLogOutputSchema = z.object({
  logs: z.array(OrderAuditLogSchema),
});
