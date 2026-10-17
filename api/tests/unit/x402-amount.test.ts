import { describe, expect, it } from 'vitest';
import { parseOrderIdFromPayPath, usdDollarsToUsdcAtomic } from '@/services/payment/x402/amount';
import {
  isX402AlreadyPaid,
  isX402Order,
  isX402Payable,
} from '@/services/payment/x402/settlement';
import type { OrderWithItems } from '@/schema';

function order(overrides: Partial<OrderWithItems> = {}): OrderWithItems {
  return {
    id: 'order_1',
    userId: 'buyer.near',
    status: 'payment_pending',
    totalAmount: 42.5,
    currency: 'USD',
    checkoutProvider: 'x402',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

describe('x402 amount conversion', () => {
  it('converts USD dollars to 6-decimal USDC atomic units (cents × 10^4)', () => {
    expect(usdDollarsToUsdcAtomic(25)).toBe('25000000');
    expect(usdDollarsToUsdcAtomic(42.5)).toBe('42500000');
  });

  it('parses the order id from the pay path', () => {
    expect(parseOrderIdFromPayPath('/orders/abc-123/pay')).toBe('abc-123');
    expect(parseOrderIdFromPayPath('/orders/abc-123/pay/')).toBe('abc-123');
    expect(parseOrderIdFromPayPath('/orders/abc-123')).toBeUndefined();
  });
});

describe('x402 payability', () => {
  it('treats x402 payment_pending orders as payable', () => {
    const pending = order();
    expect(isX402Order(pending)).toBe(true);
    expect(isX402Payable(pending)).toBe(true);
    expect(isX402AlreadyPaid(pending)).toBe(false);
  });

  it('treats paid x402 orders as already paid, not payable', () => {
    const paid = order({ status: 'processing' });
    expect(isX402Payable(paid)).toBe(false);
    expect(isX402AlreadyPaid(paid)).toBe(true);
  });

  it('does not treat pingpay orders as x402 payable or already paid', () => {
    const pingpay = order({ checkoutProvider: 'pingpay', status: 'paid' });
    expect(isX402Order(pingpay)).toBe(false);
    expect(isX402Payable(pingpay)).toBe(false);
    expect(isX402AlreadyPaid(pingpay)).toBe(false);
  });
});
