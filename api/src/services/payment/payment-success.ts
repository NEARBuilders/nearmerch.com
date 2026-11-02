import { Effect } from 'every-plugin/effect';
import type { MarketplaceRuntime } from '../../runtime';
import type { OrderStatus, OrderWithItems } from '../../schema';
import { OrderStore, ProviderConfigStore } from '../../store';
import { EmailService } from '../email';
import { handleOrderPaidEffect } from '../order-paid';

export function processPaymentSuccessEffect(options: {
  runtime: MarketplaceRuntime;
  order: OrderWithItems;
  actor: string;
  metadata?: Record<string, unknown>;
  paymentAlreadyClaimed?: boolean;
}): Effect.Effect<{ order: OrderWithItems; allProviderConfirmationsSucceeded: boolean; confirmationResults: Record<string, { success: boolean; error?: string }> }, Error, OrderStore | ProviderConfigStore | EmailService> {
  const { runtime, order, actor, metadata, paymentAlreadyClaimed = false } = options;

  return Effect.gen(function* () {
    const orderStore = yield* OrderStore;

    if (!paymentAlreadyClaimed) {
      yield* orderStore.updateStatus(order.id, 'paid', actor, 'payment.success', metadata);
    }

    const paidResult = yield* handleOrderPaidEffect({ runtime, order });
    const finalStatus: OrderStatus = paidResult.allProviderConfirmationsSucceeded
      ? 'processing'
      : 'paid_pending_fulfillment';

    const updatedOrder = yield* orderStore.updateStatus(
      order.id,
      finalStatus,
      actor,
      `fulfillment:${paidResult.allProviderConfirmationsSucceeded ? 'confirmed' : 'partial'}`,
      { confirmationResults: paidResult.confirmationResults, allSuccess: paidResult.allProviderConfirmationsSucceeded, ...metadata },
    );

    return {
      order: updatedOrder,
      allProviderConfirmationsSucceeded: paidResult.allProviderConfirmationsSucceeded,
      confirmationResults: paidResult.confirmationResults,
    };
  });
}
