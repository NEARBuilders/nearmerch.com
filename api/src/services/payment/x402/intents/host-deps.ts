import {
  getX402IntentsFacilitatorApiKey,
  getX402IntentsFacilitatorUrl,
  getX402IntentsFeeMode,
  getX402IntentsOrigins,
  isX402IntentsActive,
} from "../config";
import { createX402IntentsHttpFacilitator } from "./facilitator";
import type { X402IntentsFacilitator, X402IntentsPayDeps } from "./types";

/** The host-only API procedures the intents path calls (host-secret client). */
export type X402IntentsPluginClient = {
  getX402IntentsOrder: (input: { orderId: string }) => Promise<unknown>;
  recordX402IntentsQuote: (input: unknown) => Promise<unknown>;
  getX402IntentsOperation: (input: { operationKey: string }) => Promise<unknown>;
  settleX402IntentsOperation: (input: unknown) => Promise<unknown>;
  failX402IntentsOperation: (input: unknown) => Promise<unknown>;
};

/**
 * Build the near-intents deps for createX402PayApp, or null when the path is
 * not fully configured (see getX402IntentsInactiveReason). Recorded operations
 * settle with the facilitator that quoted them; the API key is only sent to
 * the configured facilitator URL.
 */
export function createX402IntentsPayDeps(
  client: X402IntentsPluginClient,
  options: { fetch?: typeof fetch } = {},
): X402IntentsPayDeps | null {
  if (!isX402IntentsActive()) return null;

  const facilitatorUrl = getX402IntentsFacilitatorUrl()!;
  const apiKey = getX402IntentsFacilitatorApiKey();
  const facilitators = new Map<string, X402IntentsFacilitator>();

  return {
    facilitatorUrl,
    getFacilitator: (url) => {
      let facilitator = facilitators.get(url);
      if (!facilitator) {
        facilitator = createX402IntentsHttpFacilitator({
          url,
          apiKey: url === facilitatorUrl ? apiKey : undefined,
          fetch: options.fetch,
        });
        facilitators.set(url, facilitator);
      }
      return facilitator;
    },
    origins: getX402IntentsOrigins().origins,
    feeMode: getX402IntentsFeeMode(),
    getOrderContext: (orderId) =>
      client.getX402IntentsOrder({ orderId }) as ReturnType<X402IntentsPayDeps["getOrderContext"]>,
    recordQuote: (input) =>
      client.recordX402IntentsQuote(input) as ReturnType<X402IntentsPayDeps["recordQuote"]>,
    getOperation: (operationKey) =>
      client.getX402IntentsOperation({ operationKey }) as ReturnType<
        X402IntentsPayDeps["getOperation"]
      >,
    settleOperation: (input) =>
      client.settleX402IntentsOperation(input) as ReturnType<
        X402IntentsPayDeps["settleOperation"]
      >,
    failOperation: (input) =>
      client.failX402IntentsOperation(input) as ReturnType<X402IntentsPayDeps["failOperation"]>,
  };
}
