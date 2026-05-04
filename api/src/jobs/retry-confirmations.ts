import { Effect, Schedule } from 'every-plugin/effect';
import { OrderStore } from '../store/orders';
import type { MarketplaceRuntime } from '../runtime';

export interface RetryConfirmationResult {
  totalProcessed: number;
  confirmed: number;
  stillPending: number;
  failed: number;
  errors: Array<{ orderId: string; provider: string; error: string }>;
}

export const retryPendingConfirmations = (
  runtime: MarketplaceRuntime,
  olderThanMinutes = 5
) => Effect.gen(function* () {
  const orderStore = yield* OrderStore;
  console.log(`[RetryConfirmationJob] Starting retry of paid_pending_fulfillment orders older than ${olderThanMinutes} minutes`);

  const pendingOrders = yield* orderStore.findPendingConfirmation(olderThanMinutes);

  console.log(`[RetryConfirmationJob] Found ${pendingOrders.length} orders pending fulfillment confirmation`);

  if (pendingOrders.length === 0) {
    return {
      totalProcessed: 0,
      confirmed: 0,
      stillPending: 0,
      failed: 0,
      errors: [],
    } as RetryConfirmationResult;
  }

  let confirmed = 0;
  let stillPending = 0;
  let failed = 0;
  const errors: Array<{ orderId: string; provider: string; error: string }> = [];

  for (const order of pendingOrders) {
    console.log(`[RetryConfirmationJob] Processing order ${order.id}`);

    if (!order.draftOrderIds || Object.keys(order.draftOrderIds).length === 0) {
      console.warn(`[RetryConfirmationJob] Order ${order.id} has no draft order IDs, skipping`);
      stillPending++;
      continue;
    }

    const confirmationResults: Array<{ provider: string; success: boolean; error?: string }> = [];

    for (const [providerName, draftId] of Object.entries(order.draftOrderIds)) {
      if (providerName === 'manual') {
        confirmationResults.push({ provider: providerName, success: true });
        continue;
      }

      const provider = runtime.getProvider(providerName);

      if (!provider) {
        console.error(`[RetryConfirmationJob] Provider ${providerName} not found for order ${order.id}`);
        confirmationResults.push({
          provider: providerName,
          success: false,
          error: 'Provider not found',
        });
        errors.push({
          orderId: order.id,
          provider: providerName,
          error: 'Provider not found',
        });
        continue;
      }

      const confirmResult = yield* Effect.tryPromise({
        try: () => provider.client.confirmOrder({ id: draftId }),
        catch: (e) => e instanceof Error ? e : new Error(String(e)),
      }).pipe(
        Effect.retry({ times: 3, schedule: Schedule.exponential('100 millis') }),
        Effect.map(() => ({ provider: providerName, success: true })),
        Effect.catchAll((error) => Effect.succeed({
          provider: providerName,
          success: false,
          error: error.message,
        }))
      );

      if (confirmResult.success) {
        console.log(`[RetryConfirmationJob] Successfully confirmed draft ${draftId} at ${providerName} for order ${order.id}`);
      } else {
        const errorMessage = 'error' in confirmResult ? confirmResult.error : 'Unknown error';
        console.error(`[RetryConfirmationJob] Failed to confirm draft ${draftId} at ${providerName} for order ${order.id}:`, errorMessage);
        errors.push({
          orderId: order.id,
          provider: providerName,
          error: errorMessage,
        });
      }

      confirmationResults.push(confirmResult);
    }

    const allSucceeded = confirmationResults.every(r => r.success);

    if (allSucceeded) {
      yield* orderStore.updateStatus(order.id, 'processing', 'job:retry_confirmation', 'fulfillment:confirmed');
      confirmed++;
      console.log(`[RetryConfirmationJob] Order ${order.id} fully confirmed`);
    } else {
      yield* orderStore.updateStatus(order.id, 'paid_pending_fulfillment', 'job:retry_confirmation', 'fulfillment:retry_partial', { confirmationResults });
      stillPending++;
      console.warn(`[RetryConfirmationJob] Order ${order.id} still has unconfirmed drafts`);
    }
  }

  const result: RetryConfirmationResult = {
    totalProcessed: pendingOrders.length,
    confirmed,
    stillPending,
    failed,
    errors,
  };

  console.log(`[RetryConfirmationJob] Retry completed:`, result);

  return result;
});
