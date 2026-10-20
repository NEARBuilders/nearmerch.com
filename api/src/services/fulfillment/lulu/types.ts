import { z } from 'every-plugin/zod';
import type { FulfillmentOrderStatus } from '../schema';

export const LuluBookConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  downloadUrl: z.string().url().optional(),
  downloadLabel: z.string().optional(),
  files: z.array(z.object({
    id: z.number().optional(),
    type: z.string(),
    url: z.string().url(),
    previewUrl: z.string().url().optional(),
  })).default([]),
  retailPrice: z.number().positive(),
  currency: z.string().default('USD'),
  variantName: z.string().default('Paperback'),
  sku: z.string(),
  podPackageId: z.string(),
  pageCount: z.number().int().positive(),
  coverPdfUrl: z.string().url(),
  interiorPdfUrl: z.string().url(),
});

export type LuluBookConfig = z.infer<typeof LuluBookConfigSchema>;

export const LuluProviderDetailsSchema = z.object({
  pageCount: z.number().int().positive().optional(),
  format: z.string().optional(),
});

export type LuluProviderDetails = z.infer<typeof LuluProviderDetailsSchema>;

export const LuluPrintJobStatusSchema = z.enum([
  'CREATED',
  'UNPAID',
  'PAYMENT_IN_PROGRESS',
  'PRODUCTION_DELAYED',
  'PRODUCTION_READY',
  'IN_PRODUCTION',
  'SHIPPED',
  'REJECTED',
  'CANCELED',
  'ERROR',
]);

export type LuluPrintJobStatus = z.infer<typeof LuluPrintJobStatusSchema>;

export const LULU_STATUS_MAP: Record<LuluPrintJobStatus, FulfillmentOrderStatus> = {
  CREATED: 'pending',
  UNPAID: 'pending',
  PAYMENT_IN_PROGRESS: 'pending',
  PRODUCTION_DELAYED: 'processing',
  PRODUCTION_READY: 'processing',
  IN_PRODUCTION: 'printing',
  SHIPPED: 'shipped',
  REJECTED: 'failed',
  CANCELED: 'cancelled',
  ERROR: 'failed',
};

export interface LuluTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface LuluShippingOptionsAddress {
  country: string;
  city?: string;
  postcode?: string;
  state?: string;
  state_code?: string;
  street1?: string;
  street2?: string;
  name?: string;
  organization?: string;
  phone_number?: string;
  is_business?: boolean;
  is_postbox?: boolean;
}

export interface LuluCostCalculationAddress {
  city: string;
  country_code: string;
  email?: string;
  is_business?: boolean;
  name: string;
  organization?: string;
  phone_number: string;
  postcode: string;
  state_code?: string;
  street1: string;
  street2?: string;
}

export interface LuluLineItemCalculation {
  page_count: number;
  pod_package_id: string;
  quantity: number;
}

export interface LuluShippingOption {
  id: number;
  level: 'MAIL' | 'PRIORITY_MAIL' | 'GROUND_HD' | 'GROUND_BUS' | 'GROUND' | 'EXPEDITED' | 'EXPRESS';
  cost_excl_tax?: string;
  currency: string;
  total_days_min?: number;
  total_days_max?: number;
  min_delivery_date?: string;
  max_delivery_date?: string;
}

export interface LuluShippingOptionsRequest {
  currency?: string;
  line_items: LuluLineItemCalculation[];
  shipping_address: LuluShippingOptionsAddress;
}

export interface LuluCostCalculationRequest {
  line_items: LuluLineItemCalculation[];
  shipping_address: LuluCostCalculationAddress;
  shipping_option: LuluShippingOption['level'];
}

export interface LuluCostCalculationResponse {
  currency: string;
  shipping_cost: {
    total_cost_excl_tax: string;
    total_cost_incl_tax: string;
    total_tax: string;
  };
  total_tax: string;
  total_cost_excl_tax: string;
  total_cost_incl_tax: string;
}

export interface LuluPrintJobShippingAddress {
  city: string;
  country_code: string;
  email?: string;
  name: string;
  organization?: string;
  phone_number?: string;
  postcode: string;
  state_code?: string;
  street1: string;
  street2?: string;
}

export interface LuluPrintJobLineItem {
  external_id: string;
  title?: string;
  quantity: number;
  printable_normalization: {
    cover: {
      source_url: string;
    };
    interior: {
      source_url: string;
    };
    pod_package_id: string;
  };
}

export interface LuluPrintJobRequest {
  external_id?: string;
  contact_email: string;
  shipping_level: LuluShippingOption['level'];
  shipping_address: LuluPrintJobShippingAddress;
  line_items: LuluPrintJobLineItem[];
}

export interface LuluPrintJobResponse {
  id: number | string;
  external_id?: string;
  status: { name?: string } | string;
  created_at: string;
  modified_at?: string;
  updated_at?: string;
  shipping_address?: {
    city?: string;
    country_code?: string;
    email?: string;
    name?: string;
    phone_number?: string;
    postcode?: string;
    state_code?: string;
    street1?: string;
    street2?: string;
  };
  line_items?: Array<{
    tracking_id?: string;
    tracking_urls?: string[];
    carrier_name?: string;
  }>;
  errors?: Array<{
    code?: string;
    message?: string;
    field?: string;
  }>;
}

export interface LuluWebhookPayload {
  topic: string;
  data: LuluPrintJobResponse;
}

export interface LuluProviderData {
  sku?: string;
  podPackageId: string;
  pageCount: number;
  coverPdfUrl: string;
  interiorPdfUrl: string;
  shippingLevel?: LuluShippingOption['level'];
}
