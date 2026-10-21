# Property Care and Stays platform: MVP

A property care and short-stay marketplace for India, built from `docs/SPEC.md` (v0.3). The
product name is configuration (`PRODUCT_NAME`). This is a pnpm monorepo:

- **`packages/shared`:**
  - Enums, zod schemas, state machines.
  - Money, pricing, commission and refund maths.
  - Policy registry, messages and brand.
- **`apps/api`:** NestJS 11 modular monolith on PostgreSQL 16 (Prisma). Adapters for SMS,
  payments, storage, malware scanning, AI, clock and queue.
- **`apps/web`:** Next.js 15 app.
  - Public: home, search, stay pages.
  - Guest: checkout, trips, issues.
  - Owner: properties, verification, listing wizard and calendar, maintenance requests, quotes and
    approvals, bookings, earnings.
  - Admin console: queues, request and work-order workspaces, providers, listings review,
    verifications, bookings, issues, payouts, payments, commission, catalogue, policy settings,
    staff, AI usage, reports, audit.

## Quick start

```bash
pnpm install
pnpm env:init
pnpm db:start
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Then open http://localhost:3000. Sign in with a seeded phone such as `9000000020` (guest),
`9000000010` (owner) or `9000000001` (admin), using the test-mode code `123456`. The full table of
seeded accounts, commands, adapters and troubleshooting is in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm ai:eval
pnpm test:e2e     # needs the dev stack running and Playwright's Chromium installed
```

## Documents

- [docs/SPEC.md](docs/SPEC.md): the specification.
- [docs/DECISIONS.md](docs/DECISIONS.md): choices made during the build, known gaps and
  business-pending items.
- [docs/RUNBOOK.md](docs/RUNBOOK.md): setup, operations, troubleshooting.
- [docs/openapi.json](docs/openapi.json): generated API reference.
- [CLAUDE.md](CLAUDE.md): working rules for coding agents.

Qualified legal and accounting review is required before accepting live paid jobs or bookings
(SPEC §19).
