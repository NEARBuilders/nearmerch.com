---
"ui": minor
---

Add PostHog analytics integration

- Add `posthog-js` dependency
- Create `lib/posthog.ts` with `initPostHog()` and `captureEvent()` helpers
- Track `add_to_cart` event on product page with product/variant details
- Track `download` event on free download clicks
- Configure build-time env var injection via `source.define` (`PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`)
- Add env vars to `.env.example`

PostHog is disabled by default — set `PUBLIC_POSTHOG_KEY` in your environment to activate.
