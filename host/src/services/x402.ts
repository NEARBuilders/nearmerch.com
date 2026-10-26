import type { Hono } from "hono";
import { createX402PayApp } from "../../../api/src/services/payment/x402/pay-app.ts";
import {
  getX402FacilitatorUrl,
  getX402HostSecret,
  getX402Network,
  getX402PayToAddress,
  isX402Enabled,
  getX402IntentsInactiveReason,
  isX402IntentsEnabled,
  X402_HOST_SECRET_HEADER,
} from "../../../api/src/services/payment/x402/config.ts";
import {
  createX402IntentsPayDeps,
  type X402IntentsPluginClient,
} from "../../../api/src/services/payment/x402/intents/host-deps.ts";
import type { PluginResult } from "./plugins";
import { logger } from "../utils/logger";

type X402PluginClient = {
  getX402PayQuote: (input: { orderId: string }) => Promise<{
    id: string;
    status: string;
    totalAmount: number;
    currency: string;
    payable: boolean;
    alreadyPaid: boolean;
    expired: boolean;
    settlePending: boolean;
  } | null>;
  settleX402Order: (input: {
    orderId: string;
    transaction?: string;
    payer?: string;
    network?: string;
  }) => Promise<{
    id: string;
    status: string;
    totalAmount: number;
    currency: string;
    payable: boolean;
    alreadyPaid: boolean;
    expired: boolean;
    settlePending: boolean;
  }>;
  failX402Order: (input: {
    orderId: string;
    errorReason?: string;
    errorMessage?: string;
  }) => Promise<{
    id: string;
    status: string;
    totalAmount: number;
    currency: string;
    payable: boolean;
    alreadyPaid: boolean;
    expired: boolean;
    settlePending: boolean;
  } | null>;
} & X402IntentsPluginClient;

export function setupX402PayRoute(app: Hono, plugins: PluginResult) {
  if (!isX402Enabled()) {
    return;
  }

  const payTo = getX402PayToAddress();
  if (!payTo) {
    logger.warn("[x402] X402_ENABLED is set but X402_PAY_TO_ADDRESS is missing");
    return;
  }

  const hostSecret = getX402HostSecret();
  if (!hostSecret) {
    logger.warn("[x402] X402_ENABLED is set but X402_HOST_SECRET is missing");
    return;
  }

  const pluginApi = plugins.api as {
    createClient?: (ctx: unknown) => X402PluginClient;
  } | null;

  if (!pluginApi?.createClient) {
    logger.warn("[x402] API plugin is unavailable; skipping POST /orders/:id/pay");
    return;
  }

  const reqHeaders = new Headers();
  reqHeaders.set(X402_HOST_SECRET_HEADER, hostSecret);
  const client = pluginApi.createClient({ reqHeaders });
  const intents = createX402IntentsPayDeps(client) ?? undefined;
  if (!intents && isX402IntentsEnabled()) {
    logger.warn(`[x402] near-intents disabled: ${getX402IntentsInactiveReason()}`);
  }
  const payApp = createX402PayApp({
    payTo,
    facilitatorUrl: getX402FacilitatorUrl(),
    getOrder: (orderId) => client.getX402PayQuote({ orderId }),
    settleOrder: (orderId, settlement) =>
      client.settleX402Order({ orderId, ...settlement }),
    failOrder: (orderId, settlement) =>
      client.failX402Order({ orderId, ...settlement }),
    intents,
  });

  app.route("/", payApp);
  logger.info(
    `[x402] Mounted POST /orders/:id/pay (${getX402Network()}${
      intents ? `, near-intents: ${intents.origins.length} origin(s)` : ""
    })`,
  );
}
