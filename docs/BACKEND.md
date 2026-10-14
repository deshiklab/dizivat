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

The API is built in slices. R5.1 moves **identity, security and reference data** into real tables, R5.2 the
**master data** (customers and vendors, items and master items) and R5.3 the **first documents** (stock transfers and
damage entries, sales invoices, purchases, credit and debit notes) and R5.4 the **derived stock**: the opening
entries and the production batches the branch split and an item's ledger read are rows now, and since every family
they add up is relational, both endpoints are served from those rows. The other modules keep their exact mock behaviour
inside the API, and their data is saved to PostgreSQL so nothing is lost on restart or redeploy.

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
| Items & master items (R5.2) | `items`, `items/{id}`, `master-items`, `master-items/{id}` | **native** — `items`, `master_items` (the counters an item's `remain` is derived from are columns) |
| Stock transfers & damage (R5.3) | `transfers`, `transfers/{id}`, `damage`, `damage/{id}` | **native** — `stock_documents` + `stock_document_lines` (one table for both kinds, `kind` tells them apart) |
| Sales invoices (R5.3) | `sales`, `sales/{id}`, `sales/{id}/creditable`, `sales/{id}/realisations`, `sales/{id}/restore`, `sales/bulk` | **native** — `sales` + `sale_lines` + `sale_realisations` |
| Purchases (R5.3) | `purchases`, `purchases/{id}`, `purchases/{id}/returnable`, `purchases/{id}/restore`, `purchases/bulk` | **native** — `purchases` + `purchase_lines` (the Bill of Entry and each import line's duty are columns) |
| Credit & debit notes (R5.3) | `credit-notes`, `credit-notes/{id}`, `debit-notes`, `debit-notes/{id}` | **native** — `notes` + `note_lines` (one table for both, `kind` tells them apart) |
| Opening stock (R5.4) | `opening-stock`, `opening-stock/{id}` | **native** — `opening_entries` (the R6.4 bond block of a go-live entry is columns of its row) |
| Production batches (R5.4) | `production/batches`, `production/batches/{id}`, `production/batches/{id}/receive` | **native** — `batches` + `batch_lines` + `batch_consumption` (the contractor, the job process and the receipt are columns of the row) |
| The derived stock (R5.4) | `stock`, `items/{id}/ledger` | **native** — no tables of their own: both add up the ten movement families' rows with the mock's own derivation (`src/app/api/v1/_derived.ts`) |
| The derived registers of production (R5.5) | `production/lots`, `production/subcontract` | **native** — no tables of their own: the lots add up the batches' and the invoices' rows, the subcontracting register the contractual batches' (`_r3.lotsAnswer`, `_r62.subconRegister`) |
| Price declarations (R5.5) | `production/boms`, `production/boms/{id}` | **native** — `boms` + `bom_inputs` + `bom_costs` (Mushak 4.3: the version in force is what a production batch is priced from) |
| The production configuration (R5.5) | `production/config` | **native** — `production_config` (one row: the procedure a batch follows and the consumption it records) |
| Work orders (R5.5) | `production/work-orders`, `production/work-orders/{id}` | **native** — `work_orders` + `work_order_lines` (the progress the approved batches have made is columns of the lines) |
| Accounting (R5.6) | `accounting/accounts`, `accounting/accounts/{id}`, `accounting/receipts`, `accounting/receipts/{id}`, `accounting/payments`, `accounting/payments/{id}`, `accounting/open-invoices`, `accounting/statement`, `accounting/config` | **native** — `money_accounts`, `money_docs` + `money_allocations`, `accounting_config` (a settlement writes the invoice's `paid` and `due` with it) |
| Health | `health` (public) | **native** — liveness + DB round-trip |
| The NBR VAT documents (R5.6) | `vat/treasury`, `vat/treasury/{id}`, `vat/vds`, `vat/vds/{id}`, `vat/vds/eligible`, `vat/adjustments`, `vat/adjustments/{id}` | **native** — `treasury_deposits` (TR-6), `vds_entries` (Mushak 6.6), `vat_adjustments` (the 9.1 notes no book can derive); an approved certificate settles what it withholds, on the invoice's row |
| The Mushak 9.1 return (R5.6) | `vat/returns`, `vat/returns/{period}`, `vat/returns/{period}/notes/{note}`, `vat/periods`, `vat/compliance`, `vat/settings` | **native** — `vat_returns` (one row per tax period, the period being its id; a submitted one carries the computation it was filed with) and the one row of `vat_settings`; the period lock every other family checks reads them, not the compat snapshot |
| The exporters' Utilization Declarations (R6.2) | `vat/uds`, `vat/uds/{id}`, `vat/uds/fit` | **native** — `uds` + `ud_lines` (the amendment certificates travel with the head as JSONB); one declaration number per exporter is a unique index, and a delete stamps `deleted_at` so the id stays retired |
| The export-proceeds register (R6.6) | `vat/proceeds`, `vat/proceeds/sample`, `vat/proceeds/match`, `vat/proceeds/batches`, `vat/proceeds/batches/{id}`, `vat/proceeds/batches/{id}/reverse` | **native** — `prc_batches` (the bank file's lines, allocations and history as JSONB, the number unique while it lives); the realisations themselves are rows of `sale_realisations` on the invoices, written with the batch in one transaction |
| The drawback claims (R6.5) | `vat/drawback-claims`, `vat/drawback-claims/{id}`, `vat/drawback-claims/{id}/action` | **native** — `drawback_claims` (the frozen export lines, the DEDO reference and the decision dates travel with the head; the number unique while it lives, a deleted draft stamped) |
| The last four readers (R6): the bond register, the RMG export register, the penalty quote, the SD-eligible inputs | `vat/bond`, `vat/exports`, `vat/penalty`, `vat/sd-eligible` | **native** — no tables of their own: each adds up documents other modules own, read through the mirror, with the mock's own computation — and with these four the compat route table is empty |

The compat route table that once ran unported mock handlers inside NestJS is gone: it emptied with the four
readers, and the finale (below) deleted the generator, the table and the controller that mounted it.

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
   - **Later starts:** everything is restored from the tables *before* the compat bundle loads — and a database
     that still carries a `compat_state` snapshot (anything written before the finale) is adopted and drained
     first; see the finale section below.
2. **The bundle is shared code, not routes.** No route is served through the compat path anymore: the last one
   went native with the four readers. What `dist/compat.js` still provides is the mock's own world in memory —
   the document collections the native modules read through the mirror, the shared rule functions
   (`api/src/compat/entry.ts`), and the demo data set the seed writes.
3. **Write-through** (one direction left)
   - Native modules own every family in PostgreSQL and update the in-memory copies the shared computations
     read, so the two sides always agree. For example, items validate their unit against the `units` table, and
     an invoice quotes a customer the `parties` table holds.
   - The one write the other way round is the R6.2 bulk import: it creates customers, vendors and SKUs through
     the mirror's arrays, and its own transaction carries the party, item and master-item write-back legs into
     the tables (`api/src/common/writeback.ts`) — the last users of the write-back machine now that the
     snapshot's persist step is gone. The notifications' read ids, the snapshot's other last tenant, live on
     the user's own row (`users.notif_read`).

**Single instance by design** still: run one API process per database (Render's free plan runs exactly one). The
compat snapshot that once forced this is gone, but the in-memory mirror — the shared computation's world —
remains, and it is per-process. The state lock's remaining work is the audit chain: `lockState` (a PostgreSQL
advisory lock plus the boot-epoch check) serialises appends across a rolling deploy, and `withStateLock`
serialises the import, the backup snapshot and the audit writes inside the process.

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
  `(kind, regexp_replace(bin, '^NID ', ''))`, both excluding the trash. A collision that slips past the application
  check is a 422, never a duplicate row — `uniqueViolation()` (`api/src/common/http.ts`) reads the PostgreSQL code
  from the driver error drizzle wraps it in, so every module translates it the same way.
- **Deleting is a `deleted_at` stamp.** The record stays in PostgreSQL — master data an NBR audit can ask about never
  leaves relational storage — and the undo trash is rebuilt from the table at boot. Only parties without documents
  can be deleted at all (409 `in-use:N` otherwise), exactly as before. The undo answers 200 with the party, as the
  mock did: a POST, but nothing is created. Because the indexes ignore the trash, a deleted party's name and BIN are
  free again — so an undo can collide with whatever took them, and answers that same 422 with the record left deleted.
- **Upgrading an existing database.** On the first boot after the migration, `boot.ts` moves the customers and
  vendors it finds inside `compat_state` (and the deleted ones in its undo buffer) into `parties`, then rewrites the
  snapshot without them — the items and master items below take the same path, in the same transaction. No re-seed: a customer installation keeps its data, and `SEED_VERSION` is unchanged.
  Restoring a pre-R5.2 backup into a fresh database adopts them the same way. `api_native.py` drills it in CI: it
  rewrites a live database into that older shape, restarts, and compares the registers row for row.
- **The list is not in SQL yet.** `runQuery` (the shared in-memory engine) still builds the register, because its
  aggregates, facets and totals come from *documents* — turnover and amount due per party — and those live in
  `compat_state` until R5.3. Units work the same way. When documents get their tables, this becomes a SQL join with
  `sqlList`.
- **Writes go through the state guard**, so during a deploy overlap an instance whose data set was replaced by
  another's re-seed refuses a party write (503) instead of resurrecting stale rows.

## R5.2 — items and master items on their own tables

`api/src/modules/items.ts` serves `items`, `items/{id}`, `master-items` and `master-items/{id}` from the **`items`**
and **`master_items`** tables, the same way: the contract is unchanged, and the rules are the mock's own
(`src/app/api/v1/_items.ts`, re-exported by `api/src/compat/entry.ts`), so the derived cost price, the duplicate-SKU
and unit checks, the master item's tax-override rules, its history and both registers' facets and CSV columns cannot
drift.

- **The movement counters are columns** (`opening`, `purchased`, `prod_receive`, `prod_issue`, `sold`, `damage`), so
  an item's `remain` — and the stock valuation the register totals — travels with its row. Items are never deleted:
  an unused SKU is deactivated, because its ledger must stay readable.
- **Unique by the database too**: `lower(sku)` on `items`, `lower(name)` on `master_items` — the checks the handlers
  run, with the unique violation translated to the same 422 (`{sku:["duplicate"]}`, `{name:["duplicate"]}`) on create,
  update and rename alike.
- **A master item's rename carries its SKUs along** in the same transaction (they reference it by name, as the legacy
  data does), and the mirror's copies move with them.
- **Ids stay the mock's**: `i<n>-<base36>` from the number of items, `m<n>` from the highest number the table has ever
  held — computed inside the locked transaction, so two creates in flight never share one.
- **Documents still move the counters.** Sales, purchases, debit notes, opening entries and production documents are
  compat state until R5.3–R5.4, so they write through the in-memory item and the write-back saves the new counters
  (and reads the stored row back, so a column type that rounds cannot leave the two copies apart). Since R5.3 a
  damage entry is native and writes `items.damage` itself, in the document's own transaction.
- **The stock ledger and branches' stock were still compat then**: both are *derived* from documents
  (`items/{id}/ledger`, `stock`). R5.3 gave the first documents tables — a movement became a row — and R5.4 the rest,
  so since the last R5.4 slice both endpoints are served from the rows, by the same derivation the mock runs.

## R5.3 — stock documents on their own tables

`api/src/modules/stock.ts` serves `transfers`, `transfers/{id}`, `damage` and `damage/{id}` from **`stock_documents`**
and **`stock_document_lines`**, the same way: the contract is unchanged, and the rules are the mock's own
(`src/app/api/v1/_stock.ts`, re-exported by `api/src/compat/entry.ts`), so line validation and pricing, the monthly
document numbers, the branch-stock checks around approving and cancelling, the counters a write-off moves, the
register's facets and its CSV columns cannot drift. These are the first business documents in PostgreSQL — and both
sides were held against the same contract suite, the native routes and the mock handlers serving them, so the port is
behaviour for behaviour.

- **One table for both kinds** (`kind` tells a transfer from a damage entry), because that is how the registers and
  the branch-stock derivation read them. The branch a document consumes is `from_branch_id` for either kind — a
  transfer's origin, a damage entry's own branch — and only a transfer has a destination.
- **Lines are rows, not JSON.** `stock_document_lines` holds the item, the quantity and the unit cost at posting
  (`qty numeric(18,3)`, `cost`/`value numeric(18,2)`), so what a movement carries can be summed in SQL instead of
  walked in memory. Editing a draft replaces its lines in the same transaction; deleting a draft deletes them with it.
- **Numbers are unique in the database too** (`TR-MMYY####` / `DM-MMYY####`). The handlers already skip the numbers of
  deleted drafts — the audit trail keeps them — and a violation the application check missed (two requests at once) is
  a 409, not a 500.
- **Ids stay the mock's** (`t<n>` / `d<n>`), taken from the highest number the table has ever held for that kind inside
  the locked transaction, so a document is never renumbered and two creates in flight never share an id.
- **An approval writes what it moves.** A damage entry moves `items.damage`; the counter is written with the document,
  in its transaction, and taken back on cancellation. If the transaction fails, the in-memory counters are restored —
  the two copies cannot drift apart.
- **The derived stock reads every document.** The branch split (`stock`) and an item's ledger (`items/{id}/ledger`)
  add up *all* movement documents — sales, purchases, credit and debit notes, transfers and damage entries, opening
  entries, production batches — so they stayed derived in memory until every family had a table. Since R5.4 they all
  do, and both endpoints are served from the rows (below). The in-memory copies the module keeps in step are what the
  readers that are still compat use — the VAT returns, the Mushak books, the finished-goods lots, the work orders'
  progress — and the write-back covers that direction, so a compat handler writing through the mock's arrays cannot
  leave the table behind.
- **The upgrade is one boot.** A database written before this slice holds both collections inside `compat_state`; the
  first start moves every document and line into the tables and rewrites the snapshot without them. Restoring a
  pre-R5.3 backup into a fresh database adopts them the same way, and `api_native.py` drills it in CI.

## R5.3 — sales invoices on their own tables

`api/src/modules/sales.ts` serves `sales`, `sales/{id}`, `sales/{id}/creditable`, `sales/{id}/realisations`,
`sales/{id}/restore` and `sales/bulk` from **`sales`**, **`sale_lines`** and **`sale_realisations`**. The contract is
unchanged and the rules are the mock's own (`src/app/api/v1/_r3.ts`, `_r4.ts`, `_r66.ts`, re-exported by
`api/src/compat/entry.ts`): `parseSale`, the lot/shortfall checks, `creditable`, `customerCredit`, `saleIdentity`,
the period lock, the register's facets and its CSV columns cannot drift. As with the stock documents, both sides were
held against the same contract suite — the native routes and the mock handlers serving them — so the port is
behaviour for behaviour.

- **An invoice is three tables.** The header carries the money (`numeric(18,2)`), the quantities (`numeric(18,3)`)
  and its own history (JSONB); `sale_lines` holds the printed lines in order (primary key `(sale, position)`), so an
  edit replaces rows rather than a JSON array; `sale_realisations` holds the export proceeds recorded against it.
- **The shipping documents are columns, not JSON.** An export or deemed-export invoice (Mushak 4.1, zero-rated) keeps
  its LC, bill of export, customs house, country, currency, foreign-currency value and exchange rate
  (`numeric(18,6)`) on its own row, so what a bond register or a proceeds report needs is a `WHERE`, not a walk over
  every invoice. `export_deemed` is the presence marker — NULL means a domestic sale — and two check constraints keep
  the block coherent (an export always has an LC number; only the four invoice currencies are allowed).
- **Numbers are unique in the database and stay retired** (`S-MMYY####` for goods and exports, `SS-MMYY####` for
  services). Deleting an invoice stamps `deleted_at` and keeps its lines, because the mock handed out the next number
  by counting the live array *and* the undo buffer: a deleted draft's number is never reused. A race that slips past
  the application check is a 409, not a 500.
- **Ids stay the mock's** (`s<n>`), from `saleIdentity` inside the locked transaction, so an invoice is never
  renumbered and two creates in flight never share an id.
- **An approval writes what it moves.** `items.sold` goes with the invoice, in its transaction, and is taken back on
  cancellation; if the transaction fails the in-memory counters are restored, so the two copies cannot drift apart.
- **Proceeds are rows of their own.** The PRC number is upper-cased as the mock did and unique *while it is on an
  invoice* — the R6.6 bank batches split one PRC over several invoices, so there is no global unique index — the BDT
  value is stored at the rate entered, and removing an entry frees the number again.
- **Bulk approve answers 200**, not the 201 a `POST` defaults to: nothing is created there, it reports
  `{done, skipped}` for the drafts it took and the ones a period lock, a shortfall or an approval rule refused.
- **What is still derived stays derived.** The credit a customer carries, what is returnable on an invoice and the
  credit and debit notes that quote one read the in-memory copies (the branch split and the ledger, which add up
  *every* family, read the rows themselves since R5.4). The module keeps those copies in step, and
  the write-back adopts whatever a compat handler writes — including a delete, which it reads as "this invoice is in
  the undo buffer now" and stamps exactly as the native delete does.
- **The upgrade is one boot.** A database written before this slice holds the invoices inside `compat_state`; the
  first start moves every invoice, line and proceeds entry into the tables and rewrites the snapshot without them.
  Restoring a pre-R5.3 backup into a fresh database adopts them the same way, and `api_native.py` drills it in CI.

## R5.3 — purchases on their own tables

`api/src/modules/purchases.ts` serves `purchases`, `purchases/{id}`, `purchases/{id}/returnable`,
`purchases/{id}/restore` and `purchases/bulk` from **`purchases`** and **`purchase_lines`**. The contract is
unchanged and the rules are the mock's own (`src/app/api/v1/_docs.ts`, `_r2.ts`, re-exported by
`api/src/compat/entry.ts`): `parsePurchase` — the vendor decides whether the body is a local, a service or an import
document — `buildPurchaseFields` (how the lines are priced and what duty an import line carries), `purchaseIdentity`,
`purchaseCategoryRule`, the debit notes and settlements that block a cancellation, `returnable`, the register's
facets and its CSV columns cannot drift. Both sides were held against the same contract suite again: 676 checks with
the routes served natively, 676 with the mock handlers serving them.

- **A purchase is two tables.** The header carries the money (`numeric(18,2)`), the quantities (`numeric(18,3)`) and
  the two totals only a purchase has — `tti`, the total tax incidence of an import, and `rebate`, the input tax
  credit claimable in Mushak 9.1 — plus its own history (JSONB); `purchase_lines` holds the printed lines in order
  (primary key `(document, position)`), with `rebateable` and `vds` per line.
- **The Bill of Entry is columns, not JSON.** An import purchase (a Foreign vendor) keeps its BoE number and date,
  LC number and date, customs house, origin, C&F firm, receive address, the bonded flag and the own UD number on the
  document's row — `boe_no` is the presence marker, NULL for a local or service purchase — and every import line
  keeps its duty breakdown as columns: the assessable value, CD, RD, AIT and AT with their rates. What the R6.4 bond
  register reports as duty foregone under an IM-7 bond, and what the R6.5 drawback claims read, is a `WHERE` and a
  `SUM` over those columns instead of a walk over every document in memory.
- **Numbers are unique in the database and stay retired** (`P-MMYY####` for goods and imports, `PS-MMYY####` for
  services), and deleting stamps `deleted_at` while keeping the lines, for the same reason an invoice does: the mock
  counted the live array *and* the undo buffer when it handed out the next number. A race is a 409, not a 500.
- **An approval writes what it moves.** `items.purchased` goes with the document, in its transaction, and is taken
  back on cancellation; a purchase only ever adds stock, so there is no shortfall check to refuse one.
- **A goods purchase cannot become a service one** (or the other way round) once issued — the shared
  `purchaseCategoryRule` answers 409, as the mock did.
- **What is still derived stays derived.** The debit notes that return against a purchase, the bond register and the
  drawback claims read the in-memory copies (the branch split and the ledger, which add up *every* family, read the
  rows themselves since R5.4). The module keeps those copies in step, and the write-back
  adopts whatever a compat handler writes — including a delete, which it reads as "this document is in the undo
  buffer now" and stamps exactly as the native delete does.
- **The upgrade is one boot**, as with the invoices: the first start moves every purchase and line out of
  `compat_state` and rewrites the snapshot without them, and `api_native.py` drills it in CI.

## R5.3 — credit and debit notes on their own tables

`api/src/modules/notes.ts` serves `credit-notes`, `credit-notes/{id}`, `debit-notes` and `debit-notes/{id}` from
**`notes`** and **`note_lines`** — one table for both families, `kind` telling them apart, the same choice the stock
documents made: the two registers, the two "what is still returnable" answers and the input- and output-tax sides of
a VAT return read them the same way. The contract is unchanged and the rules are the mock's own
(`src/app/api/v1/_r2.ts`, `_r3.ts`, `_r4.ts`, `_docs.ts`, re-exported by `api/src/compat/entry.ts`): `buildCredit` /
`buildDebit` (the source document has to exist and still be approved, the note cannot predate it, the period has to
be open, every line has to be returnable and within what is left of it, and a returned line is priced pro rata),
`creditIdentity` / `debitIdentity`, `creditApproveRule` / `debitApproveRule`, `creditCancelRule` / `debitCancelRule`,
`debitStockRule`, `postCredit` / `postDebit`, the registers' specs, filters and CSV columns cannot drift. Both sides
were held against the same contract suite again: 676 checks with the routes served natively, 676 with the mock
handlers serving them.

- **The two shapes come out of one row.** The document a note was raised against is `source_id` (a sales invoice or a
  purchase) and the party is `party_id` (a customer or a vendor); the response names them by kind, as the mock's two
  shapes do. A debit note carries two totals a credit note does not — `tti` and the `rebate` (input tax credit) it
  reverses — so they are NULL on the credit side and a check constraint says so; the same goes for a line's
  `sold_qty` / `purchased_qty` and its debit-only `tti` and `rebate`.
- **A deleted draft keeps its row.** Notes have no undo, and the mock removed one from its array for good — but its
  id counter had moved on and its number lives on in the audit trail, so the row is stamped rather than dropped:
  that is what stops a later note taking the same id, and the next number still skips the deleted draft's.
- **Ids and numbers come from the mock's own counters.** `cn<n>` / `dn<n>` from the state's `db.seq`, claimed inside
  the locked transaction and separately from the identity, so a debit note refused for want of stock consumes no id;
  `CN-MMYY####` / `DN-MMYY####` from the live notes *and* the audit trail. A duplicate the application check missed
  is a 409, not a 500.
- **An approval writes what it moves.** A credit note takes `items.sold` down (the goods come back into the selling
  branch), a debit note takes `items.purchased` down (they leave again), each with the note, in its transaction, and
  reversed on cancellation. Approving a debit note needs the goods still on hand — 422 while saving, 409 when
  approving a draft — and cancelling a credit note needs them still on hand too, because they leave the branch again.
- **What is still derived stays derived:** what is returnable on an invoice or a purchase and a customer's credit read
  the in-memory copies, which the module keeps in step (the branch split and the ledger read the rows themselves since
  R5.4), and the write-back adopts
  whatever a compat handler writes — including a delete, which stamps the row exactly as the native delete does.
- **The upgrade is one boot**, as with the other families: the first start moves both collections and their lines out
  of `compat_state` and rewrites the snapshot without them, and `api_native.py` drills it in CI. A note deleted
  before the upgrade has no place in the older snapshot, so what the drill requires back is the *counter*: the next
  note takes a higher id and a new number.

## R5.4 — opening stock entries on their own table

`api/src/modules/openings.ts` serves `opening-stock` and `opening-stock/{id}` from **`opening_entries`**: the
quantities the SKUs were brought forward with at go-live, their purchase value and the input-tax class that value
belongs to in Mushak 6.1. They are the first of the two collections the derived stock still read from memory — the
branch split (`stock`) and an item's ledger (`items/{id}/ledger`) add up every movement document, and after R5.3 only
the opening entries and the production batches were left. The contract is unchanged and the rules are the mock's own
(`src/app/api/v1/_r2.ts`, re-exported by `api/src/compat/entry.ts`): `buildOpening` (the SKU has to exist and be
active, the branch has to be a stock-holding one, the quantity is rounded to the unit's own decimals),
`openingIdentity`, the approve / cancel / draft / delete rules, `postOpening`, the register's spec, its `?item=`
filter and its CSV columns cannot drift. Both sides were held against the same contract suite again: 676 checks with
the routes served natively, 676 with the mock handlers serving them.

- **One row per entry, one item each** — there are no lines to hold. The value (`qty × price`) and the VAT paid on the
  stock are `numeric(18,2)` columns, so the opening value a Mushak 6.1 return quotes is a `SUM`, not a walk.
- **The R6.4 bond block is columns too:** a go-live entry can say how much of its stock was still warehoused under the
  customs bond, under which Bill of Entry, and what duty that suspended. `bond_boe_no` is the block's presence marker
  and a check constraint keeps it all there or not at all — the bond register reads those columns unchanged.
- **Numbers are unique in the database and stay retired** (`OS-MMYY####`, taken from the live entries *and* the audit
  trail), and a deleted draft keeps its row with `deleted_at`: entries have no undo, and the mock removed one from its
  array for good — but its id counter had moved on, so the stamped row is what stops a later entry taking the same id.
  On restore the counter is lifted to the highest id the table has seen, so it can never go back.
- **An approval writes what it moves:** `items.opening` goes with the entry, in its transaction, and is taken back on
  cancellation — which first checks the stock is still on hand at its branch, because the derived split loses it.
- **What is still derived stays derived:** the VAT returns and the Mushak books read the in-memory copies, which the
  module keeps in step, and the write-back adopts whatever a compat handler writes — including a delete, which stamps
  the row exactly as the native delete does. The production batches have a table now too (below), and since the last
  R5.4 slice the branch split and an item's ledger are served from the rows rather than from these copies.
- **The upgrade is one boot**, as with every family: the first start moves the entries out of `compat_state` and
  rewrites the snapshot without them, and `api_native.py` drills it in CI.

## R5.4 — production batches on their own tables

`api/src/modules/batches.ts` serves `production/batches`, `production/batches/{id}` and
`production/batches/{id}/receive` from **`batches`**, **`batch_lines`** and **`batch_consumption`**: the finished
goods a factory puts into production — in-house, at a contract manufacturer under a Mushak 6.4 challan, or brought
forward as work in progress at go-live (`mode`). They were the *last* collection the derived stock read from memory,
so after this slice the branch split (`stock`) and an item's ledger (`items/{id}/ledger`) add up rows for every
document family there is. The contract is unchanged and the rules are the mock's own (`src/app/api/v1/_r3.ts` and
`_docs.ts`, re-exported by `api/src/compat/entry.ts`): `buildBatch` (a line has to be an active finished good with an
approved BOM — an opening batch may state its own unit cost — the received and rejected quantity cannot exceed the
issued one, a work order has to be approved and still have the quantity left, and the inputs are the BOM's or, when
the production configuration asks for it, the actual ones the body lists), `batchIdentity`, the approve / stock /
cancel / draft / delete rules, `postBatchIssue` and `postBatchReceive`, the receipt rules, the register's spec, its
`?workOrder=` filter and its CSV columns cannot drift. Both sides were held against the same contract suite again:
676 checks with the routes served natively, 676 with the mock handlers serving them.

- **A batch is three tables:** the row (dates, mode, totals, process, branch, own history), one row per finished good
  in `batch_lines` (issued, received and rejected quantity, the BOM version and its unit cost, the work order it draws
  on) and one per consumed input in `batch_consumption` — so what a factory produced, rejected and consumed, and what
  it is worth, are `SUM`s, not a walk over every batch in memory.
- **The contractor block is columns too:** a challan names the contractor (id, name, BIN, address as printed), where
  the inputs are delivered, what job the contractor performs (R6.2: manufacture or a single process) and when the goods
  came back (`received_at`). The subcontracting register — still compat — reads those batches through the in-memory
  copy the module keeps in step.
- **Numbers are unique in the database and stay retired** (`PB-MMYY####`, taken from the live batches *and* the audit
  trail), and a deleted draft keeps its row with `deleted_at`, its lines and its consumption with it: batches have no
  undo, and the mock removed one from its array for good — but its id counter had moved on, so the stamped row is what
  stops a later batch taking the same id. On restore the counter is lifted to the highest id the table has seen.
- **An approval writes what it moves:** the consumed inputs go onto `items.prod_issue` and the goods received onto
  `items.prod_receive`, both in the batch's transaction, and a cancellation takes both back — after checking the goods
  are still on hand and no sales invoice draws on the batch's lots, because the derived split loses them.
- **A receipt is an edit, not a document:** `POST …/receive` answers 200, writes the returned and rejected quantities
  onto the batch's own lines, sets `received_at`, moves `items.prod_receive` and records the change in the batch's
  history and the audit trail — once per challan (409 afterwards, and 409 on a batch that is not contractual).
- **What is still derived stays derived:** the finished-goods lots, the work orders' progress and the VAT returns read
  the in-memory copies, which the module keeps in step (the branch split and the ledger read the rows themselves —
  below), and the write-back adopts
  whatever a compat handler writes — a restored backup, or the demo runtime. The BOMs, the work orders and the
  production configuration a batch is built from are compat state until their own slice.
- **The upgrade is one boot**, as with every family: the first start moves the batches and their children out of
  `compat_state` and rewrites the snapshot without them, and `api_native.py` drills it in CI.

## R5.4 — the derived stock served from the tables

`api/src/modules/derived.ts` serves `stock` (every SKU with its quantity at each stock-holding branch) and
`items/{id}/ledger` (one SKU's movement register) from PostgreSQL. Neither stores anything of its own: each adds up
every movement document — purchases, sales, credit and debit notes, transfers, damage entries, opening entries and
the production batches — and every one of those families has a table now, so both read the documents back from the ten
tables through the modules that own them and hand them to the mock's own derivation (`src/app/api/v1/_derived.ts` and
`_ledger.ts`, and `branchSplit` in `src/lib/mock/db.ts`, re-exported by `api/src/compat/entry.ts`). The rows, the
facets, the valuations, the CSV columns, the running balance and the totals are that code's, so the two runtimes
cannot drift — and both were held against the same contract suite, the native routes and the mock handlers serving
them, with all 83 captured answers identical byte for byte (every filter and sort, both CSV exports, every SKU's
ledger company-wide and per branch, and the 404s).

- **No migration, and nothing to adopt.** The endpoints have no tables of their own, so this slice adds no schema, no
  snapshot change and no upgrade path of its own: what they read is what the R5.2–R5.4 migrations already put there.
- **The derivation takes its documents as data.** `branchSplit(src)`, `ledgerRows(item, src)` and `itemLedger(item,
  branch, src)` are the mock's own functions over a `MovementSource` — the nine collections they add up. The Next.js
  handlers pass their in-memory copies, the API passes what it read from the tables, and the third caller
  (`buildBook`, the Mushak 6.1 and 6.2 books) is unchanged.
- **Everything the responses are made of lives in `_derived.ts`** — the register's spec and rows, the valuation at
  cost and at sale price, the value each branch holds, the CSV's column per branch, and the ledger's assembly: which
  rows a `?branch=` shows (transfers only appear then, because company-wide they net to zero), the running balance,
  the totals and the closing quantity. The two route files that used to hold them are a dozen lines each.
- **The in-memory copies stay**, because the readers that are still compat use them: the VAT returns, the Mushak
  books, the finished-goods lots, the work orders' progress, the subcontracting register, and the stock checks around
  approving a document (`stockShortfall`). What changed is that these two endpoints no longer depend on them — a row
  changed in SQL alone, with the in-memory copies left stale, moves both answers at once, which is what
  `api_native.py` now proves.
- **62 compat route modules were left, 54 native.** What is still derived in memory is the registers above; the rest
  of production — BOMs and their 4.3 versions, work orders, the production configuration, the lots and subcontracting
  registers — was the next slice's, and the declarations and the configuration have moved since (R5.5, below).

## R5.5 — the price declarations and the production configuration on their own tables

`api/src/modules/production.ts` serves `production/boms`, `production/boms/{id}` and `production/config` from
**`boms`**, **`bom_inputs`**, **`bom_costs`** and the one row of **`production_config`**. A declaration is the Mushak
4.3 input–output coefficient of ONE unit of a finished good: what it takes, the wastage each input allows, and the
cost heads that turn the material value into the declared price — and the version in force for an item on a date is
what a production batch prices its lines and consumes its inputs from. The configuration says whether a batch follows
a work order and whether it records the standard or the actual consumption, so `buildBatch` reads both on every create
and every edit. The contract is unchanged and the rules are the mock's own (`src/app/api/v1/_r3.ts` and `_docs.ts`,
re-exported by `api/src/compat/entry.ts`): `buildBom` (an active finished good; inputs that are active, not finished
goods and not repeated; cost heads not repeated; from version 2 on an amendment reason and an effective date after the
version it replaces; and `calcBom`'s pricing), `approveBom` (which supersedes the version in force), `activeBom`,
`bomRow`, `bomVersions`, the five lifecycle rules, `bomIdentity`, `bomDiff`, the register's spec, its CSV columns,
name and facet labels, and the configuration's `buildConfig` and `configDiff` cannot drift. Both sides were held
against the same contract suite again — 676 checks with the three routes served natively, 676 with the mock handlers
serving them — and all 65 captured answers were identical: every filter, sort, facet, date range and both CSV exports,
every declaration with the versions beside it, the 404s, the configuration, and the batch, lot, work-order and bond
registers that read them.

- **A declaration is three tables:** the row (the item as printed, the version, the two dates, the five values, the
  process, `superseded_at`, its own history), one row per input in `bom_inputs` (the net quantity, the wastage
  percent, the wastage and gross quantity, the price and the two values) and one per cost head in `bom_costs` — so the
  material value, the wastage and the value added of the version in force are `SUM`s over its own child rows, which is
  what `api_native.py` now checks for every declaration in the database.
- **The number is unique among the *live* rows only.** A declaration's number carries its version (`BOM-{sku}-v{n}`)
  and the version is worked out from the item's other declarations, so a draft that is deleted frees its version and
  filing that item again takes the same number. Its *id* is not free again: the counter the mock kept in `db.seq`
  moved on when the draft was removed, so the row is stamped with `deleted_at` instead of being removed and
  `boms_live_no_key` is a partial unique index. A cancelled version stays on record and keeps its number retired.
- **Approving writes more than one row:** the version approved becomes the one in force and every other approved
  version of the item is superseded, in the same transaction — and a transaction that rolls back puts those stamps
  back the way the in-memory copies had them.
- **The configuration is one row** (`id = 1`, with the check that keeps it single), and an update stamps who changed
  it, which the audit trail records as a `productionConfig` event carrying both fields' changes — as the mock did.
- **`license_date` is text, not a date:** a draft may be filed without one and the demo data set holds that as an
  empty string, which is the same reason a sale's export bill date is text. The rules still require a `YYYY-MM-DD`
  shape when there is one.
- **The in-memory copies stay**, because the readers that are still compat use them: `buildBatch` prices a line and
  works out its consumption from the version in force and reads the procedure and the consumption, and the bond and
  settlement registers quote a declaration. Every native write goes through to the mirror, and a compat handler that
  writes through the mock's array — a restored backup, the demo runtime — is written back to the rows. So a
  declaration filed through this module is what the very next batch is priced from, with no restart in between, which
  is what `api_native.py` proves.
- **Upgrade:** the first boot on a database written before this slice moves the declarations out of `compat_state`
  into the three tables and the configuration into its row, then rewrites the snapshot without them; restoring a
  pre-R5.5 backup into a fresh database adopts them the same way, and `api_native.py` drills it in CI. A declaration
  deleted before the upgrade left no row to adopt — the mock removed it for good — so what survives the round trip is
  the id counter, not the row, and its version is free again exactly as it was.
- **59 compat route modules were left, 57 native.** What was left of production is the work orders (below) and the
  two registers derived from the batches and the sales — the finished-goods lots and the subcontracting register.

## R5.5 — the work orders on their own tables

`api/src/modules/workorders.ts` serves `production/work-orders` and `production/work-orders/{id}` from
**`work_orders`** and **`work_order_lines`**: what the floor has to produce, and what the batches that draw on it
have made of it. A work order's progress is the one thing in this schema nobody types — `refreshWorkOrder` (the
mock's own rule) computes what was put into production, what came back, what was rejected and what is still owed
from the *approved* batches' lines, and the status follows (`open`, `partial`, `completed`). So the rows are kept
honest at both ends: a batch write recomputes them **inside its own transaction** (`refreshWorkOrderRows`, which the
batches module and the compat write-back both call), and every answer recomputes them again from the approved
batches' rows before it is sent, exactly as the mock's register does. The contract is unchanged and the rules are the
mock's own (`src/app/api/v1/_r3.ts` and `_docs.ts`, re-exported by `api/src/compat/entry.ts`): `buildWorkOrder`
(every line an active finished good with a declaration in force on the issue date, no line twice, a due date that is
not before the issue date), `woIdentity` (the next PW-MMYY####, which the audit trail takes part in), the draft /
approve / cancel / delete rules, the batches that block a cancellation and a deletion, `woDiff`, the register's spec,
its `?item=` filter and its CSV columns cannot drift. Both sides were held against the same contract suite again —
676 checks with the two routes served natively, 676 with the mock handlers serving them — and all 61 captured
answers were identical: every filter, facet, sort, date range, both CSV exports, every work order with the batches
beside it, the 404s, and the batch, lot, subcontracting and declaration registers that read them.

- **A work order is two tables:** the row (the number, the requisition, the two dates, the process, the derived
  status, who issued it, its own history) and one row per finished good in `work_order_lines` — the quantity ordered
  and the four progress quantities — so what the floor still owes is a `SUM` over the lines, and `api_native.py`
  checks every line against the approved batches' own rows in SQL.
- **The progress follows the batches, in the same transaction.** Creating, editing, approving, cancelling or
  receiving a batch recomputes the work orders it draws on before the transaction commits, and so does the
  write-back when a compat handler wrote a batch through the mock's array. A draft batch counts for nothing; a
  cancelled one gives the progress back.
- **The number is unique and never reused** (the audit trail takes part in it), and a deleted draft keeps its row
  with `deleted_at`, so a later work order takes neither its id nor its number.
- **Its page lists the batches that draw on it** — the seven fields the mock's own `woBatchRow` picks, queried
  straight from `batch_lines` and `batches`, in the order the batches were created.
- **The in-memory copies stay**, because a batch's `buildBatch` reads the quantity a work order has left
  (`woOpenQty`) and the VAT returns and the registers that are still compat read the same objects. Every native
  write goes through to the mirror, and the refresh writes it too, so a batch created through this API is refused
  the moment it would issue more than the work order has left.
- **Upgrade:** the first boot on a database written before this slice moves the work orders out of `compat_state`
  into the two tables, recomputes their progress from the batches it adopted with them, and rewrites the snapshot
  without them; restoring a pre-R5.5 backup into a fresh database adopts them the same way, and `api_native.py`
  drills it in CI. A work order deleted before the upgrade left no row to adopt, so what survives the round trip is
  the id counter and the number in the audit trail.
- **57 compat route modules were left, 59 native.** What was left of production was the two registers derived from
  the batches and the sales — the finished-goods lots and the subcontracting register — and both are served from the
  rows now (below).

## R5.5 — the lots and the subcontracting register served from the tables

`api/src/modules/derived.ts` now serves four endpoints, and the two it gained are the last of production:
`production/lots` (the finished-goods lots — what each approved batch received and what the approved invoices have
drawn on since) and `production/subcontract` (the R6.2 RMG register of the contractual batches — what is still at a
contract manufacturer under a Mushak 6.4 challan, for how long, and what it is worth). Neither stores anything of its
own: the lots add up `batch_lines` and `sale_lines`, and the subcontracting register walks the contractual rows of
`batches` — all of which the R5.3–R5.5 migrations put there. The derivation is the mock's own code, re-exported by
`api/src/compat/entry.ts`: `lots` / `lotsAnswer` (`_r3.ts`) and `subconRegister` with the range rule, the row filter
and the CSV columns that the subcontracting route used to hold itself (`_r62.ts`), so the availability of a lot, the
days at a contractor, the overdue threshold, the totals and the fourteen CSV columns cannot drift. Both sides were
held against the same contract suite again — 676 checks with the two routes served natively, 676 with the mock
handlers serving them — and all 70 captured answers were identical: every lot with and without `?all=1`, `?item=` and
`?exclude=`, every range, `?status=`, ten `?days=` values, both CSV exports, the three 422s, and the batch, stock,
work-order, declaration and configuration registers beside them.

- **No migration, and nothing to adopt.** Both endpoints are reads over rows that already exist, so this slice adds
  no schema, no snapshot change and no upgrade path of its own.
- **The rules moved out of the route files.** `subconParams` (the range, which defaults to the fiscal year the RMG
  registers run on, the overdue threshold and the state `?status=` keeps), `subconRows`, `SUBCON_CSV_COLUMNS` and
  `subconCsvName` are `_r62.ts`'s now, and `lotsAnswer` (every lot with stock left, or all of them with `?all=1`) is
  `_r3.ts`'s — the two mock route files are a dozen lines each, and the native controllers call the same functions.
- **`lots` and `subconRegister` take their documents as data.** The Next.js handlers pass their in-memory copies; the
  API passes what it read from `batches`, `batch_lines`, `sales` and `sale_lines`. The third caller of `lots` —
  `lotShortfall`, the rule that refuses an invoice drawing more than a lot holds — still reads the copies, which is
  why the write-backs stay.
- **The in-memory copies stay**, because the readers that are still compat use them: the VAT returns, the Mushak
  books and that lot check. What changed is that these two registers no longer depend on them — a batch line's
  received quantity changed in SQL alone moves the lot at once and leaves the branch split alone (which counts the
  SKU's own counters), an invoice line changed the same way moves the lot it draws, and a challan's receipt changed
  in SQL moves the subcontracting register and leaves the lots alone (they read the batch's *lines*, not its totals).
  Those are the checks `api_native.py` adds.
- **55 compat route modules were left, 61 native** — and production was out of `compat_state` entirely: the
  declarations, the configuration, the work orders and the batches are tables, and the two registers that watch them
  are derived from those tables. What is left is accounting, the VAT returns and the Mushak books, the dashboard,
  search, notifications, the bulk import and the services (R5.6).

## R5.6 — accounting on its own tables

`api/src/modules/accounting.ts` serves the nine accounting endpoints from **`money_accounts`**, **`money_docs`** +
**`money_allocations`** and the one row of **`accounting_config`**: where the company's money is, what came in and what
went out, and which invoices it settled. Both money kinds share one table (`kind` tells them apart, as it does for the
transfers, the damage entries and the notes) because the register, the audit trail and a party's statement read them
the same way. The rules are the mock's own (`src/app/api/v1/_r4.ts`, re-exported by `api/src/compat/entry.ts`), so the
party and account checks, the cheque block, the allocation rules (`notOpen`, `duplicate`, `exceedsDue`,
`overAllocated`, `advanceNotAllowed`), the closed-books check, the number series, the register's spec and its CSV
columns, a party's statement with its ageing and the configuration's own rules cannot drift. Both sides were held
against the same contract suite again — 676 checks with the nine routes served natively, 676 with the mock handlers
serving them — and all 146 captured answers were identical.

- **A settlement writes the invoices it moves, in the same transaction.** `paid` and `due` are columns of `sales` and
  `purchases`, so approving a receipt settles the invoice on its own row as the money document is written — and
  cancelling one, or a transaction that rolled back, puts those counters back. The write goes through the module that
  owns each table (`applySaleSettlement` / `applyPurchaseSettlement`), exactly as a production batch writes the
  counters an approval moves. That is what keeps the invoice registers, the open invoices and a party's statement
  agreeing with the accounts — and what `settlementsOf`, the rule that refuses to cancel an invoice something has
  settled, still reads through the mirror.
- **A draft settles nothing.** Only the approval moves the money, so the checks read the invoice's row before and
  after the transition rather than after the create.
- **A balance is derived, never stored:** the opening balance plus every approved receipt less every approved payment
  and treasury deposit, summed by the mock's own `accountRow`. Editing the opening balance moves the balance, which
  is the point of it being derived.
- **An account with transactions cannot be deleted** — only deactivated. One nothing quotes can be.
- **`money_docs.no` is unique and never reused**, and a deleted draft keeps its row with `deleted_at`, so a later
  document takes a new id *and* a new number.
- **The in-memory copies stay**, because `settlementsOf`, the VAT returns, the VDS register, the compliance centre and
  a party's credit all read them. Every native write goes through to the mirror, and a compat handler that writes
  through the mock's array is written back to the rows.
- **Upgrade:** the first boot on a database written before this slice moves the accounts, the receipts and the
  payments with their allocations and the configuration out of `compat_state`, rewrites the snapshot without them and
  lifts the `account`, `receipt` and `payment` counters from the highest id each table has held; restoring a pre-R5.6
  backup into a fresh database adopts them the same way, and `api_native.py` drills it in CI.
- **46 compat route modules are left, 70 native.** What is left is the VAT side: the treasury deposits (TR-6), VDS
  (6.6), the VAT adjustments, the Mushak 9.1 returns and the period lock, the compliance centre, and the Mushak books
  — then the dashboard, search, notifications, the bulk import and the services.

## R5.6 — the NBR VAT documents on their own tables

`api/src/modules/vat.ts` serves the treasury deposits (TR-6), the VDS certificates (Mushak 6.6) and the manual VAT
adjustments (Mushak 9.1 notes 27 / 32 / 38 / 39 / 40, including R6.3's SD on the inputs of exported goods) from
**`treasury_deposits`**, **`vds_entries`** and **`vat_adjustments`**. The three share one service and one controller
base, because they share the draft → approved → cancelled state machine the mock's `lifecycle()` already gave them;
what differs is the config each hands it. The rules are the mock's own (`src/app/api/v1/_r4.ts`, re-exported by
`api/src/compat/entry.ts`) — what a body may hold, the economic code a head takes, the challan that must not be used
twice, the invoice a certificate may be written against and how much VAT it still has to withhold, the challan a
purchase certificate quotes, the six-month window an SD-on-exports claim has to land in, the period lock, the balance
a deposit needs, the VDS entries that keep a challan from being cancelled, and each register's spec, CSV columns,
name, facet labels and diff — so the two runtimes cannot drift. Both sides were held against the same contract suite
again — 676 checks with the seven routes served natively, 676 with the mock handlers serving them — and all 106
captured answers were identical.

- **An approved certificate settles what it withholds, in the same transaction.** `paid` and `due` are columns of
  `sales` and `purchases`, so the invoice is written with the certificate, and cancelling it gives the settlement
  back — through the same `writeSettlement` / `revertSettlement` pair the receipts and the payments use. What a
  certificate settled is a column of its own row (`settled`), so the certificate still says what it did after the
  invoice has moved on.
- **The economic code is not stored by hand:** it comes from the head and the company's zone (`economicCode`), the
  way the mock filled it in, and a claim for SD on exported inputs keeps the purchase line, the export sale and the
  quantity it covers with it (`sd_export`, JSONB) — which is why an approval re-checks the six-month window: another
  claim may have used the quantity since the draft was saved.
- **The period lock is the Mushak 9.1's**, read from the returns the compat layer still holds, so a native document
  and a compat one are refused for exactly the same periods.
- **Each number (TC-, VDS-, VA-MMYY####) is unique and never reused**, and a deleted draft keeps its row with
  `deleted_at`, so a later document takes a new id *and* a new number.
- **The in-memory copies stay**, because the Mushak 9.1 return, the compliance centre, a payment's statement and the
  SD register still read them. Every native write goes through to the mirror, and a compat handler that writes
  through the mock's array is written back to the rows.
- **Upgrade:** the first boot on a database written before this slice moves the three collections out of
  `compat_state`, rewrites the snapshot without them and lifts the `treasury`, `vds` and `adjustment` counters from
  the highest id each table has held; restoring a pre-R5.6 backup into a fresh database adopts them the same way,
  and `api_native.py` drills it in CI.
- **39 compat route modules are left, 77 native.** What is left of the VAT side is the Mushak 9.1 returns with the
  period lock, the compliance centre and the Mushak books — then the dashboard, search, notifications, the bulk
  import and the services.

## R5.6 — the Mushak 9.1 return on its own tables

`api/src/modules/returns.ts` serves the return — the register, one period's return with its computation, the note
sub-forms behind a computation's notes, the tax periods, the compliance centre and the NBR settings — from
**`vat_returns`** and **`vat_settings`**. The rules are the mock's own, the same way the three VAT families' are:
what a period may be filed for (in order, and not twice), what a submission needs (the period over, the previous
return filed, a date that is neither missing nor in the future, and note 58 covering note 50), the acknowledgement
number it is given and the `late` an original filed after the due date becomes, what a draft may be edited to, why
a submitted return cannot be deleted, the register's spec and CSV columns, the note sub-forms, the compliance
answer and the settings' validation — so the responses, error codes and audit events cannot drift. The audit ref is
still `9.1 · 09-2026`, which is what makes the trail for a return readable after the move.

- **A return is a row per tax period, and the period is its id.** There is no number series and no `process`: the
  return for September 2026 is `2026-09`, and its `ord` is only the tie-breaker that keeps the register stable.
  Two checks carry the state a row may be in — a draft holds no snapshot and no acknowledgement, a submitted return
  holds both plus the date — and only an amended return says why (`amend_reason`).
- **A submitted return carries the computation it was filed with.** Every note of the Mushak 9.1 is stored with it
  (`snapshot`, JSONB), so the books, the Mushak forms and the R6.6 amendment applications read the figures as they
  were filed: the documents the return added up keep moving, the return does not.
- **The period lock is a column now.** Until this slice every native document read it from the compat snapshot's
  `returns` array; it is `vat_returns` that says whether a date is in a submitted period, through the same mirror
  the compat handlers read — so a native document and a compat one are still refused for exactly the same periods,
  and the R6.6 applications (9.3 late filing, 9.4 amendment) keep reading `db.returns` unchanged.
- **The NBR settings are one row, by constraint** (`vat_settings`, `id = 1` checked) the way the accounting
  configuration is: the zone the economic codes are derived from, and the business profile the forms print.
- **The in-memory copies stay**, because the Mushak books, the compliance centre and the R6.6 applications read
  them. Every native write goes through to the mirror, and a compat handler that writes through the mock's array is
  written back.
- **Upgrade:** the first boot on a database written before this slice moves the returns and the settings out of
  `compat_state`, rewrites the snapshot without them and leaves the tables as the only copy; restoring a pre-R5.6
  backup into a fresh database adopts them the same way, and `api_native.py` drills it in CI.
- **33 compat route modules are left, 83 native.** What is left after this one — the Mushak books, the dashboard,
  search, notifications, the bulk import and the services — is the next slice (all readers, no table of their own);
  the R6 VAT registers follow, and then `compat_state` and the lock are removed and the API can scale out.

## R5.6 — the Mushak books and the rest of the readers served from the tables

`api/src/modules/books.ts` serves eight endpoints — `mushak/[form]` (6.1, 6.2, 6.2.1 and 6.10), the dashboard, the ⌘K
search, the notifications and their mark-as-read, the two service-code lists and the bulk master-data import — and
none of them stores a row of its own. Each adds up documents that live elsewhere: an item's book every movement that
touched it, valued the way the form values it; the dashboard the year's invoices and the return's own shortfall; the
search the two invoice registers, the SKUs and both party books; the notifications the drafts awaiting an approval,
the audit trail's decisions and the stock below its re-order level; the import the SKUs and the parties it is about to
create. Every one of those families has a table, so all eight are served from the database — the documents are read
back by the modules that own them, and the derivation is the mock's own code, re-exported by
`api/src/compat/entry.ts` (`mushakBook`, `mushakCsvColumns`, `mushak610Book` and `mushak610CsvColumns`,
`dashboardAnswer`, `searchAnswer` and `notifReadInput` from `_derived.ts`, `notificationsFor` from
`lib/mock/notifications.ts`, and `bulkImport` with the row rules and the audit entries it writes from `_r62.ts`), so
the rows, the totals, the deadlines, the hits and the import's issues cannot drift between the two runtimes.

- **No migration, and nothing to adopt.** Seven of the eight are reads over rows that already exist, so this slice
  adds no schema, no snapshot change and no upgrade path of its own: what they read is what the R5.2–R5.6 migrations
  already put there.
- **The rules moved out of the route files.** The range every book shares (which defaults to the financial year to
  date, and refuses one the wrong way round), the form an item may be asked for (6.2 is finished goods only, 6.2.1 is
  the traded-goods book), the 404 that points Mushak 9.1 at `/vat/returns/{period}`, the eighteen CSV columns, the
  dashboard's four deadlines, the five families the search walks and the notification an approval or a deadline
  becomes are `_derived.ts`'s now; `mushak610` (`_r4.ts`), `notificationsFor` and `bulkImport` (`_r62.ts`) take their
  documents as data, so the eight route files are a dozen lines each and both runtimes call the same functions.
- **The two writes save the snapshot the way a compat handler's does.** Marking notifications read writes the user
  store, and the bulk import creates SKUs and parties through the mirror's arrays — both live inside the snapshot,
  which a native module's own rows do not — so they take the state lock and persist before they answer, and the item
  and party write-backs carry what the import created into their tables in the same transaction as everything else.
- **The in-memory copies stay**, because the R6 VAT registers still read them: the UDs and the bond, the drawback
  claims, the export proceeds, the late filings and the 9.4 amendments. What changed is that these eight no longer
  depend on them.
- **25 compat route modules are left, 91 native.** What is left is the R6 VAT registers, and then `compat_state` and
  the lock are removed and the API can scale out.

## R6.2 — the exporters' Utilization Declarations on their own tables

`api/src/modules/uds.ts` serves `vat/uds` (the register, with the bond licence watch-list and its CSV), `vat/uds/{id}`
(one declaration with what every deemed-export invoice has drawn on it), `vat/uds/fit` (the question the sales form
asks before it saves a deemed export) and the create / edit / delete behind the register. The rules are the mock's
own, re-exported by `api/src/compat/entry.ts` from `_r62.ts` (`udRegister`, `udCsvColumns`, `udCsvRows`, `udCheck`,
`udInUse`, `newUdId`, `udCreate`, `udUpdate`, `udRemove`, `udAnswer`, `udFitInput`, `udFitAnswer`) — the exporter that
has to be one, the SKU every input has to be, the number that is unique per exporter, the quantity that cannot drop
below what was already supplied, and the amendment a change of quantities or of the LC value becomes — so the rows,
the error codes, the amendments and the audit events cannot drift between the two runtimes.

- **A declaration is a row and each input is a row.** `uds` holds the head (the export LC / contract, the buyer, the
  dates, the status, the LC value in the declaration's currency); `ud_lines` holds what it permits, in the order it
  was entered. What a garment order may still procure, and how much of it is left, is a `SUM` over those rows.
- **One number per exporter, in the database as well.** A partial unique index on `(customer_id, no)` covers the live
  rows, so a race that slips past the application check is a 409, not a 500 — while a deleted declaration frees its
  number again, exactly as the mock's array did.
- **A delete stamps `deleted_at`.** The declaration has no undo and the mock removed it from its array for good, but
  its id counter had moved on, so the row is what stops a later declaration from taking the same id. The lines stay
  with it, as every other document family's do.
- **Amendments travel with the head.** A BGMEA / BKMEA amendment certificate — what changed, when, why and who signed
  it — is JSONB on the declaration's row, the way a document's history already was: it is a record of the edit, not a
  figure anything has to add up.
- **The in-memory copy stays**, because the RMG export register — still compat code — reads `db.uds` to decide which
  export invoices are at risk, and the bond register, the drawback claims and the sales form read it too. The module
  keeps that copy in step on every write, and the write-back adopts whatever a compat handler changes: closing a
  declaration natively moves the export register's at-risk count at once, which the suite checks.
- **`vat/uds/fit` is registered before `vat/uds/{id}`** — Express would read "fit" as a declaration id otherwise, the
  same ordering the VDS register's `eligible` route needs.
- **22 compat route modules are left, 94 native.** What is left is the rest of the R6 VAT registers, and then
  `compat_state` and the lock are removed and the API can scale out.

## R6.5 — our own UDs / UP on their own tables

`api/src/modules/bonduds.ts` serves `vat/bond-uds` (the register with its statements and totals, `?state=` and its
CSV), `vat/bond-uds/{id}` (one UD: statement, shipments, warnings, settlement) and the create / edit / settle behind
them. The rules are the mock's own, re-exported by `api/src/compat/entry.ts` from `_r65.ts` (`bondUdCreate`,
`bondUdUpdate`, `bondUdSettle`, `bondUdInUse`, `bondUdLines`, `newBondUdId`, `bondUdCsvColumns`, `bondUdCsvRows` —
the register, the statement and the settlement check are `src/lib/settlement.ts`'s, shared with the pages already) —
the SKUs every input and garment has to be, the number that is unique among our permits and cannot change once a
document quotes it, and the settlement that has to dispose of every left-over balance in full — so the rows, the
error codes, the frozen statements and the audit events cannot drift between the two runtimes.

- **An own UD is a row and each input and garment is a row.** `bond_uds` holds the head (the issuer, the kind, the
  dates, the export LC / contract, the buyer, the LC value); `bond_ud_inputs` holds what it permits us to import
  under bond and `bond_ud_garments` what the order exports, in the order they were entered — the same shape as the
  declarations' `uds` / `ud_lines` beside them.
- **One number of ours, in the database as well.** A partial unique index on `(no)` covers the live rows, so a race
  that slips past the application check is a 409, not a 500. An own UD has no delete — a permit that was issued
  lives until it is settled — but a restored older backup can drop one from the in-memory world, and the write-back
  answers that by stamping `deleted_at`, which retires its id the way every other family's stamped rows do.
- **The settlement travels with the head.** What the Bond Commissionerate disposed of — every statement line with
  the quantity cleared on duty and the quantity carried to another UD, the duty paid, the bond reference — is JSONB
  on the UD's row, the way a declaration's amendment certificates travel: a record of the settlement, not a figure
  anything has to add up. The register freezes it: a settled UD serves its settlement's lines, not the live
  statement.
- **The in-memory copy stays**, because the bond register — still compat code — links its lots to the own UDs from
  memory, and the drawback view and the R6.6 proceeds warnings read them too. The module keeps that copy in step on
  every write, and the write-back adopts whatever a compat handler changes.
- **A settled UD is refused before its body is parsed** — the mock's own order (404, then 409, then the zod 422s),
  which the contract suite pins down — and the settle POST answers 200 as the mock did, not Nest's 201.
- **19 compat route modules are left, 97 native.** What is left is the rest of the R6 VAT registers — the bond
  register, the drawback claims, the export register, the proceeds, the late filings, the penalty, the SD
  eligibility and the 9.4 amendments — and then `compat_state` and the lock are removed and the API can scale out.

## R6.6 — the Mushak 9.3 / 9.4 applications on their own tables

`api/src/modules/returnapps.ts` serves `vat/late-filings` (the register with its totals, `?status=` and its
CSV), `vat/late-filings/{id}` (one application, its edit and its delete), `vat/late-filings/{id}/action`
(file / approve / reject), and the same three routes for `vat/return-amendments` (the 9.4 register, one
amendment, and file / approve / amend). The rules are the mock's own, re-exported by `api/src/compat/entry.ts`
from `_r66.ts` (`lfCheck`, `lfCreate`, `lfUpdate`, `lfRemove`, `lfAction`, `amCheck`, `amCreate`, `amUpdate`,
`amRemove`, `amAction` with the register rows `lateFilingRow` / `amendmentRow` and the CSV columns) — the
7-day and one-month windows of s.65, the four years a 9.4 has to correct a source note, the revision that a
second application for the same period climbs to, the state a deemed approval flips it to — so the rows, the
error codes, the frozen effects and the audit events cannot drift between the two runtimes.

- **An application is a row.** `late_filings` holds a 9.3 (the period, the reason, the dates asked and granted,
  the reference it was filed under) and `return_amendments` a 9.4 — the corrections as JSONB in the order they
  were entered (note, column, as-filed, corrected, the explanation), the frozen computation the amended return
  was built from, and the history (JSONB) — the same shape a declaration's amendment certificates travel in: a
  record of what was asked, not figures anything has to add up.
- **One number per family, in the database as well.** A partial unique index on `(no)` covers the live rows of
  each family, so a race that slips past the application check is a 409, not a 500. A deleted draft is stamped
  `deleted_at`, not removed — the register no longer lists it and its id retires with it, the way every other
  family's stamped rows do — and an edit or a filing is refused once the application has moved past draft.
- **The clock is the app's, not the server's.** A filed 9.3 becomes *deemed approved* seven days after it was
  filed, and the register's `state` flips with it: the module computes that against the fixed `TODAY` the whole
  app — the mock, the pages, the seed — runs on, exactly as the mock routes do; only the CSV filename stamp uses
  the real date. The register, `?status=deemed` and the CSVs are byte-identical between the two runtimes on any
  day the suite is run.
- **The effects still land where they always did.** A decreasing 9.4 that is approved posts its s.66 adjustment
  (a `va` number, note 32) in the period it was allowed to, and amending files the amended return (9.1 type C)
  with its own acknowledgement number — both through the shared mirror write-back, so the adjustments register
  and the compliance centre, still compat code, read them the moment they are posted, and the write-back adopts
  whatever a compat handler changes the other way.
- **13 compat route modules are left, 103 native.** What is left is the rest of the R6 VAT registers — the bond
  register, the drawback claims, the export register, the proceeds, the penalty and the SD eligibility — and
  then `compat_state` and the lock are removed and the API can scale out.

## R6.6 — the export-proceeds register on its own table

`api/src/modules/proceeds.ts` serves `vat/proceeds` (the register: outstanding, overdue and due-soon tiles, the
open invoices with their ageing and their PRCs, the batches, both of its CSVs), `vat/proceeds/sample` (the
bank-file template), `vat/proceeds/match` (a file's rows matched against the open invoices before posting),
`vat/proceeds/batches` (the posted batches), `vat/proceeds/batches/{id}` (one batch, by id or number) and
`vat/proceeds/batches/{id}/reverse`. The rules are the mock's own, re-exported by `api/src/compat/entry.ts` from
`_r66.ts` (`prcBatchCreate`, `prcBatchReverse`, `newPrcBatchTag` with the open CSV columns and the PRC matcher) —
the 0.5 % realisation tolerance, the 120-day limit an invoice ages against, the fiscal-year realised total, the
duplicate a re-imported PRC is refused as — so the register, the 422s and the audit events cannot drift between
the two runtimes.

- **A batch is a row.** `prc_batches` holds the file as it was posted: the lines with their allocations as JSONB
  (the invoice each part was matched to, the basis, who by), the per-currency totals, the skipped lines, the
  history, and — after a reversal — the date and the reason. The realisations the allocations took are rows of
  `sale_realisations` on the invoices they belong to, written with the batch in one transaction; a reversal
  removes exactly the ones its `realisationId`s name. The number (`PB-…`) is a partial unique index over the
  live rows, so a race past the in-memory check is a 409, not a 500.
- **The invoices are baselined, not marked.** `prcBatchCreate` / `prcBatchReverse` mutate the sales in place and
  return the ones they touched; the module does *not* re-mark them inside the transaction — the boot and every
  earlier write already baselined them, so the shared `saleDelta` picks the mutations up by diffing against that
  baseline. On success the new baseline is committed after the transaction; on failure each touched sale is put
  back from its pre-call copy and the batch is dropped from the mirror, so a refused posting leaves nothing
  behind but (like every number-issuing family) a gap in the sequence.
- **The clock is the app's, not the server's.** The register's `asOf` is the fixed `TODAY` the whole app runs
  on, the ageing buckets and the overdue tiles are computed against it, and the CSV filename stamps it — exactly
  as the mock routes do. Only a posting's own `createdAt` is the real clock.
- **The effects still land where they always did.** A posting's realisations move the invoice's outstanding
  foreign currency (the own-UD and drawback views, still compat code, read them the moment they land), the
  audit events for the batch and every allocation are recorded after the commit, and the number comes from
  `db.seq.prcBatch` — reconciled at every boot to the highest number the rows have seen, so a stale snapshot
  cannot hand out a number twice.
- **7 compat route modules are left, 109 native.** What is left is the bond register, the drawback claims, the
  export register, the penalty quote and the SD-eligible inputs — and then `compat_state` and the lock are
  removed and the API can scale out.

## R6.5 — the drawback claims on their own table

`api/src/modules/claims.ts` serves `vat/drawback-claims` (the register with its status totals, `?status=` and
its CSV), `vat/drawback-claims/{id}` (one claim, by id or number, and the delete of a draft) and
`vat/drawback-claims/{id}/action` (file / sanction / pay / reject). The rules are the mock's own, re-exported
by `api/src/compat/entry.ts` from `_r65.ts` (`claimCreate`, `claimAct`, `claimRemove`, `CLAIM_ACTION_PERM`,
`newClaimTag` with `ClaimWrite`) — the six-month claim window, the export that cannot be on two active claims,
the DEDO reference a filing carries, the sanction that needs a reason when it allows less than was claimed,
the payment that cannot exceed the sanction — with the register rows and the action states shared with the
pages (`claimList`, `claimRow`, `ACTION_FROM` in `src/lib/drawback.ts`) — so the rows, the error codes and the
audit events cannot drift between the two runtimes.

- **A claim is a row.** `drawback_claims` holds the head (the number `DBK-MMYY####`, the status, the DEDO
  reference, the decision dates and amounts, the rejection reason) with the export lines frozen at creation as
  JSONB — the CD + RD each export claimed, its deadline, the inputs the drawback view had linked — and the
  history, the way every document family's head carries its own. What a line claimed is a record of the claim,
  not a figure anything re-adds.
- **One number while it lives, in the database as well.** A partial unique index on `(no)` covers the live
  rows, so a race that slips past the application check is a 409, not a 500. The number comes from
  `db.seq.claim` — reconciled at every boot to the highest number the rows (stamped ones included) have seen,
  so a stale snapshot cannot hand out a number twice.
- **A delete stamps `deleted_at`.** Only a draft can be deleted — the mock answered 409 for anything else, and
  the module keeps that — and the row is stamped rather than removed, which retires its id the way every other
  family's deletes do. A rejection frees its exports the same way a delete does: the drawback view counts only
  claims that are not rejected, so the export is claimable again the moment either happens.
- **The drawback view still reads the claims — through the mirror.** `vat/bond?view=drawback` is still the
  compat bond route, but the claim rows land in the in-memory `db.drawbackClaims` with every write
  (`markClaims` / `forgetClaim` in the module's write-back), so the view's "on a claim" state and its claimable
  total move the moment a claim is filed, paid or rejected — which the suite checks from both sides.
- **The permission is the mock's own.** Filing is `doc.create` — the applicant's own step — while sanction,
  pay and reject need `doc.approve`, and the from-state each action needs comes from `ACTION_FROM`, so a
  sanction aimed at a draft is the mock's 409, not a 500.
- **4 compat route modules are left, 112 native.** What is left is the bond register, the export register, the
  penalty quote and the SD-eligible inputs — and then `compat_state` and the lock are removed and the API can
  scale out.

## R6 — the last four readers: the compat route table is empty

`api/src/modules/registers.ts` serves `vat/bond` (the consumption register with its statements and totals, its
BoE ageing and its drawback view — three CSVs), `vat/exports` (the RMG export & deemed-export register with its
kind / risk / proceeds filters and its CSV), `vat/penalty` (every period's exposure, and one period's quote with
its what-if overrides) and `vat/sd-eligible` (the SD-paid purchase lines a 9.1 note-40 claim may still draw on).
Nothing here stores a row of its own: each register adds up documents other modules own — the purchases, the
invoices, the BOMs, the openings, the own UDs and the drawback claims for the bond register; the invoices, the
buyers and the exporters' declarations for the export register; the returns' own computation world for the
penalty; the purchase lines and the exports they rode for the SD list. The mirror holds in-memory copies of all
of them, and the computation is the mock's own — `bondRegisterFrom` and the three CSV column sets lifted into
`_r64.ts`, `penaltyExposureOf` / `penaltyQuoteOf` lifted into `_r63.ts`, `exportRegisterOf` lifted into
`src/lib/rmg.ts`, `sdEligible` already pure in `src/lib/sd-export.ts` — called with the mirror's copies of the
same collections the mock passes its own db, so the rows, the totals, the columns and the 422s cannot drift
between the two runtimes.

- **The range rules are the mock's own.** The bond register's `from` / `to` carry the day validation, the
  `to ≤ today` cap and the `from ≤ to` order, each with its own error code; the export register defaults its
  range from go-live to today; the penalty's quote validates its period against the returns' own span and its
  overrides against the same `min0` / `date` / `beforePeriodEnd` codes.
- **The writes these registers react to still land in one step.** Filing a drawback claim, settling a UD,
  closing a declaration or posting a PRC batch moves the bond view, the export register's at-risk count and the
  proceeds filters the moment it commits — the mirror is updated in the same transaction as the rows, which the
  suite checks from both sides.
- **What was left of the compat layer was state, not routes.** The user store's last tenant (the notifications'
  read ids), the sequence counters and the undo buffers still lived inside `compat_state` at this point, saved
  by the writes that touched them; the finale that followed moved those too.
- **0 compat route modules were left, 116 native.** Every route was served by a native module; the compat table
  was empty — and the finale deleted it, its generator and the controller that mounted it.

## The finale — `compat_state` is gone

The snapshot the compat layer was built around — the JSONB `db` the all-mock code saved after every request and
every ported slice drained a family at a time — has no tenants left, so the last piece of the layer went with it.

- **The read ids moved onto the user's own row.** Migration `0023` adds `users.notif_read` (JSONB, default `[]`)
  and lifts the ids out of the stored snapshot in the same migration, so a live upgrade loses nothing. Marking
  notifications read is a single `UPDATE` on that row plus the mirror — no snapshot save, no state lock.
- **The counters derive from the rows — and from the audit trail.** The boot already lifted every sequence
  counter from the highest id each table had seen; the finale adds the audit trail as a second witness for the
  families whose deleted drafts leave a stamped row (`sale`, `purchase`, `creditNote`, `debitNote`, `opening`,
  `batch`, `bom`, `workOrder`, `receipt`, `payment`, `account`, `treasury`, `vds`, `adjustment`, `ud`, `bondUd`,
  `lateFiling`, `returnAmendment`, `prcBatch`, `drawbackClaim`): their numbers were always retired through the
  audit refs (`nextNo` reads them), and now their ids retire through the audit `entity_id`s the same way, so a
  deleted draft's id cannot come back even when the row that stamped it is gone.
- **The boot drops the table at run time.** Migrations cannot: they run *before* the boot, and a database
  written by an earlier release still holds data the adoption legs must read first. So `bootState` reads the
  table if it exists, `restore()` adopts whatever collections a pre-port snapshot still carries (the R5.2–R6.6
  legs, unchanged), and the boot then drops `compat_state` under the state lock — the same lock, so a rolling
  deploy's older instance finishes its in-flight write first; its next save failing afterwards is its
  503-retry path. A fresh seed drops the empty table immediately.
- **The compat module is deleted.** The fallback controller, the persist step (the delta machine that compared
  the in-memory world with the last saved snapshot and wrote every family's legs) and the `compatSnapshot`
  helper are gone. The bulk import keeps its three write-back legs — party, item, master-item — in its own
  transaction, and its audit entries were already native. The route-table generator and the empty table went
  with the controller; the compat *bundle* (`dist/compat.js`) stays: it is the shared rules and the in-memory
  world the native modules still read through the mirror.
- **Backups and restores.** A backup taken by this version carries no `compat_state` (the table is gone) and
  carries the read ids on the users' rows. Restoring a backup taken *before* the finale still works: the
  restore recreates the table if the target's boot already dropped it, lifts the read ids from the snapshot
  onto the users' rows (the pre-finale users have no `notif_read` column of their own), and the restored
  copy's first boot adopts and drops the table like any other upgrade.
- **What the drills prove.** `api_native.py` ends with the finale block: the read ids survive a restart as
  rows; un-applying `0023` and rewinding the read ids into a recreated snapshot makes the next boot re-run the
  migration, lift them back out and drop the table; and a crafted pre-finale backup (compat_state and all,
  users without the column) restores, migrates, boots and ends with the table dropped. The per-family upgrade
  drills each recreate the empty snapshot before rewinding their tables into it — the shape the old code would
  have written — and assert the table is *gone* after the adoption boot, not merely rewritten without their
  collection.
- **Single instance remains — for a different reason.** The snapshot no longer pins the API to one process; the
  in-memory mirror does (every shared computation reads it). The state lock's remaining work is the audit
  chain across a rolling deploy and the re-seed epoch check; the in-process lock serialises the import, the
  backup snapshot and the audit writes. Scaling out is a story about moving the mirror's reads to the tables,
  one family at a time — the same discipline this whole port ran on.

## Tables

| Table | Purpose |
| --- | --- |
| `users` | accounts, role (incl. `vatOfficer`), status, scrypt hash, `password_is_demo`, preferences (JSONB); **R6.2** `access_until` for VAT officers; **finale** `notif_read` — the notification ids the user has already read, the last user-store bit the compat snapshot carried |
| `sessions` | one row per sign-in; `revoked_at` + `revoke_reason` (signedOut, passwordChanged, passwordReset, deactivated) |
| `login_failures` | failures per username, `locked_until` |
| `saved_views` | list views per user and table |
| `company` (single row) + `branches` | company profile printed on Mushak forms |
| `units` | units of measure; ids from `unit_id_seq` |
| `tariff_lines` | NBR tariff per fiscal year (`numeric` rates) |
| `audit_events` | append-only audit trail (indexed by time, Dhaka day, record, record type). **R6:** every row is sealed with `prev_hash` + `hash` (SHA-256 chain); triggers refuse UPDATE / DELETE / TRUNCATE — see [NBR_ENLISTMENT.md](NBR_ENLISTMENT.md) |
| `backups` | **R6.2:** scheduled / manual snapshots (`bytea` gzip JSON, SHA-256, row counts); last 30 kept; one scheduled row per slot (partial unique index) |
| `parties` | **R5.2:** customers and vendors (`kind`), exporter details, seeded credit terms; `deleted_at` is the undo trash; unique per kind on name and BIN |
| `items` | **R5.2:** SKUs — prices and rates (`numeric`), the six movement counters `remain` is derived from, the master item's *name*; unique on `lower(sku)` |
| `master_items` | **R5.2:** HS-code products — flat tax profile like `tariff_lines`, override reason, own history (JSONB); unique on `lower(name)` |
| `stock_documents` | **R5.3:** stock transfers and damage entries (`kind`) — number (unique), process, branches, reason, totals (`numeric`), own history (JSONB) |
| `stock_document_lines` | **R5.3:** a document's lines — item, quantity and unit cost at posting; primary key (document, position) |
| `sales` | **R5.3:** sales invoices (Mushak 6.3) — number and challan (number unique), process, customer and branch as printed, money (`numeric`), the export / deemed-export shipping documents as their own columns, own history (JSONB); `deleted_at` is the undo trash, which keeps a deleted draft's number retired |
| `sale_lines` | **R5.3:** an invoice's printed lines — item, name, HS code, unit, quantity, price, SD/VAT rates and totals, batch; primary key (invoice, position) |
| `sale_realisations` | **R5.3:** export proceeds (PRC) recorded against an invoice — bank, PRC number, foreign-currency amount, rate and the BDT value at that rate, the R6.6 batch that posted it |
| `purchases` | **R5.3:** purchases (Mushak 6.1 input side) — number (unique), challan / BoE number and date, vendor as printed, mode, money (`numeric`), the two totals a purchase adds (`tti`, `rebate`), the Bill of Entry an import clears as its own columns, own history (JSONB); `deleted_at` is the undo trash |
| `purchase_lines` | **R5.3:** a purchase's lines — item, quantity, prices and rates, `rebateable` / `vds`, and an import line's duty breakdown (AV, CD, RD, AIT, AT and the rates) plus what a bonded entry left foregone; primary key (document, position) |
| `notes` | **R5.3:** credit notes (Mushak 6.7) and debit notes (6.8) — `kind` tells them apart; number (unique), the document each was raised against, the customer or vendor as printed, reason, money (`numeric`), the two totals only a debit note has (`tti`, `rebate`), own history (JSONB); `deleted_at` keeps a deleted draft's id and number retired |
| `note_lines` | **R5.3:** a note's lines — item, the quantity the source document had (`sold_qty` on a credit note, `purchased_qty` on a debit note), what came back, at the source document's price and rates; primary key (note, position) |
| `batches` | **R5.4:** production batches (PB number unique) — `mode` (inHouse / contractual / opening), issue and receive dates, the contractor block of a Mushak 6.4 challan (vendor as printed, delivery address, job process, `received_at`), issued / received / rejected totals, material and finished value (`numeric`), process, branch, own history (JSONB); `deleted_at` keeps a deleted draft's id and number retired |
| `batch_lines` | **R5.4:** a batch's finished goods — item, issued / received / rejected quantity (a check keeps received + rejected within issued), the BOM and its version, the unit cost and the value, the work order the line draws on; primary key (batch, position) |
| `batch_consumption` | **R5.4:** the inputs a batch consumes — item, quantity, price and value, merged per input as the BOM (or the actual consumption) states; primary key (batch, position) |
| `opening_entries` | **R5.4:** opening stock — one SKU, one branch, the quantity brought forward, its purchase price and value, the VAT paid on it and its input-tax class; the R6.4 bond block of a go-live entry (BoE, quantity still warehoused, duty suspended) as columns; `deleted_at` keeps a deleted draft's id and number retired |
| `boms` | **R5.5:** price declarations / bills of materials (Mushak 4.3) — the item as printed, the version, the submitted and effective dates, the material value, the wastage, the value added, the declared price and the unit cost a receipt is valued at (`numeric`), the process, `superseded_at`, own history (JSONB); `deleted_at` keeps a deleted draft's id retired while its version may be filed again, so the number's unique index covers the live rows only |
| `bom_inputs` | **R5.5:** a declaration's inputs — item, net quantity, wastage percent, the wastage and gross quantity (`numeric(18,4)`, the coefficients are rounded to four decimals), the price and the two values; one row per input (unique per declaration and item); primary key (declaration, position) |
| `bom_costs` | **R5.5:** a declaration's cost heads — labour, power, overhead, packing, admin, finance, profit, other — and what each adds; a head appears at most once and only with an amount (a zero head is dropped before pricing); primary key (declaration, position) |
| `production_config` (single row) | **R5.5:** how the factory produces — `procedure` (directStock / workOrder) and `consumption` (standard / actual), with who changed it last; `buildBatch` reads both |
| `work_orders` | **R5.5:** production work orders (PW number unique) — the requisition, the issue and due dates, the process, the `status` the approved batches give it, who issued it, own history (JSONB); `deleted_at` keeps a deleted draft's id and number retired |
| `work_order_lines` | **R5.5:** the finished goods a work order asks for — the quantity ordered and the progress the approved batches have made (issued, received, rejected, still owed), with checks that keep the two lifecycle columns and the quantities in agreement; primary key (work order, position) |
| `money_accounts` | **R5.6:** the money accounts — bank, mobile wallet or cash box; the kind's own columns (branch and account type, wallet type and operator) guarded by checks; the balance is *derived*, not stored |
| `money_docs` | **R5.6:** receipts (MR-) and payments (PV-) — `kind` tells them apart; the party as printed, the method, the account, the cheque block, the amount, the charge, what was allocated and what is on account, the process, own history (JSONB); `deleted_at` keeps a deleted draft's id and number retired; checks keep the cheque block with its method and the allocation within the amount |
| `money_allocations` | **R5.6:** the invoices a receipt or payment settles — the invoice's id, number, date and total beside the amount set against it, one row per invoice; primary key (document, position) |
| `treasury_deposits` | **R5.6:** a treasury challan (TR-6) — the head and its economic code, the tax period, the challan number (unique) and date, the bank, the company account the money left, the amount and the depositor; `deleted_at` keeps a deleted draft's id and number retired |
| `vds_entries` | **R5.6:** a VDS certificate (Mushak 6.6) — the invoice it was written against, the party as printed, the value and VAT subject to VDS, the amount withheld and what it settled (`settled`), and the treasury challan a purchase certificate was deposited with; the challan block belongs to `purchase` |
| `vat_adjustments` | **R5.6:** a manual VAT adjustment — the kind and the 9.1 note it lands in (27 / 32 / 38 / 39 / 40), the period, the amount and, for SD on the inputs of exported goods, the purchase line, the export sale and the quantity it covers (JSONB) |
| `accounting_config` (single row) | **R5.6:** how far the books are closed (`closed_up_to`), whether an advance is allowed and whether a new document pre-allocates the oldest invoices — a control on every money document written after it |
| `vat_returns` | **R5.6:** one Mushak 9.1 return per tax period, the period being its id (`ord` only keeps the insertion order stable) — the kind (`original` / `amended` / `full` / `late`, an amended one with its reason), whether there were taxable activities, `draft` or `submitted`, the manual notes (parts 4–5, JSONB) and, once filed, the date, the acknowledgement number, who filed it and **every note of the computation as it was filed** (JSONB); the period lock every other document checks is a row here |
| `vat_settings` (single row) | **R5.6:** the NBR settings — the zone the economic codes are derived from and the business profile the forms print (JSONB), with who last changed them and when |
| `uds` | **R6.2:** a Utilization Declaration (BGMEA / BKMEA) or Utilization Permission (customs) of an exporter customer — the number (unique per exporter), the kind, the dates, the exporter as printed, the export LC / contract and the buyer behind it, the LC value in the declaration's own currency, the amendment certificates (JSONB), its history (JSONB); `deleted_at` keeps a deleted declaration's id retired |
| `ud_lines` | **R6.2:** the inputs a declaration permits — item, name, HS code, unit, the quantity, and the value the declaration allows for it; primary key (declaration, position) |
| `bond_uds` | **R6.5:** our own UD (BGMEA / BKMEA) or UP (Bond Commissionerate) — the number (unique while it lives), the kind and issuer, the dates, the export LC / contract and the buyer behind it, the LC value, the settlement frozen as it was recorded (JSONB), its history (JSONB); `deleted_at` retires the id of one a restored older backup dropped |
| `bond_ud_inputs` | **R6.5:** the bonded inputs an own UD permits us to import — item, name, HS code, unit, the quantity; primary key (UD, position) |
| `bond_ud_garments` | **R6.5:** the finished goods the order exports against an own UD — item, name, unit, the quantity; primary key (UD, position) |
| `late_filings` | **R6.6:** a Mushak 9.3 late-return application (s.65) — the number (unique while it lives), the period, the reason, the dates, the reference it was filed under, the decision, its history (JSONB); `deleted_at` retires the id of a deleted draft |
| `drawback_claims` | **R6.5:** a drawback claim — the number (`DBK-…`, unique while it lives), the status, the export lines frozen at creation with their CD + RD (JSONB), the DEDO reference, the sanction and refund dates and amounts, the rejection reason, the history (JSONB) |
| `prc_batches` | **R6.6:** a bank PRC file posted against the export-proceeds register — the number (`PB-…`, unique while it lives), the file name, the lines with their allocations as JSONB, the per-currency totals, the skipped lines, the reversal date and reason, its history (JSONB) |
| `return_amendments` | **R6.6:** a Mushak 9.4 amendment application (s.66) — the number (unique while it lives), the period, the revision, the corrections as JSONB (note, column, as-filed, corrected, explanation), the frozen computation the amended return was built from, the filing and decision references, the adjust period of its decreasing adjustment, its history (JSONB); `deleted_at` retires the id of a deleted draft |
| `compat_state` | **gone (finale).** The R5.1 JSONB snapshot is empty: every collection it ever held has a table now, the notification read-ids moved to `users.notif_read` and the counters derive from the rows. The table stays in the schema for one more release — a database written before the finale still upgrades through the boot's adoption legs, which read it and then drop it at run time. Remove from the schema once every installed base has passed a finale boot |
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
| `npm --prefix api run typecheck` | type-checks the API **and** the 19 compat route modules |

## Tests

The existing suites run unchanged against the backend (`BASE_URL=http://localhost:3000`). One suite is new:

```bash
API_RESTART_CMD=api/scripts/serve.sh API_LOG=/tmp/dizivat-api.log DATABASE_URL=… SESSION_SECRET=… \
  python3 scripts/api_native.py
```

It runs 793 checks: real sign-out, revocation on password change, reset and deactivation, forged tokens, lockout,
scrypt-only storage, audit rows and the append-only triggers, the R6.2 officer access window, the restore drill into a
fresh database, and that **records, preferences, views, sessions, revocations, lockouts, changed passwords and audit
ids survive an API restart**. Since R5.2 it also checks master data where it now lives — rows in `parties`, `items` and
`master_items`, none of those collections left in the snapshot, the database refusing a duplicate name, BIN or SKU that
slipped past the application checks, `delete` → `deleted_at` → undo → still deleted after a restart, a compat document's
counter and a compat import reaching `items` — and it **drills the upgrade**: `API_LOG` lets it count the adoption, and
the last section rewrites the live database back into the pre-R5.2 shape (the collections inside `compat_state`, the
deleted parties in its undo buffer, the three tables empty), restarts, and requires the same rows back, the snapshot
rewritten without them, the four registers served row for row as before, a second boot that adopts nothing again, and
writes that still land in the tables.

Since R5.3 it checks the stock documents the same way — a draft is a row with its lines and moves no stock, approving
it moves the branch split that the `stock` and ledger endpoints derive (from the tables since R5.4), cancelling gives the
stock back, a damage write-off reaches `items.damage` and is taken back again, editing a draft replaces the line rows,
deleting one removes them and retires its number, a create that cannot be approved leaves no row, and the database
refuses a duplicate document number — and it **drills the second upgrade**: the live database is rewritten back into
the pre-R5.3 shape (both collections with their lines inside `compat_state`, the two tables empty), the API restarts,
and the same documents and lines must be back in the tables, the snapshot rewritten without them, both registers
served row for row as before, the derived stock unchanged, a second boot adopting nothing again.

It checks the sales invoices the same way — a draft is a row in `sales` with its line in `sale_lines` and moves no
stock, approving it moves the branch split and `items.sold` and is quoted by the ledger that still adds up every
document, cancelling gives both back and stores the reason on the row, the invoice's own history travels with it,
editing a draft replaces the line rows in the order they are printed, deleting one stamps the row and keeps its lines
so the next invoice takes a new number and the undo clears the stamp again, an export invoice keeps its LC, country
and foreign-currency value as columns of its own row, the proceeds recorded against it are rows with the PRC number
upper-cased and the BDT value at the rate entered (a PRC already on an invoice, or more than the invoice's outstanding
foreign-currency value, is a 422, and removing an entry frees the number again), what is still returnable is served
from those rows, a service sale is numbered in its own series and moves no stock, bulk approve takes the drafts and
reports the ones it skipped, an invoice that cannot be approved leaves no row behind, the snapshot carries no sales
collection at all, and the database refuses a duplicate invoice number — and it **drills the third upgrade**: the live
database is rewritten back into its pre-R5.3 shape (the invoices with their lines and proceeds entries inside
`compat_state`, the deleted drafts back in its undo buffer, the three tables empty), the API restarts, and the same
invoices, lines, export headers and proceeds entries must be back in the tables, the snapshot rewritten without them,
the three registers served row for row as before, an invoice deleted before the upgrade still in the undo buffer and
still undoable, the derived stock unchanged, a second boot adopting nothing again, and writes landing in the tables.

It checks the purchases the same way — a draft is a row in `purchases` with its line in `purchase_lines` and moves
no stock, approving moves the branch split and `items.purchased` and is quoted by the ledger, cancelling takes the
stock back out and stores the reason on the row, the history travels with the row, editing replaces the line rows in
the order they are printed, deleting stamps the row and keeps its lines so the next document takes a new number and
the undo clears the stamp, a goods purchase refuses to become a service one, an import purchase keeps its Bill of
Entry as columns of its own row and every line's duty (AV, CD, RD, AIT, AT) as columns of its line — the totals the
R6.4 bond register and the R6.5 drawback claims read — the bonded demo entries kept their duty foregone, a service
purchase is numbered in its own series and moves no stock, bulk approve reports what it skipped, what a debit note
may still return is served from those rows (and a service purchase has nothing to return), the snapshot carries no
purchases collection, and the database refuses a duplicate document number — and it **drills the fourth upgrade**:
the live database is rewritten back into its pre-R5.3 shape (the documents with their lines, Bills of Entry and duty
breakdowns inside `compat_state`, the deleted drafts back in its undo buffer, the two tables empty), the API
restarts, and the same documents, lines, three registers row for row, BoEs, duty columns and derived stock are
required back, with a document deleted before the upgrade still undoable and a second boot adopting nothing again.

It checks the notes the same way — a credit note is raised against an approved invoice and priced pro rata, a draft
moves no stock, approving brings the goods back and takes `items.sold` down with the branch split and the ledger that
still derive from every document, what is returnable on the invoice follows, cancelling sends the goods out again and
stores the reason on the row, a second cancellation is a 409, editing a draft replaces the line rows, a note cannot
move to another invoice, returning more than the document sold or bought is a 422, a note against a draft invoice is
a 422, deleting a draft stamps the row and keeps its lines so the next note takes a new id and a new number; and on
the debit side the two totals only a debit note has are columns of its row, returning more than the branch holds is a
409, approving takes `items.purchased` down, a service purchase has no goods to return, and cancelling puts them back
— plus the snapshot carrying neither collection, the demo notes seeded into their tables, the database refusing a
duplicate note number, and a **fifth upgrade drill**: the live database is rewritten back into its pre-R5.3 shape
(both collections with their lines inside `compat_state`, the two tables empty), the API restarts, and the same notes,
lines and registers row for row are required back, with a note deleted before the upgrade staying deleted while its
id and number stay retired, the derived stock unchanged, a second boot adopting nothing again, and writes landing in
the tables.

Since R5.4 it checks the opening entries the same way — a draft is a row with its value and the VAT paid on it and
moves no stock, approving brings the quantity into the branch split that the `stock` and ledger endpoints derive and
writes `items.opening` with it, the ledger quotes the entry as its opening row, cancelling takes
the quantity back out and stores the reason on the row, a cancelled entry is neither cancelled twice nor approved
again, editing a draft replaces its fields on the row, an unknown SKU or branch is a 422 from the mock's own rules,
deleting a draft stamps the row so the next entry takes a new id and a new number, the register's `?item=` filter is
served from the table, the snapshot carries no openings collection, the demo entries were seeded with their R6.4 bond
blocks and the bond register that reads them still answers, and the database refuses a duplicate entry number — and
it **drills the R5.4 upgrade**: the live database is rewritten back into its pre-R5.4 shape (the entries inside
`compat_state`, the table empty), the API restarts, and the same entries, the same three registers row for row (the
entries, the branch split and the items with them) and the same derived stock are required back, with an entry
deleted before the upgrade staying deleted while its id and number stay retired, a second boot adopting nothing
again, and writes landing in the table.

It checks the production batches the same way — a draft is a row with its finished goods and the inputs its BOM
consumes and moves no stock, its line is priced at the active BOM's unit cost, approving receives the goods and
consumes the inputs (both ledgers quote the batch, the goods become a lot a sales invoice can draw on, and
`items.prod_issue` / `prod_receive` are written with the row), the register lists the batches with their facets and
totals and exports one CSV row per line, a batch cannot issue more than its work order has left and the work order's
progress — which compat derives from the batches in memory — follows an approval and a cancellation, cancelling puts
the goods and the inputs back and stores the reason, a cancelled batch is neither cancelled twice nor approved,
edited or deleted, editing a draft replaces its lines and totals on the row, the batch type cannot change, deleting a
draft stamps the row and keeps its lines so the next batch takes a new id and a new number, an unknown SKU, more
received than issued and an unknown contractor are 422s from the mock's own rules; a contractual challan sends the
inputs out and receives nothing, shows in the register's `receipt` facet and in the subcontracting register that reads
the batches in memory, comes back on a receipt of its own (once per challan, one line per batch line, `items.prod_receive`
with it), and an opening batch is created and approved in one step at its own unit cost with no consumption — plus the
snapshot carrying no batches collection, the demo batches seeded into their tables with their contractors and their
consumption, and the database refusing a duplicate batch number. And it **drills the same upgrade**: the live database
is rewritten back into its pre-R5.4 shape (the batches with their lines and consumption inside `compat_state`, the
three tables empty), the API restarts, and the same batches and the same six registers row for row (the batches, the
lots, the work orders' progress, the subcontracting register, the derived stock and one SKU's ledger) are required
back, with a batch
deleted before the upgrade staying deleted while its id and number stay retired, a second boot adopting nothing again,
and writes landing in the tables.

And since the last R5.4 slice it checks the two derived endpoints themselves. `/stock` answers a page of every SKU —
sorted by SKU, with the stock-holding branches and the value each holds — every row valued at cost and at sale price
over what is left, the register totalling both, facets that count the same rows, and `?stock=`, `?branch=`, `?q=`,
paging and a CSV with a column per branch all served from the tables: every quantity away from the factory is that
branch's own approved documents, summed in SQL over the ten families for every SKU, the factory holds whatever is not
explicitly at another branch, and `remain` is the counters on the SKU's own row. One SKU's ledger is sorted by date and
type, quotes the document each row came from, keeps the production posted before R3 as a monthly summary, and runs a
balance that closes on the quantity the SKU's row says is left — for *every* SKU — while `?branch=` closes on that
branch's quantity and shows the transfers, which company-wide net to zero and stay out; an unknown SKU and a branch
that cannot hold stock (one that does not exist, or the head office) are 404s. A damage entry approved at the other
branch is in both answers at once, and cancelling it takes both back row for row. And the decisive check: a transfer
line changed in SQL alone, with the in-memory copies left stale on purpose, moves the branch split and that branch's
ledger and not the company-wide one; an invoice line changed the same way moves the ledger and not the split, because
the invoice is at the factory; and putting both back restores every number — which is what "served from the database"
has to mean.

And since R5.5 it checks the price declarations and the production configuration the same way. The register answers a
page of declarations sorted by SKU with their status and the item's sale price beside the declared one, facets that
count the same rows twice over, `?status=`, `?item=`, `?q=` (which finds a declaration by the name of one of its
inputs), `?sort=`, `?from=`/`?to=` on the effective date, paging and the Mushak 4.3 CSV; one declaration comes with
every version of its item beside it, newest first, and is found by its number as well as its id. Every declaration in
the database is checked against its own child rows in SQL — the material value is the sum of its inputs' values, the
wastage the sum of theirs, the value added the sum of the cost heads, the price the first two together and the unit
cost the price less the profit head — and a unit cost or an input quantity changed in SQL alone, with the in-memory
copies left stale on purpose, moves the answer at once. Filing a declaration makes it the item's next version, priced
by the mock's own `calcBom`; an unknown item, a finished good as an input, a repeated input or cost head, a missing
amendment reason, an effective date that is not after the version in force, a license date that is not a date and a
declaration that prices at zero are 422s from those same rules, a second draft for one item is a 409, and an operator
may read the register but not file one. Editing a draft prices it again and records the price that moved and the
inputs' new signature; approving files it and supersedes the version that was in force — on the row as well as in the
register — and a filed version is neither approved again nor cancelled nor edited nor deleted. The decisive check is
the one that crosses families: a batch issued on the new version's effective date is priced from the declaration filed
through this module and consumes its inputs, while a batch issued today is still priced from the version in force —
so the mirror `buildBatch` reads is the row this module wrote, with no restart in between. A cancelled draft keeps its
number retired and a deleted one frees it, so filing that item again takes the same number but never the same id, and
the database refuses a second *live* declaration with one number while allowing a stamped row to carry it. The
configuration is the single row: an administrator's PUT replaces it and stamps who changed it, the audit trail records
both fields, an operator and an approver get a 403, and with the work-order procedure a batch has to name one at once —
`buildBatch` read the row. Plus the snapshot carrying neither collection, the demo declarations seeded into their
tables with their inputs and cost heads. And it **drills the same upgrade**: the live database is rewritten back into
its pre-R5.5 shape (the declarations with their inputs and cost heads and the configuration inside `compat_state`, the
four tables empty), the API restarts, and the same declarations, the same configuration and the same seven registers
row for row (the declarations, one with its versions, the CSV, the configuration, the batches, the lots and the bond
register) are required back, with a declaration deleted before the upgrade staying deleted while its version is free
again and its id stays retired, a batch still priced from the adopted declaration, a second boot adopting nothing
again, and writes landing in the tables.

And since the second R5.5 slice it checks the work orders the same way. The register answers a page of work orders
newest first with the status the batches give each one, facets that count the same rows, `?status=`, `?process=`,
`?q=` (which finds one by its number, its requisition, its remark or the goods it asks for), `?sort=`,
`?from=`/`?to=` on the issue date, paging and a CSV with one row per line the floor owes; one work order comes with
the batches that draw on it beside it, and is found by its number as well as its id. **Every line in the database is
checked against the approved batches' own rows in SQL** — what was issued, received and rejected is their sum, and
what is still owed is the quantity ordered less what went into production — and a quantity ordered changed in SQL
alone, with the in-memory copies left stale on purpose, moves the answer and what is owed with it. Creating and
approving a work order in one step leaves nothing issued, a draft challan that draws on it moves no progress, an
approval moves what was issued and the status to `partial` on the row and in the register at once, the contractor's
receipt moves what came back and what was rejected, a batch cannot issue more than the work order has left, and
cancelling the batch takes the whole progress back. A work order a live batch draws on cannot be cancelled (the 409
names the batch) and an approved one is neither approved again, nor edited, nor deleted; with the batches gone it
cancels with its reason on the row, and a cancelled one is not cancelled twice. An unknown SKU, one with no
declaration in force on the issue date, the same SKU twice, a due date before the issue date and no lines at all are
422s from the mock's own rules; a viewer may read the register but not add to it. Deleting a draft stamps the row and
keeps its lines, matches the id only, and the next work order takes a new id *and* a new number — the deleted draft's
stays retired through the audit trail — which the database enforces too. Plus the snapshot carrying no work orders,
the demo work orders seeded into their tables with their progress already computed from the demo batches. And it
**drills the same upgrade**: the live database is rewritten back into its pre-R5.5 shape (the work orders with their
lines inside `compat_state`, the two tables empty), the API restarts, and the same work orders, the same progress and
the same seven registers row for row (the work orders, one with its batches, the CSV, the batches, the lots, the
subcontracting register and the declarations) are required back, with a work order deleted before the upgrade staying
deleted while its id and number stay retired, a batch still creatable, a second boot adopting nothing again, and
writes landing in the tables.

And since the last R5.5 slice it checks the two derived registers of production the same way it checks the derived
stock. `/production/lots` answers one lot per batch and SKU an approved batch received — sorted by date, each quoting
its batch, with what was received, what the invoices drew and what is left — `?all=1` keeps the empty ones, `?item=`
keeps one SKU's and `?exclude=` leaves one invoice out, which is how the sales form edits a draft. Every lot is
checked against the same sums written in SQL over `batch_lines` and `sale_lines`, an invoice that draws more than a
lot holds is a 422 `exceedsLot` from the mock's own rule, an approved invoice that draws one moves it, and cancelling
the invoice gives the stock back. `/production/subcontract` answers the fiscal year the RMG registers run on by
default, every contractual challan in the range newest first with what is still at the contractor and for how long,
totals that count the same rows, `?status=`, `?days=` moving the overdue threshold, a CSV of fourteen columns named
after the range, and the three 422s its own range rule gives; both registers need a session. And the decisive checks:
**a batch line's received quantity changed in SQL alone, with the in-memory copies left stale on purpose, moves that
lot and not the branch split; a line of an invoice that draws a lot moves the lot; a challan's receipt changed the
same way moves the subcontracting register and leaves the lots alone** — because they read the batch's lines, not its
totals — and putting each row back restores every number.

And since R5.6 it checks the accounting and the NBR VAT documents the same way. The accounts register answers every account with its balance —
checked to be the opening balance plus what was received less what was paid out, and what was received checked against
the same sum over `money_docs`; an account is created with its own balance and nothing through it, a duplicate number
at the same provider is a 422, a mobile wallet is another kind and an account cannot change its kind (the schema
validates before that rule, so the body the new kind needs has to be there first). The decisive checks are the ones
that cross families. **A receipt settles an invoice: a draft leaves the invoice's `paid` untouched, approving it
writes `paid` and `due` on the `sales` row in the same transaction as the money document — and due follows as
`net_total − paid`** — so what is still open is what is left, a customer's statement carries the receipt and still
reconciles, and cancelling it gives the settlement back. A payment does the same on the purchase side. A closed book,
a future date, an account of the wrong kind, more allocated than the document took, more than the invoice has left, an
invoice that is not open, the same invoice twice and no reference on a transfer are 422s from the mock's own rules.
The register keeps its four facets and labels them, `?invoice=` keeps the receipts that settle one, the CSV names the
invoices each settled, deleting a draft stamps the row and keeps its allocation, the next receipt takes a new id and a
new number, and the database refuses a duplicate number too. The configuration is one row, an administrator's PUT
replaces it, an approver is refused, and the books cannot be closed up to a future date. Plus the snapshot carrying
none of the three collections, the demo accounts, receipts, payments and allocations seeded into their tables. And it
**drills the same upgrade**: the database is rewritten into its pre-R5.6 shape (the accounts, the documents with
their allocations and the configuration inside `compat_state`, the four tables empty), the API restarts, and the same
accounts with their balances, both money registers, the configuration, the invoices and a customer's statement are
required back row for row — with a receipt deleted before the upgrade staying deleted while its id and number stay
retired, a receipt written on the upgraded database still settling its invoice on the adopted `sales` row, a second
boot adopting nothing again, and writes landing in the tables.

And the Mushak 9.1 return, the family this release ends with. **The lock is a row: a period that has a submitted
return refuses a document dated into it, and the moment a return is deleted the same date is allowed again** — the
decisive check, because it is the one every other family reads. A return is filed in order and not twice, a period
that is not over is refused, a submission needs note 58 to cover note 50, and what comes back carries the
computation it was filed with. The register keeps its facets, its sorts, its ranges and its CSV, the note sub-forms
behind a filed return's notes answer the documents behind them, and the compliance centre answers for the open
period and for a filed one. The NBR settings are one row: an administrator's PUT replaces it, an approver is
refused, and the zone the economic codes come from is validated. Plus the snapshot carrying neither collection, the
demo's returns and settings seeded into their tables, and **the upgrade drilled the same way**: the database is
rewritten into its pre-R5.6 shape (the returns and the settings inside `compat_state`, both tables empty), the API
restarts, and the same register with its CSV, the same tax periods, the same compliance answers, the same return
with its computation and the same note sub-forms are required back — with a return started on the upgraded database
being a row in `vat_returns`, deleting the draft taking the row with it, the settings write landing in the one row,
and a second boot adopting nothing again.

And the readers this release ends with. One SKU's Mushak 6.1 book is served with its running balance and exported as a
CSV with a header and one line per row, and the Mushak 6.10 register with the purchases and the sales above the
৳2,00,000 limit. **The decisive checks are the ones that move a row in SQL alone, with the in-memory copies left
stale on purpose**: an SKU's opening counter moves the book's closing balance (the ledger reconciles to the counter,
and the counter is a column), an invoice's total moves the dashboard's KPIs, the same invoice left as a draft is one
more approval in the notifications, and its number is what the ⌘K search finds it by. The bulk import creates a
customer through the mirror, the same row a second time is a duplicate rather than an error, one bad row refuses the
lot, and the party write-back carries it into `parties` — with one audit event for the party and one for the import
itself. Marking the notifications read dismisses them, and a restart later they are still read: the ids it takes to
know that live in the user store, inside the snapshot.

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
| R5.2 | **done** — customers and vendors (`parties`), items and master items (`items`, `master_items`). The stock ledger and branches' stock are *derived* from documents (there is no stored movement table), so they become relational with the documents in R5.3 |
| R5.3 | **done** — transfers and damage (`stock_documents` + `stock_document_lines`), sales (6.3, `sales` + `sale_lines` + `sale_realisations`), purchases incl. imports and services (`purchases` + `purchase_lines`), credit and debit notes (6.7/6.8, `notes` + `note_lines`) |
| R5.4 | **done** — the derived stock: the opening entries (`opening_entries`) and the production batches (6.4, `batches` + `batch_lines` + `batch_consumption`) are rows, and since every family the branch split and an item's ledger add up is relational now, `stock` and `items/{id}/ledger` are served from those rows by the mock's own derivation. Next: the rest of production — BOMs and their 4.3 versions, work orders, the production configuration, the lots and subcontracting registers |
| R5.5 | **done** — the rest of production: the price declarations (Mushak 4.3, `boms` + `bom_inputs` + `bom_costs`), the production configuration (`production_config`) and the work orders (`work_orders` + `work_order_lines`, whose progress the approved batches' rows are summed into) are rows, and the two registers derived from them — the finished-goods lots (`production/lots`) and the subcontracting register (`production/subcontract`) — are served from those rows by the mock's own derivation. Production is out of `compat_state` |
| R5.6 | **done** — accounting: the accounts (`money_accounts`), the receipts and the payments with their allocations (`money_docs` + `money_allocations`, settling the invoice's `paid` and `due` in the same transaction) and the accounting configuration (`accounting_config`); the treasury deposits (`treasury_deposits`), the VDS certificates (`vds_entries`, whose approval settles what it withholds on the invoice's row), the VAT adjustments (`vat_adjustments`) and the Mushak 9.1 return with the period lock, the tax periods and the compliance centre (`vat_returns`, a submitted one carrying the computation it was filed with, and the one row of `vat_settings`) |
| R6.2–R6.6 | **done** — the exporters' Utilization Declarations (`uds` + `ud_lines`), our own UDs / UPs with their settlement (`bond_uds` + `bond_ud_inputs` + `bond_ud_garments`), the late-filing and return-amendment applications (`late_filings`, `return_amendments`), the bank-file PRC batches (`prc_batches`) and the drawback claims (`drawback_claims`) are rows; the registers that read them (UD register, bond consumption register, export-proceeds register, penalty) are native readers over the mirror |
| R6.7 | **done** — the last four readers (bond register, RMG export register, penalty quote, SD-eligible inputs) are native: the compat route table is empty, 116 routes native |
| Finale | **done** — `compat_state` is gone: the read ids on `users.notif_read`, the counters from the rows and the audit trail, the table dropped by the boot that drains it, and the compat module (controller, persist, snapshot helper, route-table generator) deleted. The write-back survives only for the bulk import's three legs. Scaling out is now a mirror story, not a snapshot story |

Money columns will be `numeric(18,2)` (as `parties.credit_limit`, the `items` prices and `tariff_lines` already are),
quantities `numeric(18,3)` (the units allow up to three decimals) and a declaration's coefficients `numeric(18,4)`
(the Mushak 4.3 wastage is rounded to four), with row-level
period-lock checks in the database, plus server-side PDF (R4 used print CSS) and the NBR tariff import.
