import { z } from "every-plugin/zod";

const shortString = z.string().trim().min(1).max(512);

export const X402IntentsQuotePayloadSchema = z.object({
  type: z.literal("quote"),
  refundTo: shortString,
  slippageTolerance: z.number().int().min(0).max(10000).optional(),
});

export const X402IntentsDepositPayloadSchema = z.object({
  type: z.literal("deposit"),
  operationToken: z.string().min(1).max(8192),
  depositAddress: shortString,
  depositMemo: shortString.optional(),
  txHash: shortString,
});

/** `/verify` quote response `extra` (x402 #3370). */
export const X402IntentsQuoteExtraSchema = z.object({
  depositAddress: shortString,
  amountIn: z.string().regex(/^[1-9]\d*$/),
  refundDeadline: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "refundDeadline must be an ISO-8601 timestamp",
  }),
  operationToken: z.string().min(1).max(8192),
  depositMemo: shortString.optional(),
});

export type X402IntentsQuotePayload = z.infer<typeof X402IntentsQuotePayloadSchema>;
export type X402IntentsDepositPayload = z.infer<typeof X402IntentsDepositPayloadSchema>;
export type X402IntentsQuoteExtra = z.infer<typeof X402IntentsQuoteExtraSchema>;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const NO_WHITESPACE = /^\S+$/;

function isEvmNetwork(network: string): boolean {
  return network.startsWith("eip155:");
}

/** refundTo must be an address on the origin chain (spec: refunds go to the origin). */
export function isValidOriginAddress(network: string, address: string): boolean {
  return isEvmNetwork(network) ? EVM_ADDRESS.test(address) : NO_WHITESPACE.test(address);
}

export function isValidOriginTxHash(network: string, txHash: string): boolean {
  return isEvmNetwork(network) ? EVM_TX_HASH.test(txHash) : NO_WHITESPACE.test(txHash);
}
