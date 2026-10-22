# Agent Instructions for near-merch-store

This document gives AI agents a fast operational guide for working in the NEAR Merch Store codebase.

## Quick Reference

Start the full stack:

```bash
bun dev
```

Work on one side at a time:

```bash
bun dev:ui
bun dev:api
```

Run a production-style preview:

```bash
bun start
```

Core checks:

```bash
bun db:migrate
bun typecheck
bun test
```

## Development Workflow

### Typical Session

1. Run `bun install`
2. Run `bun db:migrate`
3. Run `bun dev`
4. Open `http://localhost:3000`

Typical local ports:

- `3000` - host
- `3002` - UI remote
- `3014` - API plugin

### Isolating Work

- `bun dev:ui` - local UI with remote API
- `bun dev:api` - local API with remote UI
- `bun dev` - full local development

### Production Preview

- Use `bun start` to run the app against production-style runtime configuration

## Code Changes

### Where to Change Things

- `ui/src/` - React UI, TanStack Router routes, client components
- `api/src/` - oRPC contract, handlers, services, data access
- `host/src/` - host server and federation orchestration
- `api/src/db/` - Drizzle schema and migrations

### Common Patterns

- Add API routes in `api/src/contract.ts`, then implement them in `api/src/index.ts`
- Keep order and API types aligned with `api/src/schema.ts`
- Use `apiClient` from `@/utils/orpc` in the UI
- Reuse existing UI primitives from `ui/src/components/ui/`
- Follow neighboring file patterns before introducing a new abstraction

### Style Requirements

- Use semantic Tailwind tokens like `bg-background`, `text-foreground`, `border-border`
- Avoid hardcoded colors unless the surrounding file already uses them intentionally
- Keep implementation comments to a minimum
- Prefer type-safe code over `any`

## Data and Environment

- Runtime configuration lives in `bos.config.json`
- Secrets belong in `.env`
- Check `.env.example` for expected variables
- Run `bun db:migrate` before testing flows that touch orders, auth, or fulfillment

## Testing and Quality

Before handing work off:

```bash
bun typecheck
bun test
```

Useful focused commands:

```bash
bun run --cwd ui tsc --noEmit
bun run --cwd api tsc --noEmit
bun run test:api
```

## Changesets

Add a changeset for user-facing changes:

```bash
bun run changeset
```

Skip changesets for docs-only changes, internal refactors, or test-only updates.

## Documentation Hierarchy

| File | Purpose | Use When |
|------|---------|----------|
| `AGENT.md` | Agent workflow guide | Starting work in this repo |
| `README.md` | Human quick start and architecture | Getting oriented |
| `CONTRIBUTING.md` | Contribution workflow and release guidance | Preparing a change |
| `api/README.md` | API plugin guide | Working on backend behavior |
| `api/LLM.txt` | Deep plugin implementation reference | Working inside the API plugin |
| `ui/README.md` | Frontend guide | Working on routes and UI |
| `host/README.md` | Host server guide | Working on host orchestration |
| `skills/nearmerch/SKILL.md` | Public agent skill, served at `https://nearmerch.com/skill.md` | Changing any agent-facing API, auth or payment behavior (update it in the same PR) |

## Git Workflow

- Create feature branches for substantive work
- Use semantic commit prefixes like `feat:`, `fix:`, `docs:`, `refactor:`
- Run checks before committing
- Follow `CONTRIBUTING.md` for the full workflow

## Troubleshooting

UI not loading:

- Verify `bun dev` is running
- Check that `http://localhost:3002` responds
- Confirm host is available at `http://localhost:3000`

API not responding:

- Check that `http://localhost:3014` is running
- Verify database migrations were applied
- Re-run `bun db:migrate`

Type errors:

- Run `bun typecheck`
- Confirm the UI still matches the API contract and schemas

Database issues:

- Run `bun db:migrate`
- Use `bun db:push` only when appropriate for schema workflows
- Use `bun db:studio` to inspect data locally
