import { z } from 'every-plugin/zod';
import { ProductDownloadSchema } from '../../schema';

// ─── Fulfillment Files (universal) ───

export const FulfillmentFileSchema = z.object({
  assetId: z.string(),
  url: z.string(),
  slot: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ProviderDownloadSchema = ProductDownloadSchema;

export const ProviderMetadataSchema = z.object({
  downloads: z.array(ProviderDownloadSchema).optional(),
});

export type ProviderDownload = z.infer<typeof ProviderDownloadSchema>;
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>;

// ─── Provider Catalog (normalized across all providers) ───

export const CatalogSlotSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  required: z.boolean().default(true),
  acceptedFormats: z.array(z.string()).optional(),
});

export const ProviderCatalogPriceSchema = z.object({
  cost: z.number().optional(),
  discountedCost: z.number().optional(),
  currency: z.string().optional(),
});

export const ProviderCatalogVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  colorCode: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  providerRef: z.string(),
  price: ProviderCatalogPriceSchema.nullable().optional(),
});

export const ProviderCatalogProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  providerName: z.string(),
  slots: z.array(CatalogSlotSchema).optional(),
  variants: z.array(ProviderCatalogVariantSchema).optional(),
});

export const BrowseCatalogInputSchema = z.object({
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const BrowseCatalogOutputSchema = z.object({
  products: z.array(ProviderCatalogProductSchema),
  total: z.number(),
});

export const CatalogProductDetailOutputSchema = z.object({
  product: ProviderCatalogProductSchema,
});

export const CatalogVariantsOutputSchema = z.object({
  variants: z.array(ProviderCatalogVariantSchema),
});

export const VariantPriceOutputSchema = z.object({
  price: ProviderCatalogPriceSchema.nullable(),
});

// ─── Mockups ───

export const GenerateMockupsInputSchema = z.object({
  providerConfig: z.record(z.string(), z.unknown()),
  files: z.array(FulfillmentFileSchema),
  variantRefs: z.array(z.string()).optional(),
  mockupStyleIds: z.array(z.number()).optional(),
  format: z.enum(['jpg', 'png']).default('jpg'),
});

export const MockupImageSchema = z.object({
  variantRef: z.string(),
  slot: z.string(),
  imageUrl: z.string(),
  styleId: z.string().optional(),
});

export const GenerateMockupsOutputSchema = z.object({
  status: z.enum(['completed', 'pending', 'unsupported']),
  images: z.array(MockupImageSchema),
  taskId: z.string().optional(),
});

export const GetMockupResultOutputSchema = z.object({
  status: z.enum(['completed', 'pending', 'failed', 'unsupported']),
  images: z.array(MockupImageSchema),
  error: z.string().optional(),
});

// ─── Orders ───

export const CreateOrderItemSchema = z.object({
  providerConfig: z.record(z.string(), z.unknown()),
  files: z.array(FulfillmentFileSchema),
  quantity: z.number().int().positive(),
});

export const FulfillmentAddressSchema = z.object({
  name: z.string(),
  company: z.string().optional(),
  address1: z.string(),
  address2: z.string().optional(),
  city: z.string(),
  stateCode: z.string().optional(),
  countryCode: z.string(),
  zip: z.string(),
  phone: z.string().optional(),
  email: z.string().email(),
  taxId: z.string().optional(),
});

export const CreateOrderInputSchema = z.object({
  externalId: z.string(),
  recipient: FulfillmentAddressSchema,
  items: z.array(CreateOrderItemSchema),
  shippingMethod: z.string().optional(),
  retailCosts: z.object({ currency: z.string() }).optional(),
});

export const OrderResultSchema = z.object({
  id: z.string(),
  status: z.string(),
});

export const FulfillmentOrderStatusSchema = z.enum([
  'draft',
  'pending',
  'processing',
  'onhold',
  'printing',
  'shipped',
  'delivered',
  'cancelled',
  'failed',
]);

export const FulfillmentShipmentSchema = z.object({
  id: z.string(),
  carrier: z.string(),
  service: z.string(),
  trackingNumber: z.string(),
  trackingUrl: z.string(),
  status: z.string(),
});

export const FulfillmentOrderSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  status: FulfillmentOrderStatusSchema,
  created: z.number(),
  updated: z.number(),
  recipient: FulfillmentAddressSchema,
  shipments: z.array(FulfillmentShipmentSchema).optional(),
});

export const OrderDetailOutputSchema = z.object({
  order: FulfillmentOrderSchema,
});

// ─── Shipping & Tax ───

export const ShippingRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  rate: z.number(),
  currency: z.string(),
  taxAmount: z.number().optional(),
  vat: z.number().optional(),
  minDeliveryDays: z.number().optional(),
  maxDeliveryDays: z.number().optional(),
  minDeliveryDate: z.string().optional(),
  maxDeliveryDate: z.string().optional(),
});

export const ShippingQuoteInputSchema = z.object({
  recipient: FulfillmentAddressSchema,
  items: z.array(CreateOrderItemSchema),
  currency: z.string().optional(),
});

export const ShippingQuoteOutputSchema = z.object({
  rates: z.array(ShippingRateSchema),
  currency: z.string(),
});

export const TaxQuoteInputSchema = z.object({
  recipient: z.object({
    countryCode: z.string(),
    zip: z.string(),
    stateCode: z.string().optional(),
  }),
  items: z.array(z.object({
    providerConfig: z.record(z.string(), z.unknown()),
    quantity: z.number().int().positive(),
    files: z.array(FulfillmentFileSchema).optional(),
  })),
  currency: z.string().optional(),
  mode: z.enum(['quote', 'checkout']).optional(),
});

export const TaxQuoteOutputSchema = z.object({
  required: z.boolean(),
  rate: z.number(),
  shippingTaxable: z.boolean(),
  exempt: z.boolean(),
  taxAmount: z.number().optional(),
  vat: z.number().optional(),
});

// ─── Placements ───

export const GetPlacementsInputSchema = z.object({
  providerConfig: z.record(z.string(), z.unknown()),
});

export const GetPlacementsOutputSchema = z.object({
  placements: z.array(CatalogSlotSchema),
});

// ─── Ping ───

export const PingOutputSchema = z.object({
  provider: z.string(),
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});

// ─── Provider types ───

export const ProviderVariantSchema = z.object({
  id: z.union([z.string(), z.number()]),
  externalId: z.string(),
  name: z.string(),
  retailPrice: z.number(),
  currency: z.string(),
  sku: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  colorCode: z.string().optional(),
  catalogVariantId: z.number().optional(),
  catalogProductId: z.number().optional(),
  files: z.array(FulfillmentFileSchema).optional(),
  metadata: ProviderMetadataSchema.optional(),
  providerData: z.record(z.string(), z.unknown()).optional(),
});

export const ProviderProductSchema = z.object({
  id: z.union([z.string(), z.number()]),
  sourceId: z.number().or(z.string()),
  name: z.string(),
  description: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  variants: z.array(ProviderVariantSchema),
  metadata: ProviderMetadataSchema.optional(),
  providerDetails: z.record(z.string(), z.unknown()).optional(),
});

// ─── Type exports ───

export type FulfillmentFile = z.infer<typeof FulfillmentFileSchema>;
export type CatalogSlot = z.infer<typeof CatalogSlotSchema>;
export type ProviderCatalogProduct = z.infer<typeof ProviderCatalogProductSchema>;
export type ProviderCatalogVariant = z.infer<typeof ProviderCatalogVariantSchema>;
export type ProviderCatalogPrice = z.infer<typeof ProviderCatalogPriceSchema>;
export type BrowseCatalogInput = z.infer<typeof BrowseCatalogInputSchema>;
export type BrowseCatalogOutput = z.infer<typeof BrowseCatalogOutputSchema>;
export type CatalogProductDetailOutput = z.infer<typeof CatalogProductDetailOutputSchema>;
export type CatalogVariantsOutput = z.infer<typeof CatalogVariantsOutputSchema>;
export type VariantPriceOutput = z.infer<typeof VariantPriceOutputSchema>;
export type GenerateMockupsInput = z.infer<typeof GenerateMockupsInputSchema>;
export type GenerateMockupsOutput = z.infer<typeof GenerateMockupsOutputSchema>;
export type GetMockupResultOutput = z.infer<typeof GetMockupResultOutputSchema>;
export type MockupImage = z.infer<typeof MockupImageSchema>;
export type CreateOrderItem = z.infer<typeof CreateOrderItemSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type OrderResult = z.infer<typeof OrderResultSchema>;
export type FulfillmentOrderStatus = z.infer<typeof FulfillmentOrderStatusSchema>;
export type FulfillmentOrder = z.infer<typeof FulfillmentOrderSchema>;
export type FulfillmentAddress = z.infer<typeof FulfillmentAddressSchema>;
export type ShippingRate = z.infer<typeof ShippingRateSchema>;
export type ShippingQuoteInput = z.infer<typeof ShippingQuoteInputSchema>;
export type ShippingQuoteOutput = z.infer<typeof ShippingQuoteOutputSchema>;
export type TaxQuoteInput = z.infer<typeof TaxQuoteInputSchema>;
export type TaxQuoteOutput = z.infer<typeof TaxQuoteOutputSchema>;
export type PingOutput = z.infer<typeof PingOutputSchema>;

export type ProviderProduct = z.infer<typeof ProviderProductSchema>;
export type ProviderVariant = z.infer<typeof ProviderVariantSchema>;

export type GetPlacementsInput = z.infer<typeof GetPlacementsInputSchema>;
export type GetPlacementsOutput = z.infer<typeof GetPlacementsOutputSchema>;

// ─── Sync Progress ───

export const SyncProgressEventSchema = z.object({
  status: z.enum(['idle', 'syncing', 'completed', 'error']),
  phase: z.enum(['listing', 'fetching', 'saving', 'complete', 'error']).optional(),
  totalSynced: z.number().default(0),
  totalUpdated: z.number().default(0),
  totalFailed: z.number().default(0),
  timestamp: z.number(),
  message: z.string().optional(),
  currentProductName: z.string().optional(),
  total: z.number().optional(),
});

export type SyncProgressEvent = z.infer<typeof SyncProgressEventSchema>;
