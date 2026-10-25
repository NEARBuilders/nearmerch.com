# ADR 0001: x402 near-intents facilitator and integration seam

- **Status:** Accepted (decision: wait). Implementation is **no-go** until the preconditions in [Go/no-go](#gono-go) hold. The fee approach in [Royalties / affiliate FeeConfigs](#royalties--affiliate-feeconfigs) is **Proposed, pending confirmation**.
- **Date:** 2026-10-22
- **Issue:** [#237](https://github.com/NEARBuilders/nearmerch.com/issues/237), part of epic [#234](https://github.com/NEARBuilders/nearmerch.com/issues/234). Unblocks [#238](https://github.com/NEARBuilders/nearmerch.com/issues/238) once the go/no-go flips.
- **Scope:** Research only. No product code changes.

## Context

nearmerch accepts standard x402 payments today: EVM `exact`, USDC on Base, `POST /orders/{id}/pay` ([#235](https://github.com/NEARBuilders/nearmerch.com/issues/235), [#240](https://github.com/NEARBuilders/nearmerch.com/pull/240)). The epic also plans a second, flag-gated option. With it, an agent pays from any origin chain the NEAR Intents 1Click API supports, and the store still receives USDC on Base in the same treasury.

The relevant pieces of the existing implementation:

| Concern | Where |
|---|---|
| 402 route, facilitator client, settle hooks | `api/src/services/payment/x402/pay-app.ts` (`createX402PayApp`), mounted by `host/src/services/x402.ts` (`setupX402PayRoute`) |
| Route pattern | `X402_PAY_PATH_PATTERN = "POST /orders/:id/pay"` in `api/src/services/payment/x402/constants.ts` |
| Order payability, settle, fail | `api/src/services/payment/x402/settlement.ts` (`isX402Payable`, `isX402QuoteExpired`, `isX402SettlePending`, `settleX402OrderEffect`, `failX402OrderEffect`, `isNonTerminalX402SettleFailure`) |
| Paid → fulfillment | `processPaymentSuccessEffect` (`api/src/services/payment/payment-success.ts`) → `handleOrderPaidEffect` (`api/src/services/order-paid.ts`) |
| Host-only helpers | `getX402PayQuote`, `settleX402Order`, `failX402Order` in `api/src/contract.ts`, guarded by `X402_HOST_SECRET` |
| Config | `X402_ENABLED`, `X402_PAY_TO_ADDRESS`, `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_HOST_SECRET` (`api/src/services/payment/x402/config.ts`, `bos.config.json`) |
| Order states | `OrderStatusSchema` in `api/src/schema.ts` (`payment_pending`, `paid`, `processing`, `paid_pending_fulfillment`, `payment_failed`, `expired`, ...) |
| Fee configs | `ProductMetadata.fees` (`FeeConfigSchema`: `type`, `label`, `recipient`, `bps`) and referral `affiliate.referral.feeBps` (default `2000`). Today they are only forwarded on the PingPay path (`api/src/services/checkout.ts`). |

Today the standard path uses the default x402 flow: verify, then the handler, then settle in `onAfterSettle` with `phase === "after-handler"`. Orders are payable for `X402_MAX_TIMEOUT_SECONDS` (900 s) after creation.

## Spec status: x402-foundation/x402#3370

[x402-foundation/x402#3370](https://github.com/x402-foundation/x402/pull/3370), `specs(exact): add near-intents upfront method`, by IkerAlus. Checked 2026-10-22:

- **State:** open, not draft, not merged. GitHub `mergeable_state` is `blocked`. There are **no formal reviews** and no requested reviewers. Review has happened in conversation comments, mainly from phdargen (repo collaborator) and mikedotexe. All CI checks on the head commit pass.
- **Last update:** head commit [`2e9dded`](https://github.com/x402-foundation/x402/pull/3370/commits/2e9dded9aaeb9c58ae93be42705a2bcf5cc19f87) on 2026-10-02 (`specs(exact): harden near-intents settlement and quote handling`). The PR has had no activity since then. Note that #237 says "last revised Sep 29". There has been one more revision since.
- **File:** a single new file, `specs/schemes/exact/scheme_exact_nearintents.md` (+485).

### Breaking wire changes

There have been no commits since the epic was scoped on 2026-10-14. Every change #237 lists landed between 2026-09-14 and 2026-10-02, relative to the first #3370 draft (2026-09-04) and the superseded [#2102](https://github.com/x402-foundation/x402/pull/2102). All of them are in the current head. The commit and comment in which each landed is linked.

| Change | Landed | Effect on us |
|---|---|---|
| **Quote round-trip via facilitator `/verify`.** The client sends a typed `quote` payload. The server calls `/verify` and gets back `depositAddress`, `amountIn`, `refundDeadline` and `operationToken`, then returns a second 402. The earlier proposal for a new `POST /quote` facilitator endpoint was dropped. | [`c659cbb`](https://github.com/x402-foundation/x402/pull/3370/commits/c659cbbee5d8a2b6161da5d97d1016227a14b840), following [phdargen's proposal](https://github.com/x402-foundation/x402/pull/3370#issuecomment-5791500081) and [author's reply](https://github.com/x402-foundation/x402/pull/3370#issuecomment-5797861209) | `/orders/{id}/pay` must answer two different payload types and must not run the handler on a `quote`. |
| **Stateless HMAC `operationToken`**: `<keyId>.<expiry>.<mac>` over `network:depositAddress[:depositMemo]:resource:destinationHash:expiry`. It is a bearer credential, never reused across requests, and never put in receipts. | `c659cbb`, hardened in `2e9dded` | Binds the order's resource URL and the destination terms. It must not be logged or stored in audit metadata. |
| **Typed `quote` / `deposit` payloads.** The deposit payload echoes the *unquoted* entry and carries `depositAddress` / `depositMemo` / `txHash` itself. | `c659cbb`, reshaped in [`1e9aa45`](https://github.com/x402-foundation/x402/pull/3370#issuecomment-5888424370) | Matching the paid request to requirements uses the unquoted entry. |
| **Unquoted entry has `payTo: ""`, `amount: ""` and `extra.indicativeAmount`. The quoted entry replaces its sibling. Clients pick the entry carrying `extra.operationToken`. `maxTimeoutSeconds` is unchanged, and the cutoff is `extra.refundDeadline`.** | `1e9aa45` (2026-09-29) | Defines our 402 shape below. |
| **`settlement_pending` retry with the same `operationToken`.** The claim is released and the client MUST NOT fund a new quote. A replacement tx (fee bump) is allowed. | Adopted in [`9eba247`](https://github.com/x402-foundation/x402/pull/3370/commits/9eba2479cc7b096eb98be93fa11228c9b0e9fa73) ([comment](https://github.com/x402-foundation/x402/pull/3370#issuecomment-5575506530)), `INCOMPLETE_DEPOSIT` made non-terminal in [`03c4e44`](https://github.com/x402-foundation/x402/pull/3370/commits/03c4e44765c5b3f7f655cb0a623199672bb1136c) / [`1e9aa45`](https://github.com/x402-foundation/x402/pull/3370/commits/1e9aa459f2800b70826e232a60d53ca5ac14737c), hardened in `2e9dded` | An order must stay payable for re-presentation of the *same* operation while pending (see below). |
| **Client-controlled `refundTo`** (`refundType: ORIGIN_CHAIN`). No facilitator custody. Unused slippage buffer also returns to the client. | `c659cbb` | The store never handles intents refunds. |
| **Settlement keyed by operation (deposit address), not tx hash.** One recorded result per operation. The resource server records each quote's terms and facilitator while redeemable and executes each operation once. `proof_bound` was removed. | `2e9dded` (2026-10-02) | Drives our idempotency design. |
| **Slippage** is client-chosen in bps and clamped to the facilitator's published range in `/supported` (`kinds[].extra.slippageTolerance`). | `c659cbb` | Client concern. We do not set it. |
| **Fees:** `appFees` and `referral` are set by the **facilitator from its own configuration** at quote time. | spec §Fees | Conflicts with per-product FeeConfigs. See [Fee configs](#royalties--affiliate-feeconfigs). |

Still open in the thread:
- The author asked whether core should explicitly allow `/verify` for `quote` payloads under `upfront`. It is unanswered.
- phdargen floated a future facilitator-broadcast variant that would rename `assetTransferMethod` to the origin leg plus a new `extra.assetDeliveryMethod: "near-intents"`. The author offered a follow-up PR. If adopted, that is another **breaking** rename of the discriminator.

Related core work that affects the client UX (all open):
- [#3545](https://github.com/x402-foundation/x402/pull/3545): core answers `settlement_pending` with the same 402 as a terminal failure.
- [#3561](https://github.com/x402-foundation/x402/pull/3561): `@x402/core`'s client reports `settlement_pending` as `settle_failed`.
- [#3437](https://github.com/x402-foundation/x402/pull/3437): proposed receiver obligation on unresolved settlements.

## Candidate facilitators

Capabilities required by #3370: `/verify` that mints quotes, `/settle` with 1Click status polling, `/supported` advertising `near-intents` plus a `slippageTolerance` range, the origin networks we want to offer, and no custody of client funds.

| Candidate | `/verify` quote | `/settle` | `/supported` today | Slippage clamp | Origins | Custody / refunds | Verdict |
|---|---|---|---|---|---|---|---|
| **fastnear / mikedotexe** ([fastnear/x402-facilitator](https://github.com/fastnear/x402-facilitator), formerly `x402-near-facilitator`) | Not shipped. Draft PR [fastnear/x402-facilitator#158](https://github.com/fastnear/x402-facilitator/pull/158) (2026-09-05) adds a **disabled** `x402-near-intents` crate that is not advertised or executable. | Not for near-intents. Production `exact` only. | [`x402.mikedotexe.com/supported`](https://x402.mikedotexe.com/supported): `exact` on `near:mainnet`. [`base.x402.mikedotexe.com/supported`](https://base.x402.mikedotexe.com/supported): `exact` on `eip155:8453`. No `near-intents`. | Not advertised | n/a | The PR #158 design pins upstream #3370 at `708d660` (2026-09-04), **before** the `/verify` quote round-trip, the stateless token and client `refundTo` changes, so it is stale. `/verify` and `/settle` need a per-instance API key ([js.fastnear.com/llms.txt](https://js.fastnear.com/llms.txt)). | **Preferred candidate**, the one named in #3370's discussion. Not ready. |
| **x402.org facilitator** ([`/supported`](https://x402.org/facilitator/supported)) | No | n/a | Testnets only (e.g. `eip155:84532`), no `near-intents` | n/a | n/a | n/a | Not a candidate |
| **Other listed facilitators** ([x402 facilitators list](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md)) | None document `near-intents` | | | | | | Unknown. Re-check at go time. |
| **Self-hosted** (e.g. IkerAlus' reference work) | Possible | | | | | Would hold 1Click credentials and operation records | **Rejected** by epic #234 decision 4 (we do not run our own facilitator). [IkerAlus/x402_swapper](https://github.com/IkerAlus/x402_swapper) is the reverse direction (pay on Base, swap out) and alpha. It is not a facilitator for this flow. |

There is **no** npm mechanism package for near-intents (`@x402/near-intents` returns 404). `@x402/core` 2.28.0, the version pinned in `api/` and `host/`, ships `upfront` payment-flow support. A near-intents **server** scheme (resource-server side, not a facilitator) does not exist in the SDK. Building one in-repo would not breach decision 4.

## Decision

1. **Facilitator: wait.** Do not self-host. The preferred candidate is the fastnear (mikedotexe) facilitator, once it advertises `near-intents` against the merged spec. We will accept any facilitator that meets the [capability checklist](#gono-go). The URL is configured separately from the standard `X402_FACILITATOR_URL`.
2. **Integration seam:** as defined below, on the existing `POST /orders/{id}/pay` resource, reusing the Phase 1 order creation and `processPaymentSuccessEffect`.
3. **Flag gating:** everything is behind `X402_INTENTS_ENABLED`, default **off**. See [Flag gating](#flag-gating) for what "off" must guarantee.
4. **Go/no-go for #238: NO-GO** today. See preconditions.

## Integration seam

### Resource and amounts

- Resource: the existing `POST /orders/{id}/pay`. `resource.url` is per order, so the `operationToken` binds one order.
- Destination is always the Phase 1 settlement target:
  - `network: "eip155:8453"`
  - `asset`: USDC on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (`X402_USDC_BASE_MAINNET`)
  - `recipient`: `X402_PAY_TO_ADDRESS`
  - `amount: usdDollarsToUsdcAtomic(order.totalAmount)`, i.e. the same conversion as today
- The NEAR Intents stack has no public testnet ([js.fastnear.com/llms-full.txt](https://js.fastnear.com/llms-full.txt), "there is no public testnet deployment of the intents stack"). Intents entries are therefore only offered when `getX402Network()` is Base mainnet.
- Offered origins come from config (proposed `X402_INTENTS_ORIGINS`, a list of CAIP-2 network + asset pairs). Base USDC is **not** offered as an intents origin, because the standard `exact` entry already covers it.

### First 402 (unquoted)

The standard `exact` entry stays first and unchanged. One `near-intents` entry is added per offered origin. The amounts below are illustrative for a $32.50 order.

```jsonc
{
  "x402Version": 2,
  "resource": {
    "url": "https://nearmerch.com/orders/ord_123/pay",
    "description": "Pay for an existing merch order (USDC on Base)",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      // Phase 1 entry, unchanged
      "scheme": "exact",
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "32500000",
      "payTo": "<X402_PAY_TO_ADDRESS>",
      "maxTimeoutSeconds": 900,
      "extra": { "assetTransferMethod": "eip3009", "name": "USD Coin", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "eip155:42161",                    // origin: Arbitrum
      "asset": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC on Arbitrum
      "amount": "",                                 // vacant until quoted
      "payTo": "",                                  // vacant until quoted
      "maxTimeoutSeconds": 600,                     // deposit window, per-origin
      "extra": {
        "assetTransferMethod": "near-intents",
        "paymentFlow": "upfront",
        "indicativeAmount": "32540000",             // cached dry quote, not binding
        "destination": {
          "network": "eip155:8453",
          "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          "amount": "32500000",                     // exact amount the store receives
          "recipient": "<X402_PAY_TO_ADDRESS>"
        }
      }
    }
    // ... one entry per offered origin
  ]
}
```

### Quote request (client → us), then `/verify`

```jsonc
{
  "x402Version": 2,
  "resource": { "url": "https://nearmerch.com/orders/ord_123/pay" },
  "accepted": { /* the unquoted eip155:42161 entry */ },
  "payload": { "type": "quote", "refundTo": "0xClientOnArbitrum", "slippageTolerance": 50 }
}
```

We call the intents facilitator's `/verify` with **our own** unquoted entry, built from the order and our config and never from `accepted`, per the spec's "Resource Server Behavior". A `quote` payload never runs the handler and never changes order state.

### Second 402 (quoted entry replaces its sibling)

```jsonc
{
  "x402Version": 2,
  "resource": { "url": "https://nearmerch.com/orders/ord_123/pay" },
  "accepts": [
    { /* Phase 1 exact entry, MAY remain */ },
    {
      "scheme": "exact",
      "network": "eip155:42161",
      "asset": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "amount": "32662500",                         // VerifyResponse.extra.amountIn
      "payTo": "<DEPOSIT_ADDRESS>",                 // 1Click deposit address (illustrative)
      "maxTimeoutSeconds": 600,                     // unchanged
      "extra": {
        "assetTransferMethod": "near-intents",
        "paymentFlow": "upfront",
        "indicativeAmount": "32540000",
        "destination": { /* unchanged */ },
        "refundDeadline": "2026-10-22T10:10:00Z",
        "operationToken": "k1.1792750200.<mac>"
      }
    }
  ]
}
```

The client picks the entry carrying `extra.operationToken`, deposits `amount` to `payTo` on the origin chain before `refundDeadline`, then presents:

```jsonc
{
  "x402Version": 2,
  "resource": { "url": "https://nearmerch.com/orders/ord_123/pay" },
  "accepted": { /* the UNQUOTED entry from the first 402 */ },
  "payload": {
    "type": "deposit",
    "operationToken": "k1.1792750200.<mac>",
    "depositAddress": "<DEPOSIT_ADDRESS>",
    "txHash": "0x9bcf..."
  }
}
```

We call `/settle` **before** the handler (`paymentFlow: "upfront"`). This differs from Phase 1, where settlement runs in `onAfterSettle` after the handler.

### `settlement_pending` handling and order-state mapping

| Event | Order status | Notes |
|---|---|---|
| Quote minted | stays `payment_pending` | Record the operation (see Idempotency). |
| `/settle` → `success: true` | `payment_pending` → `paid` via `settleX402OrderEffect` (`claimStatus`), then `processPaymentSuccessEffect` → `processing` / `paid_pending_fulfillment` | Same path as Phase 1 and the PingPay/Stripe webhooks. Settlement metadata should store `extra.originNetwork` / `originTxHash` and the Base delivery tx. It must **never** store `operationToken`. |
| `/settle` → `settlement_pending` (non-terminal statuses `KNOWN_DEPOSIT_TX`, `PENDING_DEPOSIT`, `PROCESSING`, `INCOMPLETE_DEPOSIT`) | stays `payment_pending`, with `paymentDetails.settlePending = true` | The existing `failX402OrderEffect` already does this. **Required change:** `createX402PayApp`'s `onProtectedRequest` currently aborts any request with `settlement_pending` while `settlePending` is set. For intents, it must instead let through a `deposit` payload for the **same recorded operation** and reject everything else, including new quotes for that order. |
| `invalid_exact_near_intents_*` (`token_invalid`, `token_expired`, `quote_mismatch`, `deposit_not_found`) | **no change** | These reject a presentation without ending the operation. **Required change:** today every non-pending settle failure is mapped to `payment_failed`. |
| `exact_near_intents_payment_failed` / `exact_near_intents_insufficient_deposit` (terminal `REFUNDED` / `FAILED`) | `payment_pending` → `payment_failed` | 1Click refunds the client's `refundTo` directly. Matches #238's acceptance criteria. |
| `exact_near_intents_operation_executed` | unchanged (already paid) | Return the idempotent `alreadyPaid` response. |

Timing: today `isX402QuoteExpired` makes an order unpayable 900 s after creation. While an order has a recorded, unexpired operation, it MUST stay redeemable for that operation, until the token `expiry` (≥ 24 h after `refundDeadline`). A `SUCCESS` means money was delivered, so it must always be able to mark the order `paid`. The intents `maxTimeoutSeconds` should be calibrated per origin (the spec suggests minutes for EVM/Solana and much longer for Bitcoin).

Client retry UX, to be documented in the `api/README.md` agent guide once implemented:
1. Persist `payTo`, `depositMemo` and `operationToken` before depositing, and `txHash` after. Losing the token makes a delivered payment unredeemable.
2. On a `PAYMENT-RESPONSE` with `errorReason: "settlement_pending"`, wait with backoff and re-send the **same** deposit payload. A replacement tx for the same deposit address is allowed. Never request a new quote while pending.
3. Read `errorReason` from `PAYMENT-RESPONSE` yourself. Today the HTTP status is 402 for both pending and terminal failures ([#3545](https://github.com/x402-foundation/x402/pull/3545)), and `@x402/core`'s client reports both as `settle_failed` ([#3561](https://github.com/x402-foundation/x402/pull/3561)).

### Royalties / affiliate FeeConfigs

> **Status: Proposed, pending confirmation.** This approach changes epic decision 5 and needs maintainer sign-off. The rest of this ADR is Accepted.

Epic decision 5 is that FeeConfigs are preserved on the intents path via the [1Click fee config](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config), the doc linked from the referral tooltip in `ui/src/routes/_marketplace/products/$productId.tsx`. Research shows three blockers to doing that literally:

1. **The spec gives the facilitator, not the merchant, control of `appFees`/`referral`.** It "sets them from its own configuration at quote time". There is no wire field for per-order fee recipients.
2. **1Click caps the combined fee at 500 bps (5%)**, including 1Click's own share. nearmerch referral fees default to 2000 bps (`ReferralConfigSchema`), and creator `fees` can add more. Most fee'd products cannot be expressed as `appFees`.
3. **Semantics differ.** nearmerch FeeConfigs are a share *of the price* ("Price includes X% creator fees"). Under `EXACT_OUTPUT`, `appFees` are *added on the input side* and increase the buyer's deposit.

Proposed approach for the seam: the store receives the full order total on Base, as on the standard x402 path. FeeConfigs are reconciled **out of band** from `paymentDetails.referral` and product `fees`, the same treatment epic decision 5 already gives standard x402. Carrying fees via 1Click `appFees` is an open question for #238. It needs either a facilitator that accepts merchant-supplied `appFees`, or a spec extension, and only works for fee totals under the 1Click cap.

### Idempotency and storage

- **Operation record**, written when we return a quoted entry and kept until the token expiry (≥ 24 h after `refundDeadline`). Key: `network:depositAddress[:depositMemo]`. Fields: order id, the unquoted entry it was quoted from (destination terms), the facilitator URL that minted it, `refundDeadline`, state (`quoted` → `settling` → `executed` / `failed`), and the recorded settlement response, **without** the token. Settle always uses the recorded entry and facilitator, so a price or config change cannot invalidate a paid quote.
- **Execute once:** `claimStatus(payment_pending → paid)` is already atomic per order. On top of that, the operation's `executed` transition must be atomic across instances, e.g. a unique key plus a conditional update. Proposed: a dedicated table rather than the `orders.payment_details` jsonb, so there can be several quotes per order and a unique constraint. The exact schema is left to #238.
- **Two delivered operations for one order** (a client funds two quotes despite the MUST NOT): the second one finds the order already paid and gets `alreadyPaid`, but the funds have been delivered to the treasury. There is no automatic refund path, so this needs a manual refund process. See risks.
- Quote payloads must be rate-limited per requester, and the facilitator must rate-limit them too (per the spec). Each quote mints a live 1Click quote.

### Flag gating

| Variable | Status | Meaning |
|---|---|---|
| `X402_INTENTS_ENABLED` | **proposed** (from #237/#238), default off | Adds the `near-intents` entries and enables quote/deposit handling. It has no effect unless `X402_ENABLED` is on and the Phase 1 config is valid. |
| `X402_INTENTS_FACILITATOR_URL` | proposed | Facilitator for intents entries. It is separate from `X402_FACILITATOR_URL` because the standard `exact` facilitator may differ. |
| `X402_INTENTS_FACILITATOR_API_KEY` | proposed, if the chosen facilitator needs one (fastnear does) | Secret, add to `bos.config.json` secrets like the other `X402_*` vars. |
| `X402_INTENTS_ORIGINS` | proposed | Offered origin network/asset pairs. |

With `X402_INTENTS_ENABLED` off, the 402 body, settle path and order transitions must be byte-identical to Phase 1. The #238 acceptance criteria already include this, and it should be pinned by a test. Intents entries are also suppressed when `X402_NETWORK` is not Base mainnet.

## Open risks and questions

1. **Spec churn.** #3370 is unmerged, with no formal reviews and no activity since 2026-10-02. The proposed `assetDeliveryMethod` split would rename the discriminator.
2. **No facilitator.** None advertises `near-intents`. The fastnear scaffold is disabled and pinned to a pre-redesign draft. There is no ETA.
3. **Fee splits.** See above: there is no merchant-controlled `appFees` in the spec, there is the 5% cap, and the semantics differ. This conflicts with epic decision 5 as written.
4. **`settlement_pending` in core.** Pending and terminal failures look identical to stock clients ([#3545](https://github.com/x402-foundation/x402/pull/3545), [#3561](https://github.com/x402-foundation/x402/pull/3561), [#3437](https://github.com/x402-foundation/x402/pull/3437)). Agents built on `@x402/fetch` may re-quote and double-pay unless they follow our guide.
5. **SDK support.** There is no near-intents server scheme in `@x402/*`. We may need to write the resource-server side (quote round-trip and second 402) ourselves. It is unknown whether core's enrichment hooks allow returning a corrective 402 from a `/verify` result without custom middleware.
6. **Order lifetime vs. deposit windows.** The 900 s payable window and the token/refund windows (≥ 24 h grace) must be reconciled. Admin `deleteOrders` cancels provider drafts for `payment_pending` orders, so an in-flight intents payment could be orphaned. Guard or warn.
7. **Overpayment / double funding.** Delivered funds for an already-paid order have no automatic refund.
8. **Indicative amount source.** `extra.indicativeAmount` needs a cached `dry: true` 1Click quote. It is unknown whether the facilitator exposes one, or whether we must call 1Click directly (and with which API key and fees).
9. **Mainnet only.** There is no intents testnet, so end-to-end tests are mocked and the first live test spends real funds. Phase 1 itself is not yet live on Base mainnet: the pay-to address and the mainnet facilitator are still pending.
10. **Custodial senders.** Deposits from exchanges refund to the exchange. This is documented in the spec, and the agent guide must state it.

## Go/no-go

**Recorded decision (2026-10-22): NO-GO** for starting #238.

Flip to GO when **all** of these hold:

- [ ] #3370 is merged, or explicitly approved by a maintainer with a frozen wire shape (method discriminator, payload types, error codes). Re-diff this ADR against the merged text.
- [ ] A third-party facilitator advertises `near-intents` in `/supported` on mainnet with a `slippageTolerance` range, implements the `/verify` quote and `/settle` per the merged spec, keeps no client-fund custody, and covers at least one origin we want to offer. Its access terms (API key, fees, rate limits) are known.
- [ ] The fee approach is decided: out of band (this ADR's default), or 1Click `appFees` with a facilitator that accepts merchant-supplied fees.
- [ ] Phase 1 is live on Base mainnet: `X402_PAY_TO_ADDRESS` treasury set, mainnet `X402_FACILITATOR_URL`, `X402_NETWORK` unset.
- [ ] Decision on the server-side mechanism: an SDK package exists, or we accept an in-repo near-intents server scheme.

## References

- Issue [#237](https://github.com/NEARBuilders/nearmerch.com/issues/237), epic [#234](https://github.com/NEARBuilders/nearmerch.com/issues/234), implementation [#238](https://github.com/NEARBuilders/nearmerch.com/issues/238), Phase 1 [#235](https://github.com/NEARBuilders/nearmerch.com/issues/235) / [#240](https://github.com/NEARBuilders/nearmerch.com/pull/240)
- Spec PR [x402-foundation/x402#3370](https://github.com/x402-foundation/x402/pull/3370), [file at head `2e9dded`](https://github.com/IkerAlus/x402/blob/2e9dded9aaeb9c58ae93be42705a2bcf5cc19f87/specs/schemes/exact/scheme_exact_nearintents.md)
- Family spec [#3145](https://github.com/x402-foundation/x402/pull/3145), superseded draft [#2102](https://github.com/x402-foundation/x402/pull/2102)
- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- Core `settlement_pending` work: [#3545](https://github.com/x402-foundation/x402/pull/3545), [#3561](https://github.com/x402-foundation/x402/pull/3561), [#3437](https://github.com/x402-foundation/x402/pull/3437)
- fastnear facilitator: [repo](https://github.com/fastnear/x402-facilitator), [near-intents scaffold PR #158](https://github.com/fastnear/x402-facilitator/pull/158), [NEAR `/supported`](https://x402.mikedotexe.com/supported), [Base `/supported`](https://base.x402.mikedotexe.com/supported)
- [x402 facilitators list](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md)
- 1Click: [About](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api), [Fee config](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config), [Chain support](https://docs.near-intents.org/resources/chain-support), [TS SDK](https://github.com/defuse-protocol/one-click-sdk-typescript)
