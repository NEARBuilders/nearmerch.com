import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { X402IntentsFacilitator } from "./types";

const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;
/** Settle can wait on the swap; the facilitator answers settlement_pending when it gives up. */
const DEFAULT_SETTLE_TIMEOUT_MS = 120_000;

export type X402IntentsHttpFacilitatorOptions = {
  url: string;
  apiKey?: string;
  fetch?: typeof fetch;
  verifyTimeoutMs?: number;
  settleTimeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Minimal HTTP client for a near-intents facilitator (`/verify`, `/settle`).
 * Unlike HTTPFacilitatorClient it keeps the full response (`extra`, `network`,
 * `amount`) on non-2xx replies, which the intents flow needs for refund and
 * pending receipts.
 */
export function createX402IntentsHttpFacilitator(
  options: X402IntentsHttpFacilitatorOptions,
): X402IntentsFacilitator {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;

  const post = async (
    path: "verify" | "settle",
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    const response = await fetchImpl(`${baseUrl}/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Intents facilitator ${path} failed (${response.status})`);
    }

    if (!isRecord(data)) {
      throw new Error(`Intents facilitator ${path} returned an invalid body (${response.status})`);
    }

    return data;
  };

  return {
    async verify(paymentPayload, paymentRequirements) {
      const data = await post(
        "verify",
        paymentPayload,
        paymentRequirements,
        options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
      );
      if (typeof data.isValid !== "boolean") {
        throw new Error("Intents facilitator verify returned no isValid");
      }
      return data as unknown as VerifyResponse;
    },

    async settle(paymentPayload, paymentRequirements) {
      const data = await post(
        "settle",
        paymentPayload,
        paymentRequirements,
        options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS,
      );
      if (typeof data.success !== "boolean") {
        throw new Error("Intents facilitator settle returned no success flag");
      }
      return data as unknown as SettleResponse;
    },
  };
}
