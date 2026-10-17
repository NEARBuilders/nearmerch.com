import { Effect } from "every-plugin/effect";
import type { MarketplaceRuntime } from "../../../runtime";
import type { OrderStatus, OrderWithItems } from "../../../schema";
import { OrderStore } from "../../../store";
import { ProviderConfigStore } from "../../../store/providers";
import { EmailService } from "../../email";
import { processPaymentSuccessEffect } from "../payment-success";
import { canApplyPaymentFailure } from "../pingpay/webhook";
import type { X402PayOrder } from "./pay-app";

const PAID_STATUSES: OrderStatus[] = [
  "paid",
  "processing",
  "paid_pending_fulfillment",
  "shipped",
  "delivered",
];

export function isX402Order(order: OrderWithItems): boolean {
  return order.checkoutProvider === "x402";
}

export function isX402AlreadyPaid(order: OrderWithItems): boolean {
  return isX402Order(order) && PAID_STATUSES.includes(order.status);
}

export function isX402Payable(order: OrderWithItems): boolean {
  return isX402Order(order) && order.status === "payment_pending";
}

export function toX402PayOrder(order: OrderWithItems): X402PayOrder {
  return {
    id: order.id,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
    payable: isX402Payable(order),
    alreadyPaid: isX402AlreadyPaid(order),
  };
}

export function settleX402OrderEffect(options: {
  runtime: MarketplaceRuntime;
  order: OrderWithItems;
  metadata?: Record<string, unknown>;
}): Effect.Effect<
  OrderWithItems,
  Error,
  OrderStore | ProviderConfigStore | EmailService
> {
  const { runtime, order, metadata } = options;

  return Effect.gen(function* () {
    const store = yield* OrderStore;
    const current = (yield* store.find(order.id)) ?? order;

    if (isX402AlreadyPaid(current)) {
      return current;
    }

    if (!isX402Payable(current)) {
      return yield* Effect.fail(
        new Error(`Order ${order.id} is not awaiting x402 payment (status=${current.status})`),
      );
    }

    const claimed = yield* store.claimStatus(
      current.id,
      "payment_pending",
      "paid",
      "service:x402",
      "x402.settle_claimed",
      { provider: "x402", ...metadata },
    );

    if (!claimed) {
      const raced = yield* store.find(current.id);
      if (raced && isX402AlreadyPaid(raced)) {
        return raced;
      }

      return yield* Effect.fail(
        new Error(`Order ${order.id} is not awaiting x402 payment`),
      );
    }

    yield* store.updatePaymentDetails(claimed.id, {
      ...(claimed.paymentDetails ?? {}),
      provider: "x402",
      settlement: metadata,
      settledAt: new Date().toISOString(),
    });

    const result = yield* processPaymentSuccessEffect({
      runtime,
      order: claimed,
      actor: "service:x402",
      metadata: { provider: "x402", ...metadata },
    });

    return result.order;
  });
}

export function failX402OrderEffect(options: {
  order: OrderWithItems;
  metadata?: Record<string, unknown>;
}): Effect.Effect<OrderWithItems, Error, OrderStore> {
  const { order, metadata } = options;

  return Effect.gen(function* () {
    const store = yield* OrderStore;

    if (!canApplyPaymentFailure(order.status)) {
      return order;
    }

    return yield* store.updateStatus(
      order.id,
      "payment_failed",
      "service:x402",
      "x402.settle_failed",
      metadata,
    );
  });
}
