# NBR VAT-software enlistment — readiness (R6 / R6.2 / R6.3)

DiziVAT is being prepared for enlistment as **NBR-approved VAT software** under General Order 16/Mushak/2019. Taxpayers with
an annual turnover above Tk 5 crore must keep their VAT records in enlisted software. The non-compliance penalty is
Tk 10,000–1,00,000. Manual returns are no longer accepted from July 2026.

This page maps the enlistment requirements to what the software does, and lists what is still open. It is a working
document for the application, **not** legal advice. Check every rule against the current Act, rules, SROs and
general orders before you file.

Branch `r6-enlistment-rmg`, version **0.12.0** (R6.3). The git tag `v0.9.1` marks the state before R6; `v0.10.0` is R6.1, `v0.11.0` R6.2.

## 1. Requirements → status

| # | Requirement (GO 16/Mushak/2019 and NBR practice) | DiziVAT | Status |
|---|---|---|---|
| 1 | Comply with the VAT & SD Act 2012, the Rules and orders | Rules engine with effective-dated parameters (`src/lib/rules.ts`, below); Mushak forms per the 2019 rules and the 2024 9.1 layout | ✅ ongoing |
| 2 | Automated generation and printing of the return, purchase book, sales book and current account | 9.1 return builder with note drill-down; Mushak 6.1 / 6.2 books; party statements; PDF + print on every form | ✅ |
| 3 | Statutory forms | 4.3, 6.1, 6.2, **6.2.1** (purchase-sales book of traded goods), 6.3 (local / export / service), 6.4 (contractual batches + subcontracting register), **6.5** (transfer challan print), 6.6, 6.7, 6.8, 6.10, 9.1, TR-6 | ✅ R6.2 (9.3 / 9.4 not in scope) |
| 4 | **Tamper protection** — records must not be altered or deleted unnoticed | Audit trail is **append-only in the database** (triggers) and **hash-chained** (SHA-256); integrity check in the UI and the API (§2) | ✅ R6.1 |
| 5 | **VAT officials must have access for audit** | **VAT officer** role: read-only, audit trail and exports, **time-boxed** (access-until date, max 90 days, enforced at sign-in and on every request) and **every read logged** in the audit trail (§5) | ✅ R6.2 |
| 6 | **At least two backups of transaction data a day** | **Two scheduled backups a day** (02:00 and 14:00 Asia/Dhaka) plus on demand: gzip JSON snapshot of every table with its SHA-256, last 30 kept, verify and download in *Master data › Backups* (§6). A **restore drill** proves a backup restores into a fresh database (§8). Neon point-in-time recovery on top | ✅ R6.2 / R6.3 |
| 7 | Manual records during outages, entered later | Back-dated entry within open periods; period lock after the return is submitted | ✅ |
| 8 | Integration with the taxpayer's ERP / books | Typed REST API (`docs/API.md`) and CSV exports on every register; **bulk import** of items, customers and vendors from CSV / Excel with a dry run (§7). Transaction import is planned | ✅ masters · 🟡 transactions |
| 9 | User access control | Roles (admin, approver, operator, viewer/auditor, VAT officer) with per-permission checks in the API; sessions revoked on password change, reset or deactivation; lockout | ✅ |
| 10 | Records kept for 5 years | No hard deletes of tax documents (cancel with reason); audit rows cannot be deleted | ✅ (retention job planned) |
| 11 | e-VAT filing pack (GO 12/Musak/2026) | 9.1 values computed per note, ready to key into the e-return. A direct upload format will follow once NBR publishes one | 🟡 |
| 12 | Developer: RJSC company, 5 years' experience, after-sales service | Company paperwork — outside the software | — |

✅ done · 🟡 partly / planned · — not a software item

## 2. Tamper-evident audit trail (R6.1)

Every audit event (create, edit, approve, cancel, sign-in, settings change …) is sealed when it is written:

```
hash = SHA-256( prev_hash + "\n" + canonical(event) )
canonical(event) = JSON of [at (ISO-8601 UTC), actor, actorId, entity, entityId, ref, action, changes, note]
first prev_hash = 64 × "0"
```

- **Database guard** (`api/drizzle/0003_audit_append_only.sql`): triggers on `audit_events` refuse `UPDATE`,
  `DELETE` and `TRUNCATE`. The one exception is the single sealing write that fills a missing `hash`. Only the demo
  re-seed bypasses the guard: it sets the transaction-local flag `dizivat.reseed`.
- **Chain**: each new event reads the newest seal inside the state lock and links to it, so the order is fixed.
  Changing any field, deleting a row or re-ordering rows breaks every later link.
- **Upgrade**: rows written by R5.1 (before the chain existed) are sealed once at start-up, oldest first.
- **Verify**: `GET /api/v1/audit/verify` (permission `audit.view`) recomputes the chain and returns
  `{ ok, algorithm, count, head, checkedAt, broken? }`. `broken` names the first bad event and why it failed:
  `hashMismatch` (altered), `prevMismatch` (deleted or re-ordered) or `missingHash`. The **Audit trail** page shows the
  result in a card with a *Verify now* button.
- **Why both**: the triggers stop the application or a casual SQL user from rewriting history. The chain detects what
  the triggers cannot stop, such as a superuser disabling them or a restore from an edited dump. Keep a copy of the
  `head` hash outside the database (for example, print it with the monthly return) to anchor the chain.

Tests: `scripts/api_native.py` (database refuses UPDATE / DELETE / TRUNCATE, all rows sealed, chain verifies and
continues across a restart) and `scripts/e2e_r6.py` (UI card, permissions, the head moves with every event).

## 3. Rules engine (R6.1)

`src/lib/rules.ts` holds the statutory parameters with their **effective dates and legal reference**, so a
document is always judged by the rule in force on its date:

| Key | Value | From | Reference |
|---|---|---|---|
| `return.dueDays` | 15 days after the period | 2019-07-01 | §64; Ordinance approved 29-09-2026 |
| `return.dueDaysExtended` | 20 days (government, banks, insurers, zero-return filers) | 2026-07-01 | §64 as amended |
| `itc.windowPeriods` | 4 → **6** tax periods | 2025-07-01 | §46(2), Finance Ordinance 2025 |
| `at.adjustWindowPeriods` | 4 → **6** | 2025-07-01 | §31 |
| `vds.supplierWindowPeriods` | 3 → **6** | 2025-07-01 | VDS Guidelines 2025 |
| `vds.certificateWorkingDays` | **3 working days** after the return | 2025-07-01 | VDS Guidelines 2025 |
| `at.rate.manufacturer` | 3 % → **2 %** | 2025-07-01 | Finance Ordinance 2025 |
| `at.rate.commercial` | 5 % → **7.5 %** | 2025-07-01 | Finance Ordinance 2025 |
| `interest.monthlyPct` / `interest.maxMonths` | 1 % a month, 24 months at most | 2019-07-01 | §127 |
| `bank.channelLimit` | Tk 1,00,000 | 2019-07-01 | §46 |
| `m610.limit` | Tk 2,00,000 | 2019-07-01 | Rule 42 |

**Working days:** Friday and Saturday are weekly holidays. Fixed national days (21 Feb, 26 Mar, 14 Apr, 1 May,
16 Dec, 25 Dec) are built in. Moon-sighting holidays (Eid, Ashura …) and other gazetted days are added each year in
**NBR VAT › VAT settings › Business profile › Extra holidays**. A due date that falls on a holiday moves to the
next working day.

Where it is used:
- the return due date (compliance centre, dashboard deadlines, period list, 9.1);
- the Mushak 6.6 deadline (compliance centre, *Issue Mushak 6.6 by …*);
- advance tax on imports, pre-filled at 2 % or 7.5 % from the business profile.

## 4. Business profile

**VAT settings › Business profile** (permission `settings.manage`) stores:
- the segment (RMG direct / deemed / composite exporter, manufacturer, trader, service);
- the *100 % export-oriented* flag (Rule 21: no Mushak 4.3; a note appears on the 4.3 register);
- the importer class (AT rate);
- the return-deadline category;
- the bond licence and its expiry (warned 90 days ahead);
- trade-body membership;
- extra holidays.

Every change is audited field by field. A 100 % export-oriented RMG unit cannot be saved without a bond licence.

## 5. VAT-officer access (R6.2)

- Role `vatOfficer` — permissions: view everything, export (CSV / PDF) and the audit trail; **no** create, edit, approve,
  settings or user administration (403 from the API, buttons hidden in the UI).
- **Access until** (Asia/Dhaka date) is required, may not be in the past and at most **90 days** ahead
  (`OFFICER_MAX_DAYS`). The day after it, sign-in answers `403 expired` (logged as a failed sign-in) and open sessions
  stop working at once. Admins extend or end the access in *Users & roles*; the list shows "until …".
- **Access log:** every request an officer makes is written to the audit trail as *access · viewed* with the path and
  query (at most once a minute per path), so the taxpayer can show exactly what was inspected. Native and compat
  endpoints share one de-duplication map.
- Database: `users.access_until` (date) with a check constraint that officers have one (migration `0004`).

## 6. Backups (R6.2)

| | |
|---|---|
| Schedule | 02:00 and 14:00 Asia/Dhaka (`src/lib/backup-schedule.ts`); a slot missed while the service slept is taken as soon as it wakes (catch-up, checked every 5 minutes and on every visit to the page) |
| Content | `dizivat-backup/1`: gzip JSON of every table — documents, masters, users (without password hashes), audit trail with its hash chain, settings. Sessions and lockouts are left out |
| Integrity | SHA-256 stored with each backup; *Verify* re-hashes the stored bytes; downloads carry `X-Backup-SHA256` and are audited |
| Retention | last 30 (15 days at two a day) in the `backups` table; download copies for off-site storage |
| Demo upgrades | when a release ships a new demo data set, the server backs up everything first, then re-seeds (`DEMO_RESEED=off` keeps customer data) |

API: `GET /api/v1/backups` (status + list), `POST /api/v1/backups`, `GET /api/v1/backups/{id}` (download),
`POST /api/v1/backups/{id}/verify` — permission `settings.manage`.

## 7. Bulk master-data import (R6.2)

*Master data › Data import*: items, customers or vendors from **CSV or Excel (.xlsx)** — read in the browser, header row
mapped by name (common aliases such as "HS code", "UoM", "Item code" are recognised), up to 2,000 rows.
**Validate** runs the same rules as the entry forms on every row (row numbers as in the sheet); **Import** is enabled only
after a clean validation and is all-or-nothing. Records already on file (same SKU / BIN / name) are skipped; duplicates
inside the file are errors. An **RMG starter catalogue** (31 garment inputs, trims, packaging and garments with HS codes)
can be loaded instead of a file. Each created record and the import itself are audited.

## 8. Restore drill (R6.3)

`api/dist/restore.js` restores a backup — a row of the `backups` table or a downloaded `.json.gz` — into an **empty**
database (it refuses a non-empty one), checks the SHA-256, loads every table in one transaction, compares row counts
and every document collection, verifies the audit hash chain end to end and, with `--boot`, starts the API on the copy,
signs in and lists the sales invoices. `--record` stores the result in the source database: *Master data › Backups*
shows **Last restore drill** (`GET /api/v1/backups` → `drill`). CI runs a full drill on every push (in
`api_native.py`). Procedure, targets (RPO ≤ 12 h, RTO ≤ 1 h) and the checklist: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

## 9. Interest and penalty calculator (R6.3)

The compliance centre has an **Interest & penalty** card for the selected period: §127 interest at 1 % a month (a
started month counts) on unpaid VAT (9.1 note 41) and SD (note 42), capped at 24 months, and the late-return penalty
(note 43, Tk 10,000 by default — the officer sets the amount). Due dates follow the return due date (15th / 20th, moved
past weekends and holidays). Every input can be changed for a what-if; buttons open the return or a TR-6 for the
interest or penalty. An **exposure** list shows each period that owes interest or a penalty today. Rates live in the
effective-dated rules table. API: `GET /api/v1/vat/penalty`.

## 10. Next

1. Transaction import (sales, purchases) and an e-VAT filing export once NBR publishes the format.
2. 9.3 / 9.4 (late and corrected returns) if NBR requires them for enlistment.
3. Off-site copy of the backups (object storage) and a scheduled monthly drill on the live service.
