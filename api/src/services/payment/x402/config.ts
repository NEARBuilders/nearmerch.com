import { timingSafeEqual } from "node:crypto";

export const X402_HOST_SECRET_HEADER = "x-x402-host-secret";

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
