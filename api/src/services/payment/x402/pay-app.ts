import { Hono } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type { OrderStatus } from "../../../schema";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { parseOrderIdFromPayPath, usdDollarsToUsdcAtomic } from "./amount";
import {
  getX402Network,
  getX402UsdcAddress,
  getX402UsdcExtra,
} from "./config";
import {
  X402_MAX_TIMEOUT_SECONDS,
  X402_PAY_PATH_PATTERN,
  X402_SCHEME,
} from "./constants";
import { isNonTerminalX402SettleFailure } from "./settlement";

export type X402PayOrder = {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  payable: boolean;
  alreadyPaid: boolean;
  expired: boolean;
  settlePending: boolean;
};

export type X402PayAppDeps = {
  payTo: string;
  facilitatorUrl?: string;
  facilitator?: FacilitatorClient;
  getOrder: (orderId: string) => Promise<X402PayOrder | null>;
  settleOrder: (
    orderId: string,
    settlement: { transaction?: string; payer?: string; network?: string },
  ) => Promise<X402PayOrder>;
  failOrder: (
    orderId: string,
    settlement: { errorReason?: string; errorMessage?: string },
  ) => Promise<X402PayOrder | null>;
  syncFacilitatorOnStart?: boolean;
};

function orderIdFromTransport(transportContext: unknown): string | undefined {
  if (!transportContext || typeof transportContext !== "object") return undefined;
  const request = (transportContext as { request?: { path?: string } }).request;
  return request?.path ? parseOrderIdFromPayPath(request.path) : undefined;
}

function requireOrderId(path: string): string {
  const orderId = parseOrderIdFromPayPath(path);
  if (!orderId) {
    throw new Error("Missing order id");
  }
  return orderId;
}

function settleErrorReason(error: unknown): string | undefined {
  if (error && typeof error === "object" && "errorReason" in error) {
    const reason = error.errorReason;
    if (typeof reason === "string" && reason.length > 0) {
      return reason;
    }
  }

  return error instanceof Error ? error.message : undefined;
}

export function createX402PayApp(deps: X402PayAppDeps): Hono {
  const network = getX402Network();
  const usdc = getX402UsdcAddress();
  const extra = getX402UsdcExtra();
  const facilitator =
    deps.facilitator ??
    new HTTPFacilitatorClient({ url: deps.facilitatorUrl ?? "" });

  const resourceServer = new x402ResourceServer(facilitator).register(
    network,
    new ExactEvmScheme(),
  );

  resourceServer.onAfterSettle(async (context) => {
    if (context.phase !== "after-handler") return;
    const orderId = orderIdFromTransport(context.transportContext);
    if (!orderId) return;
    await deps.settleOrder(orderId, {
      transaction: context.result.transaction,
      payer: context.result.payer,
      network: context.result.network,
    });
  });

  resourceServer.onSettleFailure(async (context) => {
    const orderId = orderIdFromTransport(context.transportContext);
    if (!orderId) return;
    const nonTerminal = isNonTerminalX402SettleFailure(context.error);
    await deps.failOrder(orderId, {
      errorReason: nonTerminal
        ? "settlement_pending"
        : settleErrorReason(context.error),
      errorMessage: context.error.message,
    });
  });

  const routes = {
    [X402_PAY_PATH_PATTERN]: {
      description: "Pay for an existing merch order (USDC on Base)",
      mimeType: "application/json",
      accepts: {
        scheme: X402_SCHEME,
        network,
        payTo: deps.payTo,
        maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
        extra,
        price: async (context: { path: string }) => {
          const orderId = requireOrderId(context.path);
          const order = await deps.getOrder(orderId);
          if (!order) {
            throw new Error("order_not_found");
          }
          return {
            asset: usdc,
            amount: usdDollarsToUsdcAtomic(order.totalAmount),
            extra,
          };
        },
      },
    },
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  httpServer.onProtectedRequest(async (httpContext) => {
    const orderId = parseOrderIdFromPayPath(httpContext.path);
    if (!orderId) {
      return { abort: true, reason: "missing_order_id" };
    }

    const order = await deps.getOrder(orderId);
    if (!order) {
      return { abort: true, reason: "order_not_found" };
    }

    if (order.alreadyPaid) {
      return { grantAccess: true };
    }

    if (order.expired) {
      return { abort: true, reason: "expired" };
    }

    if (order.settlePending) {
      return { abort: true, reason: "settlement_pending" };
    }

    if (!order.payable) {
      return { abort: true, reason: "order_not_payable" };
    }

    return;
  });

  const app = new Hono();

  app.use(
    "/orders/:id/pay",
    paymentMiddlewareFromHTTPServer(
      httpServer,
      undefined,
      undefined,
      deps.syncFacilitatorOnStart ?? true,
    ),
  );

  app.post("/orders/:id/pay", async (c) => {
    const order = await deps.getOrder(c.req.param("id"));
    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    if (order.alreadyPaid) {
      return c.json({
        orderId: order.id,
        status: order.status,
        idempotent: true,
      });
    }

    if (!order.payable) {
      return c.json(
        { error: "Order is not awaiting x402 payment", status: order.status },
        409,
      );
    }

    return c.json({
      orderId: order.id,
      status: order.status,
      currency: order.currency,
    });
  });

  return app;
}
