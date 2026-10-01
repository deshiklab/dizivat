# DiziVAT backend — R5 (NestJS + PostgreSQL)

Branch **`r5-nestjs`**. The `main` branch and its GitHub Pages demo (in-browser mock) are unchanged.

```
Browser ──▶ Next.js 15 (pages, middleware)  ──/api/v1/* rewrite──▶  NestJS 11 API  ──▶  PostgreSQL 16/17 (Neon in production)
            same UI, same typed client             127.0.0.1:4000       Drizzle ORM, migrations in api/drizzle
```

The frontend did not change: it still calls `/api/v1/…` via `src/lib/api/client.ts`. When it is built with
`API_UPSTREAM` set, Next.js proxies those calls to the API instead of running the in-process mock handlers. The
contract (`docs/API.md`, 176 endpoints) is the same, and **the whole existing test suite passes against the real
backend**, including 520 contract checks, every end-to-end suite, axe, and all 32 visual baselines pixel-identical.

## R5.1 — what runs where

The API is built in slices. R5.1 moves **identity, security and reference data** into real tables. The other
business modules keep their exact mock behaviour inside the API, and their data is saved to PostgreSQL so nothing
is lost on restart or redeploy.

| Area | Endpoints | R5.1 |
| --- | --- | --- |
| Sign-in / sign-out / login-info | `auth/login`, `auth/logout`, `auth/login-info` | **native** — `users`, `sessions`, `login_failures` |
| Current user | `me`, `me/password`, `me/preferences`, `me/views` | **native** — `users.preferences`, `saved_views` |
| Users & roles | `users`, `users/{id}`, `users/{id}/reset-password` | **native** — `users`, `sessions` |
| Company & branches | `company` | **native** — `company`, `branches` |
| Units of measure | `units`, `units/{id}` | **native** — `units` |
| NBR tariff | `tariff` | **native** — `tariff_lines` (per fiscal year) |
| Audit trail | `audit` | **native** — `audit_events` (append-only) |
| Health | `health` (public) | **native** — liveness + DB round-trip |
| Everything else: sales, purchases, parties, items, stock, production, accounting, VAT returns, notifications, dashboard, search… | 70 route modules | **compat** — the mock handlers run unchanged; state saved to `compat_state` (JSONB) after every write |

`api/scripts/gen-compat-routes.mjs` holds the native list and generates the compat route table
(`api/src/compat/routes.gen.ts`). CI fails if the table is stale.

### What is better than the mock now

- **Passwords** are scrypt hashes (`scrypt$N$r$p$salt$hash`), never stored in clear. Temporary passwords come from `crypto.randomInt`.
- **Server-side sessions**: the cookie keeps the same signed `body.sig` format (so the Next.js middleware still
  verifies it at the edge) but now carries a session id. The API honours it only while the `sessions` row is active, so:
  - **Sign-out is real.** A copied cookie stops working.
  - A **password change** signs out every other browser. This browser gets a fresh session.
  - An admin **reset** or **deactivation** signs the user out immediately.
  - A token that is validly signed but has no live session is rejected.
- **Lockout** (5 wrong passwords → 60 s) is stored in `login_failures`, so it survives restarts.
- **Audit trail**: rows in `audit_events`, which the app only ever inserts. Events recorded by compat handlers are forwarded in the same transaction as their data.
- **Persistence**: every record, preference, saved view, session and audit event survives API restarts and redeploys.
- **Lists in SQL** (users, audit, tariff): the search, date range, facet counts, sort and pagination match the mock
  exactly. Text sorts use an ICU collation (`"natural"`, numeric-aware) so the order is the same as the UI's `localeCompare`.

### How the compat layer works

1. **Boot**
   - Migrations run first.
   - **First start:** the demo data set is seeded into PostgreSQL (the same data the mock and the Pages demo use): 6 users with scrypt hashes, company, units, tariff, about 1,160 audit events, and the document state.
   - **Later starts:** everything is restored from PostgreSQL *before* the compat bundle loads.
2. **Per request**
   - Nest authenticates the request from the `sessions` table and runs the mock handler with that user (`api/src/compat/session-user.shim.ts`).
   - When the handler changes state, the JSONB snapshot and any new audit events are saved in one transaction.
   - A process-wide lock serialises compat requests.
3. **Write-through**
   - Native modules own users, company and units in PostgreSQL.
   - They update the in-memory copies the compat handlers read, so both sides always agree. For example, items validate their unit against the `units` table.

**Single instance by design** until R5.5 removes the compat layer: run one API process per database. Render's free
plan runs exactly one.

## Tables

| Table | Purpose |
| --- | --- |
| `users` | accounts, role, status, scrypt hash, `password_is_demo`, preferences (JSONB) |
| `sessions` | one row per sign-in; `revoked_at` + `revoke_reason` (signedOut, passwordChanged, passwordReset, deactivated) |
| `login_failures` | failures per username, `locked_until` |
| `saved_views` | list views per user and table |
| `company` (single row) + `branches` | company profile printed on Mushak forms |
| `units` | units of measure; ids from `unit_id_seq` |
| `tariff_lines` | NBR tariff per fiscal year (`numeric` rates) |
| `audit_events` | append-only audit trail (indexed by time, Dhaka day, record, record type). **R6:** every row is sealed with `prev_hash` + `hash` (SHA-256 chain); triggers refuse UPDATE / DELETE / TRUNCATE — see [NBR_ENLISTMENT.md](NBR_ENLISTMENT.md) |
| `compat_state` | JSONB state of the modules not yet ported |
| `meta` | seed version, tariff fiscal year |

The schema is in `api/src/db/schema.ts`. Migrations are generated with `npm --prefix api run db:generate` into `api/drizzle/` and applied automatically at start-up.

## Run locally

```bash
# PostgreSQL (any 14+; Debian: apt install postgresql)
sudo -u postgres psql -c "create role dizivat login password 'dizivat'" -c "create database dizivat owner dizivat"

export DATABASE_URL=postgres://dizivat:dizivat@127.0.0.1:5432/dizivat
export SESSION_SECRET=$(openssl rand -hex 32)      # web server and API must share it
export API_UPSTREAM=http://127.0.0.1:4000          # build- AND run-time

npm ci && npm --prefix api ci
npm --prefix api run build                          # → api/dist/main.js + api/dist/compat.js
node api/dist/main.js &                             # migrates, seeds on first start, listens on 127.0.0.1:4000
npm run build && npx next start -p 3000             # → http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `node api/dist/main.js --reset` | drop everything and re-seed the demo data |
| `node api/dist/main.js --migrate-only` | apply migrations and exit |
| `npm --prefix api run typecheck` | type-checks the API **and** the 70 compat route modules |

## Tests

The existing suites run unchanged against the backend (`BASE_URL=http://localhost:3000`). One suite is new:

```bash
API_RESTART_CMD=api/scripts/serve.sh DATABASE_URL=… SESSION_SECRET=… python3 scripts/api_native.py
```

It runs 39 checks: real sign-out, revocation on password change, reset and deactivation, forged tokens, lockout, scrypt-only storage, audit rows, and that **records, preferences, views, sessions, revocations, lockouts, changed passwords and audit ids survive an API restart**.

CI (`.github/workflows/backend.yml`, on every push to `r5-nestjs`):

1. Starts a PostgreSQL 16 service, runs the full suite plus `api_native.py`, and checks that the migrations and the compat table are current.
2. Builds the Docker image, pushes it to `ghcr.io/deshiklab/dizivat:r5-nestjs`, and smoke-tests it against a fresh PostgreSQL.

## Deploy: Render + Neon (free)

One Docker container runs both processes (`Dockerfile`, `docker/start.sh`): Next.js on `$PORT` and the API on
`127.0.0.1:4000`. The database is Neon, whose free plan does not expire (unlike Render's free Postgres, which is deleted after 30 days).

1. **Neon** → project → *Connect* → copy the connection string (`postgresql://…neon.tech/neondb?sslmode=require…`).
   Prefer the **direct** host (drop `-pooler` from the host name), since migrations run at start-up. `sslmode=require` and
   `channel_binding=require` are handled (upgraded to full certificate verification plus channel binding).
2. **Render** → [Deploy to Render](https://render.com/deploy?repo=https://github.com/deshiklab/dizivat/tree/r5-nestjs)
   (reads `render.yaml`: free web service, branch `r5-nestjs`, health check `/api/v1/health`). Paste the Neon string as
   `DATABASE_URL`. `SESSION_SECRET` is generated for you. Keep Render and Neon in the same region: `render.yaml` uses
   **Ohio** for a Neon project in AWS us-east-2 (pick Singapore for ap-southeast-1, and so on).
3. The first deploy builds the image, migrates and seeds Neon, then serves `https://dizivat-r5.onrender.com` (or the name Render assigns).

Free-plan notes:
- The service sleeps after 15 minutes idle; the first request then takes about a minute.
- Data lives in Neon, so it survives sleeps and redeploys.
- If a build ever runs out of memory, set the service to deploy the prebuilt image `ghcr.io/deshiklab/dizivat:r5-nestjs` instead (the package must be public: GitHub → Packages → dizivat → Package settings → Change visibility).

## Roadmap (compat → relational, one module per slice)

| Slice | Moves to its own tables |
| --- | --- |
| R5.2 | customers, vendors, items, master items, stock ledger, branches' stock |
| R5.3 | sales (6.3), purchases incl. imports/services, credit & debit notes (6.7/6.8), transfers, damage |
| R5.4 | production: BOM/4.3 versions, work orders, batches (6.4), production config |
| R5.5 | accounting (accounts, receipts/payments, allocations), VAT: 9.1 returns, period lock, treasury/TR-6, VDS/6.6, adjustments — then `compat_state` and the lock are removed and the API can scale out |

Money columns will be `numeric(18,2)`, with row-level period-lock checks in the database, plus server-side PDF (R4 used print CSS) and the NBR tariff import.
