---
name: nearmerch
description: Browse the NEAR Merch Store catalog, quote shipping, create orders, and pay for them over the nearmerch.com HTTP API, either with x402 (USDC on Base) or a hosted PingPay checkout. Use this when an agent needs to find NEAR merch, buy it for a shipping address, or check an order's status.
compatibility: Needs HTTPS access to nearmerch.com. Signing in needs a NEAR account with a full-access key. x402 payments need an EVM wallet holding USDC on Base mainnet.
metadata:
  version: "0.1.0"
  homepage: "https://nearmerch.com"
  source: "https://github.com/NEARBuilders/nearmerch.com/blob/main/skills/nearmerch/SKILL.md"
---

# NEAR Merch Store (nearmerch.com)

NEAR Merch Store sells official NEAR ecosystem merch (t-shirts, hoodies, hats and more), mostly printed and shipped on demand through Printful. Agents use the same JSON API as the storefront: browse products, get a shipping quote, create an order for a shipping address, then pay.

This file is served at `https://nearmerch.com/skill.md`. Its source of truth is `skills/nearmerch/SKILL.md` in the repo.

## Base URLs

| What | URL |
|------|-----|
| Storefront | `https://nearmerch.com` |
| REST API (JSON) | `https://nearmerch.com/api` |
| OpenAPI 3.1 spec | `https://nearmerch.com/api/spec.json` |
| Interactive API reference | `https://nearmerch.com/api` (HTML) |
| Sign in with NEAR | `https://nearmerch.com/api/auth/near/*` |
| x402 pay route | `POST https://nearmerch.com/orders/{orderId}/pay` (not under `/api`) |

All prices and totals are **USD dollars** as decimal numbers, for example `22` or `28.81`, not cents.

## The flow at a glance

1. Browse products (public, no auth) and pick a `productId` plus a `variantId`.
2. `POST /api/quote` with the items and a shipping address (public). Read the shipping rates.
3. Sign in with NEAR (`/api/auth/near/verify`) and keep the session cookie.
4. `POST /api/checkout` with the items, address, chosen rates and a `paymentProvider`.
5. Pay:
   - `x402`: `POST /orders/{orderId}/pay` within **15 minutes**, using an x402 v2 client and USDC on Base.
   - `pingpay`: send a human to the returned `checkoutUrl`.
6. Track it with `GET /api/orders/{orderId}` (needs the session cookie).

## 1. Browse the catalog (no auth)

| Method & path | Notes |
|---------------|-------|
| `GET /api/products` | Query: `limit` (1-500, default 50), `offset` (default 0), `productTypeSlug`. Returns `{ products, total }`. |
| `GET /api/products/{id}` | Returns `{ product }`. Unknown or unlisted → `404 NOT_FOUND`. |
| `GET /api/products/search?query=hoodie` | Returns `{ products }` (up to 20). Do not send `limit` on this route; it is rejected with 400. |
| `GET /api/products/featured` | Returns `{ products }` (up to 8). Do not send `limit`. |
| `GET /api/collections` | Returns `{ collections }`. |
| `GET /api/collections/{slug}` | Returns `{ collection, products }`. Unknown slug → `404`. |
| `GET /api/product-types` | Returns `{ productTypes }` (`slug`, `label`, ...). Use a `slug` as `productTypeSlug`. |
| `GET /api/site-config` | Returns `{ maintenance: { enabled, message? } }`. When `enabled` is true, checkout is refused. |

The fields you need on a product:

```jsonc
{
  "id": "019cf658-91d3-75dc-824f-752132f58a3c",   // productId
  "slug": "aiayn-CcXkQY_2NIfI",                    // storefront URL: https://nearmerch.com/products/{slug}
  "title": "AIAYN",
  "price": 22,                                      // USD
  "currency": "USD",
  "options": [{ "name": "Size", "values": ["S", "M", "L"] }],
  "variants": [
    {
      "id": "printful-variant-5235396146",          // variantId
      "title": "AIAYN / S",
      "price": 22,
      "attributes": [{ "name": "Size", "value": "S" }, { "name": "Color", "value": "Black" }],
      "availableForSale": true
    }
  ],
  "fulfillmentProvider": "printful",
  "metadata": { "purchaseGate": { "pluginId": "legion-holder" } } // only on gated items
}
```

Pick a variant whose `availableForSale` is `true` and whose `attributes` match what was asked for (size, color). Products with `metadata.purchaseGate` can only be bought by NEAR accounts that pass that gate. Otherwise checkout returns `403`.

## 2. Quote shipping (no auth)

`POST /api/quote`

```json
{
  "items": [
    { "productId": "PRODUCT_ID", "variantId": "VARIANT_ID", "quantity": 1 }
  ],
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
}
```

Shipping address fields: `firstName`, `lastName`, `addressLine1`, `city`, `postCode`, `email` (valid email) and `country` (2-letter ISO code) are required. `companyName`, `addressLine2`, `state`, `phone` and `taxId` are optional. Items fulfilled by Lulu (`fulfillmentProvider: "lulu"`) also need `phone`. Without it, checkout returns `400` ("Phone number is required for delivery"). If shipping isn't available to an address, quote or checkout returns `400` with the reason.

Response (trimmed):

```json
{
  "subtotal": 22,
  "shippingCost": 4.95,
  "tax": 1.86,
  "vat": 0,
  "total": 28.81,
  "currency": "USD",
  "providerBreakdown": [
    {
      "provider": "printful",
      "itemCount": 1,
      "subtotal": 22,
      "selectedShipping": { "provider": "printful", "rateId": "STANDARD", "rateName": "Flat Rate", "shippingCost": 4.95, "currency": "USD" },
      "availableRates": [ { "rateId": "STANDARD", "shippingCost": 4.95 }, { "rateId": "STANDARD_CARBON_OFFSET", "shippingCost": 5.04 } ]
    }
  ],
  "estimatedDelivery": { "minDays": 4, "maxDays": 6 }
}
```

Build `selectedRates` as `{ [provider]: rateId }` from `providerBreakdown`, using `selectedShipping.rateId` or another `availableRates[].rateId`. Copy `shippingCost` too. At checkout the server re-quotes the selected rates and computes the real total itself, so always pay the `totalAmount` that checkout returns.

## 3. Sign in with NEAR

Checkout and order reads need a session. Sessions come from Sign in with NEAR (NEP-413, via `better-near-auth`). The signed message's `recipient` must be **`near-merch-store.near`**, and the key must be a **full-access key** on the account.

```ts
import { sign } from "near-sign-verify";

const accountId = "your-agent.near";
const authToken = await sign("Sign in to NEAR Merch Store", {
  signer: process.env.NEAR_PRIVATE_KEY!, // "ed25519:..." full-access key for accountId
  accountId,
  recipient: "near-merch-store.near",
});

const res = await fetch("https://nearmerch.com/api/auth/near/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://nearmerch.com" },
  body: JSON.stringify({ accountId, authToken }),
});
// 200 → { success: true, token, user: { id, accountId, network } } plus Set-Cookie headers
const cookie = res.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
```

- Send that `Cookie` header on every authenticated request. It is a cookie session, so `Authorization: Bearer` is **not** accepted.
- Signed tokens are valid for 15 minutes and are single-use. Replaying one returns `401`.
- `POST /api/auth/near/nonce` with `{ "accountId", "networkId": "mainnet" }` returns a server nonce if your signer wants one. It is optional when you sign with `near-sign-verify`.
- Without a session, protected routes return `401` with `{"code":"UNAUTHORIZED","message":"Authentication required","data":{"authType":"nearAccountId"}}`.

## 4. Create the order (auth required)

`POST /api/checkout` (send the session `Cookie`)

```json
{
  "items": [
    { "productId": "PRODUCT_ID", "variantId": "VARIANT_ID", "quantity": 1 }
  ],
  "shippingAddress": { "...": "same object as the quote" },
  "selectedRates": { "printful": "STANDARD" },
  "shippingCost": 4.95,
  "successUrl": "https://nearmerch.com/order-confirmation",
  "cancelUrl": "https://nearmerch.com/checkout",
  "paymentProvider": "x402"
}
```

- `paymentProvider` is `"x402"`, `"pingpay"` or `"stripe"`. **Always set it.** It defaults to `"stripe"`, which only works where Stripe is configured. The storefront itself uses `pingpay`.
- `successUrl` and `cancelUrl` must be valid URLs. They matter for PingPay redirects, but are still required for x402.
- Optional per item: `referralAccountId` (a NEAR account) credits a referral on products that have referrals enabled.

Response for `x402`:

```json
{ "orderId": "ORDER_ID", "checkoutSessionId": "x402:ORDER_ID", "totalAmount": 28.81, "currency": "USD", "status": "payment_pending" }
```

Response for `pingpay` (and `stripe`):

```json
{ "orderId": "ORDER_ID", "checkoutSessionId": "SESSION_ID", "checkoutUrl": "https://...", "totalAmount": 28.81, "currency": "USD", "status": "draft_created" }
```

Each call creates a new order. Don't retry a successful checkout. Reuse the `orderId` you got back.

## 5a. Pay with x402 (USDC on Base)

The store speaks **x402 v2**, `exact` scheme on **Base mainnet** (`eip155:8453`), asset **USDC** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (EIP-712 domain `USD Coin`, version `2`, `eip3009` transfer). Use `@x402/fetch` v2. The v1 `x402-fetch` package won't work.

- `POST https://nearmerch.com/orders/{orderId}/pay` with no payment header returns **`402`**. The `PAYMENT-REQUIRED` response header (base64 JSON) lists `accepts` with `scheme`, `network`, `asset`, `amount`, `payTo` and `extra`.
- `amount` is USDC atomic units (6 decimals): `round(totalAmount * 100) * 10000`. So `28.81` becomes `"28810000"`.
- Retry the same request with a `PAYMENT-SIGNATURE` header (an x402 v2 encoded payment payload). `@x402/fetch` does both steps for you.
- The pay route needs **no session cookie**. Anyone holding the `orderId` can pay it.
- You must pay within **900 seconds (15 minutes)** of checkout. After that the route returns `403 {"error":"expired"}`. Create a new checkout.

```ts
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPay(`https://nearmerch.com/orders/${orderId}/pay`, { method: "POST" });
console.log(res.status, await res.json());
// 200 → { "orderId": "...", "status": "...", "currency": "USD" }
// The body is built before settlement completes, so `status` can still read
// "payment_pending". Confirm the final state with GET /api/orders/{orderId}.
```

Responses from `POST /orders/{orderId}/pay`:

| Status | Body / header | Meaning and what to do |
|--------|---------------|------------------------|
| `200` | `{ orderId, status, currency }` plus a `PAYMENT-RESPONSE` header | Paid and settled. The order is now `paid`, `processing` or `paid_pending_fulfillment` (`status` in this body can lag; check `GET /api/orders/{orderId}`). |
| `200` | `{ orderId, status, idempotent: true }` | Already paid. A repeat request is safe and does not charge or fulfill twice. |
| `402` | `PAYMENT-REQUIRED` header | No payment yet, or the payment failed verification (the decoded header has an `error`, e.g. `insufficient_funds`). Fix it and retry. The order is unchanged. |
| `402` | after a signed request | Settlement failed. The order may now be `payment_failed`. Check `GET /api/orders/{orderId}` before trying again. |
| `403` | `{"error":"order_not_found"}` | Wrong `orderId`. |
| `403` | `{"error":"expired"}` | More than 15 minutes have passed. Create a new checkout. |
| `403` | `{"error":"settlement_pending"}` | A payment was broadcast but isn't confirmed yet. **Don't pay again.** Poll the order status. |
| `403` | `{"error":"order_not_payable"}` | Not an x402 order, or not in `payment_pending` (for example a `pingpay` order). |
| `409` | `{ error, status }` | Not awaiting x402 payment. |

## 5b. Pay with PingPay (hosted checkout)

Use `"paymentProvider": "pingpay"` when a human will pay. Open the `checkoutUrl` from checkout. After PingPay confirms, the order moves from `draft_created` to `paid` and then `processing`. Watch it with `GET /api/orders/by-session/{checkoutSessionId}` or the SSE stream `GET /api/orders/status/subscribe/{checkoutSessionId}` (both need the session cookie).

## 6. Track orders (auth required, owner only)

| Method & path | Notes |
|---------------|-------|
| `GET /api/orders/{orderId}` | Returns `{ order }`. Another account's order → `403`. Unknown → `404`. |
| `GET /api/orders` | Returns `{ orders, total }` for the signed-in account (first page of 10). Do not send `limit`/`offset` as query strings. |
| `GET /api/orders/by-session/{sessionId}` | Returns `{ order }` or `{ order: null }`. |
| `GET /api/orders/status/subscribe/{sessionId}` | Server-sent events `{ status, trackingInfo, updatedAt }` until a terminal status. |

Useful `order` fields: `id`, `status`, `totalAmount`, `subtotal`, `shippingCost`, `taxAmount`, `currency`, `checkoutProvider` (`x402` | `pingpay` | `stripe`), `items[]`, `shippingAddress`, `trackingInfo[]` (`trackingCode`, `trackingUrl`, `shipmentMethodName`), `createdAt`, `updatedAt`.

Order statuses:

| Status | Meaning |
|--------|---------|
| `payment_pending` | x402 order created, waiting for payment |
| `draft_created` | Hosted checkout (PingPay/Stripe) created, waiting for payment |
| `paid` | Payment confirmed, fulfillment being confirmed |
| `processing` | Paid, and the print/fulfillment order has been confirmed |
| `paid_pending_fulfillment` | Paid, but fulfillment confirmation is still pending. The store retries it. |
| `payment_failed` | Payment settlement failed |
| `expired` | Checkout expired unpaid |
| `shipped`, `delivered` | Shipped (see `trackingInfo`), delivered |
| `on_hold`, `cancelled`, `partially_cancelled`, `returned`, `refunded`, `failed`, `rejected`, `pending` | Other fulfillment or admin states |

## Errors

API errors (everything under `/api`) are JSON:

```json
{ "defined": true, "code": "NOT_FOUND", "status": 404, "message": "This product is no longer available.", "data": { "resource": "product", "resourceId": "..." } }
```

| Status | Code | Typical cause |
|--------|------|---------------|
| `400` | `BAD_REQUEST` | Input validation failed (`data.issues`), invalid address, variant unavailable, shipping not available to the destination |
| `401` | `UNAUTHORIZED` | No or expired session cookie |
| `403` | `FORBIDDEN` | Site in maintenance ("Purchases are temporarily disabled"), a purchase gate not met, or someone else's order |
| `404` | `NOT_FOUND` | Unknown product, collection or order |
| `500` | `INTERNAL_SERVER_ERROR` | Provider failure. Checkout may say "Order Failed, please contact support (orders@nearmerch.com)" |

Don't retry `4xx` errors unchanged. Retry `5xx` errors on `GET` with backoff. Never blindly retry `POST /api/checkout`, because each success creates another order.

## Rules for agents

- Confirm the item, size and color, the shipping address and the **total in USD** with your user before checkout and before paying.
- Never put private keys or session cookies in URLs, logs or messages.
- Pay exactly the order's `totalAmount`, from the 402 challenge, within 15 minutes.
- If you see `settlement_pending`, wait and poll. Never pay twice.
- Support: `orders@nearmerch.com`.

## Planned: NEAR Intents payments

Paying from NEAR or any chain through a NEAR Intents x402 facilitator is **not live yet**. The research and go/no-go decision are in ADR 0001: <https://github.com/NEARBuilders/nearmerch.com/blob/main/docs/adr/0001-x402-near-intents-facilitator.md> (tracking issue <https://github.com/NEARBuilders/nearmerch.com/issues/237>). Until it ships, the only agent-native payment method is x402 with USDC on Base.

## More references

- OpenAPI spec (every route and schema): `https://nearmerch.com/api/spec.json`
- Agent payments (x402) guide for developers: <https://github.com/NEARBuilders/nearmerch.com/blob/main/api/README.md#agent-payments-x402>
- Source: <https://github.com/NEARBuilders/nearmerch.com>
