import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'every-plugin/effect';
import { handlePingPayWebhookEffect } from '@/services/payment/pingpay/webhook';
import { EmailService } from '@/services/email';
import { OrderStore, ProviderConfigStore } from '@/store';

describe('payment webhook recovery', () => {
  it('records a failed post-claim workflow and keeps the order recoverable', async () => {
    const order = {
      id: 'order-payment-recovery',
      status: 'draft_created',
      items: [],
      draftOrderIds: {},
    } as any;
    const statusUpdates: string[] = [];
    const failPaymentWebhook = vi.fn(() => Effect.void);
    const updateStatus = vi.fn((_orderId: string, status: string) => {
      statusUpdates.push(status);
      if (status === 'processing') {
        return Effect.fail(new Error('fulfillment status update failed'));
      }
      return Effect.succeed({ ...order, status });
    });

    const layer = Layer.mergeAll(
      Layer.succeed(OrderStore, {
        find: () => Effect.succeed(order),
        claimPaymentWebhook: () => Effect.succeed({ claimed: true as const, order: { ...order, status: 'paid_pending_fulfillment' } }),
        completePaymentWebhook: () => Effect.void,
        failPaymentWebhook,
        updateStatus,
      } as any),
      Layer.succeed(ProviderConfigStore, {} as any),
      Layer.succeed(EmailService, {} as any),
    );

    const effect = handlePingPayWebhookEffect({
      runtime: {
        getProvider: () => null,
      } as any,
      pingProvider: {
        client: {
          verifyWebhook: async () => ({
            eventId: 'ping-recovery-event',
            eventType: 'payment.success',
            orderId: order.id,
          }),
        },
      } as any,
      signature: 'verified',
      timestamp: 'test-time',
      body: '{"id":"ping-recovery-event","type":"payment.success"}',
    }).pipe(Effect.provide(layer));

    const exit = await Effect.runPromiseExit(effect);

    expect(exit._tag).toBe('Failure');
    expect(failPaymentWebhook).toHaveBeenCalledWith('pingpay', 'ping-recovery-event', expect.any(Error));
    expect(statusUpdates).toEqual(['processing', 'paid_pending_fulfillment']);
  });
});
