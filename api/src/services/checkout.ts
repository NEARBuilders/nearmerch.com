import { Context, Effect, Layer, Schedule } from "every-plugin/effect";
import type { MarketplaceRuntime } from "../runtime";
import type {
  ProviderBreakdown,
  ProviderShippingOption,
  QuoteItemInput,
  CheckoutItemInput,
  QuoteOutput,
  ShippingAddress,
  FulfillmentConfig,
  TaxBreakdown,
  FeeConfig,
  Product,
  ProductMetadata,
  ProductVariant,
} from "../schema";
import { OrderStore, ProductStore } from "../store";
import type { CreateOrderItem } from "./fulfillment/schema";
import type { PaymentLineItem } from "./payment/schema";
import { CheckoutError } from "./checkout/errors";
import { getProvidersAddressRequirementError } from "./checkout/provider-address-requirements";


interface ProviderItemGroup {
  item: CheckoutItemInput;
  productId: string;
  variantId?: string;
  price: number;
  currency: string;
  fulfillmentConfig: FulfillmentConfig | undefined;
  productTitle: string;
  productDescription?: string;
  productImage?: string;
  fulfillmentProvider?: string;
  metadata?: ProductMetadata;
  referralAccountId?: string;
}

function selectCheckoutVariant(
  product: Product,
  variantId?: string,
): Effect.Effect<ProductVariant | undefined, CheckoutError> {
  if (!variantId) {
    if (product.variants.length > 0) {
      return Effect.fail(
        new CheckoutError({
          code: "VARIANT_UNAVAILABLE",
          productId: product.id,
          cause: new Error(`A variant must be selected for ${product.title}`),
        }),
      );
    }
    return Effect.succeed(undefined);
  }

  const selectedVariant = product.variants.find((variant) => variant.id === variantId);

  if (selectedVariant && !selectedVariant.availableForSale) {
    return Effect.fail(
      new CheckoutError({
        code: "VARIANT_UNAVAILABLE",
        productId: product.id,
        cause: new Error(`Variant is unavailable: ${selectedVariant.id}`),
      }),
    );
  }

  return Effect.succeed(selectedVariant);
}

function getManualNotificationConfig(metadata?: ProductMetadata) {
  const manualDetails = metadata?.providerDetails?.manual;

  if (!manualDetails) {
    return undefined;
  }

  const notificationEmails = Array.isArray(manualDetails.notificationEmails)
    ? manualDetails.notificationEmails
    : [];
  const ownerAccountIds = Array.isArray(manualDetails.ownerAccountIds)
    ? manualDetails.ownerAccountIds
    : [];

  return {
    ...(notificationEmails.length > 0
      ? { notificationEmails }
      : {}),
    ...(ownerAccountIds.length > 0
      ? { ownerAccountIds }
      : {}),
  };
}

export interface CreateCheckoutParams {
  userId: string;
  items: CheckoutItemInput[];
  address: ShippingAddress;
  selectedRates: Record<string, string>;
  shippingCost: number;
  successUrl: string;
  cancelUrl: string;
  paymentProvider?: "stripe" | "pingpay";
}

function normalizeNearAccountId(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return undefined;
  }

  const firstToken = trimmed.split(/\s+/)[0];
  const cleaned = firstToken?.replace(/[^a-z0-9._-]/g, "");

  return cleaned || undefined;
}

function getReferralFeeBps(metadata?: ProductMetadata) {
  const feeBps = metadata?.affiliate?.referral?.enabled
    ? metadata.affiliate.referral.feeBps ?? 2000
    : undefined;

  if (!feeBps || feeBps <= 0) {
    return undefined;
  }

  return feeBps;
}

interface ReferralFeeDetail {
  productId: string;
  productTitle: string;
  recipient: string;
  configuredFeeBps: number;
  itemSubtotal: number;
  allocationWeight: number;
  allocatedTotalAmount: number;
  feeAmount: number;
}

export function buildReferralFeeDetails({
  providerItems,
  userId,
  totalSubtotal,
  totalAmount,
}: {
  providerItems: ProviderItemGroup[];
  userId: string;
  totalSubtotal: number;
  totalAmount: number;
}): ReferralFeeDetail[] {
  const normalizedUserId = normalizeNearAccountId(userId);

  return providerItems
    .map((pi) => {
      const recipient = pi.referralAccountId;
      const feeBps = getReferralFeeBps(pi.metadata);

      if (!recipient || !feeBps || recipient === normalizedUserId) {
        return null;
      }

      const itemSubtotal = pi.price * pi.item.quantity;
      const allocationWeight = totalSubtotal > 0 ? itemSubtotal / totalSubtotal : 0;
      const allocatedTotalAmount = totalAmount * allocationWeight;

      return {
        productId: pi.productId,
        productTitle: pi.productTitle,
        recipient,
        configuredFeeBps: feeBps,
        itemSubtotal,
        allocationWeight,
        allocatedTotalAmount,
        feeAmount: (allocatedTotalAmount * feeBps) / 10000,
      };
    })
    .filter((detail): detail is ReferralFeeDetail => detail !== null);
}

export interface CreateCheckoutOutput {
  orderId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
  draftOrderIds: Record<string, string>;
}

function buildRecipient(address: ShippingAddress) {
  return {
    name: `${address.firstName} ${address.lastName}`,
    company: address.companyName,
    address1: address.addressLine1,
    address2: address.addressLine2,
    city: address.city,
    stateCode: address.state,
    countryCode: address.country,
    zip: address.postCode,
    phone: address.phone,
    email: address.email,
    taxId: address.taxId,
  };
}

function mapToFulfillmentItems(providerItems: ProviderItemGroup[], selectedRateId?: string): CreateOrderItem[] {
  return providerItems.map(pi => {
    const config = pi.fulfillmentConfig;
    const providerConfig = config?.providerConfig as Record<string, unknown> | undefined;
    const mergedProviderConfig = {
      ...(providerConfig || {}),
      ...(selectedRateId ? { shippingLevel: selectedRateId } : {}),
    };

    const files = config?.files || [];

    return {
      providerConfig: mergedProviderConfig,
      files,
      quantity: pi.item.quantity,
    };
  });
}

export class CheckoutService extends Context.Tag("CheckoutService")<
  CheckoutService,
  {
    readonly getQuote: (
      items: QuoteItemInput[],
      address: ShippingAddress,
    ) => Effect.Effect<QuoteOutput, Error | CheckoutError>;
    readonly createCheckout: (
      params: CreateCheckoutParams,
    ) => Effect.Effect<CreateCheckoutOutput, Error | CheckoutError>;
  }
>() {}

export const CheckoutServiceLive = (runtime: MarketplaceRuntime) =>
  Layer.effect(
    CheckoutService,
      Effect.gen(function* () {
        const productStore = yield* ProductStore;
        const orderStore = yield* OrderStore;
        

        const logDuration = (label: string, startedAt: number) => {
          console.log(`[checkout] ${label} took ${Date.now() - startedAt}ms`);
        };

        const calculateProviderTax = ({
          providerName,
          providerItems,
          selectedRateId,
          selectedRateTaxAmount,
          selectedRateVat,
          address,
          currency,
          mode,
        }: {
          providerName: string;
          providerItems: ProviderItemGroup[];
          selectedRateId?: string;
          selectedRateTaxAmount?: number;
          selectedRateVat?: number;
          address: ShippingAddress;
          currency: string;
          mode: 'quote' | 'checkout';
        }) =>
          Effect.gen(function* () {
            if (providerName === 'manual') {
              return {
                required: false,
                rate: 0,
                shippingTaxable: false,
                exempt: true,
                taxAmount: 0,
                vat: 0,
              };
            }

            const provider = runtime.getProvider(providerName);
            if (!provider) {
              return {
                required: false,
                rate: 0,
                shippingTaxable: false,
                exempt: true,
                taxAmount: 0,
                vat: 0,
              };
            }

            if (providerName === 'lulu') {
              const taxAmount = selectedRateTaxAmount ?? 0;
              const vat = selectedRateVat ?? 0;
              const providerSubtotal = providerItems.reduce(
                (sum, pi) => sum + pi.price * pi.item.quantity,
                0
              );

              return {
                required: taxAmount > 0 || vat > 0,
                rate: providerSubtotal > 0 ? (taxAmount + vat) / providerSubtotal : 0,
                shippingTaxable: taxAmount > 0 || vat > 0,
                exempt: taxAmount === 0 && vat === 0,
                taxAmount,
                vat,
              };
            }

            {
              const taxItems = providerItems.map(pi => {
                const config = pi.fulfillmentConfig;
                return {
                  providerConfig: config?.providerConfig || {},
                  quantity: pi.item.quantity,
                  files: config?.files || [],
                };
              });

              if (taxItems.length === 0) {
                return {
                  required: false,
                  rate: 0,
                  shippingTaxable: false,
                  exempt: true,
                  taxAmount: 0,
                  vat: 0,
                };
              }

              const taxStartedAt = Date.now();

              const taxResultOption = yield* Effect.option(
                Effect.tryPromise({
                  try: () =>
                    provider.client.calculateTax({
                      recipient: {
                        countryCode: address.country,
                        zip: address.postCode,
                        stateCode: address.state,
                      },
                      items: taxItems,
                      currency,
                      mode,
                    }),
                  catch: (error) => {
                    console.error(`[${providerName}] Tax calculation failed:`, error);
                    return new Error(`Tax calculation failed: ${error instanceof Error ? error.message : String(error)}`);
                  },
                })
              );

              logDuration(`${providerName} tax (${mode})`, taxStartedAt);

              if (taxResultOption._tag === 'Some') {
                const taxResult = taxResultOption.value;
                return {
                  required: taxResult.required,
                  rate: taxResult.rate,
                  shippingTaxable: taxResult.shippingTaxable,
                  exempt: taxResult.exempt,
                  taxAmount: taxResult.taxAmount ?? 0,
                  vat: taxResult.vat ?? 0,
                };
              }
            }

            const providerSubtotal = providerItems.reduce(
              (sum, pi) => sum + pi.price * pi.item.quantity,
              0
            );

            return {
              required: false,
              rate: 0,
              shippingTaxable: false,
              exempt: providerSubtotal === 0,
              taxAmount: 0,
              vat: 0,
            };
          });

        return {
        getQuote: (items, address) =>
          Effect.gen(function* () {
            const itemsByProvider = new Map<string, ProviderItemGroup[]>();

            let totalSubtotal = 0;
            const currency = "USD";

            for (const item of items) {
              const product = yield* productStore.find(item.productId);
              if (!product || !product.listed) {
                return yield* Effect.fail(
                  new Error(`Product not found: ${item.productId}`),
                );
              }

              const selectedVariant = yield* selectCheckoutVariant(
                product,
                item.variantId,
              );

              const unitPrice = selectedVariant?.price ?? product.price;
              const itemSubtotal = unitPrice * item.quantity;
              totalSubtotal += itemSubtotal;

              const provider = product.fulfillmentProvider || "manual";

              if (!itemsByProvider.has(provider)) {
                itemsByProvider.set(provider, []);
              }

              itemsByProvider.get(provider)!.push({
                item,
                productId: product.id,
                variantId: selectedVariant?.id,
                price: unitPrice,
                currency:
                  selectedVariant?.currency ?? product.currency ?? currency,
                fulfillmentConfig: selectedVariant?.fulfillmentConfig,
                productTitle: product.title,
                productDescription: product.description,
                productImage: product.images?.[0]?.url,
                fulfillmentProvider: product.fulfillmentProvider,
              });
            }

            const quoteAddressError = getProvidersAddressRequirementError(
              itemsByProvider.keys(),
              address,
            );

            if (quoteAddressError) {
              return yield* Effect.fail(
                new CheckoutError({
                  code: "INVALID_ADDRESS",
                  provider: quoteAddressError.provider,
                  cause: new Error(quoteAddressError.message),
                }),
              );
            }

            const providerBreakdown: ProviderBreakdown[] = [];
            let totalShippingCost = 0;
            let totalTax = 0;
            let totalVat = 0;
            let minDeliveryDays: number | undefined;
            let maxDeliveryDays: number | undefined;
            const providerTaxResults: Array<{ required: boolean; rate: number; shippingTaxable: boolean; exempt: boolean; taxAmount: number; vat: number }> = [];
            const quoteStartedAt = Date.now();

            for (const [
              providerName,
              providerItems,
            ] of itemsByProvider.entries()) {
              const provider = runtime.getProvider(providerName);

              if (!provider) {
                if (providerName === "manual") {
                  const manualSubtotal = providerItems.reduce(
                    (sum, pi) => sum + pi.price * pi.item.quantity,
                    0,
                  );

                  const manualShipping: ProviderShippingOption = {
                    provider: "manual",
                    rateId: "manual-standard",
                    rateName: "Standard Shipping",
                    shippingCost: 0,
                    currency,
                    minDeliveryDays: 5,
                    maxDeliveryDays: 10,
                  };

                  providerBreakdown.push({
                    provider: "manual",
                    itemCount: providerItems.length,
                    subtotal: manualSubtotal,
                    selectedShipping: manualShipping,
                    availableRates: [manualShipping],
                  });

                  if (
                    minDeliveryDays === undefined ||
                    manualShipping.minDeliveryDays! < minDeliveryDays
                  ) {
                    minDeliveryDays = manualShipping.minDeliveryDays;
                  }
                  if (
                    maxDeliveryDays === undefined ||
                    manualShipping.maxDeliveryDays! > maxDeliveryDays
                  ) {
                    maxDeliveryDays = manualShipping.maxDeliveryDays;
                  }

                  continue;
                }

                return yield* Effect.fail(
                  new Error(`Provider not configured: ${providerName}`),
                );
              }

              const fulfillmentItems = mapToFulfillmentItems(providerItems);
              const providerStartedAt = Date.now();

              const quoteResult: any = yield* Effect.tryPromise({
                try: () =>
                  provider.client.quoteShipping({
                    recipient: buildRecipient(address),
                    items: fulfillmentItems,
                    currency,
                  }),
                catch: (error) =>
                  new CheckoutError({
                    code: "QUOTE_FAILED",
                    provider: providerName,
                    cause: error,
                  }),
              });

              const rates = quoteResult.rates || [];
              if (rates.length === 0) {
                return yield* Effect.fail(
                  new Error(`No shipping rates available from ${providerName}`),
                );
              }

              const selectedRate = rates.reduce((cheapest: any, rate: any) =>
                rate.rate < cheapest.rate ? rate : cheapest,
              );

              const availableRates: any[] = rates.map((rate: any) => ({
                provider: providerName,
                rateId: rate.id,
                rateName: rate.name,
                shippingCost: rate.rate,
                currency: rate.currency,
                taxAmount: rate.taxAmount,
                vat: rate.vat,
                minDeliveryDays: rate.minDeliveryDays,
                maxDeliveryDays: rate.maxDeliveryDays,
              }));

              const selectedShipping: ProviderShippingOption = {
                provider: providerName,
                rateId: selectedRate.id,
                rateName: selectedRate.name,
                shippingCost: selectedRate.rate,
                currency: selectedRate.currency,
                taxAmount: selectedRate.taxAmount,
                vat: selectedRate.vat,
                minDeliveryDays: selectedRate.minDeliveryDays,
                maxDeliveryDays: selectedRate.maxDeliveryDays,
              };

              const providerSubtotal = providerItems.reduce(
                (sum, pi) => sum + pi.price * pi.item.quantity,
                0,
              );

              providerBreakdown.push({
                provider: providerName,
                itemCount: providerItems.length,
                subtotal: providerSubtotal,
                selectedShipping,
                availableRates,
              });

              totalShippingCost += selectedRate.rate;

              logDuration(`${providerName} shipping quote`, providerStartedAt);

              const providerTax = yield* calculateProviderTax({
                providerName,
                providerItems,
                selectedRateId: selectedRate.id,
                selectedRateTaxAmount: selectedRate.taxAmount,
                selectedRateVat: selectedRate.vat,
                address,
                currency,
                mode: 'quote',
              });
              providerTaxResults.push(providerTax);
              totalTax += providerTax.taxAmount;
              totalVat += providerTax.vat;

              if (selectedRate.minDeliveryDays !== undefined) {
                if (
                  minDeliveryDays === undefined ||
                  selectedRate.minDeliveryDays < minDeliveryDays
                ) {
                  minDeliveryDays = selectedRate.minDeliveryDays;
                }
              }
              if (selectedRate.maxDeliveryDays !== undefined) {
                if (
                  maxDeliveryDays === undefined ||
                  selectedRate.maxDeliveryDays > maxDeliveryDays
                ) {
                  maxDeliveryDays = selectedRate.maxDeliveryDays;
                }
              }
            }

            let tax = totalTax;
            let vat = totalVat;
            let taxBreakdown: { required: boolean; rate: number; shippingTaxable: boolean; exempt: boolean; taxAmount?: number; vat?: number } | undefined;

            if (providerTaxResults.length > 0) {
              taxBreakdown = {
                required: providerTaxResults.some((result) => result.required),
                rate: totalSubtotal > 0 ? (tax + vat) / totalSubtotal : 0,
                shippingTaxable: providerTaxResults.some((result) => result.shippingTaxable),
                exempt: providerTaxResults.every((result) => result.exempt),
                taxAmount: tax,
                vat,
              };
            }

            const quoteResult = {
              subtotal: totalSubtotal,
              shippingCost: totalShippingCost,
              tax,
              vat,
              taxBreakdown,
              total: totalSubtotal + totalShippingCost + tax + vat,
              currency,
              providerBreakdown,
              estimatedDelivery:
                minDeliveryDays !== undefined && maxDeliveryDays !== undefined
                  ? { minDays: minDeliveryDays, maxDays: maxDeliveryDays }
                  : undefined,
            };

            logDuration('quote aggregation', quoteStartedAt);

            return quoteResult;
          }),

        createCheckout: (params) =>
          Effect.gen(function* () {
            const {
              userId,
              items,
              address,
              selectedRates,
              shippingCost,
              successUrl,
              cancelUrl,
            } = params;

            const itemsByProvider = new Map<string, ProviderItemGroup[]>();

            let totalSubtotal = 0;
            const currency = "USD";

            for (const item of items) {
              const product = yield* productStore.find(item.productId);
              if (!product || !product.listed) {
                return yield* Effect.fail(
                  new Error(`Product not found: ${item.productId}`),
                );
              }

              const selectedVariant = yield* selectCheckoutVariant(
                product,
                item.variantId,
              );

              const unitPrice = selectedVariant?.price ?? product.price;
              const itemSubtotal = unitPrice * item.quantity;
              totalSubtotal += itemSubtotal;

              const provider = product.fulfillmentProvider || "manual";

              if (!itemsByProvider.has(provider)) {
                itemsByProvider.set(provider, []);
              }

              itemsByProvider.get(provider)!.push({
                item,
                productId: product.id,
                variantId: selectedVariant?.id,
                price: unitPrice,
                currency:
                  selectedVariant?.currency ?? product.currency ?? currency,
                fulfillmentConfig: selectedVariant?.fulfillmentConfig,
                productTitle: product.title,
                productDescription: product.description,
                productImage: product.images?.[0]?.url,
                fulfillmentProvider: product.fulfillmentProvider,
                metadata: product.metadata,
                referralAccountId: normalizeNearAccountId(item.referralAccountId),
              });
            }

            const checkoutAddressError = getProvidersAddressRequirementError(
              itemsByProvider.keys(),
              address,
            );

            if (checkoutAddressError) {
              return yield* Effect.fail(
                new CheckoutError({
                  code: "INVALID_ADDRESS",
                  provider: checkoutAddressError.provider,
                  userId,
                  cause: new Error(checkoutAddressError.message),
                }),
              );
            }

            let verifiedShippingCost = 0;
            let tax = 0;
            let vat = 0;
            const providerTaxResults: Array<{ required: boolean; rate: number; shippingTaxable: boolean; exempt: boolean; taxAmount: number; vat: number }> = [];

            for (const [
              providerName,
              providerItems,
            ] of itemsByProvider.entries()) {
              if (providerName === "manual") continue;

              const provider = runtime.getProvider(providerName);
              if (!provider) continue;

              const selectedRateId = selectedRates[providerName];
              if (!selectedRateId) {
                return yield* Effect.fail(
                  new CheckoutError({
                    code: "NO_SHIPPING_RATE_SELECTED",
                    provider: providerName,
                    userId,
                    cause: new Error(`No shipping rate selected for provider ${providerName}`),
                  }),
                );
              }

              const fulfillmentItems = mapToFulfillmentItems(providerItems);

              const quoteResultOption = yield* Effect.option(
                Effect.tryPromise({
                  try: () =>
                    provider.client.quoteShipping({
                      recipient: buildRecipient(address),
                      items: fulfillmentItems,
                      currency,
                    }),
                  catch: (error) => {
                    console.error(
                      `[createCheckout] Failed to get shipping rates for ${providerName}:`,
                      error,
                    );
                    return new Error(
                      `Failed to get shipping rates: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  },
                }),
              );

              if (quoteResultOption._tag === "Some") {
                const quoteResult: any = quoteResultOption.value;
                const selectedRate = (quoteResult.rates || [])?.find(
                  (r: any) => r.id === selectedRateId,
                );
                if (selectedRate) {
                  verifiedShippingCost += selectedRate.rate;

                  const providerTax = yield* calculateProviderTax({
                    providerName,
                    providerItems,
                    selectedRateId: selectedRate.id,
                    selectedRateTaxAmount: selectedRate.taxAmount,
                    selectedRateVat: selectedRate.vat,
                    address,
                    currency,
                    mode: 'checkout',
                  });
                  providerTaxResults.push(providerTax);
                  tax += providerTax.taxAmount;
                  vat += providerTax.vat;
                } else {
                  return yield* Effect.fail(
                    new CheckoutError({
                      code: "INVALID_SHIPPING_RATE",
                      provider: providerName,
                      userId,
                      cause: new Error(
                        `Selected shipping rate ${selectedRateId} is no longer available for provider ${providerName}`,
                      ),
                    }),
                  );
                }
              } else {
                return yield* Effect.fail(
                  new CheckoutError({
                    code: "QUOTE_FAILED",
                    provider: providerName,
                    userId,
                    cause: new Error(`Failed to quote shipping for provider ${providerName}`),
                  }),
                );
              }
            }

            const manualItems = itemsByProvider.get("manual") || [];
            if (manualItems.length > 0) {
              verifiedShippingCost += 0;
            }

            let taxRequired: boolean | undefined;
            let taxRate: number | undefined;
            let taxShippingTaxable: boolean | undefined;
            let taxExempt = false;

            if (providerTaxResults.length > 0) {
              taxRequired = providerTaxResults.some((result) => result.required);
              taxRate = totalSubtotal > 0 ? (tax + vat) / totalSubtotal : 0;
              taxShippingTaxable = providerTaxResults.some((result) => result.shippingTaxable);
              taxExempt = providerTaxResults.every((result) => result.exempt);
            }

            const totalAmount =
              totalSubtotal + verifiedShippingCost + tax + vat;

            const allItems = Array.from(itemsByProvider.values()).flat();

            const referralFeeDetails = buildReferralFeeDetails({
              providerItems: allItems,
              userId,
              totalSubtotal,
              totalAmount,
            });

            const orderItems = allItems.map((pi) => {
              const manualNotification = pi.fulfillmentProvider === "manual"
                ? getManualNotificationConfig(pi.metadata)
                : undefined;

              const fulfillmentConfig = manualNotification
                ? {
                    providerName:
                      pi.fulfillmentConfig?.providerName ||
                      pi.fulfillmentProvider ||
                      "manual",
                    providerConfig: {
                      ...((pi.fulfillmentConfig?.providerConfig as Record<string, unknown> | undefined) || {}),
                      manualNotification,
                    },
                    files: pi.fulfillmentConfig?.files || [],
                  }
                : pi.fulfillmentConfig;

              return {
                productId: pi.productId,
                variantId: pi.variantId,
                productName: pi.productTitle,
                quantity: pi.item.quantity,
                unitPrice: pi.price,
                fulfillmentProvider: pi.fulfillmentProvider,
                fulfillmentConfig,
              };
            });

            const order = yield* orderStore.create({
              userId,
              items: orderItems,
              subtotal: totalSubtotal,
              shippingCost: verifiedShippingCost,
              taxAmount: tax,
              vatAmount: vat,
              taxRequired,
              taxRate:
                taxRate !== undefined ? Math.round(taxRate * 10000) : undefined,
              taxShippingTaxable,
              taxExempt,
              customerTaxId: address.taxId,
              totalAmount,
              currency,
              shippingAddress: address,
            });

            const draftOrderIds: Record<string, string> = {};

            for (const [
              providerName,
              providerItems,
            ] of itemsByProvider.entries()) {
              const provider = runtime.getProvider(providerName);
              if (!provider) {
                if (providerName === "manual") {
                  continue;
                }

                return yield* Effect.fail(
                  new Error(`Provider not configured: ${providerName}`),
                );
              }

              const selectedRateId = selectedRates[providerName];
              if (providerName !== 'manual' && !selectedRateId) {
                return yield* Effect.fail(
                  new Error(
                    `No shipping rate selected for provider: ${providerName}`,
                  ),
                );
              }

              const fulfillmentItems = mapToFulfillmentItems(providerItems, selectedRateId);

              const draftOrder = yield* Effect.tryPromise({
                try: () =>
                  provider.client.createOrder({
                    externalId: order.fulfillmentReferenceId || order.id,
                    recipient: buildRecipient(address),
                    items: fulfillmentItems,
                    retailCosts: {
                      currency,
                    },
                  }),
                catch: (error) =>
                  new CheckoutError({
                    code: "DRAFT_ORDER_FAILED",
                    provider: providerName,
                    orderId: order.id,
                    userId,
                    cause: error,
                  }),
              });

              draftOrderIds[providerName] = draftOrder.id;
            }

            const providerName = params.paymentProvider || "stripe";
            const paymentProvider = runtime.getPaymentProvider(providerName);
            if (!paymentProvider) {
              return yield* Effect.fail(
                new Error(`Payment provider '${providerName}' not configured`),
              );
            }

            const lineItems: PaymentLineItem[] = Array.from(
              itemsByProvider.values(),
            )
              .flat()
              .map((pi) => ({
                name: pi.productTitle,
                description: pi.productDescription,
                image: pi.productImage,
                unitAmount: Math.round(pi.price * 100),
                quantity: pi.item.quantity,
              }));

            if (verifiedShippingCost > 0) {
              lineItems.push({
                name: "Shipping",
                unitAmount: Math.round(verifiedShippingCost * 100),
                quantity: 1,
              });
            }

            if (tax > 0) {
              lineItems.push({
                name: "Tax",
                unitAmount: Math.round(tax * 100),
                quantity: 1,
              });
            }

            let fees: FeeConfig[] | undefined;
            if (providerName === "pingpay") {
              const itemsWithFees = allItems.filter(
                (pi) => pi.metadata?.fees && pi.metadata.fees.length > 0,
              );
              const feeMap = new Map<string, FeeConfig>();

              const upsertFee = (fee: FeeConfig) => {
                const key = `${fee.recipient}:${fee.type}:${fee.label}`;
                const existing = feeMap.get(key);

                if (existing) {
                  feeMap.set(key, {
                    ...existing,
                    bps: existing.bps + fee.bps,
                  });
                  return;
                }

                feeMap.set(key, fee);
              };

              if (itemsWithFees.length > 0) {
                for (const pi of itemsWithFees) {
                  for (const fee of pi.metadata!.fees) {
                    upsertFee(fee);
                  }
                }
              }

              const referralFeeAmountByRecipient = new Map<string, number>();
              for (const referralFee of referralFeeDetails) {
                referralFeeAmountByRecipient.set(
                  referralFee.recipient,
                  (referralFeeAmountByRecipient.get(referralFee.recipient) ?? 0) +
                    referralFee.feeAmount,
                );
              }

              for (const [recipient, feeAmount] of referralFeeAmountByRecipient.entries()) {
                const effectiveBps =
                  totalAmount > 0 ? Math.round((feeAmount / totalAmount) * 10000) : 0;

                if (effectiveBps <= 0) {
                  continue;
                }

                upsertFee({
                  type: "affiliate",
                  label: "Referral",
                  recipient,
                  bps: effectiveBps,
                });
              }

              fees = Array.from(feeMap.values());
            }

            const paymentRequest = {
              orderId: order.id,
              amount: Math.round(totalAmount * 100),
              currency,
              items: lineItems,
              successUrl,
              cancelUrl,
              fees,
            };

            const checkout = yield* Effect.tryPromise({
              try: () => paymentProvider.client.createCheckout(paymentRequest),
              catch: (error) => {
                console.error(
                  `[Checkout] Payment provider '${providerName}' createCheckout failed:`,
                  error,
                );
                return new CheckoutError({
                  code: "PAYMENT_CHECKOUT_FAILED",
                  orderId: order.id,
                  userId,
                  cause: error,
                });
              },
            });

            yield* orderStore.updatePaymentDetails(order.id, {
              provider: providerName,
              request: paymentRequest,
              referral:
                referralFeeDetails.length > 0
                  ? {
                      items: referralFeeDetails,
                    }
                  : undefined,
              response: {
                sessionId: checkout.sessionId,
                url: checkout.url,
              },
              createdAt: new Date().toISOString(),
            });

            yield* orderStore.updateCheckout(
              order.id,
              checkout.sessionId,
              providerName,
            );

            yield* orderStore.updateDraftOrderIds(order.id, draftOrderIds);

            yield* orderStore.updateStatus(order.id, "draft_created");

            return {
              orderId: order.id,
              checkoutSessionId: checkout.sessionId,
              checkoutUrl: checkout.url,
              draftOrderIds,
            };
          }),
      };
    }),
  );
