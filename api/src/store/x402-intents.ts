import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import * as schema from "../db/schema";
import type {
  X402IntentsOperation,
  X402IntentsOperationState,
  X402IntentsRecordQuoteInput,
} from "../services/payment/x402/intents/types";
import { Database } from "./database";

/** A `settling` claim older than this is considered abandoned and may be re-claimed. */
export const X402_INTENTS_SETTLING_CLAIM_TTL_MS = 60_000;

type OperationRow = typeof schema.x402IntentsOperations.$inferSelect;

function toOperation(row: OperationRow): X402IntentsOperation {
  return {
    operationKey: row.operationKey,
    orderId: row.orderId,
    originNetwork: row.originNetwork,
    originAsset: row.originAsset,
    depositAddress: row.depositAddress,
    depositMemo: row.depositMemo,
    facilitatorUrl: row.facilitatorUrl,
    requirements: row.requirements,
    feePlan: row.feePlan,
    refundDeadline: row.refundDeadline?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    state: row.state as X402IntentsOperationState,
    settleResponse: row.settleResponse ?? null,
    lastErrorReason: row.lastErrorReason,
    duplicate: row.duplicate,
  };
}

export class X402IntentsOperationStore extends Context.Tag("X402IntentsOperationStore")<
  X402IntentsOperationStore,
  {
    /** Insert a quoted operation; an existing key is returned unchanged. */
    readonly recordQuote: (
      input: X402IntentsRecordQuoteInput & { expiresAt: Date },
    ) => Effect.Effect<X402IntentsOperation, Error>;
    readonly find: (operationKey: string) => Effect.Effect<X402IntentsOperation | null, Error>;
    /** Atomically move quoted/pending (or an abandoned settling claim) to settling. */
    readonly claimSettling: (
      operationKey: string,
    ) => Effect.Effect<X402IntentsOperation | null, Error>;
    readonly markExecuted: (input: {
      operationKey: string;
      settleResponse: Record<string, unknown>;
      duplicate: boolean;
      lastErrorReason?: string;
    }) => Effect.Effect<X402IntentsOperation | null, Error>;
    /** Release a settling claim without recording a result. */
    readonly releaseSettling: (operationKey: string) => Effect.Effect<void, Error>;
    readonly markPending: (input: {
      operationKey: string;
      settleResponse: Record<string, unknown>;
      lastErrorReason: string;
    }) => Effect.Effect<X402IntentsOperation | null, Error>;
    readonly markFailed: (input: {
      operationKey: string;
      settleResponse: Record<string, unknown>;
      lastErrorReason: string;
    }) => Effect.Effect<X402IntentsOperation | null, Error>;
  }
>() {}

export const X402IntentsOperationStoreLive = Layer.effect(
  X402IntentsOperationStore,
  Effect.gen(function* () {
    const db = yield* Database;
    const table = schema.x402IntentsOperations;

    const find = (operationKey: string) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await db
            .select()
            .from(table)
            .where(eq(table.operationKey, operationKey))
            .limit(1);
          return rows[0] ? toOperation(rows[0]) : null;
        },
        catch: (error) => new Error(`Failed to find x402 intents operation: ${error}`),
      });

    const updateWhere = (
      operationKey: string,
      states: X402IntentsOperationState[],
      values: Partial<typeof table.$inferInsert>,
    ) =>
      Effect.tryPromise({
        try: async () => {
          const rows = await db
            .update(table)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(table.operationKey, operationKey), inArray(table.state, states)))
            .returning();
          return rows[0] ? toOperation(rows[0]) : null;
        },
        catch: (error) => new Error(`Failed to update x402 intents operation: ${error}`),
      });

    return {
      find,

      recordQuote: (input) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .insert(table)
              .values({
                operationKey: input.operationKey,
                orderId: input.orderId,
                originNetwork: input.originNetwork,
                originAsset: input.originAsset,
                depositAddress: input.depositAddress,
                depositMemo: input.depositMemo ?? null,
                facilitatorUrl: input.facilitatorUrl,
                requirements: input.requirements,
                feePlan: input.feePlan,
                refundDeadline: input.refundDeadline ? new Date(input.refundDeadline) : null,
                expiresAt: input.expiresAt,
              })
              .onConflictDoNothing({ target: table.operationKey });

            const rows = await db
              .select()
              .from(table)
              .where(eq(table.operationKey, input.operationKey))
              .limit(1);
            if (!rows[0]) {
              throw new Error("operation missing after insert");
            }
            return toOperation(rows[0]);
          },
          catch: (error) => new Error(`Failed to record x402 intents quote: ${error}`),
        }),

      claimSettling: (operationKey) =>
        Effect.tryPromise({
          try: async () => {
            const staleBefore = new Date(Date.now() - X402_INTENTS_SETTLING_CLAIM_TTL_MS);
            const rows = await db
              .update(table)
              .set({ state: "settling", claimedAt: sql`now()`, updatedAt: new Date() })
              .where(
                and(
                  eq(table.operationKey, operationKey),
                  or(
                    inArray(table.state, ["quoted", "pending"]),
                    and(eq(table.state, "settling"), lt(table.claimedAt, staleBefore)),
                  ),
                ),
              )
              .returning();
            return rows[0] ? toOperation(rows[0]) : null;
          },
          catch: (error) => new Error(`Failed to claim x402 intents operation: ${error}`),
        }),

      markExecuted: (input) =>
        updateWhere(input.operationKey, ["settling"], {
          state: "executed",
          settleResponse: input.settleResponse,
          duplicate: input.duplicate,
          lastErrorReason: input.lastErrorReason ?? null,
          claimedAt: null,
        }),

      releaseSettling: (operationKey) =>
        Effect.asVoid(
          updateWhere(operationKey, ["settling"], { state: "pending", claimedAt: null }),
        ),

      markPending: (input) =>
        updateWhere(input.operationKey, ["quoted", "pending"], {
          state: "pending",
          settleResponse: input.settleResponse,
          lastErrorReason: input.lastErrorReason,
        }),

      markFailed: (input) =>
        updateWhere(input.operationKey, ["quoted", "pending"], {
          state: "failed",
          settleResponse: input.settleResponse,
          lastErrorReason: input.lastErrorReason,
        }),
    };
  }),
);
