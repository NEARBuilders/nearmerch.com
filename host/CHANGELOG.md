# host

## 1.0.4

### Patch Changes

- 1b2f839: Serve the agent skill guide at `/skill.md` (`text/markdown`) from `skills/nearmerch/SKILL.md`, so agents can learn how to browse, quote, check out and pay (x402 or PingPay) on nearmerch.com.

## 1.0.3

### Patch Changes

- f7fbaee: Publish the host bundle in the release build so the x402 POST /orders/:id/pay route goes live.

## 1.0.2

### Patch Changes

- ea58d74: Fix provider quote errors not reaching frontend and sanitize debug prefixes (#96)

## 1.0.1

### Patch Changes

- 603eabb: Remove verbose HTTP and SSR request logging
