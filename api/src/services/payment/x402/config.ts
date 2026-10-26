import { timingSafeEqual } from "node:crypto";
import { z } from "every-plugin/zod";
import {
  X402_INTENTS_DEFAULT_MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  X402_NETWORK_MAINNET,
  X402_NETWORK_SEPOLIA,
  X402_USDC_BASE_MAINNET,
  X402_USDC_BASE_SEPOLIA,
  X402_USDC_EXTRA_MAINNET,
  X402_USDC_EXTRA_SEPOLIA,
} from "./constants";

export const X402_HOST_SECRET_HEADER = "x-x402-host-secret";

const NETWORK_CONFIG = {
  [X402_NETWORK_MAINNET]: {
    asset: X402_USDC_BASE_MAINNET,
    extra: X402_USDC_EXTRA_MAINNET,
  },
  [X402_NETWORK_SEPOLIA]: {
    asset: X402_USDC_BASE_SEPOLIA,
    extra: X402_USDC_EXTRA_SEPOLIA,
  },
} as const;

export type X402NetworkId = keyof typeof NETWORK_CONFIG;

export function getX402Network(): X402NetworkId {
  const value = process.env.X402_NETWORK?.trim();
  if (value === X402_NETWORK_SEPOLIA || value === X402_NETWORK_MAINNET) {
    return value;
  }
  return X402_NETWORK;
}

export function getX402UsdcAddress(): string {
  return NETWORK_CONFIG[getX402Network()].asset;
}

export function getX402UsdcExtra(): {
  assetTransferMethod: "eip3009";
  name: string;
  version: string;
} {
  return { ...NETWORK_CONFIG[getX402Network()].extra };
}

export function isX402Enabled(): boolean {
  const value = process.env.X402_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export function getX402PayToAddress(): string | undefined {
  const value = process.env.X402_PAY_TO_ADDRESS?.trim();
  return value || undefined;
}

export function getX402FacilitatorUrl(): string | undefined {
  const value = process.env.X402_FACILITATOR_URL?.trim();
  return value || undefined;
}

export function getX402HostSecret(): string | undefined {
  const value = process.env.X402_HOST_SECRET?.trim();
  return value || undefined;
}

export function x402HostSecretMatches(reqHeaders?: Headers): boolean {
  const expected = getX402HostSecret();
  const provided = reqHeaders?.get(X402_HOST_SECRET_HEADER)?.trim();
  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/** Phase 2 near-intents upfront path (issue #238). Off unless explicitly enabled. */
export function isX402IntentsEnabled(): boolean {
  return isTruthyEnv(process.env.X402_INTENTS_ENABLED);
}

export function getX402IntentsFacilitatorUrl(): string | undefined {
  const value = process.env.X402_INTENTS_FACILITATOR_URL?.trim();
  return value || undefined;
}

export function getX402IntentsFacilitatorApiKey(): string | undefined {
  const value = process.env.X402_INTENTS_FACILITATOR_API_KEY?.trim();
  return value || undefined;
}

export type X402IntentsFeeMode = "out_of_band" | "app_fees";

/**
 * How royalty/affiliate splits are settled on intents payments.
 * - out_of_band (default): merchant receives the full total on Base; splits are
 *   recorded on the order for reconciliation, exactly like Phase 1.
 * - app_fees: splits are passed as 1Click appFees (bps of amountIn) and the
 *   destination amount is reduced by the same amounts. Requires a facilitator
 *   that forwards `extra.appFees`; falls back to out_of_band when the split
 *   cannot be expressed as appFees (cap, recipient format).
 */
export function getX402IntentsFeeMode(): X402IntentsFeeMode {
  const value = process.env.X402_INTENTS_FEE_MODE?.trim().toLowerCase();
  return value === "app_fees" ? "app_fees" : "out_of_band";
}

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

export const X402IntentsOriginSchema = z.object({
  network: z.string().regex(CAIP2_PATTERN),
  asset: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
  maxTimeoutSeconds: z
    .number()
    .int()
    .positive()
    .default(X402_INTENTS_DEFAULT_MAX_TIMEOUT_SECONDS),
  /** USD-pegged stablecoin: indicativeAmount is derived from the USD total. */
  usdPegged: z.boolean().default(false),
});

export type X402IntentsOrigin = z.infer<typeof X402IntentsOriginSchema>;

export type X402IntentsOriginsResult = {
  origins: X402IntentsOrigin[];
  errors: string[];
};

function isBaseUsdcOrigin(origin: X402IntentsOrigin): boolean {
  return (
    origin.network === X402_NETWORK_MAINNET &&
    origin.asset.toLowerCase() === X402_USDC_BASE_MAINNET.toLowerCase()
  );
}

/**
 * X402_INTENTS_ORIGINS: JSON array of origins offered as near-intents entries,
 * e.g. [{"network":"eip155:42161","asset":"0xaf88…5831","decimals":6,"maxTimeoutSeconds":300,"usdPegged":true}].
 * Base USDC is never an origin (Phase 1 exact covers it). Origins without a
 * price source (usdPegged=false) are skipped: indicativeAmount can't be derived.
 */
export function getX402IntentsOrigins(): X402IntentsOriginsResult {
  const raw = process.env.X402_INTENTS_ORIGINS?.trim();
  if (!raw) {
    return { origins: [], errors: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { origins: [], errors: ["X402_INTENTS_ORIGINS is not valid JSON"] };
  }

  if (!Array.isArray(parsed)) {
    return { origins: [], errors: ["X402_INTENTS_ORIGINS must be a JSON array"] };
  }

  const origins: X402IntentsOrigin[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  parsed.forEach((entry, index) => {
    const result = X402IntentsOriginSchema.safeParse(entry);
    if (!result.success) {
      errors.push(`X402_INTENTS_ORIGINS[${index}] is invalid`);
      return;
    }

    const origin = result.data;
    if (isBaseUsdcOrigin(origin)) {
      errors.push(`X402_INTENTS_ORIGINS[${index}] is Base USDC (served by Phase 1 exact)`);
      return;
    }

    if (!origin.usdPegged) {
      errors.push(`X402_INTENTS_ORIGINS[${index}] has no indicative price source (usdPegged=false)`);
      return;
    }

    const key = `${origin.network}:${origin.asset.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`X402_INTENTS_ORIGINS[${index}] duplicates ${origin.network} ${origin.asset}`);
      return;
    }
    seen.add(key);
    origins.push(origin);
  });

  return { origins, errors };
}

/**
 * Why the intents path is inactive, or null when it is fully configured.
 * Requires the Phase 1 config (X402_ENABLED, pay-to, host secret) and Base
 * mainnet: there is no near-intents testnet (ADR 0001).
 */
export function getX402IntentsInactiveReason(): string | null {
  if (!isX402IntentsEnabled()) return "X402_INTENTS_ENABLED is off";
  if (!isX402Enabled()) return "X402_ENABLED is off";
  if (!getX402PayToAddress()) return "X402_PAY_TO_ADDRESS is missing";
  if (!getX402HostSecret()) return "X402_HOST_SECRET is missing";
  if (getX402Network() !== X402_NETWORK_MAINNET) {
    return "near-intents requires X402_NETWORK=eip155:8453 (no intents testnet)";
  }
  if (!getX402IntentsFacilitatorUrl()) return "X402_INTENTS_FACILITATOR_URL is missing";
  if (getX402IntentsOrigins().origins.length === 0) {
    return "X402_INTENTS_ORIGINS has no usable origin";
  }
  return null;
}

export function isX402IntentsActive(): boolean {
  return getX402IntentsInactiveReason() === null;
}
