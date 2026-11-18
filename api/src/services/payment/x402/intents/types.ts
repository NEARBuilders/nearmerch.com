import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import type { FeeConfig } from "../../../../schema";
import type { X402IntentsOrigin } from "../config";
import type { X402PayOrder } from "../pay-app";

export type X402IntentsDestination = {
  network: string;
  asset: string;
  amount: string;
  recipient: string;
};

/** One royalty/affiliate split in destination-asset atomic units. */
export type X402IntentsFeeSplit = {
  type: FeeConfig["type"];
  label: string;
  recipient: string;
  bps: number;
  amount: string;
};

export type X402IntentsFeePlan = {
  /** none: no splits; out_of_band: full total to the merchant, splits recorded for reconciliation. */
  mode: "none" | "out_of_band";
  totalAmount: string;
  destinationAmount: string;
  splits: X402IntentsFeeSplit[];
};

export type X402IntentsOperationState =
  | "quoted"
  | "pending"
  | "settling"
  | "executed"
  | "failed";

export type X402IntentsOperation = {
  operationKey: string;
  orderId: string;
  originNetwork: string;
  originAsset: string;
  depositAddress: string;
  depositMemo: string | null;
  facilitatorUrl: string;
  requirements: Record<string, unknown>;
  feePlan: Record<string, unknown>;
  refundDeadline: string | null;
  expiresAt: string;
  state: X402IntentsOperationState;
  settleResponse: Record<string, unknown> | null;
  lastErrorReason: string | null;
  duplicate: boolean;
};

export type X402IntentsRecordQuoteInput = {
  orderId: string;
  operationKey: string;
  originNetwork: string;
  originAsset: string;
  depositAddress: string;
  depositMemo?: string;
  facilitatorUrl: string;
  requirements: Record<string, unknown>;
  feePlan: Record<string, unknown>;
  refundDeadline?: string;
  maxTimeoutSeconds: number;
};

export type X402IntentsSettlement = {
  transaction: string;
  payer?: string;
  network: string;
  amount?: string;
  originNetwork: string;
  originTxHash: string;
};

export type X402IntentsSettleOutcome =
  | "settled"
  | "duplicate"
  | "already_executed"
  | "in_progress"
  | "failed"
  | "order_not_payable";

export type X402IntentsSettleResult = {
  outcome: X402IntentsSettleOutcome;
  order: X402PayOrder | null;
  operation: X402IntentsOperation;
};

export type X402IntentsFailResult = {
  order: X402PayOrder | null;
  operation: X402IntentsOperation;
};

export type X402IntentsFacilitator = {
  /**
   * Unquoted `accepts[]` for a destination amount (Ping `GET /offers`): one
   * entry per origin, empty `payTo`/`amount`, `extra.destination` from the
   * merchant's dashboard settings.
   */
  offers(amountOut: string): Promise<PaymentRequirements[]>;
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse>;
  /**
   * Ping `POST /execution {depositAddress}`: claims the settled challenge as
   * executed (what @pingpay/agentpay-middleware does before serving). Returns
   * whether Ping granted the claim; undefined when the facilitator has no such
   * route.
   */
  claimExecution?(depositAddress: string): Promise<boolean | undefined>;
};

export type X402IntentsOrderContext = {
  order: X402PayOrder;
  fees: FeeConfig[];
};

export type X402IntentsPayDeps = {
  facilitatorUrl: string;
  /** Facilitator for a URL; recorded operations settle with the facilitator that quoted them. */
  getFacilitator: (facilitatorUrl: string) => X402IntentsFacilitator;
  /** Optional allow-list over the facilitator's origins; undefined = all. */
  origins?: X402IntentsOrigin[];
  getOrderContext: (orderId: string) => Promise<X402IntentsOrderContext | null>;
  recordQuote: (input: X402IntentsRecordQuoteInput) => Promise<X402IntentsOperation>;
  getOperation: (operationKey: string) => Promise<X402IntentsOperation | null>;
  settleOperation: (input: {
    operationKey: string;
    settlement: X402IntentsSettlement;
    settleResponse: Record<string, unknown>;
  }) => Promise<X402IntentsSettleResult>;
  failOperation: (input: {
    operationKey: string;
    errorReason: string;
    pending: boolean;
    settleResponse: Record<string, unknown>;
  }) => Promise<X402IntentsFailResult>;
  now?: () => number;
};
