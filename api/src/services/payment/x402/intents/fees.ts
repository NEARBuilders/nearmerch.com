import type { FeeConfig } from "../../../../schema";
import type { X402IntentsFeeMode } from "../config";
import { X402_INTENTS_MAX_APP_FEE_BPS } from "../constants";
import type { X402IntentsAppFee, X402IntentsFeePlan, X402IntentsFeeSplit } from "./types";

/** NEAR account id (named or implicit), the recipient format 1Click appFees accept. */
const NEAR_ACCOUNT_ID =
  /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isNearAccountId(value: string): boolean {
  return NEAR_ACCOUNT_ID.test(value);
}

function splitAmount(total: bigint, bps: number): bigint {
  return (total * BigInt(bps)) / 10000n;
}

/**
 * Turn the order's fee splits into the destination amount and (optionally)
 * 1Click appFees. `totalAmount` is the order total in destination atomic units.
 *
 * - No splits: merchant receives the total.
 * - out_of_band: merchant receives the total; splits are recorded for payout
 *   reconciliation (same as Phase 1 x402).
 * - app_fees: each split is charged as a 1Click appFee (bps of amountIn) and the
 *   destination is reduced by floor(total * bps / 10000) per split, so the payer
 *   still pays ~the order total. Falls back to out_of_band when the splits exceed
 *   the 500 bps cap or a recipient is not a NEAR account id.
 */
export function planX402IntentsFees(input: {
  totalAmount: string;
  fees: ReadonlyArray<FeeConfig>;
  mode: X402IntentsFeeMode;
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

  if (splits.length === 0) {
    return {
      mode: "none",
      totalAmount: total.toString(),
      destinationAmount: total.toString(),
      splits,
    };
  }

  const outOfBand = (fallbackReason?: string): X402IntentsFeePlan => ({
    mode: "out_of_band",
    totalAmount: total.toString(),
    destinationAmount: total.toString(),
    splits,
    ...(fallbackReason ? { fallbackReason } : {}),
  });

  if (input.mode !== "app_fees") {
    return outOfBand();
  }

  const totalBps = splits.reduce((sum, split) => sum + split.bps, 0);
  if (totalBps > X402_INTENTS_MAX_APP_FEE_BPS) {
    return outOfBand(
      `appFees total ${totalBps} bps exceeds the ${X402_INTENTS_MAX_APP_FEE_BPS} bps cap`,
    );
  }

  const invalidRecipient = splits.find((split) => !isNearAccountId(split.recipient));
  if (invalidRecipient) {
    return outOfBand("appFees recipients must be NEAR account ids");
  }

  const feeTotal = splits.reduce((sum, split) => sum + BigInt(split.amount), 0n);
  const destination = total - feeTotal;
  if (destination <= 0n) {
    return outOfBand("appFees leave no destination amount");
  }

  const appFeesByRecipient = new Map<string, number>();
  for (const split of splits) {
    appFeesByRecipient.set(
      split.recipient,
      (appFeesByRecipient.get(split.recipient) ?? 0) + split.bps,
    );
  }
  const appFees: X402IntentsAppFee[] = Array.from(appFeesByRecipient, ([recipient, fee]) => ({
    recipient,
    fee,
  }));

  return {
    mode: "app_fees",
    totalAmount: total.toString(),
    destinationAmount: destination.toString(),
    splits,
    appFees,
  };
}
