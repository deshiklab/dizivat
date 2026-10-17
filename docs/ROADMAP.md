# DiziVAT — roadmap after R8

Where the releases stand, and what the next ones are. Every slice ships the same way the R8 ones did:
shared pure rules (`src/lib/…`) used by the mock handlers **and** the NestJS modules through the compat
bundle, a migration, the page (English + Bangla), a knowledge-base article, the e2e / contract /
api_native checks, and this documentation — one slice per PR, one CI watch.

| Release | Theme | Status |
| --- | --- | --- |
| S1–S4, R1–R4 | sales, purchases, stock, production, money accounts, receipts & payments, TR-6, VDS 6.6, adjustments, Mushak 9.1, compliance centre | **landed** |
| R6, R6.2–R6.6 | NBR enlistment readiness, RMG (UDs, bond consumption, drawback), PRC proceeds, 9.3 / 9.4 applications, backups, bulk import | **landed** |
| R7, R7.1–R7.6 | tariff import, penalty calculator, compliance pack, e-filing JSON, onboarding imports, QR verification (R8.1), bank reconciliation (R8.2) | **landed** |
| **R8.3** | statutory reminders + report delivery (the schedule, the digests, the tick) | done |
| **R9.1** | treasury operations: own-account transfers (TX-), cheque register with lifecycle | done |
| **R9.2** | the general ledger: chart of accounts, derived posting rules, manual journal entries | done |
| R9 | the complete accounting module (R9.3 next: statements and the close) | in flight |
| R10 | POS integration | after R9 |

## R9 — the complete accounting module

What the books already have (R4–R8.3): bank / MFS / cash accounts, receipts and payments with invoice
allocation and advances, party statements with ageing, TR-6 treasury deposits across all ten heads, VDS
certificates, manual VAT adjustments, bank-statement import with line matching and reconciliation, and the
reminder / delivery schedule. What they still lack, in the order the slices fill it:

| Slice | Scope | Notes |
| --- | --- | --- |
| **R9.1 — treasury operations** ✅ | transfers between the company's own accounts, cash deposit / withdrawal, and the cheque register with its lifecycle (issued → presented → cleared / bounced, post-dated view) — **shipped v0.16.0** | the most basic gap: money cannot move between own accounts today. A cleared cheque is exactly what the R8.2 bank matcher already explains |
| **R9.2 — the general ledger** ✅ | chart of accounts (a seeded RMG template), posting rules that derive the GL from the documents that already exist (sales, purchases, notes, receipts, payments, transfers, TR-6, VDS, adjustments, openings), manual journal entries (JE-) for everything else, one account's ledger — **shipped v0.17.0** | the keystone. Derived-posting-first means the GL is complete from day one without anyone typing double entries for transactions |
| **R9.3 — statements and the close** | trial balance, profit & loss, balance sheet, cash flow; the period close that locks posting | reads the R9.2 ledger |
| **R9.4 — fixed assets** | asset register, classes, straight-line depreciation schedules at the NBR's rates, revaluation and disposal, capital-item input-credit tracking | feeds the ledger, the P&L and the 9.1 |
| **R9.5 — expenses and TDS** | expense vouchers (rent, professional fees, contractors) and income-tax deducted at source, with AIT challan deposit and the monthly e-TDS return data | the income-tax sibling of the VDS pattern the VAT side already has |
| **R9.6 — multi-currency** | FX revaluation and realised gain / loss on settlements | imports and exports already carry foreign currency; the money documents do not |
| **R9.7 — recurring entries and petty cash** | standing payments and receipts executed by the R8.3 schedule's tick, and the petty-cash float book | the tick already knows how to run a day's work idempotently |

## R10 — POS integration

Both flavours, in this order, because the second reuses the first:

| Slice | Scope | Notes |
| --- | --- | --- |
| **R10.1 — the counter POS** | a fast sale screen: scan or type the SKU, mixed tender (cash / card / bKash / Nagad — the account kinds already exist), VAT by the item's own rate, a Mushak 6.3 with the R8.1 QR, shift open / close with X / Z reports and the cash count variance | items already carry SKUs; QR verification and the e-filing JSON already exist — this slice is mostly the screen and a lean counter-sale document |
| **R10.2 — settlement reconciliation** | the card / MFS terminal settlement statements imported and matched against the POS invoices, commission and service charges parked as charge lines | the R8.2 bank-statement matcher pattern, applied to terminals |
| **R10.3 — the external POS API** | scoped API tokens, idempotent REST endpoints for third-party front-ends (post a sale, read stock and price), webhooks, an offline device queue with sequence numbers, and the register / device management page | makes DiziVAT the system of record whatever the counter runs on |
| **R10.4 — print and labels** | 80 mm thermal receipts (print CSS, like the statutory forms) and item barcode labels | keeps a slot for the NBR e-invoice adapter: the Finance Act 2026 lets an ERP issue the Mushak 6.3 itself |

## Beyond — the other candidates, in rough priority

1. **Procurement** — requisition → purchase order → goods receipt → three-way match → payable. The biggest
   daily-use gap for an RMG factory after the ledger.
2. **Stock take** — physical count sessions, variance postings, multi-location (branch stock exists).
3. **NBR notice management** — a register of audits and notices, response packs, deadlines that ride on the
   R8.3 reminders.
4. **Email / SMS delivery of the digests** — the schedule already freezes the figures; an SMTP leg with the
   PDF attached is a natural extension of R8.3.
5. **Payroll (light)** — salary runs, provident fund, payroll TDS (after R9.5).
6. **Multi-company / group consolidation** — a large architectural step: every table keys by company.
7. **BI** — VAT trend, receivables DSO, budget vs actual.
8. **Party portals** — statement downloads for customers and vendors (QR verification is already public).
