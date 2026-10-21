# Decisions log

Small choices made while building the MVP from `docs/SPEC.md` (v0.3). Each entry says what was
decided and why. Business-pending items (SPEC §19) stay configurable and are listed at the end.

## Workspace and tooling

- **pnpm workspace with `node-linker=hoisted`.** Nested `node_modules` paths exceeded Windows
  MAX_PATH during install and when running Postgres binaries; a flat layout avoids it.
- **Embedded PostgreSQL 16 for local development** (`scripts/local-db.mjs`, port 54329). There is
  no Docker dependency to get started. Binaries are copied to `%LOCALAPPDATA%\propcare\pg16`
  (short path), and the data lives in `%LOCALAPPDATA%\propcare\data` (`~/.local/share/propcare` on
  macOS/Linux). `docker-compose.yml` offers the same port and credentials as an alternative, plus
  Redis, MinIO and ClamAV for the production adapters.
- **Two databases:** `propcare` (dev, seeded) and `propcare_test` (truncated before each suite).
- **Versions are pinned exactly** and were all published at least two weeks before the build.
- **Brand check:** `scripts/check-brand.mjs` fails lint if the product name appears anywhere
  except `packages/shared/src/brand.ts`. Docs and the README are exempt.

## API

- **Sessions:** opaque random token in an HttpOnly `sid` cookie; only its SHA-256 is stored. The
  active role lives on the session, so switching roles never needs a new login.
- **CSRF:** double-submit cookie (`csrf_token`) and `x-csrf-token` header on every mutating request.
- **Idempotency:** the `Idempotency-Key` header (8–100 of `[A-Za-z0-9_-]`) is required on money and
  booking actions. Replays return the stored response; the same key with a different body is rejected (`IDEMPOTENCY_KEY_REUSED`).
- **Errors:** `{ error: { code, message, details[] } }`. Other users' resources return 404, never
  403, so existence is not leaked.
- **State machines** live in `packages/shared/src/state-machines.ts`. `RecordsService.transition`
  is the only code path that changes a status, and it writes `status_events`. Deleting the only
  quote draft returns the request from `QUOTATION_DRAFT` to `UNDER_REVIEW`.
- **Double-booking** is prevented by the `listing_occupancy` exclusion constraint
  (`daterange [)`, btree_gist). Holds, bookings, owner/admin blocks and maintenance blocks share it.
- **Append-only and immutability rules are database triggers:** `audit_events`, `status_events`,
  sent quote lines, booking pricing snapshots, and ADMIN role exclusivity.
- **Transactional outbox:** domain events are written in the same transaction and dispatched by a
  leased poller. The in-process queue driver is the default; BullMQ is available with `QUEUE_DRIVER=bullmq`.
- **Rate limiting is in memory** (single instance). Move it to Redis before running more than one API instance.
- **Commission without any enabled benchmark** falls back to the ceiling (`NO_BENCHMARK_FALLBACK`),
  so the platform never charges more than the configured maximum.
- **Payout dual approval:** payouts above `payout.dual_approval_threshold_paise` need one finance
  admin to approve and a different one to mark them paid. Payouts have no separate APPROVED status.
- **Stay tax** defaults to 0 bps (`pricing.stay_tax_bps`) until an accountant confirms the GST treatment.
- **Disclosure windows:** the exact address appears once a booking is confirmed. Check-in
  instructions and the guest's phone appear only inside the `disclosure.*` windows before check-in.
  Contact details in messages are masked until confirmation.
- **Media:** uploads go to private storage through signed URLs, and MIME types are sniffed. Only
  published-listing photos get public WebP variants, re-encoded with sharp, which strips EXIF/GPS.
  Variants are removed when a listing is paused or archived.
- **Malware scanning** uses the no-op scanner adapter in the MVP. The ClamAV container in
  docker-compose is a slot for the real adapter.
- **Search** uses Postgres full-text search (a trigger-maintained `search_vector`) plus trigram
  similarity for place names. There is no external search service.

## AI

- **Advisory only:** no tools and no write access. Context comes from per-feature allow-list
  builders, then the redactor (phones, e-mails, URLs, coordinates, PIN codes and known secrets),
  then versioned prompt files with `<data>` delimiting and guard rails, then zod validation, then
  deterministic post-processing (urgency can only go up, IDs must exist and be visible, category
  slugs must be known).
- **Models come from env:** `AI_MODEL_FAST` (default `claude-haiku-5-5`) and `AI_MODEL_SMART`
  (default `claude-opus-5-5`). The server-side refusal fallback is requested only on the smart tier
  (`AI_REFUSAL_FALLBACK=smart`).
- **Mock provider by default.** It is deterministic and offline, and it records requests so tests
  can assert on exactly what would leave the system.
- **`pnpm ai:eval`** runs `AiService.dryRun` for every feature against the seeded dev data, with
  planted contact details and an injection string. It writes nothing. It runs under Jest
  (ts-jest), because Nest DI needs decorator metadata that tsx/esbuild does not emit.

## Web

- **Next.js App Router.** Public pages (home, search, stay detail) render on the server for SEO and
  speed. Signed-in areas are client components using SWR against the same-origin `/api` proxy.
- **Client role gates (`RoleGate`, `SignedIn`) only route people.** The API enforces every rule.
- **Forms use native validation** with `:user-invalid` styling and an `aria-invalid` bridge.
  Dialogs use `<dialog>.showModal()`, with `closedby="any"` as a progressive enhancement.
- **`pattern` attributes are written for the `v` regex flag,** which browsers now use: `-` is
  escaped inside character classes. A check script validated every pattern.
- **The service worker is registered in production only.** Dev chunk names are not content-hashed,
  so caching them served stale code. In development the page unregisters any old worker.
- **On-behalf recording:** admins record visits, checklist results and evidence for a chosen
  provider, with the report source (phone, messaging app…). A photo checklist item stores the
  attachment ids of the evidence it refers to.
- **The quote builder** previews totals with the shared `computeQuoteTotals`, and the server
  recomputes them on save. New lines default to 18% tax as a convenience; it is editable.

## Known gaps (not built in this MVP)

- Owner-facing invoice/receipt list. The API (`/invoices`, PDF download URLs) exists.
- UI for change orders, listing photo reordering, provider document uploads, creating new service
  categories (the existing ones can be edited as JSON) and editing cancellation policies (read-only
  in the console). The API endpoints exist for all of these.
- The Playwright suite covers the public and customer smoke paths only, not all eleven §18.2 scenarios.
  Most of those scenarios are covered at the API level by the Jest integration suites.

## Business-pending (SPEC §19), kept configurable

Product name (`PRODUCT_NAME`) · commission benchmarks and the undercut/floor/ceiling settings
(placeholders, shown as "unconfirmed" in the console) · GST on stays, commission and maintenance ·
invoice numbering · legal structure, terms and privacy text (placeholder pages) · KYC rules ·
payout method (manual, with masked references only) · cancellation policy details (seeded
placeholders) · payment and SMS providers (mock and console adapters; production refuses to start
with them) · pilot geography (`service_areas`) · SLAs and emergency definitions · retention periods.
