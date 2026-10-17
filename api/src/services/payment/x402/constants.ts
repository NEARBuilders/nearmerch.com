/** Base mainnet (CAIP-2). */
export const X402_NETWORK = "eip155:8453" as const;

/** USDC on Base. */
export const X402_USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const X402_SCHEME = "exact" as const;

/** Quote-style validity for a 402 challenge (no separate quote TTL in checkout). */
export const X402_MAX_TIMEOUT_SECONDS = 900;

export const X402_PAY_PATH_PATTERN = "POST /orders/:id/pay";
