import { Effect, Schedule } from 'every-plugin/effect';
import type { MarketplaceRuntime, PaymentProvider } from '../../../runtime';
import type { OrderStatus } from '../../../schema';
import { OrderStore } from '../../../store/orders';

export function handlePingPayWebhookEffect(options: {
  runtime: MarketplaceRuntime;
  pingProvider: PaymentProvider;
  signature: string;
  timestamp: string;
  body: string;
}): Effect.Effect<{ received: true }, Error, OrderStore> {
  const { runtime, pingProvider, signature, timestamp, body } = options;

  return Effect.gen(function* () {
    const webhookResult = yield* Effect.tryPromise({
      try: async () =>
        pingProvider.client.verifyWebhook({
          body,
          signature,
          timestamp,
        }),
      catch: (error) => {
        const errorMsg = `Webhook verification failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error('[PingPay Webhook]', errorMsg, { error: String(error) });
        return new Error(errorMsg);
      },
    });

    console.log('[PingPay Webhook] Webhook verified successfully', {
      eventType: webhookResult.eventType,
      orderId: webhookResult.orderId,
      sessionId: webhookResult.sessionId,
    });

    const eventType = webhookResult.eventType;
    const { orderId, sessionId } = webhookResult;

    const store = yield* OrderStore;

    console.log('[PingPay Webhook] Looking up order', { orderId, sessionId });

    let order = orderId ? yield* store.find(orderId) : null;
    if (!order && sessionId) {
      console.log('[PingPay Webhook] Order not found by ID, trying session lookup', { sessionId });
      order = yield* store.findByCheckoutSession(sessionId);
    }

    if (!order) {
      console.warn('[PingPay Webhook] Order not found, skipping processing', { orderId, sessionId });
      return { received: true } as const;
    }

    console.log('[PingPay Webhook] Order found', {
      orderId: order.id,
      currentStatus: order.status,
      eventType,
    });

    const resolvedOrderId = order.id;
    const draftOrderIds = order.draftOrderIds || {};

    switch (eventType) {
      case 'payment.success':
      case 'checkout.session.completed': {
        console.log('[PingPay Webhook] Processing payment success event', {
          currentStatus: order.status,
        });

        if (order.status !== 'draft_created' && order.status !== 'pending' && order.status !== 'payment_pending') {
          console.log('[PingPay Webhook] Order already processed, skipping', {
            orderId: order.id,
            currentStatus: order.status,
          });
          return { received: true } as const;
        }

        yield* store.updateStatus(
          resolvedOrderId, 
          'paid', 
          'service:pingpay',
          eventType,
          { sessionId }
        );
        console.log('[PingPay Webhook] Updated order status to paid', { orderId: resolvedOrderId });

        if (Object.keys(draftOrderIds).length === 0) {
          console.log('[PingPay Webhook] No draft orders to confirm', { orderId: resolvedOrderId });
          return { received: true } as const;
        }

        console.log('[PingPay Webhook] Confirming draft orders', {
          draftOrderIds,
          orderId: resolvedOrderId,
        });

        const confirmationResults: Record<string, { success: boolean; error?: string }> = {};

        for (const [providerName, draftId] of Object.entries(draftOrderIds)) {
          if (providerName === 'manual') {
            console.log('[PingPay Webhook] Manual provider, skipping confirmation', { providerName });
            confirmationResults[providerName] = { success: true };
            continue;
          }

          console.log('[PingPay Webhook] Confirming order with provider', { providerName, draftId });

          const provider = runtime.getProvider(providerName);
          if (!provider) {
            console.error('[PingPay Webhook] Provider not configured', { providerName });
            confirmationResults[providerName] = { success: false, error: 'Provider not configured' };
            continue;
          }

          const confirmEffect = Effect.tryPromise({
            try: () => provider.client.confirmOrder({ id: draftId as string }),
            catch: (error) => {
              const errorMsg = `Failed to confirm order at ${providerName}: ${error instanceof Error ? error.message : String(error)}`;
              console.error('[PingPay Webhook]', errorMsg, { error: String(error), providerName, draftId });
              return new Error(errorMsg);
            },
          }).pipe(Effect.retry({ times: 3, schedule: Schedule.exponential('100 millis') }));

          const result = yield* confirmEffect.pipe(
            Effect.map((r) => {
              console.log('[PingPay Webhook] Successfully confirmed order', { providerName, draftId, result: r });
              return { success: true } as const;
            }),
            Effect.catchAll((error) => {
              const errorMsg = error.message || String(error);
              const isCostCalculationPending = /calculat|cost.*pending|not.*possible.*confirm/i.test(errorMsg);
              if (isCostCalculationPending) {
                console.warn('[PingPay Webhook] Order confirmation failed — Printful costs still calculating. Order will remain in paid_pending_fulfillment for retry job.', {
                  providerName,
                  draftId,
                  error: errorMsg,
                });
              } else {
                console.error('[PingPay Webhook] Order confirmation failed', {
                  providerName,
                  draftId,
                  error: errorMsg,
                });
              }
              return Effect.succeed({ success: false as const, error: errorMsg, isCostCalculationPending });
            })
          );

          confirmationResults[providerName] = result;
        }

        console.log('[PingPay Webhook] Confirmation results', { confirmationResults });

        const allSuccess = Object.values(confirmationResults).every((r) => r.success);
        const finalStatus: OrderStatus = allSuccess ? 'processing' : 'paid_pending_fulfillment';
        yield* store.updateStatus(
          resolvedOrderId, 
          finalStatus, 
          'service:pingpay',
          `fulfillment:${allSuccess ? 'confirmed' : 'partial'}`,
          { confirmationResults, allSuccess }
        );
        console.log('[PingPay Webhook] Updated final status', { orderId: resolvedOrderId, finalStatus, allSuccess });
        break;
      }

      case 'payment.failed':
        console.log('[PingPay Webhook] Processing payment failed event', { orderId: resolvedOrderId });
        yield* store.updateStatus(
          resolvedOrderId, 
          'payment_failed', 
          'service:pingpay',
          eventType,
          { sessionId }
        );
        console.log('[PingPay Webhook] Updated order status to payment_failed', { orderId: resolvedOrderId });
        break;

      default:
        console.warn('[PingPay Webhook] Unknown event type', { eventType });
        break;
    }

    console.log('[PingPay Webhook] Processing completed successfully', { orderId: resolvedOrderId });
    return { received: true } as const;
  });
}
