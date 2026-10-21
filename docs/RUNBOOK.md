# Runbook

## First-time setup

Node 22+ and pnpm 10 are required.

```bash
pnpm install
pnpm env:init      # writes .env with development defaults and random local secrets
pnpm db:start      # embedded PostgreSQL 16 on port 54329
pnpm db:migrate
pnpm db:seed       # idempotent; skips if the seed admin already exists
pnpm dev           # API on http://localhost:4000, web on http://localhost:3000
```

Sign in with any seeded phone and the test-mode code `123456` (`OTP_TEST_MODE=true`, development only):

| Phone | Who |
| --- | --- |
| +91 90000 00001 | Admin with every permission flag |
| +91 90000 00002 | Admin, operations |
| +91 90000 00003 | Admin, finance |
| +91 90000 00010 | Owner (also a guest), three properties |
| +91 90000 00011 | Owner, more listings including one awaiting review |
| +91 90000 00020 / 21 | Guests |

Create a real first admin on a fresh database with:

```bash
pnpm seed:admin --phone +91XXXXXXXXXX --name "Full Name"
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm lint` | ESLint across all packages, then the brand check |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Shared unit tests, API integration tests (against `propcare_test`) and web unit tests |
| `pnpm test:e2e` | Playwright smoke tests against the running dev stack (install Chromium first: `pnpm --filter @propcare/web exec playwright install chromium`) |
| `pnpm ai:eval` | Every AI feature on seeded data: redaction, injection, schema and guard-rail checks. Writes nothing. |
| `pnpm --filter @propcare/api openapi` | Regenerates `docs/openapi.json` from the controllers and shared schemas |
| `pnpm db:status` / `pnpm db:stop` | Embedded database status and stop |
| `pnpm db:reset` | **Destructive.** Drops and re-seeds the local development database only |

## Switching adapters (all through `.env`)

- **AI:** `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_SMART`. Turn
  everything off with `AI_ENABLED=false`, or individual features in Admin → Policy settings (`ai.*`).
  Check the current model IDs at https://docs.claude.com.
- **Storage:** `STORAGE_DRIVER=s3` plus the `S3_*` variables. `docker compose up -d minio minio-init`
  gives a local S3; its values are in comments in `docker-compose.yml`.
- **Queue:** `QUEUE_DRIVER=bullmq` with `REDIS_URL` (`docker compose up -d redis`).
- **Payments and SMS:** only the mock and console adapters exist. Production start-up refuses
  them, refuses `OTP_TEST_MODE` and refuses insecure cookies. Add a real adapter in
  `apps/api/src/adapters` before going live.

## Operations

- **Jobs** run in the API process (`JOBS_ENABLED=true`):
  - expiring payment holds and booking requests
  - completing stays and payout eligibility
  - quote expiry and work-order auto-acceptance
  - issue auto-close
  - the outbox dispatcher (notifications and media variants)
  - the daily AI briefing
- **Logs** are JSON lines on stdout. OTPs, session tokens, access notes, phone numbers, documents
  and payment payloads are never logged.
- **Health:** `GET /api/v1/health/live` and `GET /api/v1/health/ready` (the latter checks the database).
- **Backups:** `pg_dump` the database and back up the private bucket. Public variants can be
  regenerated, because they are derived from private originals.

## Troubleshooting

- **The web app shows stale code in development.** An old service worker may be cached from a
  production build. The dev layout unregisters it automatically; reload once, or clear it in
  DevTools → Application → Service workers.
- **Windows path errors when installing or starting Postgres.** Keep the repo path short.
  `node-linker=hoisted` and the copied Postgres binaries already work around MAX_PATH.
- **Port 54329 is in use.** Either the embedded or the Docker Postgres is already running. Run
  only one of them.
- **`pnpm ai:eval` says there is no seeded admin.** Run `pnpm db:seed` first.
