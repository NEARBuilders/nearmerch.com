import type { Context, MiddlewareHandler } from "hono";
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import type { X402IntentsOrigin } from "../config";
import { getX402Network, getX402UsdcAddress } from "../config";
import {
  X402_INTENTS_ERRORS,
  X402_INTENTS_QUOTE_RATE_LIMIT,
  X402_INTENTS_QUOTE_RATE_WINDOW_MS,
  X402_INTENTS_TERMINAL_SETTLE_ERRORS,
} from "../constants";
import { planX402IntentsFees } from "./fees";
import {
  buildX402IntentsQuotedEntry,
  buildX402IntentsUnquotedEntry,
  isX402IntentsRequirements,
  originMatches,
  x402IntentsOperationKey,
} from "./requirements";
import {
  isValidOriginAddress,
  isValidOriginTxHash,
  X402IntentsDepositPayloadSchema,
  X402IntentsQuoteExtraSchema,
  X402IntentsQuotePayloadSchema,
  type X402IntentsDepositPayload,
} from "./schema";
import type {
  X402IntentsFeePlan,
  X402IntentsOperation,
  X402IntentsOrderContext,
  X402IntentsPayDeps,
} from "./types";
import { usdDollarsToUsdcAtomic } from "../amount";

export type X402IntentsResource = PaymentRequired["resource"];

type IntentsMiddlewareOptions = {
  deps: X402IntentsPayDeps;
  payTo: string;
  resource: (c: Context) => X402IntentsResource;
  /** Phase 1 success body; intents success responses use the same shape. */
  paidResponse: (c: Context, orderId: string) => Promise<Response>;
};

const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

/** Never echo or store the facilitator's operationToken in receipts (spec #3370). */
export function stripOperationToken<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripOperationToken(item)) as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "operationToken") continue;
      result[key] = stripOperationToken(item);
    }
    return result as T;
  }
  return value;
}

function abort(c: Context, reason: string, status: 403 | 404 | 409 | 429 | 502 = 403) {
  c.header("Cache-Control", "no-store");
  return c.json({ error: reason }, status);
}

function getPaymentHeader(c: Context): string | undefined {
  return c.req.header("payment-signature") ?? c.req.header("x-payment") ?? undefined;
}

export function createX402IntentsMiddleware(
  options: IntentsMiddlewareOptions,
): MiddlewareHandler {
  const { deps } = options;
  const now = deps.now ?? Date.now;
  const quoteHistory = new Map<string, number[]>();

  const allowQuote = (orderId: string): boolean => {
    const cutoff = now() - X402_INTENTS_QUOTE_RATE_WINDOW_MS;
    for (const [key, times] of quoteHistory) {
      const recent = times.filter((time) => time > cutoff);
      if (recent.length === 0) quoteHistory.delete(key);
      else quoteHistory.set(key, recent);
    }
    const recent = quoteHistory.get(orderId) ?? [];
    if (recent.length >= X402_INTENTS_QUOTE_RATE_LIMIT) return false;
    recent.push(now());
    quoteHistory.set(orderId, recent);
    return true;
  };

  const feePlanFor = (context: X402IntentsOrderContext): X402IntentsFeePlan =>
    planX402IntentsFees({
      totalAmount: usdDollarsToUsdcAtomic(context.order.totalAmount),
      fees: context.fees,
      mode: deps.feeMode,
    });

  const unquotedEntry = (
    origin: X402IntentsOrigin,
    feePlan: X402IntentsFeePlan,
  ): PaymentRequirements =>
    buildX402IntentsUnquotedEntry({
      origin,
      feePlan,
      destination: {
        network: getX402Network(),
        asset: getX402UsdcAddress(),
        amount: feePlan.destinationAmount,
        recipient: options.payTo,
      },
    });

  const paymentRequired = (
    c: Context,
    input: {
      error?: string;
      accepts: PaymentRequirements[];
      settleResponse?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
  ) => {
    const required: PaymentRequired = {
      x402Version: 2,
      ...(input.error ? { error: input.error } : {}),
      resource: options.resource(c),
      accepts: input.accepts,
    };
    c.header(PAYMENT_REQUIRED_HEADER, encodePaymentRequiredHeader(required));
    c.header("Cache-Control", "no-store");
    if (input.settleResponse) {
      c.header(
        PAYMENT_RESPONSE_HEADER,
        encodePaymentResponseHeader(input.settleResponse as unknown as SettleResponse),
      );
    }
    return c.json(input.body ?? (input.error ? { error: input.error } : {}), 402);
  };

  /** Add one unquoted near-intents entry per origin to Phase 1's unpaid 402. */
  const appendIntentsEntries = async (c: Context, orderId: string) => {
    const header = c.res.headers.get(PAYMENT_REQUIRED_HEADER);
    if (c.res.status !== 402 || !header) return;

    let required: PaymentRequired;
    try {
      required = decodePaymentRequiredHeader(header);
    } catch {
      return;
    }

    let context: X402IntentsOrderContext | null;
    try {
      context = await deps.getOrderContext(orderId);
    } catch (error) {
      console.error("[x402-intents] order lookup failed; serving Phase 1 only", error);
      return;
    }
    if (!context?.order.payable || context.order.settlePending || context.order.expired) {
      return;
    }

    const feePlan = feePlanFor(context);
    const entries = deps.origins.map((origin) => unquotedEntry(origin, feePlan));
    c.res.headers.set(
      PAYMENT_REQUIRED_HEADER,
      encodePaymentRequiredHeader({
        ...required,
        accepts: [...required.accepts, ...entries],
      }),
    );
  };

  const handleQuote = async (
    c: Context,
    orderId: string,
    payload: PaymentPayload,
    origin: X402IntentsOrigin,
    context: X402IntentsOrderContext,
  ) => {
    const { order } = context;
    if (order.alreadyPaid) return options.paidResponse(c, orderId);
    if (order.settlePending) return abort(c, X402_INTENTS_ERRORS.settlementPending);
    if (order.expired) return abort(c, "expired");
    if (!order.payable) return abort(c, "order_not_payable");

    const feePlan = feePlanFor(context);
    const unquoted = unquotedEntry(origin, feePlan);

    const quote = X402IntentsQuotePayloadSchema.safeParse(payload.payload);
    if (!quote.success || !isValidOriginAddress(origin.network, quote.data.refundTo)) {
      return paymentRequired(c, { error: "invalid_payload", accepts: [unquoted] });
    }

    if (!allowQuote(orderId)) return abort(c, "rate_limited", 429);

    let verify;
    try {
      verify = await deps.getFacilitator(deps.facilitatorUrl).verify(payload, unquoted);
    } catch (error) {
      console.error("[x402-intents] facilitator verify failed", error);
      return abort(c, "facilitator_unavailable", 502);
    }

    if (!verify.isValid) {
      return paymentRequired(c, {
        error: verify.invalidReason ?? X402_INTENTS_ERRORS.quoteUnavailable,
        accepts: [unquoted],
      });
    }

    const parsedQuote = X402IntentsQuoteExtraSchema.safeParse(verify.extra);
    if (!parsedQuote.success || Date.parse(parsedQuote.data.refundDeadline) <= now()) {
      console.error("[x402-intents] facilitator returned an unusable quote");
      return paymentRequired(c, {
        error: X402_INTENTS_ERRORS.quoteUnavailable,
        accepts: [unquoted],
      });
    }

    const quoteExtra = parsedQuote.data;
    try {
      await deps.recordQuote({
        orderId,
        operationKey: x402IntentsOperationKey(
          origin.network,
          quoteExtra.depositAddress,
          quoteExtra.depositMemo,
        ),
        originNetwork: origin.network,
        originAsset: origin.asset,
        depositAddress: quoteExtra.depositAddress,
        depositMemo: quoteExtra.depositMemo,
        facilitatorUrl: deps.facilitatorUrl,
        requirements: unquoted as unknown as Record<string, unknown>,
        feePlan: feePlan as unknown as Record<string, unknown>,
        refundDeadline: new Date(quoteExtra.refundDeadline).toISOString(),
        maxTimeoutSeconds: origin.maxTimeoutSeconds,
      });
    } catch (error) {
      // Never hand out a deposit address we could not record.
      console.error("[x402-intents] failed to record quote", error);
      return abort(c, "quote_record_failed", 502);
    }

    return paymentRequired(c, {
      accepts: [buildX402IntentsQuotedEntry(unquoted, quoteExtra)],
    });
  };

  const respondWithRecordedResult = async (
    c: Context,
    orderId: string,
    operation: X402IntentsOperation,
  ) => {
    const receipt = operation.settleResponse ?? {};
    if (operation.state === "executed") {
      const context = await deps.getOrderContext(orderId);
      c.header(
        PAYMENT_RESPONSE_HEADER,
        encodePaymentResponseHeader(receipt as unknown as SettleResponse),
      );
      c.header("Cache-Control", "no-store");
      return c.json({
        orderId,
        status: context?.order.status,
        idempotent: true,
        reason: X402_INTENTS_ERRORS.operationExecuted,
      });
    }

    return paymentRequired(c, {
      error: operation.lastErrorReason ?? X402_INTENTS_ERRORS.paymentFailed,
      accepts: [operation.requirements as unknown as PaymentRequirements],
      settleResponse: receipt,
    });
  };

  const handleDeposit = async (
    c: Context,
    orderId: string,
    payload: PaymentPayload,
    origin: X402IntentsOrigin | undefined,
    context: X402IntentsOrderContext,
  ) => {
    const parsed = X402IntentsDepositPayloadSchema.safeParse(payload.payload);
    const network = payload.accepted.network;
    if (!parsed.success || !isValidOriginTxHash(network, parsed.data.txHash)) {
      return paymentRequired(c, { error: "invalid_payload", accepts: [] });
    }
    const deposit: X402IntentsDepositPayload = parsed.data;
    const operationKey = x402IntentsOperationKey(
      network,
      deposit.depositAddress,
      deposit.depositMemo,
    );

    let operation = await deps.getOperation(operationKey);
    if (operation && operation.orderId !== orderId) {
      return paymentRequired(c, {
        error: X402_INTENTS_ERRORS.tokenInvalid,
        accepts: [],
      });
    }

    // Recorded results are returned before any facilitator call (spec #3370).
    if (operation && (operation.state === "executed" || operation.state === "failed")) {
      return respondWithRecordedResult(c, orderId, operation);
    }

    const { order } = context;
    if (operation) {
      if (now() > Date.parse(operation.expiresAt)) {
        return paymentRequired(c, {
          error: X402_INTENTS_ERRORS.tokenExpired,
          accepts: [operation.requirements as unknown as PaymentRequirements],
        });
      }
      // A recorded operation stays redeemable past the 900 s Phase 1 window and
      // is settled even if the order moved on, so delivered funds are always
      // recorded. While one is pending only that operation (pending, or being
      // settled by a concurrent retry) may settle the order.
      if (order.status === "payment_pending" && order.settlePending && operation.state === "quoted") {
        return abort(c, X402_INTENTS_ERRORS.settlementPending);
      }
    } else {
      // No record: fall back to the current configuration (spec #3370).
      if (!origin) {
        return paymentRequired(c, { error: "invalid_network", accepts: [] });
      }
      if (order.alreadyPaid) return options.paidResponse(c, orderId);
      if (order.settlePending) return abort(c, X402_INTENTS_ERRORS.settlementPending);
      if (order.expired) return abort(c, "expired");
      if (!order.payable) return abort(c, "order_not_payable");

      const feePlan = feePlanFor(context);
      try {
        operation = await deps.recordQuote({
          orderId,
          operationKey,
          originNetwork: origin.network,
          originAsset: origin.asset,
          depositAddress: deposit.depositAddress,
          depositMemo: deposit.depositMemo,
          facilitatorUrl: deps.facilitatorUrl,
          requirements: unquotedEntry(origin, feePlan) as unknown as Record<string, unknown>,
          feePlan: feePlan as unknown as Record<string, unknown>,
          maxTimeoutSeconds: origin.maxTimeoutSeconds,
        });
      } catch (error) {
        console.error("[x402-intents] failed to record operation", error);
        return abort(c, "operation_record_failed", 502);
      }
      if (operation.orderId !== orderId) {
        return paymentRequired(c, { error: X402_INTENTS_ERRORS.tokenInvalid, accepts: [] });
      }
    }

    const requirements = operation.requirements as unknown as PaymentRequirements;
    const destination = (requirements.extra?.destination ?? {}) as {
      network?: string;
      amount?: string;
    };

    let settle: SettleResponse;
    try {
      settle = await deps
        .getFacilitator(operation.facilitatorUrl)
        .settle(payload, requirements);
    } catch (error) {
      // Transport failure: no state change; the client retries the same payload.
      console.error("[x402-intents] facilitator settle failed", error);
      return abort(c, "facilitator_unavailable", 502);
    }

    const receipt = stripOperationToken(settle) as unknown as Record<string, unknown>;

    if (settle.success) {
      if (settle.network !== destination.network || settle.amount !== destination.amount) {
        console.error("[x402-intents] settle receipt does not match the destination", {
          operationKey,
          network: settle.network,
          amount: settle.amount,
        });
        return abort(c, "settlement_mismatch", 502);
      }

      const extra = (settle.extra ?? {}) as { originNetwork?: unknown; originTxHash?: unknown };
      const result = await deps.settleOperation({
        operationKey,
        settlement: {
          transaction: settle.transaction,
          payer: settle.payer,
          network: settle.network,
          amount: settle.amount,
          originNetwork:
            typeof extra.originNetwork === "string" ? extra.originNetwork : network,
          originTxHash:
            typeof extra.originTxHash === "string" ? extra.originTxHash : deposit.txHash,
        },
        settleResponse: receipt,
      });

      if (result.outcome === "in_progress") {
        return abort(c, X402_INTENTS_ERRORS.settlementPending, 409);
      }
      if (result.outcome === "failed") {
        return respondWithRecordedResult(c, orderId, result.operation);
      }
      if (result.outcome === "order_not_payable") {
        return abort(c, "order_not_payable", 409);
      }

      c.header(
        PAYMENT_RESPONSE_HEADER,
        encodePaymentResponseHeader(
          (result.operation.settleResponse ?? receipt) as unknown as SettleResponse,
        ),
      );
      c.header("Cache-Control", "no-store");
      if (result.outcome === "settled") {
        return c.json({
          orderId,
          status: result.order?.status,
          currency: result.order?.currency,
        });
      }
      return c.json({
        orderId,
        status: result.order?.status,
        idempotent: true,
        ...(result.outcome === "already_executed"
          ? { reason: X402_INTENTS_ERRORS.operationExecuted }
          : {}),
      });
    }

    const reason = settle.errorReason ?? "unexpected_settle_error";

    if (reason === X402_INTENTS_ERRORS.settlementPending) {
      await deps.failOperation({ operationKey, errorReason: reason, pending: true, settleResponse: receipt });
      return paymentRequired(c, {
        error: reason,
        accepts: [requirements],
        settleResponse: receipt,
      });
    }

    if (X402_INTENTS_TERMINAL_SETTLE_ERRORS.has(reason)) {
      const failed = await deps.failOperation({
        operationKey,
        errorReason: X402_INTENTS_ERRORS.paymentFailed,
        pending: false,
        settleResponse: receipt,
      });
      if (failed.operation.state === "executed") {
        return respondWithRecordedResult(c, orderId, failed.operation);
      }
      return paymentRequired(c, {
        error: X402_INTENTS_ERRORS.paymentFailed,
        accepts: [requirements],
        settleResponse: receipt,
      });
    }

    // invalid_* (token, deposit not found, quote mismatch) and unknown reasons:
    // no state change (spec #3370).
    return paymentRequired(c, {
      error: reason,
      accepts: [requirements],
      settleResponse: receipt,
    });
  };

  return async (c, next) => {
    if (c.req.method !== "POST") return next();
    const orderId = c.req.param("id");
    if (!orderId) return next();

    const header = getPaymentHeader(c);
    if (!header) {
      await next();
      await appendIntentsEntries(c, orderId);
      return;
    }

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      return next();
    }

    if (!isX402IntentsRequirements(payload.accepted)) {
      return next();
    }

    if (payload.x402Version !== 2) {
      return paymentRequired(c, { error: "invalid_x402_version", accepts: [] });
    }

    if (payload.resource?.url !== options.resource(c).url) {
      return paymentRequired(c, { error: "invalid_payload", accepts: [] });
    }

    try {
      const context = await deps.getOrderContext(orderId);
      if (!context) return abort(c, "order_not_found");

      const origin = deps.origins.find((candidate) =>
        originMatches(candidate, payload.accepted.network, payload.accepted.asset),
      );
      const type = (payload.payload as { type?: unknown } | undefined)?.type;

      if (type === "quote") {
        if (!origin) {
          return paymentRequired(c, { error: "invalid_network", accepts: [] });
        }
        return await handleQuote(c, orderId, payload, origin, context);
      }

      if (type === "deposit") {
        return await handleDeposit(c, orderId, payload, origin, context);
      }

      return paymentRequired(c, { error: "invalid_payload", accepts: [] });
    } catch (error) {
      // A host API call (order, operation record) failed. Nothing is
      // committed on our side that a retry cannot redo: the facilitator returns
      // its recorded result and the operation is settled or failed then.
      console.error("[x402-intents] host API call failed", error);
      return abort(c, "intents_unavailable", 502);
    }
  };
}
