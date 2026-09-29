import { z } from 'every-plugin/zod';

export const QikinkProviderDetailsSchema = z.object({
  sku: z.string().optional(),
  searchFromMyProducts: z.union([z.literal(0), z.literal(1)]).optional(),
  placementSku: z.string().optional(),
  printMethod: z.string().optional(),
  printTypeId: z.number().optional(),
}).passthrough();

export type QikinkProviderDetails = z.infer<typeof QikinkProviderDetailsSchema>;

export const QIKINK_PROVIDER_FIELDS = {
  sku: { label: 'SKU', order: 1 },
  searchFromMyProducts: { label: 'Search from My Products', order: 2 },
  placementSku: { label: 'Placement SKU', order: 3 },
  printMethod: { label: 'Print Method', order: 4 },
  printTypeId: { label: 'Print Type ID', order: 5 },
} as const;

export type QikinkProviderFields = typeof QIKINK_PROVIDER_FIELDS;

export interface QikinkProviderConfig {
  sku: string;
  searchFromMyProducts: 0 | 1;
  placementSku: string;
  catalogProductId: string;
  catalogVariantId: string;
  printMethod?: string;
  printTypeId?: number;
  /** Qikink supplier cost in INR when the SKU is not in the sandbox fixture. */
  basePriceInr?: number;
}

export interface QikinkShippingAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  phone: string;
  email: string;
  city: string;
  zip: string;
  province: string;
  country_code: string;
}

export interface QikinkDesign {
  design_code: string;
  /** Official example leaves this blank when design_code already exists. */
  width_inches: string;
  height_inches: string;
  /** Documented codes: fr, bk, lp, rp, rs, ls. */
  placement_sku: string;
  /** Create-order example uses design_link (docs text also says design_url). */
  design_link: string;
  /** Create-order example uses mockup_link (docs text also says mockup_url). */
  mockup_link: string;
}

export interface QikinkLineItem {
  search_from_my_products: 0 | 1;
  sku: string;
  quantity: string;
  /**
   * Qikink supplier line price as a string. This is the T2 catalog fixture cost
   * in INR (Qikink's published product price), not the NearMerch USD retail price.
   */
  price: string;
  /** Present in the official create-order example. */
  print_type_id?: number;
  /** Required when search_from_my_products is 0. Nested; not flattened onto the line item. */
  designs?: QikinkDesign[];
}

export interface QikinkCreateOrderPayload {
  order_number: string;
  qikink_shipping: '1';
  gateway: 'Prepaid';
  total_order_value: string;
  line_items: QikinkLineItem[];
  shipping_address: QikinkShippingAddress;
}

/** Official collection: https://documenter.getpostman.com/view/26157218/2sBYAxNoxr */
export const QIKINK_API_DOCS_URL = 'https://documenter.getpostman.com/view/26157218/2sBYAxNoxr';

export type QikinkEnvironment = 'sandbox' | 'production';

export const QIKINK_BASE_URLS = {
  sandbox: 'https://sandbox.qikink.com',
  production: 'https://api.qikink.com',
} as const;

export interface QikinkTokenResponse {
  ClientId?: string | number;
  Accesstoken?: string;
  expires_in?: number;
}

export type QikinkFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface QikinkClientConfig {
  clientId: string;
  clientSecret: string;
  environment?: string;
  baseUrl?: string;
  fetch?: QikinkFetch;
}

export function resolveQikinkEnvironment(value?: string): QikinkEnvironment {
  if (value === 'production' || value === 'live') {
    return 'production';
  }
  return 'sandbox';
}

export function resolveQikinkBaseUrl(environment?: string, baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '');
  }
  return QIKINK_BASE_URLS[resolveQikinkEnvironment(environment)];
}
