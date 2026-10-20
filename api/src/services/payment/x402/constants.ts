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
