import type { PaymentRequirements } from "@x402/core/types";
import type { X402IntentsOrigin } from "../config";
import {
  X402_INTENTS_ASSET_TRANSFER_METHOD,
  X402_INTENTS_PAYMENT_FLOW,
  X402_SCHEME,
} from "../constants";
import type { X402IntentsQuoteExtra } from "./schema";
import type { X402IntentsDestination, X402IntentsFeePlan } from "./types";

/** Destination USDC on Base uses 6 decimals. */
const DESTINATION_DECIMALS = 6;

export function isX402IntentsRequirements(
  requirements: { extra?: Record<string, unknown> } | undefined,
): boolean {
  return requirements?.extra?.assetTransferMethod === X402_INTENTS_ASSET_TRANSFER_METHOD;
}

/** Records are keyed by network:depositAddress[:memo] (spec #3370). */
export function x402IntentsOperationKey(
  network: string,
  depositAddress: string,
  depositMemo?: string | null,
): string {
  const base = `${network}:${depositAddress}`;
  return depositMemo ? `${base}:${depositMemo}` : base;
}

/**
 * Indicative origin amount for a USD-pegged origin: the order total (6-decimal
 * USDC) rescaled to the origin's decimals, rounded up. The binding amount is
 * the quoted amountIn.
 */
export function x402IntentsIndicativeAmount(
  totalAmount: string,
  originDecimals: number,
): string {
  const total = BigInt(totalAmount);
  if (originDecimals >= DESTINATION_DECIMALS) {
    return (total * 10n ** BigInt(originDecimals - DESTINATION_DECIMALS)).toString();
  }
  const divisor = 10n ** BigInt(DESTINATION_DECIMALS - originDecimals);
  return ((total + divisor - 1n) / divisor).toString();
}

export function originMatches(
  origin: X402IntentsOrigin,
  network: string,
  asset: string,
): boolean {
  if (origin.network !== network) return false;
  return network.startsWith("eip155:")
    ? origin.asset.toLowerCase() === asset.toLowerCase()
    : origin.asset === asset;
}

/** Unquoted 402 entry: amount and payTo empty until the facilitator quotes. */
export function buildX402IntentsUnquotedEntry(input: {
  origin: X402IntentsOrigin;
  destination: X402IntentsDestination;
  feePlan: X402IntentsFeePlan;
}): PaymentRequirements {
  const { origin, destination, feePlan } = input;
  return {
    scheme: X402_SCHEME,
    network: origin.network as PaymentRequirements["network"],
    amount: "",
    asset: origin.asset,
    payTo: "",
    maxTimeoutSeconds: origin.maxTimeoutSeconds,
    extra: {
      assetTransferMethod: X402_INTENTS_ASSET_TRANSFER_METHOD,
      paymentFlow: X402_INTENTS_PAYMENT_FLOW,
      indicativeAmount: x402IntentsIndicativeAmount(feePlan.totalAmount, origin.decimals),
      destination,
      ...(feePlan.mode === "app_fees" && feePlan.appFees
        ? { appFees: feePlan.appFees }
        : {}),
    },
  };
}

/** Quoted entry returned in the second 402 (payTo = deposit address, amount = amountIn). */
export function buildX402IntentsQuotedEntry(
  unquoted: PaymentRequirements,
  quote: X402IntentsQuoteExtra,
): PaymentRequirements {
  return {
    ...unquoted,
    amount: quote.amountIn,
    payTo: quote.depositAddress,
    extra: {
      ...unquoted.extra,
      refundDeadline: quote.refundDeadline,
      operationToken: quote.operationToken,
      ...(quote.depositMemo ? { depositMemo: quote.depositMemo } : {}),
    },
  };
}
