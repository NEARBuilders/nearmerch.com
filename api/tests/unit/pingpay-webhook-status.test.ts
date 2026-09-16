import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@/schema';
import { canApplyPaymentFailure } from '@/services/payment/pingpay/webhook';

describe('PingPay failure webhook status guard', () => {
  it.each<OrderStatus>([
    'draft_created',
    'pending',
    'payment_pending',
  ])('allows payment failure while an order is unpaid: %s', (status) => {
    expect(canApplyPaymentFailure(status)).toBe(true);
  });

  it.each<OrderStatus>([
    'paid',
    'paid_pending_fulfillment',
    'processing',
    'on_hold',
    'shipped',
    'delivered',
    'returned',
    'cancelled',
    'partially_cancelled',
    'failed',
    'payment_failed',
    'expired',
  ])('rejects late payment failure after an order has progressed: %s', (status) => {
    expect(canApplyPaymentFailure(status)).toBe(false);
  });
});
