import { timingSafeEqual } from "node:crypto";
import {
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
