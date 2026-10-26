# api

[every-plugin](https://github.com/near-everything/every-plugin) based API.

## Plugin Architecture

Built with **every-plugin** framework (Rspack + Module Federation):

```bash
┌─────────────────────────────────────────────────────────┐
│                    createPlugin()                       │
├─────────────────────────────────────────────────────────┤
│  variables: { ... }                                     │
│  secrets: { ... }                                       │
│  contract: oRPC route definitions                       │
│  initialize(): Effect → services                        │
│  createRouter(): handlers using services                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   Host Integration                      │
├─────────────────────────────────────────────────────────┤
│  bos.config.json → plugin URL + secrets                 │
│  runtime.ts → createPluginRuntime().usePlugin()         │
│  routers/index.ts → merge plugin.router into AppRouter  │
└─────────────────────────────────────────────────────────┘
```

**Plugin Structure:**

- `contract.ts` - oRPC contract definition (routes, schemas)
- `index.ts` - Plugin initialization + router handlers
- `services/` - Business logic with Effect-TS
- `db/` - Database schema and migrations

## Tech Stack

- **Framework**: every-plugin + oRPC
- **Effects**: Effect-TS for service composition
- **Database**: PostgreSQL + Drizzle ORM

## Available Scripts

- `bun dev` - Start dev server
- `bun build` - Build plugin
- `bun test` - Run tests
- `bun db:push` - Push schema to database
- `bun db:studio` - Open Drizzle Studio

## Agent payments (x402)

Agents and API clients can pay for merch orders with standard x402 (EVM `exact`, USDC on Base) instead of a hosted PingPay/Stripe redirect.

x402 is **not** a `PaymentContract` plugin (`ping` / `createCheckout` / `verifyWebhook` / `getSession`). Create the order first (with a shipping address), then settle `POST /orders/{id}/pay`.

This host speaks **x402 v2**. Use `@x402/fetch` (not the v1 `x402-fetch` package). `PAYMENT-SIGNATURE` is an x402 v2 encoded payment-signature header, not a raw EIP-3009 or Permit2 blob.

### Flow

1. Authenticate as a NEAR account (same as storefront checkout).
2. `POST /api/quote` with cart items and shipping address.
3. `POST /api/checkout` with `paymentProvider: "x402"` and the quote's `selectedRates` + `shippingCost`. The response is `orderId` + totals (`payment_pending`); there is no `checkoutUrl`.
4. `POST /orders/{id}/pay` without payment → HTTP 402 (`scheme: "exact"`, `network: "eip155:8453"`, USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
5. Retry the same request with a v2 `PAYMENT-SIGNATURE` (built by `@x402/fetch` from the 402 `accepts` payload).
6. On successful settle the order moves to `paid` / `processing`, fulfillment drafts are confirmed, and the confirmation email is sent.

### Environment

```
X402_ENABLED=true
X402_PAY_TO_ADDRESS=0xYourStoreTreasuryOnBase
X402_FACILITATOR_URL=https://facilitator.example
X402_HOST_SECRET=replace-me
```

`checkout.totalAmount` is USD **dollars**. The 402 amount is 6-decimal USDC atomic units: `round(totalAmount * 100) * 10_000` (USD cents × 10⁴). Do not treat `totalAmount` as cents.

`X402_HOST_SECRET` is a host-only shared secret for internal settle helpers. Buyers never send it.

### Paying from another chain (`near-intents`, issue #238)

When `X402_INTENTS_ENABLED=true` and the intents config is complete, the unpaid 402 also lists one entry per configured origin (e.g. USDC on Arbitrum) with `extra.assetTransferMethod: "near-intents"`, `amount: ""` and `payTo: ""`. The merchant still receives USDC on Base (`extra.destination`). The flow follows the upfront near-intents scheme ([x402 #3370](https://github.com/x402-foundation/x402/pull/3370)):

1. **Quote.** Retry with a `PAYMENT-SIGNATURE` whose `accepted` is the unquoted entry and `payload` is `{"type":"quote","refundTo":"<your address on the origin chain>"}`. You get a second 402 whose single entry has `payTo` = deposit address, `amount` = `amountIn`, and `extra.refundDeadline` / `extra.operationToken` (and `extra.depositMemo` when set). Nothing changes on the order.
2. **Deposit.** Send exactly `amount` of the origin asset to `payTo` (with the memo, if any) before `refundDeadline`.
3. **Settle.** Retry with `accepted` = the quoted entry and `payload` = `{"type":"deposit","operationToken","depositAddress","depositMemo"?,"txHash"}`.

Responses to the deposit request:

| Result | HTTP | What to do |
| --- | --- | --- |
| Paid | 200 + `PAYMENT-RESPONSE` (Base tx, `extra.originTxHash`) | Done. |
| `settlement_pending` | 402 + `PAYMENT-RESPONSE` | Retry the **same** deposit payload later. It stays valid until `refundDeadline` + 24 h, even past the 900 s quote window. Do not request a new quote; new quotes are refused while one is pending. |
| `exact_near_intents_payment_failed` | 402 + `PAYMENT-RESPONSE` (`extra.status: "REFUNDED"`, `extra.refundTo`) | The swap failed and funds were refunded on the origin chain. The order is `payment_failed`; start a new checkout. |
| `invalid_exact_near_intents_*` (e.g. `deposit_not_found`) | 402 | Nothing changed. Fix the payload (or wait for the deposit to land) and retry. |
| Replay of a settled operation | 200, `idempotent: true`, `reason: exact_near_intents_operation_executed` | Already paid; the order is not paid or fulfilled twice. |

Only fund one quote per order. A second funded quote is still delivered to the merchant and recorded as a duplicate for a manual refund.

Fee splits (royalty, affiliate, referral) are recorded on the order. With `X402_INTENTS_FEE_MODE=app_fees` they are passed to the facilitator as 1Click `appFees` (bps of `amountIn`, NEAR account recipients, max 500 bps total) and `extra.destination.amount` is reduced by the same amounts; otherwise (`out_of_band`, default) the merchant receives the full total and splits are reconciled off-chain as in Phase 1. Only use `app_fees` with a facilitator that applies merchant-supplied `extra.appFees`: spec #3370 lets the facilitator set fees from its own configuration, and a facilitator that ignores them would pay the merchant the reduced amount with nothing sent to the fee recipients.

Environment (Base mainnet only; there is no near-intents testnet):

```
X402_INTENTS_ENABLED=true
X402_INTENTS_FACILITATOR_URL=https://intents-facilitator.example
X402_INTENTS_FACILITATOR_API_KEY=optional
X402_INTENTS_ORIGINS=[{"network":"eip155:42161","asset":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","decimals":6,"maxTimeoutSeconds":300,"usdPegged":true}]
X402_INTENTS_FEE_MODE=out_of_band
```

With the flag off (default) the 402 and the Phase 1 flow are unchanged. Design and facilitator decision: [ADR 0001](../docs/adr/0001-x402-near-intents-facilitator.md).

### curl

Copy `providerBreakdown[].provider` → `selectedShipping.rateId` into `selectedRates`, and copy `shippingCost`, from the quote response.

```bash
# 1. Quote
curl -sS http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -H "Cookie: $NEAR_SESSION_COOKIE" \
  -d '{
    "items": [{"productId": "PRODUCT_ID", "variantId": "VARIANT_ID", "quantity": 1}],
    "shippingAddress": {
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@example.com",
      "addressLine1": "123 Main St",
      "city": "Los Angeles",
      "state": "CA",
      "postCode": "90001",
      "country": "US"
    }
  }'

# 2. Create an x402 order (selectedRates + shippingCost must come from the quote)
curl -sS http://localhost:3000/api/checkout \
  -H "Content-Type: application/json" \
  -H "Cookie: $NEAR_SESSION_COOKIE" \
  -d '{
    "items": [{"productId": "PRODUCT_ID", "variantId": "VARIANT_ID", "quantity": 1}],
    "shippingAddress": {
      "firstName": "Ada",
      "lastName": "Lovelace",
      "email": "ada@example.com",
      "addressLine1": "123 Main St",
      "city": "Los Angeles",
      "state": "CA",
      "postCode": "90001",
      "country": "US"
    },
    "selectedRates": { "manual": "RATE_ID" },
    "shippingCost": 0,
    "successUrl": "https://nearmerch.com/order-confirmation",
    "cancelUrl": "https://nearmerch.com/checkout",
    "paymentProvider": "x402"
  }'

# 3. Unpaid request → HTTP 402 Payment Required
curl -i -X POST "http://localhost:3000/orders/ORDER_ID/pay"
```

Prefer `@x402/fetch` for step 4. It reads the 402 `accepts` list, signs exact USDC on Base, and retries with `PAYMENT-SIGNATURE`.

### x402-fetch (v2)

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const shippingAddress = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  addressLine1: "123 Main St",
  city: "Los Angeles",
  state: "CA",
  postCode: "90001",
  country: "US",
};

const items = [{ productId: "PRODUCT_ID", variantId: "VARIANT_ID", quantity: 1 }];
const headers = {
  "Content-Type": "application/json",
  Cookie: process.env.NEAR_SESSION_COOKIE!,
};

const quote = await fetch("http://localhost:3000/api/quote", {
  method: "POST",
  headers,
  body: JSON.stringify({ items, shippingAddress }),
}).then((res) => res.json() as Promise<{
  shippingCost: number;
  providerBreakdown: Array<{ provider: string; selectedShipping: { rateId: string } }>;
}>);

const selectedRates = Object.fromEntries(
  quote.providerBreakdown.map((provider) => [
    provider.provider,
    provider.selectedShipping.rateId,
  ]),
);

const created = await fetch("http://localhost:3000/api/checkout", {
  method: "POST",
  headers,
  body: JSON.stringify({
    items,
    shippingAddress,
    selectedRates,
    shippingCost: quote.shippingCost,
    successUrl: "https://nearmerch.com/order-confirmation",
    cancelUrl: "https://nearmerch.com/checkout",
    paymentProvider: "x402",
  }),
}).then((res) => res.json() as Promise<{ orderId: string }>);

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const x402 = new x402Client();
x402.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, x402);

const paid = await fetchWithPay(
  `http://localhost:3000/orders/${created.orderId}/pay`,
  { method: "POST" },
);

console.log(paid.status, await paid.json());
```

The wallet must hold USDC on Base and the signer must support EIP-3009 (or Permit2). Repeated presentation against an already-paid order is idempotent and does not confirm fulfillment twice.

## Configuration

**bos.config.json**:

```json
{
  "app": {
    "api": {
      "name": "api",
      "development": "http://localhost:3014",
      "production": "https://cdn.example.com/api",
      "variables": {},
      "secrets": [
        "API_DATABASE_URL",
        "API_DATABASE_AUTH_TOKEN"
      ]
    }
  }
}
```
