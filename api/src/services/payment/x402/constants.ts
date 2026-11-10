/** Base mainnet (CAIP-2). */
export const X402_NETWORK_MAINNET = "eip155:8453" as const;

/** Base Sepolia (CAIP-2). Public x402.org facilitator supports this, not mainnet. */
export const X402_NETWORK_SEPOLIA = "eip155:84532" as const;

/** Default advertised network (mainnet). Override with X402_NETWORK. */
export const X402_NETWORK = X402_NETWORK_MAINNET;

/** USDC on Base mainnet. */
export const X402_USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** USDC on Base Sepolia. */
export const X402_USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Default USDC asset (mainnet). */
export const X402_USDC_BASE = X402_USDC_BASE_MAINNET;

export const X402_SCHEME = "exact" as const;

export const X402_ASSET_TRANSFER_METHOD = "eip3009" as const;

/**
 * EIP-712 domain for native USDC on Base. Required in `accepts[].extra` so
 * agents can sign EIP-3009 `transferWithAuthorization` (scheme_exact_evm.md).
 * Name is "USD Coin" on Base mainnet, not "USDC" (that name is Base Sepolia).
 */
export const X402_USDC_EXTRA_MAINNET = {
  assetTransferMethod: X402_ASSET_TRANSFER_METHOD,
  name: "USD Coin",
  version: "2",
} as const;

export const X402_USDC_EXTRA_SEPOLIA = {
  assetTransferMethod: X402_ASSET_TRANSFER_METHOD,
  name: "USDC",
  version: "2",
} as const;

export const X402_USDC_EXTRA = X402_USDC_EXTRA_MAINNET;

/** Quote-style validity for a 402 challenge (no separate quote TTL in checkout). */
export const X402_MAX_TIMEOUT_SECONDS = 900;

export const X402_PAY_PATH_PATTERN = "POST /orders/:id/pay";

/** `extra.assetTransferMethod` for the near-intents upfront path (x402 #3370). */
export const X402_INTENTS_ASSET_TRANSFER_METHOD = "near-intents" as const;

export const X402_INTENTS_PAYMENT_FLOW = "upfront" as const;

/**
 * A recorded intents operation stays redeemable until its refundDeadline plus
 * this grace window, so a delayed `settlement_pending` retry is never stranded
 * by the 900 s Phase 1 quote window (ADR 0001).
 */
export const X402_INTENTS_OPERATION_GRACE_SECONDS = 24 * 60 * 60;

/** `maxTimeoutSeconds` for an offer entry that omits it. */
export const X402_INTENTS_DEFAULT_MAX_TIMEOUT_SECONDS = 3600;

/** Ping Agent Pay x402 facilitator (production). Staging: https://staging.pingpay.io/agentpay/x402 */
export const X402_INTENTS_DEFAULT_FACILITATOR_URL = "https://pay.pingpay.io/agentpay/x402";

/** Unquoted offers are cached per amountOut for this long (they carry no deposit address). */
export const X402_INTENTS_OFFERS_CACHE_MS = 60 * 1000;

/** Receipt network when Ping settles through NEAR Intents (NEAR tx hash). */
export const X402_INTENTS_NEAR_MAINNET = "near:mainnet" as const;

/** 1Click status for a short deposit: top up the same address and retry settle. */
export const X402_INTENTS_INCOMPLETE_DEPOSIT = "INCOMPLETE_DEPOSIT" as const;

/** Quote requests allowed per order per window (each quote mints a deposit address). */
export const X402_INTENTS_QUOTE_RATE_LIMIT = 10;
export const X402_INTENTS_QUOTE_RATE_WINDOW_MS = 10 * 60 * 1000;

export const X402_INTENTS_ERRORS = {
  settlementPending: "settlement_pending",
  quoteUnavailable: "invalid_exact_near_intents_quote_unavailable",
  tokenInvalid: "invalid_exact_near_intents_token_invalid",
  tokenExpired: "invalid_exact_near_intents_token_expired",
  quoteMismatch: "invalid_exact_near_intents_quote_mismatch",
  depositNotFound: "invalid_exact_near_intents_deposit_not_found",
  paymentFailed: "exact_near_intents_payment_failed",
  insufficientDeposit: "exact_near_intents_insufficient_deposit",
  operationExecuted: "exact_near_intents_operation_executed",
} as const;

/** Settle failures that are terminal for the order (payment_failed). */
export const X402_INTENTS_TERMINAL_SETTLE_ERRORS: ReadonlySet<string> = new Set([
  X402_INTENTS_ERRORS.paymentFailed,
  X402_INTENTS_ERRORS.insufficientDeposit,
]);
