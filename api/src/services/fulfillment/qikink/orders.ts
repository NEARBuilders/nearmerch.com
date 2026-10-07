import { FulfillmentError } from '../errors';
import type {
  CreateOrderInput,
  CreateOrderItem,
  FulfillmentAddress,
  FulfillmentFile,
  ShippingQuoteOutput,
} from '../schema';
import { findFixtureVariant, QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS, stripQikinkPrefix } from './catalog';
import type { QikinkCreateOrderPayload, QikinkDesign, QikinkLineItem, QikinkShippingAddress } from './types';

/**
 * Qikink publishes no shipping-rate API in the Postman collection
 * (https://documenter.getpostman.com/view/26157218/2sBYAxNoxr). Token, create-order,
 * and get-order are documented. This fallback is intentionally not a live quote.
 *
 * The USD amount is 0 so checkout can select a rate, the same pattern as Manual.
 * That is a checkout-unblocker, not a Qikink-quoted rate and not an agreed
 * free-shipping business decision. Do not treat this as Qikink shipping cost.
 */
export const QIKINK_STANDARD_SHIPPING_RATE_ID = 'qikink-standard';
export const QIKINK_STANDARD_SHIPPING_RATE_AMOUNT = 0;

export const QIKINK_ORDER_CREATE_PATH = '/api/order/create';
export const QIKINK_ORDER_GET_PATH = '/api/order';

export const QIKINK_ORDER_NUMBER_MAX_LENGTH = 15;
export const QIKINK_DESIGN_CODE_MAX_LENGTH = 20;

/** Official create-order example uses print_type_id: 1. */
export const QIKINK_DOCUMENTED_PRINT_TYPE_ID = 1;

/**
 * Documented placement_sku values:
 * fr=Front, bk=Back, lp=LeftPocket, rp=RightPocket, rs=RightShoulder, ls=LeftShoulder.
 */
const QIKINK_PLACEMENT_ALIASES: Record<string, string> = {
  fr: 'fr',
  front: 'fr',
  bk: 'bk',
  back: 'bk',
  lp: 'lp',
  leftpocket: 'lp',
  rp: 'rp',
  rightpocket: 'rp',
  rs: 'rs',
  rightshoulder: 'rs',
  rightsleeve: 'rs',
  ls: 'ls',
  leftshoulder: 'ls',
  leftsleeve: 'ls',
};

export function toQikinkPlacementSku(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return QIKINK_PLACEMENT_ALIASES[normalized] ?? 'fr';
}

export function toQikinkDesignCode(assetId: string): string {
  const trimmed = assetId.trim();
  if (!trimmed) {
    throw new FulfillmentError({
      message: 'Qikink sandbox orders require design artwork (assetId and url) when search_from_my_products is 0',
      code: 'INVALID_REQUEST',
      provider: 'qikink',
    });
  }
  return trimmed.slice(0, QIKINK_DESIGN_CODE_MAX_LENGTH);
}

export function quoteQikinkFallbackShipping(currency = 'USD'): ShippingQuoteOutput {
  return {
    rates: [
      {
        id: QIKINK_STANDARD_SHIPPING_RATE_ID,
        name: 'Qikink standard (fallback — no Qikink shipping-rate API; amount TBD)',
        rate: QIKINK_STANDARD_SHIPPING_RATE_AMOUNT,
        currency,
        minDeliveryDays: 5,
        maxDeliveryDays: 10,
      },
    ],
    currency,
  };
}

/** Deterministic: same NearMerch `externalId` (fulfillmentReferenceId) always maps to the same <=15 char Qikink order_number. */
export function toQikinkOrderNumber(externalId: string): string {
  const trimmed = externalId.replace(/[^a-zA-Z0-9]/g, '');
  const fallback = trimmed || 'NEARORDER';
  return fallback.slice(0, QIKINK_ORDER_NUMBER_MAX_LENGTH);
}

export function splitRecipientName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new FulfillmentError({
      message: 'Qikink orders require a recipient name',
      code: 'INVALID_ADDRESS',
      provider: 'qikink',
    });
  }
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(' ') || parts[0]!,
  };
}

export function toQikinkShippingAddress(recipient: FulfillmentAddress): QikinkShippingAddress {
  if (!recipient.phone?.trim()) {
    throw new FulfillmentError({
      message: 'Phone number is required for Qikink delivery',
      code: 'INVALID_ADDRESS',
      provider: 'qikink',
    });
  }
  if (!recipient.zip?.trim()) {
    throw new FulfillmentError({
      message: 'Pincode is required for Qikink delivery',
      code: 'INVALID_ADDRESS',
      provider: 'qikink',
    });
  }

  const { firstName, lastName } = splitRecipientName(recipient.name);
  return {
    first_name: firstName,
    last_name: lastName,
    address1: recipient.address1,
    address2: recipient.address2 ?? '',
    phone: recipient.phone.trim(),
    email: recipient.email,
    city: recipient.city,
    zip: recipient.zip.trim(),
    province: recipient.stateCode ?? '',
    country_code: recipient.countryCode,
  };
}

function resolveSku(providerConfig: Record<string, unknown>): string {
  if (typeof providerConfig.sku === 'string' && providerConfig.sku.trim()) {
    return providerConfig.sku.trim();
  }
  if (typeof providerConfig.catalogVariantId === 'string' && providerConfig.catalogVariantId.trim()) {
    return stripQikinkPrefix(providerConfig.catalogVariantId);
  }
  throw new FulfillmentError({
    message: 'Qikink order items require providerConfig.sku',
    code: 'INVALID_REQUEST',
    provider: 'qikink',
  });
}

function resolveSearchFromMyProducts(providerConfig: Record<string, unknown>): 0 | 1 {
  const value = providerConfig.searchFromMyProducts;
  if (value === 1 || value === '1') {
    return 1;
  }
  return QIKINK_SANDBOX_SEARCH_FROM_MY_PRODUCTS;
}

function resolvePlacementSku(
  providerConfig: Record<string, unknown>,
  file: FulfillmentFile | undefined,
): string {
  if (typeof providerConfig.placementSku === 'string' && providerConfig.placementSku.trim()) {
    return providerConfig.placementSku.trim();
  }
  if (file?.slot?.trim()) {
    return file.slot.trim();
  }
  return 'Front';
}

function resolveDesignFile(item: CreateOrderItem, placementSku: string): FulfillmentFile | undefined {
  const files = item.files.filter((file) => file.url);
  return files.find((file) => file.slot === placementSku) ?? files[0];
}

function resolvePrintTypeId(providerConfig: Record<string, unknown>): number {
  const value = providerConfig.printTypeId;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return QIKINK_DOCUMENTED_PRINT_TYPE_ID;
}

/**
 * Qikink `line_items[].price` is the supplier cost Qikink expects, as a string.
 * Source is the T2 catalog fixture `basePriceInr` (INR), or `providerConfig.basePriceInr`
 * for My Products SKUs that are not in the sandbox fixture. This is not the
 * customer's NearMerch checkout price, which stays USD on the local order.
 */
function resolveLinePrice(sku: string, providerConfig: Record<string, unknown>): string {
  const fixture = findFixtureVariant(sku);
  if (fixture) {
    return String(fixture.product.basePriceInr);
  }

  const fromConfig = providerConfig.basePriceInr;
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0) {
    return String(fromConfig);
  }
  if (typeof fromConfig === 'string' && /^\d+(\.\d+)?$/.test(fromConfig.trim()) && Number(fromConfig) > 0) {
    return fromConfig.trim();
  }

  throw new FulfillmentError({
    message: `Qikink line items require a catalog fixture price or providerConfig.basePriceInr for SKU ${sku}`,
    code: 'INVALID_REQUEST',
    provider: 'qikink',
  });
}

export function mapQikinkDesignFromItem(item: CreateOrderItem): QikinkDesign {
  const requestedPlacement = typeof item.providerConfig.placementSku === 'string'
    ? item.providerConfig.placementSku
    : undefined;
  const file = resolveDesignFile(item, requestedPlacement ?? 'Front');
  const placementSku = toQikinkPlacementSku(resolvePlacementSku(item.providerConfig, file));
  if (!file?.url || !file.assetId) {
    throw new FulfillmentError({
      message: 'Qikink sandbox orders require design artwork (assetId and url) when search_from_my_products is 0',
      code: 'INVALID_REQUEST',
      provider: 'qikink',
    });
  }
  return {
    // T4 stores NearMerch asset id + public URL + placement slot on fulfillmentConfig.files.
    // Official create-order nests those under line_items[].designs[]
    // (https://documenter.getpostman.com/view/26157218/2sBYAxNoxr).
    design_code: toQikinkDesignCode(file.assetId),
    width_inches: '',
    height_inches: '',
    placement_sku: placementSku,
    design_link: file.url,
    mockup_link: file.url,
  };
}

export function toQikinkLineItem(item: CreateOrderItem): QikinkLineItem {
  const sku = resolveSku(item.providerConfig);
  const searchFromMyProducts = resolveSearchFromMyProducts(item.providerConfig);
  const printTypeId = resolvePrintTypeId(item.providerConfig);
  const design = searchFromMyProducts === 0 ? mapQikinkDesignFromItem(item) : undefined;

  return {
    search_from_my_products: searchFromMyProducts,
    sku,
    quantity: String(item.quantity),
    price: resolveLinePrice(sku, item.providerConfig),
    ...(searchFromMyProducts === 0 ? { print_type_id: printTypeId } : {}),
    ...(design ? { designs: [design] } : {}),
  };
}

export function toQikinkCreateOrderPayload(input: CreateOrderInput): QikinkCreateOrderPayload {
  if (input.items.length === 0) {
    throw new FulfillmentError({
      message: 'Qikink orders require at least one line item',
      code: 'INVALID_REQUEST',
      provider: 'qikink',
    });
  }

  const lineItems = input.items.map(toQikinkLineItem);
  const total = lineItems.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0);

  return {
    order_number: toQikinkOrderNumber(input.externalId),
    qikink_shipping: '1',
    gateway: 'Prepaid',
    total_order_value: String(total),
    line_items: lineItems,
    shipping_address: toQikinkShippingAddress(input.recipient),
  };
}

export function parseQikinkOrderId(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['order_id', 'orderId', 'OrderId', 'id']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
  }
  return fallback;
}
