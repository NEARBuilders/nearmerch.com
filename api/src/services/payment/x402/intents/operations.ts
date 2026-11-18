import { Effect } from "every-plugin/effect";
import { z } from "every-plugin/zod";
import type { MarketplaceRuntime } from "../../../../runtime";
import { FeeConfigSchema, type OrderWithItems } from "../../../../schema";
import { OrderStore, X402IntentsOperationStore } from "../../../../store";
import { ProviderConfigStore } from "../../../../store/providers";
import { EmailService } from "../../../email";
import { X402_INTENTS_OPERATION_GRACE_SECONDS } from "../constants";
import {
  failX402OrderEffect,
  isX402AlreadyPaid,
  settleX402OrderEffect,
  toX402PayOrder,
} from "../settlement";
import type {
  X402IntentsFailResult,
  X402IntentsOperation,
  X402IntentsOrderContext,
  X402IntentsRecordQuoteInput,
  X402IntentsSettleResult,
  X402IntentsSettlement,
} from "./types";

export class X402IntentsOperationError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "X402IntentsOperationError";
  }
}

const OrderFeesSchema = z.array(FeeConfigSchema);

export function getX402IntentsOrderContextEffect(
  orderId: string,
): Effect.Effect<X402IntentsOrderContext | null, Error, OrderStore> {
  return Effect.gen(function* () {
    const store = yield* OrderStore;
    const order = yield* store.find(orderId);
    if (!order) return null;
    const fees = OrderFeesSchema.safeParse(order.paymentDetails?.fees);
    return {
      order: toX402PayOrder(order),
      fees: fees.success ? fees.data : [],
    };
  });
}

/** Record lifetime: refundDeadline (or the origin timeout when unknown) + 24 h. */
export function x402IntentsOperationExpiry(
  input: Pick<X402IntentsRecordQuoteInput, "refundDeadline" | "maxTimeoutSeconds">,
  nowMs: number = Date.now(),
): Date {
  const base = input.refundDeadline
    ? Date.parse(input.refundDeadline)
    : nowMs + input.maxTimeoutSeconds * 1000;
  return new Date(base + X402_INTENTS_OPERATION_GRACE_SECONDS * 1000);
}

export function recordX402IntentsQuoteEffect(
  input: X402IntentsRecordQuoteInput,
): Effect.Effect<X402IntentsOperation, Error, OrderStore | X402IntentsOperationStore> {
  return Effect.gen(function* () {
    const orders = yield* OrderStore;
    const operations = yield* X402IntentsOperationStore;
    const order = yield* orders.find(input.orderId);
    if (!order) {
      return yield* Effect.fail(new X402IntentsOperationError("NOT_FOUND", "Order not found"));
    }

    const operation = yield* operations.recordQuote({
      ...input,
      expiresAt: x402IntentsOperationExpiry(input),
    });

    if (operation.orderId !== input.orderId) {
      return yield* Effect.fail(
        new X402IntentsOperationError(
          "BAD_REQUEST",
          "Operation key is already recorded for another order",
        ),
      );
    }

    return operation;
  });
}

function settledByOperation(order: OrderWithItems, operationKey: string): boolean {
  const settlement = order.paymentDetails?.settlement as { operationKey?: unknown } | undefined;
  return settlement?.operationKey === operationKey;
}

/**
 * Successful facilitator settle → mark the order paid (runs fulfillment once)
 * and the operation executed. The operation is claimed first so a concurrent
 * retry of the same operation cannot settle twice; a second operation that
 * finds the order already paid is recorded as a duplicate (manual refund).
 */
export function settleX402IntentsOperationEffect(options: {
  runtime: MarketplaceRuntime;
  operationKey: string;
  settlement: X402IntentsSettlement;
  settleResponse: Record<string, unknown>;
}): Effect.Effect<
  X402IntentsSettleResult,
  Error,
  OrderStore | X402IntentsOperationStore | ProviderConfigStore | EmailService
> {
  const { runtime, operationKey, settlement, settleResponse } = options;

  return Effect.gen(function* () {
    const orders = yield* OrderStore;
    const operations = yield* X402IntentsOperationStore;

    const claimed = yield* operations.claimSettling(operationKey);
    if (!claimed) {
      const current = yield* operations.find(operationKey);
      if (!current) {
        return yield* Effect.fail(
          new X402IntentsOperationError("NOT_FOUND", "Operation not found"),
        );
      }
      const order = yield* orders.find(current.orderId);
      const outcome =
        current.state === "executed"
          ? "already_executed"
          : current.state === "failed"
            ? "failed"
            : "in_progress";
      return {
        outcome,
        order: order ? toX402PayOrder(order) : null,
        operation: current,
      } satisfies X402IntentsSettleResult;
    }

    const order = yield* orders.find(claimed.orderId);
    if (!order) {
      yield* operations.releaseSettling(operationKey);
      return yield* Effect.fail(new X402IntentsOperationError("NOT_FOUND", "Order not found"));
    }

    const metadata = {
      method: "near-intents",
      operationKey,
      depositAddress: claimed.depositAddress,
      ...(claimed.depositMemo ? { depositMemo: claimed.depositMemo } : {}),
      transaction: settlement.transaction,
      payer: settlement.payer,
      network: settlement.network,
      amount: settlement.amount,
      originNetwork: settlement.originNetwork,
      originTxHash: settlement.originTxHash,
      fees: claimed.feePlan,
    };

    const settleExit = yield* Effect.exit(
      settleX402OrderEffect({ runtime, order, metadata }),
    );
    if (settleExit._tag === "Failure") {
      yield* Effect.logError("x402 intents: order settlement failed after a successful swap").pipe(
        Effect.annotateLogs({ operationKey, orderId: order.id }),
      );
    }

    const finalOrder = (yield* orders.find(order.id)) ?? order;
    const ours = settledByOperation(finalOrder, operationKey);
    const paid = isX402AlreadyPaid(finalOrder);

    // Funds were delivered either way: record the operation as executed so a
    // retry never re-settles, and flag anything that did not pay this order.
    const executed = yield* operations.markExecuted({
      operationKey,
      settleResponse,
      duplicate: !ours,
      lastErrorReason: paid ? undefined : "order_not_payable",
    });
    const operation = executed ?? (yield* operations.find(operationKey)) ?? claimed;

    return {
      outcome: !paid ? "order_not_payable" : ours ? "settled" : "duplicate",
      order: toX402PayOrder(finalOrder),
      operation,
    } satisfies X402IntentsSettleResult;
  });
}

/**
 * settlement_pending → operation pending, order keeps payment_pending with
 * settlePending (only this operation may settle it). Terminal failure →
 * operation failed, order payment_failed. No-op when the operation already
 * reached executed/failed or is being settled.
 */
export function failX402IntentsOperationEffect(options: {
  operationKey: string;
  errorReason: string;
  pending: boolean;
  settleResponse: Record<string, unknown>;
}): Effect.Effect<X402IntentsFailResult, Error, OrderStore | X402IntentsOperationStore> {
  const { operationKey, errorReason, pending, settleResponse } = options;

  return Effect.gen(function* () {
    const orders = yield* OrderStore;
    const operations = yield* X402IntentsOperationStore;

    const updated = pending
      ? yield* operations.markPending({ operationKey, settleResponse, lastErrorReason: errorReason })
      : yield* operations.markFailed({ operationKey, settleResponse, lastErrorReason: errorReason });

    const operation = updated ?? (yield* operations.find(operationKey));
    if (!operation) {
      return yield* Effect.fail(new X402IntentsOperationError("NOT_FOUND", "Operation not found"));
    }

    const order = yield* orders.find(operation.orderId);
    if (!order) {
      return { order: null, operation };
    }

    if (!updated) {
      return { order: toX402PayOrder(order), operation };
    }

    const failed = yield* failX402OrderEffect({
      order,
      metadata: {
        errorReason: pending ? "settlement_pending" : errorReason,
        method: "near-intents",
        operationKey,
        refundTo: (settleResponse.extra as { refundTo?: unknown } | undefined)?.refundTo,
        status: (settleResponse.extra as { status?: unknown } | undefined)?.status,
      },
    });

    return { order: toX402PayOrder(failed), operation };
  });
}
