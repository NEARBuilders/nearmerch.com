import type { PaymentRequirements } from "@x402/core/types";
import type { X402IntentsOrigin } from "../config";
import {
  X402_INTENTS_ASSET_TRANSFER_METHOD,
  X402_INTENTS_DEFAULT_MAX_TIMEOUT_SECONDS,
  X402_INTENTS_PAYMENT_FLOW,
  X402_SCHEME,
} from "../constants";
import type { X402IntentsQuoteExtra } from "./schema";
import type { X402IntentsDestination } from "./types";

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

function sameAsset(network: string, a: string, b: string): boolean {
  return network.startsWith("eip155:") ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Whether an origin (network + asset) passes the X402_INTENTS_ORIGINS allow-list. */
export function originAllowed(
  allowList: ReadonlyArray<X402IntentsOrigin> | undefined,
  network: string,
  asset: string,
): boolean {
  if (!allowList) return true;
  return allowList.some(
    (origin) =>
      origin.network === network &&
      (origin.asset === undefined || sameAsset(network, origin.asset, asset)),
  );
}

/** The offer entry a client picked, matched by origin network and asset. */
export function findOffer(
  offers: ReadonlyArray<PaymentRequirements>,
  network: string,
  asset: string,
): PaymentRequirements | undefined {
  return offers.find(
    (offer) => offer.network === network && sameAsset(network, offer.asset, asset),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function readX402IntentsDestination(
  requirements: { extra?: Record<string, unknown> } | undefined,
): X402IntentsDestination | undefined {
  const destination = requirements?.extra?.destination;
  if (!isRecord(destination)) return undefined;
  const { network, asset, amount, recipient } = destination;
  if (
    !nonEmptyString(network) ||
    !nonEmptyString(asset) ||
    !nonEmptyString(amount) ||
    !nonEmptyString(recipient)
  ) {
    return undefined;
  }
  return { network, asset, amount, recipient };
}

/**
 * Normalise one entry of the facilitator's unquoted `accepts[]`, or undefined
 * when it is not a usable near-intents offer for `amountOut`. The destination
 * (asset, recipient) comes from the facilitator, i.e. the Ping dashboard, and
 * must be for exactly `amountOut`.
 */
export function normalizeX402IntentsOffer(
  entry: unknown,
  amountOut: string,
): PaymentRequirements | undefined {
  if (!isRecord(entry) || !isRecord(entry.extra)) return undefined;
  if (entry.scheme !== X402_SCHEME) return undefined;
  if (!nonEmptyString(entry.network) || !nonEmptyString(entry.asset)) return undefined;
  if (entry.extra.assetTransferMethod !== X402_INTENTS_ASSET_TRANSFER_METHOD) return undefined;
  const destination = readX402IntentsDestination(entry as { extra: Record<string, unknown> });
  if (!destination || destination.amount !== amountOut) return undefined;

  const timeout = entry.maxTimeoutSeconds;
  const { description: _description, ...rest } = entry;
  return {
    ...rest,
    scheme: X402_SCHEME,
    network: entry.network as PaymentRequirements["network"],
    asset: entry.asset,
    amount: "",
    payTo: "",
    maxTimeoutSeconds:
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0
        ? timeout
        : X402_INTENTS_DEFAULT_MAX_TIMEOUT_SECONDS,
    extra: {
      ...entry.extra,
      paymentFlow: X402_INTENTS_PAYMENT_FLOW,
    },
  } as PaymentRequirements;
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

/**
 * Requirements for `/settle`: the recorded unquoted entry (our destination
 * terms, never the client's) with the quoted instrument the client echoes
 * back, like @pingpay/agentpay-middleware sends.
 */
export function buildX402IntentsSettleRequirements(
  recorded: PaymentRequirements,
  accepted: PaymentRequirements,
  depositAddress: string,
): PaymentRequirements {
  const echoed = isRecord(accepted.extra) ? accepted.extra : {};
  const instrument: Record<string, unknown> = {};
  for (const key of ["refundDeadline", "operationToken", "depositMemo"] as const) {
    if (nonEmptyString(echoed[key])) instrument[key] = echoed[key];
  }
  return {
    ...recorded,
    amount: nonEmptyString(accepted.amount) ? accepted.amount : recorded.amount,
    payTo: depositAddress,
    extra: { ...recorded.extra, ...instrument },
  };
}
