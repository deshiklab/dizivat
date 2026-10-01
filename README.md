# DiziVAT — VAT management system (Sprints 1–4 + R2–R4 + Knowledge base + R5 backend + R6 enlistment & RMG)

> **Branch `r5-nestjs`:** the same app on a real backend: **NestJS 11 + PostgreSQL** (Drizzle ORM), deployable to
> **Render + Neon**. See [docs/BACKEND.md](docs/BACKEND.md).
> **CI/CD:** every push to `r5-nestjs` that passes the full PostgreSQL suite, the Docker smoke test and CI is deployed to Render
> automatically, verified by commit and smoke-tested live ([docs/BACKEND.md › Continuous deployment](docs/BACKEND.md#continuous-deployment-github-actions--render)).
> [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/deshiklab/dizivat/tree/r5-nestjs)
> The `main` branch keeps the in-browser mock demo on GitHub Pages: https://deshiklab.github.io/dizivat/en/
>
> **Branch `r6-enlistment-rmg` (v0.10.0):** readiness for **NBR VAT-software enlistment** and features for the **RMG
> (garments)** segment — see [docs/NBR_ENLISTMENT.md](docs/NBR_ENLISTMENT.md) and [docs/RMG.md](docs/RMG.md). Tag `v0.9.1` is the state before.

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · next-intl (EN/বাংলা) · TanStack Query + Table · React Hook Form + Zod · Recharts.

**DiziVAT** (formerly *RBS VAT*) is the **strangler** frontend for RUPSHA FLEXIPACK LTD's VAT system.

- **Sprint 1:** app shell, design system, Dashboard, Sales invoices (Mushak 6.3), Purchases and Items.
- **Sprint 2:** sign-in with roles and permissions, customers and vendors CRUD, draft edit, cancel with a reason, undo, the item stock ledger, preferences and saved views stored on the server, and CI quality gates.
- **Sprint 3:** users & roles administration (invite with a one-time password, forced password change, reset, deactivate), company profile, NBR tariff with HS lookup in the item sheet, audit-trail viewer, server-driven notifications, an API contract suite (`docs/API.md`), performance budgets and visual regression for dark, mobile and Bangla screens.
- **Sprint 4:** branches on documents (sales ship from and purchases arrive at a branch; Mushak 6.3 prints the issuing branch), a Units-of-measure master, stock transfers between branches (Mushak 6.5 data), damage & wastage write-offs, finished goods by branch with a per-branch stock ledger, a History tab on every record (sales, purchases, transfers, damage, items, parties, users, units) backed by the audit trail, and dashboard charts loaded after first paint (first-load JS 207 kB).
- **R2 — Inventory + Purchase (v0.5.0):** import purchases with a Bill of Entry (LC, customs house, origin) and per-line customs duties (CD, RD, SD, VAT, AIT, AT → assessable value, total tax incidence, rebatable VAT + AT, landed cost) pre-filled from the NBR tariff; service purchases (VDS) with their own list; purchase returns / debit notes (Mushak 6.8) capped at the returnable quantity, which reverse stock and input tax on approval; opening stock entries; a master-items wizard (HS lookup → tariff rates, overrides need a reason, renames flow to linked SKUs); and the Mushak 6.1 purchase book and 6.2 sales book per item, with drill-down to source documents and a CSV export. It also fixes the legacy typos (Catehory, Attch, Comapny, Orgin, Debite).
- **R3 — Sales + Production (v0.6.0):** export invoices (direct export to a foreign buyer with LC, customs house, destination and Bill of Export; deemed export to a local buyer against a back-to-back LC — both zero-rated) with their own list; service sales (`SS-`, service codes, VDS, no stock); inline customer credit (receivable, overdue, credit limit) and batch (lot) availability on the sale form, with lots enforced on approval; credit notes (Mushak 6.7) capped at the returnable quantity, which restore stock and reduce output VAT; price declarations (Mushak 4.3) with versions, amendment reasons, version compare and supersede-on-approve; work orders with progress; production batches — in-house, contractual with the contractor's return (Mushak 6.4) and from a work order — that consume inputs at the BOM coefficients (or actual quantities) and receive finished goods at BOM unit cost; production opening; and the production config (direct stock or work order; standard or actual consumption). The legacy screen typos ("Opeining", "Requsition", "Purachse", "Comapny", "In-Houe") are fixed.
- **R4 — NBR VAT + Accounting (v0.7.0):** bank, mobile-wallet and cash accounts with running balances; customer receipts and supplier payments (cash, bank transfer, cheque with cheque details, mobile with transaction ID) allocated to open invoices, so invoice due amounts update on approval and return on cancel, with a printable money receipt / payment voucher and books closed up to a date; party statements (ledger, ageing, open invoices) that reconcile with the invoice registers; the accounting config. NBR VAT: a compliance centre (period status, shortfall, deposits, VDS to issue and awaited, a sorted and de-duplicated tax-period list, every Mushak report in one place); the Mushak 9.1 return builder with all notes computed live from approved documents, a drill-down sub-form behind every note, manual notes, submission in order only after the period ends and once note 58 covers note 50, and the period lock that follows (no new, edited, approved or cancelled documents in a submitted period); treasury deposits with the TR Form 6 challan and economic codes pre-filled from the 9.1 shortfall; VDS for purchases and sales with Mushak 6.6 certificates from a pending list; VAT adjustments (notes 27, 32, 38, 39); Mushak 6.10 (invoices above Tk 2 lakh); NBR settings with an explicit edit mode; live dashboard deadlines. Closes the legacy defects D-04 (9.1 sub-form HTTP 500), D-05 (6.10 "totalPurchase"), D-10 (accounting screens showing bank setup), D-15 (unsorted, duplicated tax months) and D-16 (blocking report loader), and the typos "Treasuary", "Rerturn" and "Purchhase". Prints use print CSS in place of server-side PDF until the Symfony API exists.
- **Knowledge base (v0.8.0):** the app is renamed **DiziVAT**, and a built-in user guide sits under **Help & documentation** (`/help`): 34 articles in 9 topics (getting started, sales, purchase, inventory, production, accounting, NBR VAT, master data & admin, reference with a VAT glossary and FAQ), fully written in English **and** Bangla and following the language switch. The help centre has a topic filter and instant search over titles, keywords and headings (Bangla and Latin digits match, so `৯.১` finds 9.1). Each article has a table of contents, the screens it covers, related articles and prev/next. It can be **printed** or saved as **PDF** as a clean A4 document without the app chrome, **shared** (copy link, email, WhatsApp or the device share sheet) and **downloaded** as a standalone HTML page or Markdown, with links back to the app. The **whole manual** downloads or prints the same way. The top-bar help menu offers **Help for this page** on every screen, and ⌘K finds the knowledge base. Article text is rendered on the server and never ships in the page JavaScript; the exporter loads on first use. `npm run kb:lint` checks English/Bangla parity, cross-article links and app routes. The stale 9.1 note numbers in three form hints were corrected, and *Keep me signed in* now lasts 7 days.
- **Mushak 4.3 register and credits (v0.8.1):** **NBR VAT › Mushak 4.3** (`/vat/mushak-4-3`) lists every input–output coefficient declaration (current, drafts or all versions, with search) beside the official form, ready to print or save as PDF; **Open in Bill of materials** goes back to amend or approve it. The compliance centre's 4.3 card opens it, the production entry reads *Bill of materials (4.3)*, and ⌘K matches Bangla and Latin digits (`4.3` finds `মূসক ৪.৩`). The help article and FAQ explain where to find it. The copyright line **© BITSCOL (www.bitscol.com), Email: sales@bitscol.com, Mobile: +8801711853769** appears in the status footer, on the sign-in page, in the phone navigation drawer and at the end of every exported/printed help document (HTML and Markdown).

- **R5.1 — Backend: NestJS + PostgreSQL (v0.9.0, branch `r5-nestjs`):** an API in `api/` (NestJS 11, Drizzle ORM, PostgreSQL 16/17) behind the unchanged frontend. Next.js proxies `/api/v1` to it when built with `API_UPSTREAM`.
  - **Native modules:** identity, users, company and branches, units, the tariff and the audit trail, on real tables.
    - Passwords are stored as scrypt hashes.
    - Server-side sessions make sign-out real; password changes, resets and deactivations revoke sessions immediately.
    - Lockouts survive restarts.
    - The audit table is append-only.
    - Lists are filtered, faceted and sorted in SQL.
  - **Compat layer:** the other 70 route modules run unchanged inside Nest, with their state saved to PostgreSQL after every write.
  - **Tests:** the full existing suite passes against it (520 contract checks, every E2E suite, axe, 32/32 visual baselines). `scripts/api_native.py` adds 39 backend checks, including persistence across API restarts.
  - **Deployment:** one Docker image runs both processes, via `render.yaml` for Render with Neon Postgres. The roadmap R5.2–R5.5 moves each business module to relational tables.
- **PDF download of the statutory forms (v0.9.1):** every printable form has a **PDF** button next to **Print**: Mushak 6.3 invoices, 6.7 credit and 6.8 debit notes, 6.6 VDS certificates, TR-6 challans, money receipts and payment vouchers, 6.4 batches, 4.3 declarations (sheet and register), the 6.10 report, the 9.1 return, party statements, purchases, and the 6.1/6.2 books (landscape). It replaces the old *“Server-side PDF (Gotenberg) is wired in R3”* notice.
  - **How it works:** the PDF is made **in the browser** from the same A4 template that is printed (`src/lib/pdf/export.ts`, lazy-loaded on click), so Bangla shaping and fonts are identical to Print. It needs no server memory and also works on the static demo.
  - **Layout:** the form is laid out in an off-screen A4-wide frame (paper-width breakpoints, always the light print look, even in dark mode), paginated between table rows, rasterised at about 240 dpi and written as a multi-page A4 PDF named after the form and document (e.g. `Mushak-6.3_S-09260012.pdf`).
  - **Trade-off:** the pages are images, so the text can't be selected; Print → *Save as PDF* still gives a text PDF.
  - **Also fixed:** the Mushak 6.1/6.2 books printed a blank page (they weren't marked as a print area).
- **R6.1 — NBR enlistment readiness + RMG (v0.10.0, branch `r6-enlistment-rmg`):**
  - **Tamper-evident audit trail:** every event is sealed in a SHA-256 hash chain (`prev_hash` → `hash`). PostgreSQL
    triggers refuse UPDATE, DELETE and TRUNCATE on `audit_events`, and earlier rows are sealed once on upgrade.
    `GET /audit/verify` and a card on **Audit trail** recompute the chain and name the first altered or deleted
    record.
  - **Rules engine** (`src/lib/rules.ts`): effective-dated statutory parameters, each with its legal reference.
    - Return due date: 15 days, or 20 for the extended category, moved to the next working day. Fri/Sat, the fixed
      national days and company-defined gazetted holidays are skipped.
    - Mushak 6.6 due 3 working days after the return (VDS Guidelines 2025).
    - Advance tax on imports at **2 %** for manufacturers / **7.5 %** for commercial importers (Finance Ordinance
      2025), pre-filled on import lines.
    - 6-period credit windows.
  - **Business profile** (VAT settings): segment (RMG direct / deemed / composite …), 100 % export-oriented
    (Rule 21 note on Mushak 4.3), importer class, deadline category, bond licence with expiry warning, trade-body
    membership and extra holidays. All changes are audited field by field.
  - **RMG:**
    - customer exporter profile (exporter type, bond licence, BGMEA / BKMEA / BGAPMEA no.);
    - UD / UP, EXP no., currency, FC value and exchange rate on export and deemed-export invoices, with a live
      checklist of the **five NBR deemed-export conditions** (clarification of 09-10-2025) or the direct-export
      documents;
    - the same checklist on the sale detail;
    - **NBR VAT › Export register** (`/vat/export-compliance`): totals for direct, deemed and *zero-rating at risk*,
      filters, CSV, PDF and print.
  - **Tests:** `e2e_r6.py` (31 checks); `api_native.py` +8 (append-only database, sealed rows, chain verifies and
    survives restarts); contract 526 checks / 178 endpoints; axe 0 violations / 224 runs. All earlier suites pass
    unchanged, and 6 visual baselines were updated for the new sidebar entry.

Every menu entry of the plan is now live; unknown URLs still open a *Planned* page that links back to the legacy RBS VAT screen.

All data is **realistic mock data**, served from `src/app/api/v1/*` (Next route handlers) through a typed client (`src/lib/api/client.ts`). ESLint stops components from importing the mock directly. On this branch the same `/api/v1` contract is also served by the **NestJS + PostgreSQL** API in `api/`: build and run with `API_UPSTREAM=http://127.0.0.1:4000` and no component changes are needed (see *Backend (R5)* below).

## Run

```bash
npm install
npm run build
npx next start -H 0.0.0.0 -p 3000      # → http://localhost:3000  (redirects to /en/login)
# or for development:
npm run dev
```

Sign in with a demo account (the login page lists them; the password is `demo1234` for all):

| User | Role | Can |
|---|---|---|
| `arif`, `farzana` | Approver | everything except user management and company settings |
| `kamal` | Operator | create, edit and delete drafts, export. Cannot approve or cancel |
| `auditor` | Viewer | read, export and the audit trail |
| `admin` | Administrator | everything, incl. users & roles and the company profile |
| `jewel` | Operator | deactivated — sign-in is refused |

The mock database, sessions and login-attempt counters live in memory and reset whenever the server restarts.

> On a machine with ≤ 2 GB RAM the lint step inside `next build` can run out of memory. Run `npm run lint` on its own, then `npx next build --no-lint` (CI runners are unaffected).

> Start the server only after `npm run build` has finished writing `.next/BUILD_ID`. A server started mid-build serves mixed chunk hashes, which shows up as "Loading chunk … failed".

## Backend (R5) — NestJS + PostgreSQL

```bash
export DATABASE_URL=postgres://dizivat:dizivat@127.0.0.1:5432/dizivat SESSION_SECRET=$(openssl rand -hex 32) API_UPSTREAM=http://127.0.0.1:4000
npm --prefix api ci && npm --prefix api run build
node api/dist/main.js &            # migrations + first-start seed, then http://127.0.0.1:4000/api/v1/health
npm run build && npx next start -p 3000
API_RESTART_CMD=api/scripts/serve.sh python3 scripts/api_native.py   # backend checks (sessions, revocation, persistence)
```

`docker build -t dizivat .` produces the deployable image (Next.js on `$PORT` + API inside). Architecture, tables,
the compat layer, Render + Neon steps and the roadmap are in [docs/BACKEND.md](docs/BACKEND.md).

## Quality checks

```bash
npm run typecheck                 # tsc --noEmit
npm run lint                      # ESLint incl. project guard-rails (see below)

pip install -r scripts/requirements.txt
python -m playwright install --with-deps chromium
npm run test:e2e                  # server must be running on a fresh seed
```

`test:e2e` runs the same steps as CI, in this order:

| Script | What it checks |
|---|---|
| `capture.py` | 32 reference screens (14 light desktop + 4 R2 screens: import form, debit notes, master items, Mushak 6.1 + 4 R4 screens: 9.1 return, compliance centre, receipts, TR-6 print + 3 knowledge-base screens: help centre, an article, a Bangla article + the Mushak 4.3 register — plus dark, 390 px mobile and a Bangla form). The browser clock is frozen at 25 Sep 2026 10:30 Dhaka so screens do not depend on when CI runs. Fails on any console or page error |
| `visual.py` | Compares those screens with `tests/visual/baseline/` and fails if more than 20 pixels change. Diffs go to `$SHOT_DIR/diff/`. Accept intended changes with `python visual.py --update` |
| `e2e.py` | 12 Sprint 1 flows (create, approve, stock guard, bulk approve, palette, shortcuts, URL filters, language switch, preferences) |
| `e2e_s2.py` | 33 Sprint 2 flows (sign-in, roles, edit, cancel, undo, customers, vendors, ledger, saved views, expired session, i18n completeness) |
| `contract.py` | API contract: 178 endpoints × (anonymous → 401, role without the permission → 403 naming it, 200 JSON, `Page<T>` shape, CSV content type) + 127 specific 404/409/422 cases — 526 checks. Non-destructive; runs before `e2e_s3.py` (which deactivates `auditor`). `--doc` regenerates `docs/API.md`; CI fails if it is out of date |
| `e2e_s3.py` | 39 Sprint 3 flows (invite → one-time password → forced change, operator locked out of admin pages, self-edit guard, reset revokes sessions, deactivation blocks sign-in, company validation + read-only for non-admins, tariff search, HS lookup, audit filters/detail/CSV, notifications, Bangla) |
| `e2e_s4.py` | 32 Sprint 4 flows (units CRUD with in-use guards, transfer form → draft leaves stock alone → approve moves it and keeps the company total, over-stock blocks approval, branch ledger shows transfer in, damage with the 'lost' note rule, finished goods by branch, branch selects on sale/purchase, History tabs + no-access message, Mushak 6.3 branch address, audit links, deferred charts, Bangla) |
| `e2e_r2.py` | 32 R2 flows (import form: tariff pre-fill, live duty summary, LC-after-BoE rejected, approve → BoE panel, duties stored to 2 dp, stock in; service purchase: no branch, VAT and VDS from the service code, PS- draft; debit note: pre-selected purchase, capped at the remaining quantity, approve reverses stock and input tax, Mushak 6.8 print, blocks cancelling the purchase; opening stock; master-item wizard with the HS requirement, tariff defaults and override reason; Mushak 6.1/6.2 books: closing balance = stock on hand, item-type and date-range checks; operator can draft but not approve; Bangla) |
| `e2e_r3.py` | 52 R3 checks (export invoice: foreign buyer shows the export card and zero-rates VAT, missing LC rejected, approve stores LC / Bill of Export and moves stock; export rules — foreign needs export documents, no services to foreign buyers, direct export foreign-only, deemed local-only; service sale: SS- draft at the service rate, listed under services only; customer credit card and lot picker, selling beyond a lot rejected, lot sold quantity tracked; credit note: pre-selected invoice, capped at the remaining quantity, approve restores stock and reverses VAT, Mushak 6.7 print, blocks cancelling the invoice, appears in Mushak 6.2; 4.3: version compare, print, gross coefficients and price maths, amendment reason, one draft per item, approve supersedes; work order → batch: pre-filled lines, over-receipt rejected, approve consumes inputs at the BOM and adds finished goods, work order completes and cannot be cancelled; contractual receipt + Mushak 6.4; production opening; config gating and the work-order procedure; operator/viewer gating; Bangla; legacy typos gone) |
| `e2e_r4.py` | 52 R4 checks (accounts page; wallet number and service-charge rules, operator cannot add accounts; receipt from the invoice with the due pre-allocated, approve settles it (D-10), money receipt print; cash-into-bank, closed books, over-allocation and missing cheque details rejected; payment settles the bill and cancelling restores it; operator drafts but cannot approve, viewer read-only; customer and supplier statements reconcile with the registers; TR-6 pre-filled from the 9.1 shortfall, approve lands in note 58, bilingual TR Form 6; VDS from the pending list, over-withholding blocked, Mushak 6.6, sales VDS needs the certificate no.; adjustment reason rule, approved adjustment flows to note 27; 9.1 formulas, sub-form totals, parts 3–11, note drill-down, sub-form selector (D-04), sorted de-duplicated periods (D-15), early and repeat submission rejected; period lock: adjustments and invoices in a submitted period rejected, cancel → 409, lock note without a Cancel button; compliance centre; Mushak 6.10 API + page (D-05); NBR settings edit mode, accounting config, settings.manage gating; dashboard deadlines follow the return; Bangla; legacy typos gone; no console errors) |
| `e2e_kb.py` | 24 knowledge-base checks (help centre with 34 articles in 9 topics and the topic filter; search ranking, no-results and Clear, Bangla search, Bangla/Latin digits; article TOC anchors, related, screens covered, help: and in-app links, prev/next and breadcrumb; Print and PDF open a standalone print document; Share → Copy link; article HTML and Markdown downloads with absolute links; full-manual Markdown and HTML with in-document links, Print full manual; top-bar Help for this page (longest route match), shortcuts, sidebar link and ⌘K; Bangla article, downloads and print font; all 68 article pages, 404 for unknown articles, operator and viewer access; no console errors). Read-only |
| `e2e_m43.py` | 13 checks for the Mushak 4.3 register and the copyright line (sidebar entry and the (4.3) BOM label, compliance-centre card, ⌘K in English and Bangla with Latin digits; active list and official form, selection in the URL, search, all versions with the superseded note, Print, Open in Bill of materials, Help for this page, Bangla page; copyright in the status footer (English and Bangla labels, web/e-mail/phone links), on the sign-in page, in the phone drawer and at the end of HTML and Markdown exports; no console errors). Read-only |
| `e2e_pdf.py` | 9 checks for the **PDF** buttons. Each download is parsed and checked (xref offsets, A4 media boxes, page count, JPEG pages, Bangla title) and must contain no blank pages. Covers: Mushak 6.3 in English, Bangla and dark mode (still a light page), no Gotenberg placeholder, the exporter is lazy-loaded; 8 side-sheet forms (6.7, 6.8, 6.6, TR-6, receipt, voucher, 6.4, 4.3) from any tab, named by document number; 9.1, statement, 6.10, 4.3 register and purchase paginated; the 6.1 book in landscape with no blank pages; Print still opens the print dialog. Read-only |
| `e2e_r6.py` | 31 R6 checks (return due 15 Oct and Mushak 6.6 due 20 Oct for Sep 2026; business profile card: segment, AT 2 % → 7.5 % for a commercial importer, a company holiday moves the due date live and in the compliance centre, invalid dates rejected, Rule 21 note on 4.3, audited per field, bond licence required for an export-oriented RMG unit, `settings.manage` gating; customer RMG section and expired-bond warning; sale form deemed-export checklist going from 3 missing to complete, FC → taka, direct-export EXP field; UD / FC saved, unsupported currency rejected; sale-detail checklist; export register API, risk filter, sidebar + compliance-centre entry, URL filters, CSV, links, Bangla, phone; audit chain verifies and moves with every event, integrity card for the auditor, operators blocked; no console errors). Creates one draft invoice |
| `a11y.py` | axe-core WCAG 2.2 AA on 112 pages × light/dark (224 runs; admin pages as `admin`). Fails on any violation |
| `perf.py` | Cold-cache load of 14 key pages with 4× CPU throttling and a 9 Mbps / 40 ms network: LCP < 2.5 s, CLS < 0.1, initial JS < 400 KB compressed (chunks the server HTML references — the critical path) and total JS < 500 KB (including chunks fetched after first paint, such as the dashboard charts). Writes `/tmp/perf.json` |

Environment variables: `BASE_URL` (default `http://localhost:3000`) and `SHOT_DIR` (where screenshots are written).

**CI:** `.github/workflows/ci.yml`. The first job runs typecheck, lint, the knowledge-base lint and build and uploads `.next`. The second job starts that build and runs the scripts above, uploading screenshots, diffs and the server log.

## Layout

| Path | What |
|---|---|
| `src/middleware.ts` | Locale routing and session guard (redirects to `/{locale}/login?next=…`) |
| `src/app/[locale]/login` | Sign-in page |
| `src/app/[locale]/(app)/…` | Pages: `/`, sales and purchases (list, `new`, `[id]`, `[id]/edit`), `sales/services`, `sales/exports`, `sales/credit-notes`, `purchases/services`, `purchases/debit-notes`, `purchases/opening`, `production/bom`, `production/work-orders`, `production/batches`, `production/opening`, `production/config`, `accounting/{receipts,payments,bank-accounts,statements,config}`, `vat/{mushak,return-9-1,tr-6,vds,adjustments,mushak-6-10,settings}`, `inventory/items`, `inventory/finished-goods`, `inventory/transfers`, `inventory/damage`, `master/units`, `master/customers`, `master/vendors`, `master/users`, `master/company`, `master/audit`, `vat/tariff`, `help` and `help/[slug]` (knowledge base, pre-rendered in both languages), `[...slug]` in-shell 404 for unknown URLs (`page.server.tsx`: server build only) |
| `src/app/api/v1/…` | Mock REST API: auth (`login`, `logout`, `me`, `me/preferences`, `me/views`), documents (list/filter/sort/page, CSV, bulk approve, edit, approve, cancel, delete + restore), customers and vendors, items + ledger, dashboard, search, users (invite, reset password), company, tariff, audit, notifications, `me/password`, `stock` (by branch), `transfers`, `damage`, `units`, `debit-notes`, `opening-stock`, `master-items`, `mushak/6.1|6.2`, `sale-services`, `credit-notes`, `sales/{id}/creditable`, `production/{boms,work-orders,batches,config,lots}`, `accounting/{accounts,receipts,payments,open-invoices,statement,config}`, `vat/{periods,compliance,returns (+ notes),treasury,vds (+ eligible),adjustments,settings}`, `mushak/6.10`. Errors are problem+json — see `docs/API.md` |
| `src/lib/auth` | Roles → permissions, signed session tokens, server helpers |
| `src/components/auth` | `MeProvider`, `useMe()`, `useCan()`, `<Can>`, `<RequirePerm>` |
| `src/components/ui` | shadcn primitives (do not edit casually) |
| `src/components/shell` | Sidebar, top bar, ⌘K palette, user menu, notifications, shortcuts, mobile nav, status footer |
| `src/components/data-table` | One table for every list: URL state, facets, date presets, columns, server-saved views, bulk bar, CSV, mobile cards |
| `src/components/common` | Page header, status badge, money, field (+ unsaved-changes guard), combobox, confirm and cancel-reason dialogs, empty state |
| `src/features/*` | Screens by module: dashboard, sales, purchases, docs (shared document actions), items (+ HS lookup), stock (transfers, damage, finished goods), debit and credit notes, production (BOM / Mushak 4.3, work orders, batches / Mushak 6.4, config), money (receipts, payments), accounts, statements, VAT (Mushak 4.3 register, 9.1 return, sub-forms, TR-6, VDS / Mushak 6.6, adjustments, 6.10, compliance centre, settings), units, parties, users, company, tariff, audit (+ per-record history), auth |
| `src/content/help` | Knowledge base: `registry.ts` (order, topics, screens covered, related), `en/` and `bn/` article text (typed blocks with light inline markup), `blocks.ts` helpers |
| `src/features/help` | Help centre and search, article body, print / PDF / share / download actions, the lazy exporter (`src/lib/help/export.ts` builds the HTML and Markdown) |
| `src/lib` | Types, VAT maths (`vat.ts`), formatting (`format.ts`), client-side PDF export of the printable forms (`pdf/export.ts`), navigation registry (`nav.ts`), Zod schemas, API client, mock DB |
| `src/messages/{en,bn}.json` | UI strings (2,751 keys; every key exists in both files) |
| `tests/visual/baseline` | Visual-regression reference screens (32) |
| `docs/API.md` | API reference generated from the contract-test table: conventions, 176 endpoints with permissions, roles matrix |

## Conventions (enforced by ESLint in `src/components` and `src/features`)

- **Data only through `@/lib/api/client`.** No imports from `lib/mock` or server-only auth modules.
- **No hex colours.** Use the tokens in `globals.css` (`bg-primary`, `text-success`, `bg-warning-soft`, `bg-swatch-*`…).
- **No hard-coded English.** JSX text and `placeholder` / `title` / `aria-label` / `alt` go through `useTranslations`. Acronyms (VAT, BIN, CSV) are allowed. The NBR-prescribed Mushak 6.3 form is exempt. Numbers, money and dates go through `lib/format.ts` (en-IN lakh/crore grouping, Bengali digits in `bn`).
- **Locale-aware navigation.** Use `Link` / `useRouter` / `usePathname` from `@/i18n/navigation`, not `next/link` or `next/navigation`.
- **No native dialogs.** Use `useConfirm()`, the cancel-reason dialog or a toast; never `confirm()`, `alert()` or `prompt()`.
- **Base UI primitives only** from `@/components/ui`, never `@radix-ui/*`.
- **Disable Base UI controls explicitly.** `<fieldset disabled>` only reaches native inputs; Select, RadioGroup, Switch and Checkbox render spans and need their own `disabled` prop.

These are conventions without a lint rule:

- List state (filters, sort, page, search) lives in the URL, so every view can be shared with **Copy link**.
- Permissions are checked on the server. The UI uses `useCan()` to hide actions the role can't perform — in the sidebar, module tabs, ⌘K palette, buttons and row menus alike.
- Reversible deletes show a 10-second **Undo** toast (the record is restored from the server trash).
- Money is rounded with `round2`. Line maths: SD on value; VAT on value + SD.

## Static demo on GitHub Pages

Every push to `main` also publishes a **static demo** (`.github/workflows/pages.yml`) at
`https://<owner>.github.io/<repo>/`. GitHub Pages only serves files, so the demo build:

- pre-renders every page (`next build` with `output: "export"`, into `out/`);
- runs the same mock API route handlers **inside the browser** (`src/lib/demo`): `fetch("/api/v1/…")` is answered locally
  and the data plus the session live in `localStorage`, so each visitor has a private copy (use **Reset demo data** on the
  sign-in page);
- has no middleware: the session check happens in the browser (`DemoGate`), and `/` picks English or Bengali in the browser.

```bash
NEXT_PUBLIC_BASE_PATH=/dizivat npm run build:pages      # → out/
mkdir -p /tmp/site && ln -s "$PWD/out" /tmp/site/dizivat && (cd /tmp/site && python3 -m http.server 8080 &)
PAGES_URL=http://localhost:8080/dizivat python3 scripts/pages_smoke.py
```

Documents created in the demo get sequential ids (`s215`, `s216` …). Pages exist for the seeded documents plus 50 new ones
of each type per browser. The server build is unaffected, but both builds use `.next`: run `npm run build` again
before `npm start` if you built the demo locally.

## Credits

© BITSCOL ([www.bitscol.com](https://www.bitscol.com)), Email: [sales@bitscol.com](mailto:sales@bitscol.com), Mobile: [+8801711853769](tel:+8801711853769)
