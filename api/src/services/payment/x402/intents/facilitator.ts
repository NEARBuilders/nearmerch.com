import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { X402_INTENTS_OFFERS_CACHE_MS } from "../constants";
import { normalizeX402IntentsOffer } from "./requirements";
import type { X402IntentsFacilitator } from "./types";

const DEFAULT_OFFERS_TIMEOUT_MS = 15_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;
/** Settle can wait on the swap; Ping answers settlement_pending when it gives up. */
const DEFAULT_SETTLE_TIMEOUT_MS = 120_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 10_000;

export type X402IntentsHttpFacilitatorOptions = {
  url: string;
  /** Sent as `X-Api-Key` (Ping Agent Pay). */
  apiKey?: string;
  fetch?: typeof fetch;
  offersTimeoutMs?: number;
  verifyTimeoutMs?: number;
  settleTimeoutMs?: number;
  offersCacheMs?: number;
  now?: () => number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(data: Record<string, unknown>): string | undefined {
  for (const key of ["errorReason", "invalidReason", "code", "error"] as const) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Error from the facilitator that a retry may fix (transport, 5xx, bad body). */
export class X402IntentsFacilitatorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402IntentsFacilitatorUnavailableError";
  }
}

/**
 * HTTP client for Ping Agent Pay's x402 facilitator (`/offers`, `/verify`,
 * `/settle`, `/execution`), which follows x402 #3370 for near-intents.
 * Unlike HTTPFacilitatorClient it keeps the full response (`extra`, `network`,
 * `amount`) on 4xx replies (e.g. a terminal 402), which the intents flow needs
 * for refund and pending receipts. 5xx (Ping documents 503/504 as transient)
 * and non-JSON bodies throw so the caller changes nothing and the client retries.
 */
export function createX402IntentsHttpFacilitator(
  options: X402IntentsHttpFacilitatorOptions,
): X402IntentsFacilitator {
  const baseUrl = options.url.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cacheMs = options.offersCacheMs ?? X402_INTENTS_OFFERS_CACHE_MS;
  const offersCache = new Map<string, { at: number; offers: PaymentRequirements[] }>();

  const headers = (json: boolean): Record<string, string> => {
    const result: Record<string, string> = {};
    if (json) result["Content-Type"] = "application/json";
    if (options.apiKey) result["X-Api-Key"] = options.apiKey;
    return result;
  };

  const readJson = async (response: Response, path: string): Promise<Record<string, unknown>> => {
    if (response.status >= 500) {
      throw new X402IntentsFacilitatorUnavailableError(
        `Intents facilitator ${path} unavailable (${response.status})`,
      );
    }
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new X402IntentsFacilitatorUnavailableError(
        `Intents facilitator ${path} failed (${response.status})`,
      );
    }
    if (!isRecord(data)) {
      throw new X402IntentsFacilitatorUnavailableError(
        `Intents facilitator ${path} returned an invalid body (${response.status})`,
      );
    }
    return data;
  };

  const post = async (
    path: "verify" | "settle",
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> => {
    const response = await fetchImpl(`${baseUrl}/${path}`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        x402Version: paymentPayload.x402Version,
        paymentPayload,
        paymentRequirements,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return readJson(response, path);
  };

  return {
    async offers(amountOut) {
      const cached = offersCache.get(amountOut);
      if (cached && now() - cached.at < cacheMs) return cached.offers;

      const url = new URL(`${baseUrl}/offers`);
      url.searchParams.set("amountOut", amountOut);
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: headers(false),
        signal: AbortSignal.timeout(options.offersTimeoutMs ?? DEFAULT_OFFERS_TIMEOUT_MS),
      });
      if (!response.ok) {
        // 400 agent_pay_misconfigured / 403 agent_pay_disabled / 401 bad key.
        let code: string | undefined;
        try {
          const body = (await response.json()) as unknown;
          code = isRecord(body) ? errorCode(body) : undefined;
        } catch {
          // keep the status only
        }
        throw new X402IntentsFacilitatorUnavailableError(
          `Intents facilitator offers failed (${response.status}${code ? ` ${code.slice(0, 120)}` : ""})`,
        );
      }
      const data = await readJson(response, "offers");
      const accepts = Array.isArray(data.accepts) ? data.accepts : [];
      const offers = accepts
        .map((entry) => normalizeX402IntentsOffer(entry, amountOut))
        .filter((entry): entry is PaymentRequirements => entry !== undefined);

      offersCache.set(amountOut, { at: now(), offers });
      if (offersCache.size > 256) {
        for (const [key, value] of offersCache) {
          if (now() - value.at >= cacheMs) offersCache.delete(key);
        }
      }
      return offers;
    },

    async verify(paymentPayload, paymentRequirements) {
      const data = await post(
        "verify",
        paymentPayload,
        paymentRequirements,
        options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
      );
      if (typeof data.isValid !== "boolean") {
        // Ping answers config/refund errors as { error, code } (e.g. 400
        // refund_address_required, agent_pay_misconfigured, 403 agent_pay_disabled).
        const reason = errorCode(data);
        if (!reason) {
          throw new X402IntentsFacilitatorUnavailableError(
            "Intents facilitator verify returned no isValid",
          );
        }
        return { isValid: false, invalidReason: reason } as VerifyResponse;
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
        const reason = errorCode(data);
        if (!reason) {
          throw new X402IntentsFacilitatorUnavailableError(
            "Intents facilitator settle returned no success flag",
          );
        }
        return {
          success: false,
          errorReason: reason,
          transaction: "",
          network: paymentRequirements.network,
        } as SettleResponse;
      }
      return data as unknown as SettleResponse;
    },

    async claimExecution(depositAddress) {
      const response = await fetchImpl(`${baseUrl}/execution`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ depositAddress }),
        signal: AbortSignal.timeout(DEFAULT_EXECUTION_TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 405) return undefined;
      try {
        const data = (await response.json()) as { execute?: unknown };
        return response.ok && data.execute === true;
      } catch {
        return false;
      }
    },
  };
}
