---
"api": minor
"host": patch
---

x402: accept payment from other chains through NEAR Intents via Ping Agent Pay (x402 #3370 upfront `near-intents` offers from Ping `/offers`, quote and deposit flow, operation records, fee splits recorded out of band). `X402_ENABLED` stays the master switch (default off); `X402_INTENTS_ENABLED` defaults on. Base USDC `exact` is offered only when `X402_PAY_TO_ADDRESS` is set, so without it the pay route serves the intents path only.
