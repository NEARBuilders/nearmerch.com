import { Effect } from "every-plugin/effect";
import type { MarketplaceRuntime } from "../../../runtime";
import type { OrderStatus, OrderWithItems } from "../../../schema";
import { OrderStore } from "../../../store";
import { ProviderConfigStore } from "../../../store/providers";
import { EmailService } from "../../email";
import { processPaymentSuccessEffect } from "../payment-success";
import { X402_MAX_TIMEOUT_SECONDS } from "./constants";
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

export function isX402SettlePending(order: OrderWithItems): boolean {
  return order.paymentDetails?.settlePending === true;
}

export function isX402QuoteExpired(
  order: OrderWithItems,
  nowMs: number = Date.now(),
): boolean {
  if (!isX402Order(order)) {
    return false;
  }

  if (order.status === "expired") {
    return true;
  }

  if (order.status !== "payment_pending") {
    return false;
  }

  const createdMs = Date.parse(order.createdAt);
  if (Number.isNaN(createdMs)) {
    return false;
  }

  return nowMs - createdMs > X402_MAX_TIMEOUT_SECONDS * 1000;
}

export function isX402Payable(order: OrderWithItems): boolean {
  return (
    isX402Order(order) &&
    order.status === "payment_pending" &&
    !isX402SettlePending(order) &&
    !isX402QuoteExpired(order)
  );
}

export function toX402PayOrder(order: OrderWithItems): X402PayOrder {
  return {
    id: order.id,
    status: order.status,
    totalAmount: order.totalAmount,
    currency: order.currency,
    payable: isX402Payable(order),
    alreadyPaid: isX402AlreadyPaid(order),
    expired: isX402QuoteExpired(order),
    settlePending: isX402SettlePending(order),
  };
}

const NON_TERMINAL_SETTLE_REASONS = new Set(["settlement_pending"]);

function settleFailureReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  if ("errorReason" in error && typeof error.errorReason === "string") {
    return error.errorReason;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return undefined;
}

/**
 * Broadcast-but-unconfirmed settle and facilitator timeouts are not terminal.
 * Marking the order payment_failed would strand a payment that may still confirm.
 */
export function isNonTerminalX402SettleFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("name" in error && error.name === "FacilitatorTimeoutError") {
    return true;
  }

  const reason = settleFailureReason(error);
  if (!reason) {
    return false;
  }

  return (
    NON_TERMINAL_SETTLE_REASONS.has(reason) ||
    reason.includes("settlement_pending")
  );
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

    if (!isX402Order(current) || current.status !== "payment_pending") {
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
      settlePending: false,
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

function isPendingSettleMetadata(metadata?: Record<string, unknown>): boolean {
  if (!metadata) {
    return false;
  }

  return isNonTerminalX402SettleFailure({
    errorReason: metadata.errorReason,
    message: metadata.errorMessage,
    name: metadata.errorReason,
  });
}

export function failX402OrderEffect(options: {
  order: OrderWithItems;
  metadata?: Record<string, unknown>;
}): Effect.Effect<OrderWithItems, Error, OrderStore> {
  const { order, metadata } = options;

  return Effect.gen(function* () {
    const store = yield* OrderStore;
    const current = (yield* store.find(order.id)) ?? order;

    if (isX402AlreadyPaid(current)) {
      return current;
    }

    if (isPendingSettleMetadata(metadata)) {
      if (current.status !== "payment_pending") {
        return current;
      }

      yield* store.updatePaymentDetails(current.id, {
        ...(current.paymentDetails ?? {}),
        provider: "x402",
        settlePending: true,
        settleFailure: metadata,
      });

      return (yield* store.find(current.id)) ?? current;
    }

    const claimed = yield* store.claimStatus(
      current.id,
      "payment_pending",
      "payment_failed",
      "service:x402",
      "x402.settle_failed",
      metadata,
    );

    if (!claimed) {
      return (yield* store.find(current.id)) ?? current;
    }

    return claimed;
  });
}
