# CLAUDE.md
Project: Gharsetu (working name). A property care and short-stay marketplace for India.
The product name is configuration (PRODUCT_NAME); never hard-code it (`scripts/check-brand.mjs` enforces this).
Source of truth: docs/SPEC.md. Log small choices in docs/DECISIONS.md.

Roles: OWNER, CUSTOMER (looking for a property), ADMIN. There is no worker login: admins manage the
provider directory and record work on providers' behalf. A user may hold OWNER and CUSTOMER; ADMIN is exclusive.
Each property has a service mode: CARE | LIST | LIST_AND_CARE.

Stack: pnpm monorepo.
- apps/web: Next.js 15 App Router, Tailwind 4, SWR.
- apps/api: NestJS 11 modular monolith.
- packages/shared: zod schemas, enums, state machines, money/pricing, policies, messages, brand.
- Data and infrastructure: PostgreSQL 16 + Prisma. An embedded Postgres runs locally (`pnpm db:start`).
  Redis/BullMQ and S3/MinIO are optional (docker-compose.yml).

Commands:
- Development: pnpm dev · pnpm db:start · pnpm db:migrate · pnpm db:seed
- Checks: pnpm lint · pnpm typecheck · pnpm test · pnpm test:e2e · pnpm ai:eval
- Docs: pnpm --filter @propcare/api openapi (writes docs/openapi.json)

Rules:
- Money is integer paise; commission is in bps; round half-up. The server computes all totals, prices, commission and refunds.
- Every state change goes through the shared transition table (`RecordsService.transition`) and writes status_events.
- Double-booking is prevented by the listing_occupancy exclusion constraint; test concurrency.
- Authorise on the server, scope queries by owner or participant, and return 404 for other users' resources.
- Use audience-specific serialisers (public, customer, owner, admin, finance); never return DB rows directly.
- Only published-listing photos are public (EXIF location stripped); everything else is private behind signed URLs.
- AI is advisory: allow-listed context, redaction, zod-validated output, no mutating tools, kill switches.
  Core flows work with AI off.
- Never log OTPs, session IDs, access notes, phone numbers, documents or payment data.
- Business policy lives in policy_settings (`packages/shared/src/policies.ts`). Providers live behind adapters; mock first.
- Destructive database commands (`pnpm db:reset`) run only against the local development database.
- A change is done only when lint, typecheck and tests pass.
