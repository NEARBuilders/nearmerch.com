import { Effect, Schedule } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import type { MarketplaceRuntime, PaymentProvider } from '../../../runtime';
import type { OrderStatus } from '../../../schema';
import { OrderStore } from '../../../store/orders';
import { ProviderConfigStore } from '../../../store/providers';
import { EmailService } from '../../email';
import { processPaymentSuccessEffect } from '../payment-success';

export function canApplyPaymentFailure(status: OrderStatus): boolean {
  return status === 'draft_created' || status === 'pending' || status === 'payment_pending';
}

export function handlePingPayWebhookEffect(options: {
  runtime: MarketplaceRuntime;
  pingProvider: PaymentProvider;
  signature: string;
  timestamp: string;
  body: string;
}): Effect.Effect<{ received: true }, Error, OrderStore | ProviderConfigStore | EmailService> {
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
        return new ORPCError('UNAUTHORIZED', { message: errorMsg });
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

        const result = yield* processPaymentSuccessEffect({
          runtime,
          order,
          actor: 'service:pingpay',
          metadata: { sessionId, eventType },
        });
        console.log('[PingPay Webhook] Updated final status', { orderId: order.id, finalStatus: result.order.status, allSuccess: result.allProviderConfirmationsSucceeded });
        break;
      }

      case 'payment.failed':
        console.log('[PingPay Webhook] Processing payment failed event', { orderId: resolvedOrderId(order.id) });

        if (!canApplyPaymentFailure(order.status)) {
          console.log('[PingPay Webhook] Order is no longer awaiting payment, skipping failure event', {
            orderId: order.id,
            currentStatus: order.status,
          });
          return { received: true } as const;
        }

        yield* store.updateStatus(
          resolvedOrderId(order.id),
          'payment_failed',
          'service:pingpay',
          eventType,
          { sessionId },
        );
        console.log('[PingPay Webhook] Updated order status to payment_failed', { orderId: resolvedOrderId(order.id) });
        break;

      default:
        console.warn('[PingPay Webhook] Unknown event type', { eventType });
        break;
    }

    console.log('[PingPay Webhook] Processing completed successfully', { orderId: resolvedOrderId(order.id) });
    return { received: true } as const;
  });
}

function resolvedOrderId(orderId: string): string {
  return orderId;
}
