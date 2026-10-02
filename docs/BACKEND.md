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

The API is built in slices. R5.1 moves **identity, security and reference data** into real tables, R5.2 the first
business records (**customers and vendors**). The other modules keep their exact mock behaviour inside the API, and
their data is saved to PostgreSQL so nothing is lost on restart or redeploy.

| Area | Endpoints | R5.1 |
| --- | --- | --- |
| Sign-in / sign-out / login-info | `auth/login`, `auth/logout`, `auth/login-info` | **native** — `users`, `sessions`, `login_failures` |
| Current user | `me`, `me/password`, `me/preferences`, `me/views` | **native** — `users.preferences`, `saved_views` |
| Users & roles | `users`, `users/{id}`, `users/{id}/reset-password` | **native** — `users`, `sessions` |
| Company & branches | `company` | **native** — `company`, `branches` |
| Units of measure | `units`, `units/{id}` | **native** — `units` |
| NBR tariff | `tariff` | **native** — `tariff_lines` (per fiscal year) |
| Audit trail | `audit` | **native** — `audit_events` (append-only) |
| Backups (R6.2) | `backups`, `backups/{id}`, `backups/{id}/verify` | **native** — `backups` (gzip snapshot + SHA-256), scheduler 02:00 / 14:00 Dhaka with catch-up |
| Customers & vendors (R5.2) | `customers`, `customers/{id}`, `customers/{id}/restore`, and the same three for `vendors` | **native** — `parties` (one table, `kind` tells them apart) |
| Health | `health` (public) | **native** — liveness + DB round-trip |
| Everything else: sales, purchases, items, stock, production, accounting, VAT returns, notifications, dashboard, search… | 92 route modules | **compat** — the mock handlers run unchanged; state saved to `compat_state` (JSONB) after every write |

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
3. **Write-through** (both directions)
   - Native modules own users, company, units and (R5.2) the parties in PostgreSQL.
   - They update the in-memory copies the compat handlers read, so both sides always agree. For example, items validate their unit against the `units` table, and an invoice quotes a customer the `parties` table holds.
   - The other way round: when a compat handler writes a record a native module owns — the R6.2 bulk import creates customers and vendors — the request's persist step compares the in-memory rows with what was last saved and adopts the difference into the table.

**Single instance by design** until R5.5 removes the compat layer: run one API process per database. Render's free
plan runs exactly one.

## R5.2 — customers and vendors on their own table

`api/src/modules/parties.ts` serves the six party endpoints from the **`parties`** table. The contract
(`docs/API.md`) is unchanged: same responses, same 422/404/409 codes, same audit events.

- **One table, two kinds.** `kind` is `customer` or `vendor`; `ord` (a serial) keeps each kind's insertion order, so
  sorted lists tie-break exactly as the in-memory arrays did.
- **The rules are shared, not copied.** `api/src/compat/entry.ts` re-exports the mock handlers' own functions
  (`partyRow`, `partyErrors`, `normaliseParty`, `buildParty`, `newPartyId`, `partySpec`, `partyCsvColumns`,
  `PARTY_FIELDS`) and the native module calls them through `compat()`. Aggregates, the duplicate and `modeLocked`
  checks, the stored shape and the id format therefore cannot drift between the PostgreSQL API, the Next.js mock and
  the GitHub Pages demo — all three run the same code.
- **The database enforces the duplicates too**: partial unique indexes on `(kind, lower(btrim(name)))` and
  `(kind, regexp_replace(bin, '^NID ', ''))`, both excluding the trash. A race that slips past the application check
  is a 422 (the unique violation is translated), never a duplicate row.
- **Deleting is a `deleted_at` stamp.** The record stays in PostgreSQL — master data an NBR audit can ask about never
  leaves relational storage — and the undo trash is rebuilt from the table at boot. Only parties without documents
  can be deleted at all (409 `in-use:N` otherwise), exactly as before.
- **Upgrading an existing database.** On the first boot after the migration, `boot.ts` moves the customers and
  vendors it finds inside `compat_state` (and the deleted ones in its undo buffer) into `parties`, then rewrites the
  snapshot without them. No re-seed: a customer installation keeps its data, and `SEED_VERSION` is unchanged.
  Restoring a pre-R5.2 backup into a fresh database adopts them the same way.
- **The list is not in SQL yet.** `runQuery` (the shared in-memory engine) still builds the register, because its
  aggregates, facets and totals come from *documents* — turnover and amount due per party — and those live in
  `compat_state` until R5.3. Units work the same way. When documents get their tables, this becomes a SQL join with
  `sqlList`.
- **Writes go through the state guard**, so during a deploy overlap an instance whose data set was replaced by
  another's re-seed refuses a party write (503) instead of resurrecting stale rows.

## Tables

| Table | Purpose |
| --- | --- |
| `users` | accounts, role (incl. `vatOfficer`), status, scrypt hash, `password_is_demo`, preferences (JSONB); **R6.2** `access_until` for VAT officers |
| `sessions` | one row per sign-in; `revoked_at` + `revoke_reason` (signedOut, passwordChanged, passwordReset, deactivated) |
| `login_failures` | failures per username, `locked_until` |
| `saved_views` | list views per user and table |
| `company` (single row) + `branches` | company profile printed on Mushak forms |
| `units` | units of measure; ids from `unit_id_seq` |
| `tariff_lines` | NBR tariff per fiscal year (`numeric` rates) |
| `audit_events` | append-only audit trail (indexed by time, Dhaka day, record, record type). **R6:** every row is sealed with `prev_hash` + `hash` (SHA-256 chain); triggers refuse UPDATE / DELETE / TRUNCATE — see [NBR_ENLISTMENT.md](NBR_ENLISTMENT.md) |
| `backups` | **R6.2:** scheduled / manual snapshots (`bytea` gzip JSON, SHA-256, row counts); last 30 kept; one scheduled row per slot (partial unique index) |
| `parties` | **R5.2:** customers and vendors (`kind`), exporter details, seeded credit terms; `deleted_at` is the undo trash; unique per kind on name and BIN |
| `compat_state` | JSONB state of the modules not yet ported (no customers, vendors or units since R5.2) |
| `meta` | seed version, tariff fiscal year |

**Demo data upgrades (R6.2):** at start-up, if `meta.seed_version` differs from `SEED_VERSION` in `api/src/boot.ts`, the
API takes a backup of every table into `backups` and re-seeds the demo data set. Set `DEMO_RESEED=off` on a customer
installation to keep its data across upgrades. `BACKUPS=off` disables the scheduler (tests).
The scheduler checks every 5 minutes and once `BACKUP_FIRST_DELAY_MS` (default 20 s) after boot. It only takes the
*latest* slot (02:00 or 14:00 Dhaka) if that slot has no backup yet. So after a long Render sleep, one catch-up backup is
taken, not one per missed slot. A unique index on the scheduled slot stops two instances from both taking it.

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
2. Builds the Docker image, pushes it to `ghcr.io/deshiklab/dizivat:<branch>`, and smoke-tests it against a fresh PostgreSQL
   (including that `/api/v1/health` reports the commit baked into the image).
3. On `r5-nestjs` only: deploys to production (see *Continuous deployment* below).

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

## Continuous deployment (GitHub Actions → Render)

Every push to **`r5-nestjs`** (the branch the Render service tracks) goes live automatically once it is proven good:

```
push r5-nestjs ─▶ Backend workflow: full browser suite on NestJS + PostgreSQL ─▶ Docker image → GHCR + smoke test
                                                                                        │
                  CI workflow (lint, types, mock E2E, visual, a11y, perf) ── green? ────┤  deploy job waits for it
                                                                                        ▼
                     still the branch head? ─▶ Render deploy hook ─▶ wait until live /api/v1/health reports this commit
                                                                                        ▼
                     smoke tests on https://dizivat-r5.onrender.com ─▶ GitHub "production" environment shows the deploy
```

- **Gates:** nothing deploys unless the Backend run (all E2E suites against PostgreSQL, the backend checks and the
  image smoke test) **and** the CI workflow for the same commit pass. A red run never reaches production.
- **Newest wins:** the hook builds the branch head, so a run whose commit is no longer the head skips the deploy;
  the newer commit's own run deploys after its tests. Deploys never overlap (`concurrency: render-production`).
- **Proof it is live:** `/api/v1/health` returns `commit` (Render's `RENDER_GIT_COMMIT`; the GHCR image bakes
  `GIT_COMMIT`). The job waits up to 40 minutes for the live service to report the tested commit, then runs
  `scripts/deploy_render.py smoke`. That script checks health and the database, the login page, sign-in, `/me`, the
  dashboard with the session (catches a `SESSION_SECRET` mismatch), the audit hash chain, the export register,
  the compliance centre and sign-out.
- **Render side:** `render.yaml` sets `autoDeployTrigger: "off"`, so untested commits are never auto-deployed.
  A Blueprint-managed service picks that up on the next sync. For a service set up by hand, set
  *Settings → Build & Deploy → Auto-Deploy* to **Off**.

**One-time setup** (repository → Settings → Secrets and variables → Actions):

| Secret | Required | Where |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | yes | Render → dizivat-r5 → Settings → **Deploy Hook** (`https://api.render.com/deploy/srv-…?key=…`) |
| `RENDER_API_KEY` | optional | Render → Account settings → API Keys. With it the job follows the Render build and fails fast on `build_failed` |

Without `RENDER_DEPLOY_HOOK_URL`, the *Deploy gate* job prints a warning and nothing is deployed. The tests still run.

**Release / redeploy:**
- Release a tested branch: `git push origin r6-enlistment-rmg:r5-nestjs` (fast-forward).
- Redeploy the current head with full tests: Actions → *Backend (NestJS + PostgreSQL)* → **Run workflow** on `r5-nestjs`.
- Check the live site by hand: `python3 scripts/deploy_render.py smoke --base https://dizivat-r5.onrender.com`.
- Roll back: push the earlier commit as a new commit (`git revert`), never force-push. You can also use
  Render → Deploys → **Rollback** for an immediate switch, then revert in Git so the next deploy keeps the fix.

## Roadmap (compat → relational, one module per slice)

| Slice | Moves to its own tables |
| --- | --- |
| R5.2 | **customers, vendors — done (`parties`)**; items, master items. The stock ledger and branches' stock are *derived* from documents (there is no stored movement table), so they become relational with the documents in R5.3 |
| R5.3 | sales (6.3), purchases incl. imports/services, credit & debit notes (6.7/6.8), transfers, damage |
| R5.4 | production: BOM/4.3 versions, work orders, batches (6.4), production config |
| R5.5 | accounting (accounts, receipts/payments, allocations), VAT: 9.1 returns, period lock, treasury/TR-6, VDS/6.6, adjustments — then `compat_state` and the lock are removed and the API can scale out |

Money columns will be `numeric(18,2)` (as `parties.credit_limit` and `tariff_lines` already are), with row-level
period-lock checks in the database, plus server-side PDF (R4 used print CSS) and the NBR tariff import.
