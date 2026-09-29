# RBS VAT — new frontend (Sprints 1–4 + R2)

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · next-intl (EN/বাংলা) · TanStack Query + Table · React Hook Form + Zod · Recharts.

This is the **strangler** frontend for RUPSHA FLEXIPACK LTD's RBS VAT system.

- **Sprint 1:** app shell, design system, Dashboard, Sales invoices (Mushak 6.3), Purchases and Items.
- **Sprint 2:** sign-in with roles and permissions, customers and vendors CRUD, draft edit, cancel with a reason, undo, the item stock ledger, preferences and saved views stored on the server, and CI quality gates.
- **Sprint 3:** users & roles administration (invite with a one-time password, forced password change, reset, deactivate), company profile, NBR tariff with HS lookup in the item sheet, audit-trail viewer, server-driven notifications, an API contract suite (`docs/API.md`), performance budgets and visual regression for dark, mobile and Bangla screens.
- **Sprint 4:** branches on documents (sales ship from and purchases arrive at a branch; Mushak 6.3 prints the issuing branch), a Units-of-measure master, stock transfers between branches (Mushak 6.5 data), damage & wastage write-offs, finished goods by branch with a per-branch stock ledger, a History tab on every record (sales, purchases, transfers, damage, items, parties, users, units) backed by the audit trail, and dashboard charts loaded after first paint (first-load JS 207 kB).
- **R2 — Inventory + Purchase (v0.5.0):** import purchases with a Bill of Entry (LC, customs house, origin) and per-line customs duties (CD, RD, SD, VAT, AIT, AT → assessable value, total tax incidence, rebatable VAT + AT, landed cost) pre-filled from the NBR tariff; service purchases (VDS) with their own list; purchase returns / debit notes (Mushak 6.8) capped at the returnable quantity, which reverse stock and input tax on approval; opening stock entries; a master-items wizard (HS lookup → tariff rates, overrides need a reason, renames flow to linked SKUs); and the Mushak 6.1 purchase book and 6.2 sales book per item, with drill-down to source documents and a CSV export. It also fixes the legacy typos (Catehory, Attch, Comapny, Orgin, Debite).

Every other menu entry opens a *Planned for release Rn* page that links back to the current RBS screen.

All data is **realistic mock data**, served from `src/app/api/v1/*` (Next route handlers) through a typed client (`src/lib/api/client.ts`). When the Symfony `/api/v1` is ready, point the client's base URL at it and delete `src/lib/mock` and `src/app/api`. No component changes are needed, and ESLint stops components from importing the mock directly.

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
| `capture.py` | 24 reference screens (14 light desktop + 4 R2 screens: import form, debit notes, master items, Mushak 6.1 — plus dark, 390 px mobile and a Bangla form). The browser clock is frozen at 25 Sep 2026 10:30 Dhaka so screens do not depend on when CI runs. Fails on any console or page error |
| `visual.py` | Compares those screens with `tests/visual/baseline/` and fails if more than 20 pixels change. Diffs go to `$SHOT_DIR/diff/`. Accept intended changes with `python visual.py --update` |
| `e2e.py` | 12 Sprint 1 flows (create, approve, stock guard, bulk approve, palette, shortcuts, URL filters, language switch, preferences) |
| `e2e_s2.py` | 33 Sprint 2 flows (sign-in, roles, edit, cancel, undo, customers, vendors, ledger, saved views, expired session, i18n completeness) |
| `contract.py` | API contract: 93 endpoints × (anonymous → 401, role without the permission → 403 naming it, 200 JSON, `Page<T>` shape, CSV content type) + 62 specific 404/409/422 cases — 271 checks. Non-destructive; runs before `e2e_s3.py` (which deactivates `auditor`). `--doc` regenerates `docs/API.md`; CI fails if it is out of date |
| `e2e_s3.py` | 39 Sprint 3 flows (invite → one-time password → forced change, operator locked out of admin pages, self-edit guard, reset revokes sessions, deactivation blocks sign-in, company validation + read-only for non-admins, tariff search, HS lookup, audit filters/detail/CSV, notifications, Bangla) |
| `e2e_s4.py` | 32 Sprint 4 flows (units CRUD with in-use guards, transfer form → draft leaves stock alone → approve moves it and keeps the company total, over-stock blocks approval, branch ledger shows transfer in, damage with the 'lost' note rule, finished goods by branch, branch selects on sale/purchase, History tabs + no-access message, Mushak 6.3 branch address, audit links, deferred charts, Bangla) |
| `e2e_r2.py` | 32 R2 flows (import form: tariff pre-fill, live duty summary, LC-after-BoE rejected, approve → BoE panel, duties stored to 2 dp, stock in; service purchase: no branch, VAT and VDS from the service code, PS- draft; debit note: pre-selected purchase, capped at the remaining quantity, approve reverses stock and input tax, Mushak 6.8 print, blocks cancelling the purchase; opening stock; master-item wizard with the HS requirement, tariff defaults and override reason; Mushak 6.1/6.2 books: closing balance = stock on hand, item-type and date-range checks; operator can draft but not approve; Bangla) |
| `a11y.py` | axe-core WCAG 2.2 AA on 48 pages × light/dark (96 runs; admin pages as `admin`). Fails on any violation |
| `perf.py` | Cold-cache load of 10 key pages with 4× CPU throttling and a 9 Mbps / 40 ms network: LCP < 2.5 s, CLS < 0.1, initial JS < 400 KB compressed (chunks the server HTML references — the critical path) and total JS < 500 KB (including chunks fetched after first paint, such as the dashboard charts). Writes `/tmp/perf.json` |

Environment variables: `BASE_URL` (default `http://localhost:3000`) and `SHOT_DIR` (where screenshots are written).

**CI:** `.github/workflows/ci.yml`. The first job runs typecheck, lint and build and uploads `.next`. The second job starts that build and runs the scripts above, uploading screenshots, diffs and the server log.

## Layout

| Path | What |
|---|---|
| `src/middleware.ts` | Locale routing and session guard (redirects to `/{locale}/login?next=…`) |
| `src/app/[locale]/login` | Sign-in page |
| `src/app/[locale]/(app)/…` | Pages: `/`, sales and purchases (list, `new`, `[id]`, `[id]/edit`), `inventory/items`, `inventory/finished-goods`, `inventory/transfers`, `inventory/damage`, `master/units`, `master/customers`, `master/vendors`, `master/users`, `master/company`, `master/audit`, `vat/tariff`, `[...slug]` placeholder |
| `src/app/api/v1/…` | Mock REST API: auth (`login`, `logout`, `me`, `me/preferences`, `me/views`), documents (list/filter/sort/page, CSV, bulk approve, edit, approve, cancel, delete + restore), customers and vendors, items + ledger, dashboard, search, users (invite, reset password), company, tariff, audit, notifications, `me/password`, `stock` (by branch), `transfers`, `damage`, `units`. Errors are problem+json — see `docs/API.md` |
| `src/lib/auth` | Roles → permissions, signed session tokens, server helpers |
| `src/components/auth` | `MeProvider`, `useMe()`, `useCan()`, `<Can>`, `<RequirePerm>` |
| `src/components/ui` | shadcn primitives (do not edit casually) |
| `src/components/shell` | Sidebar, top bar, ⌘K palette, user menu, notifications, shortcuts, mobile nav, status footer |
| `src/components/data-table` | One table for every list: URL state, facets, date presets, columns, server-saved views, bulk bar, CSV, mobile cards |
| `src/components/common` | Page header, status badge, money, field (+ unsaved-changes guard), combobox, confirm and cancel-reason dialogs, empty state |
| `src/features/*` | Screens by module: dashboard, sales, purchases, docs (shared document actions), items (+ HS lookup), stock (transfers, damage, finished goods), units, parties, users, company, tariff, audit (+ per-record history), auth |
| `src/lib` | Types, VAT maths (`vat.ts`), formatting (`format.ts`), navigation registry (`nav.ts`), Zod schemas, API client, mock DB |
| `src/messages/{en,bn}.json` | UI strings (1,180 keys; every key exists in both files) |
| `tests/visual/baseline` | Visual-regression reference screens (24) |
| `docs/API.md` | API reference generated from the contract-test table: conventions, 93 endpoints with permissions, roles matrix |

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
NEXT_PUBLIC_BASE_PATH=/rbs-vat-frontend npm run build:pages      # → out/
mkdir -p /tmp/site && cp -r out /tmp/site/rbs-vat-frontend && (cd /tmp/site && python3 -m http.server 8080 &)
PAGES_URL=http://localhost:8080/rbs-vat-frontend python3 scripts/pages_smoke.py
```

Documents created in the demo get sequential ids (`s215`, `s216` …). Pages exist for the seeded documents plus 50 new ones
of each type per browser. The server build is unaffected, but both builds use `.next`: run `npm run build` again
before `npm start` if you built the demo locally.
