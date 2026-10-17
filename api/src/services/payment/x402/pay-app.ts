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
  X402_MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  X402_PAY_PATH_PATTERN,
  X402_SCHEME,
  X402_USDC_BASE,
} from "./constants";

export type X402PayOrder = {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  payable: boolean;
  alreadyPaid: boolean;
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

export function createX402PayApp(deps: X402PayAppDeps): Hono {
  const facilitator =
    deps.facilitator ??
    new HTTPFacilitatorClient({ url: deps.facilitatorUrl ?? "" });

  const resourceServer = new x402ResourceServer(facilitator).register(
    X402_NETWORK,
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
    await deps.failOrder(orderId, {
      errorReason: context.error.message,
      errorMessage: context.error.message,
    });
  });

  const routes = {
    [X402_PAY_PATH_PATTERN]: {
      description: "Pay for an existing merch order (USDC on Base)",
      mimeType: "application/json",
      accepts: {
        scheme: X402_SCHEME,
        network: X402_NETWORK,
        payTo: deps.payTo,
        maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
        price: async (context: { path: string }) => {
          const orderId = requireOrderId(context.path);
          const order = await deps.getOrder(orderId);
          if (!order) {
            throw new Error("order_not_found");
          }
          return {
            asset: X402_USDC_BASE,
            amount: usdDollarsToUsdcAtomic(order.totalAmount),
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
