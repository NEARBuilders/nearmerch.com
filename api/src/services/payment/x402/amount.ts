/**
 * USD cents → 6-decimal USDC atomic units (same conversion as PingPay).
 * order.totalAmount from OrderStore is dollars; cents = round(dollars * 100).
 */
export function usdDollarsToUsdcAtomic(totalAmountDollars: number): string {
  const amountInCents = Math.round(totalAmountDollars * 100);
  return String(amountInCents * 10000);
}

export function parseOrderIdFromPayPath(path: string): string | undefined {
  const match = path.match(/\/orders\/([^/]+)\/pay\/?$/);
  return match?.[1];
}
