import type { FeeConfig } from "../../schema";

export type CheckoutReferralFee = {
  recipient: string;
  feeAmount: number;
};

/**
 * Aggregate product fee splits and referral payouts into one FeeConfig list.
 * Product fees merge by recipient:type:label (bps summed); referral amounts
 * become effective bps of the order total. Shared by PingPay checkout and the
 * x402 near-intents path so both see the same splits.
 */
export function aggregateCheckoutFees(input: {
  itemFees: ReadonlyArray<ReadonlyArray<FeeConfig> | undefined>;
  referralFees: ReadonlyArray<CheckoutReferralFee>;
  totalAmount: number;
}): FeeConfig[] {
  const feeMap = new Map<string, FeeConfig>();

  const upsertFee = (fee: FeeConfig) => {
    const key = `${fee.recipient}:${fee.type}:${fee.label}`;
    const existing = feeMap.get(key);

    if (existing) {
      feeMap.set(key, {
        ...existing,
        bps: existing.bps + fee.bps,
      });
      return;
    }

    feeMap.set(key, fee);
  };

  for (const fees of input.itemFees) {
    if (!fees || fees.length === 0) continue;
    for (const fee of fees) {
      upsertFee(fee);
    }
  }

  const referralFeeAmountByRecipient = new Map<string, number>();
  for (const referralFee of input.referralFees) {
    referralFeeAmountByRecipient.set(
      referralFee.recipient,
      (referralFeeAmountByRecipient.get(referralFee.recipient) ?? 0) +
        referralFee.feeAmount,
    );
  }

  for (const [recipient, feeAmount] of referralFeeAmountByRecipient.entries()) {
    const effectiveBps =
      input.totalAmount > 0
        ? Math.round((feeAmount / input.totalAmount) * 10000)
        : 0;

    if (effectiveBps <= 0) {
      continue;
    }

    upsertFee({
      type: "affiliate",
      label: "Referral",
      recipient,
      bps: effectiveBps,
    });
  }

  return Array.from(feeMap.values());
}
