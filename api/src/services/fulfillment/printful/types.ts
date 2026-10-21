import { z } from 'every-plugin/zod';

export const PrintfulOrderStatus = z.enum([
  'draft',
  'pending',
  'failed',
  'canceled',
  'cancelled',
  'inprocess',
  'onhold',
  'partial',
  'fulfilled',
  'inreview',
]);

export const PrintfulProviderDetailsSchema = z.object({
  brand: z.string().optional(),
  model: z.string().optional(),
  description: z.string().optional(),
  techniques: z.array(z.string()).optional(),
  placements: z.array(z.string()).optional(),
  gsm: z.number().optional(),
  material: z.string().optional(),
});

export type PrintfulOrderStatus = z.infer<typeof PrintfulOrderStatus>;
export type PrintfulProviderDetails = z.infer<typeof PrintfulProviderDetailsSchema>;

export const PrintfulSyncFileSchema = z.object({
  id: z.number(),
  type: z.string(),
  url: z.string(),
  preview_url: z.string().nullable().optional(),
});

export const PrintfulSyncVariantSchema = z.object({
  id: z.number(),
  external_id: z.string(),
  sync_product_id: z.number(),
  name: z.string(),
  synced: z.boolean(),
  variant_id: z.number(),
  retail_price: z.string().nullable(),
  currency: z.string(),
  product: z.object({
    variant_id: z.number(),
    product_id: z.number(),
    image: z.string(),
    name: z.string(),
  }),
  files: z.array(PrintfulSyncFileSchema),
});

export const PrintfulSyncProductSchema = z.object({
  id: z.number(),
  external_id: z.string(),
  name: z.string(),
  variants: z.number(),
  synced: z.number(),
  thumbnail_url: z.string().nullable(),
  is_ignored: z.boolean(),
});

export type PrintfulSyncFile = z.infer<typeof PrintfulSyncFileSchema>;
export type PrintfulSyncVariant = z.infer<typeof PrintfulSyncVariantSchema>;
export type PrintfulSyncProduct = z.infer<typeof PrintfulSyncProductSchema>;

export const MockupStyleSchema = z.enum([
  'Lifestyle',
  'Lifestyle 2',
  'Lifestyle 3',
  'Flat',
  'Flat 2',
  'On Figure',
  'On Hanger',
  'Closeup',
  'Back',
  'Front',
  'Left',
  'Right',
  '3/4 Front',
  '3/4 Back',
]);

export const MockupPlacementSchema = z.enum([
  'front',
  'back',
  'left',
  'right',
  'front_large',
  'back_large',
  'label_outside',
  'sleeve_left',
  'sleeve_right',
  'embroidery_front',
  'embroidery_back',
]);

export const MockupFormatSchema = z.enum(['jpg', 'png']);

export const PrintfulMockupConfigSchema = z.object({
  styles: z.array(MockupStyleSchema).default(['Lifestyle', 'Flat']),
  placements: z.array(MockupPlacementSchema).default(['front']),
  format: MockupFormatSchema.default('jpg'),
  generateOnSync: z.boolean().default(true),
});

export const MockupStyleInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  placement: z.string().optional(),
  technique: z.string().optional(),
  viewName: z.string().optional(),
});

export type MockupStyle = z.infer<typeof MockupStyleSchema>;
export type MockupPlacement = z.infer<typeof MockupPlacementSchema>;
export type MockupFormat = z.infer<typeof MockupFormatSchema>;
export type PrintfulMockupConfig = z.infer<typeof PrintfulMockupConfigSchema>;
export type MockupStyleInfo = z.infer<typeof MockupStyleInfoSchema>;
