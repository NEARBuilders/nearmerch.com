---
"ui": minor
---

Add PostHog analytics integration

- Add `posthog-js` dependency
- Create `lib/posthog.ts` with `initPostHog()` and `captureEvent()` helpers
- Track `add_to_cart` event on product page with product/variant details
- Track `download` event on free download clicks
- Use Rsbuild `loadEnv()` with monorepo root cwd to inject `PUBLIC_` prefixed env vars at build time
- Add `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST` types to `env.d.ts`
- Add PostHog secrets to release workflow env block
- Add env vars to `.env.example`

PostHog is disabled by default — set `PUBLIC_POSTHOG_KEY` in your environment to activate.
