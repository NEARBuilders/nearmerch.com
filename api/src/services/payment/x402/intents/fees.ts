import type { FeeConfig } from "../../../../schema";
import type { X402IntentsFeePlan, X402IntentsFeeSplit } from "./types";

function splitAmount(total: bigint, bps: number): bigint {
  return (total * BigInt(bps)) / 10000n;
}

/**
 * Record the order's fee splits for an intents payment. The merchant always
 * receives the full total (`destinationAmount`): Ping Agent Pay settles the
 * whole amount to the dashboard recipient and does not take merchant-supplied
 * appFees, so royalty/affiliate/referral splits are reconciled off-chain
 * exactly like Phase 1 x402. `totalAmount` is in destination atomic units.
 */
export function planX402IntentsFees(input: {
  totalAmount: string;
  fees: ReadonlyArray<FeeConfig>;
}): X402IntentsFeePlan {
  const total = BigInt(input.totalAmount);
  const splits: X402IntentsFeeSplit[] = input.fees
    .filter((fee) => fee.bps > 0)
    .map((fee) => ({
      type: fee.type,
      label: fee.label,
      recipient: fee.recipient,
      bps: fee.bps,
      amount: splitAmount(total, fee.bps).toString(),
    }));

  return {
    mode: splits.length === 0 ? "none" : "out_of_band",
    totalAmount: total.toString(),
    destinationAmount: total.toString(),
    splits,
  };
}
