import { timingSafeEqual } from "node:crypto";
import { z } from "every-plugin/zod";
import {
  X402_INTENTS_DEFAULT_FACILITATOR_URL,
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

function isFalsyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off";
}

/**
 * Near-intents path (issue #238). On by default, but nothing x402 is mounted
 * unless X402_ENABLED (the master switch) is also on.
 */
export function isX402IntentsEnabled(): boolean {
  return !isFalsyEnv(process.env.X402_INTENTS_ENABLED);
}

/** Facilitator base URL; defaults to Ping Agent Pay (production). */
export function getX402IntentsFacilitatorUrl(): string {
  const value = process.env.X402_INTENTS_FACILITATOR_URL?.trim();
  return (value || X402_INTENTS_DEFAULT_FACILITATOR_URL).replace(/\/+$/, "");
}

function isPingFacilitatorUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "pingpay.io" || host.endsWith(".pingpay.io");
  } catch {
    return false;
  }
}

/**
 * API key sent as X-Api-Key. X402_INTENTS_FACILITATOR_API_KEY wins; otherwise
 * the Ping checkout key (PING_API_KEY, same organization) is reused, but only
 * when the facilitator is a Ping host so it is never sent anywhere else.
 */
export function getX402IntentsFacilitatorApiKey(): string | undefined {
  const value = process.env.X402_INTENTS_FACILITATOR_API_KEY?.trim();
  if (value) return value;
  const ping = process.env.PING_API_KEY?.trim();
  return ping && isPingFacilitatorUrl(getX402IntentsFacilitatorUrl()) ? ping : undefined;
}

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

/** One allow-list entry: a CAIP-2 network, optionally narrowed to one asset. */
export const X402IntentsOriginSchema = z.union([
  z.string().regex(CAIP2_PATTERN).transform((network) => ({ network })),
  z.object({
    network: z.string().regex(CAIP2_PATTERN),
    asset: z.string().min(1).optional(),
  }),
]);

export type X402IntentsOrigin = { network: string; asset?: string };

export type X402IntentsOriginsResult = {
  /** undefined: offer every origin the facilitator returns. */
  origins: X402IntentsOrigin[] | undefined;
  errors: string[];
};

/**
 * X402_INTENTS_ORIGINS (optional): allow-list over the origins the facilitator
 * offers, e.g. ["eip155:8453", {"network":"eip155:42161","asset":"0xaf88…5831"}].
 * Unset: every origin Ping offers. Set but with no valid entry: none (fail closed).
 */
export function getX402IntentsOrigins(): X402IntentsOriginsResult {
  const raw = process.env.X402_INTENTS_ORIGINS?.trim();
  if (!raw) {
    return { origins: undefined, errors: [] };
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
    const data: X402IntentsOrigin = result.data;
    const origin: X402IntentsOrigin = data.asset
      ? { network: data.network, asset: data.asset }
      : { network: data.network };
    const key = `${origin.network}:${origin.asset?.toLowerCase() ?? "*"}`;
    if (seen.has(key)) {
      errors.push(`X402_INTENTS_ORIGINS[${index}] is a duplicate`);
      return;
    }
    seen.add(key);
    origins.push(origin);
  });

  return { origins, errors };
}

/**
 * Flags and host secret only (no facilitator key): what the API needs to accept
 * x402 orders that only the intents path can pay.
 */
export function isX402IntentsConfigured(): boolean {
  return isX402Enabled() && isX402IntentsEnabled() && Boolean(getX402HostSecret());
}

/** Why the intents path is inactive, or null when it can be mounted. */
export function getX402IntentsInactiveReason(): string | null {
  if (!isX402Enabled()) return "X402_ENABLED is off";
  if (!isX402IntentsEnabled()) return "X402_INTENTS_ENABLED is off";
  if (!getX402HostSecret()) return "X402_HOST_SECRET is missing";
  if (!getX402IntentsFacilitatorApiKey()) {
    return "X402_INTENTS_FACILITATOR_API_KEY (or PING_API_KEY) is missing";
  }
  const { origins } = getX402IntentsOrigins();
  if (origins && origins.length === 0) {
    return "X402_INTENTS_ORIGINS has no usable origin";
  }
  return null;
}

export function isX402IntentsActive(): boolean {
  return getX402IntentsInactiveReason() === null;
}

/**
 * Why an x402 order can't be created, or null. Base `exact` needs
 * X402_PAY_TO_ADDRESS; without it the intents path must be active (same check
 * the host uses to mount POST /orders/:id/pay), so checkout never creates an
 * order the pay route can't serve (e.g. facilitator key missing).
 */
export function getX402CheckoutUnavailableReason(): string | null {
  if (!isX402Enabled()) return "x402 payments are not enabled";
  if (!getX402PayToAddress()) {
    const inactive = getX402IntentsInactiveReason();
    if (inactive) {
      return `x402 pay-to address is not configured and near-intents is off (${inactive})`;
    }
  }
  return null;
}
