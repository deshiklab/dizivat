"""API contract tests — one ENDPOINTS table drives auth (401/403), shape (Page<T>), content-type (problem+json)
and error-code checks. `python3 contract.py --doc` also writes docs/API.md from the same table, so the
reference Symfony implements (R1+) can never drift from what the frontend is tested against.
Non-destructive: only reads, and writes that are rejected (401/403/404/409/422)."""
import os, random, sys, requests

BASE = os.environ.get("BASE_URL", "http://localhost:3000") + "/api/v1"
PW = "demo1234"
# Who lacks each permission (used for the 403 check)
LACKS = {"doc.create": "auditor", "doc.edit": "auditor", "doc.delete": "auditor", "doc.approve": "kamal", "doc.cancel": "kamal",
         "master.edit": "kamal", "users.manage": "arif", "settings.manage": "arif", "audit.view": "kamal", "export": None}
# Who has it (used for the success/shape checks)
HAS = {"users.manage": "admin", "settings.manage": "admin", "audit.view": "arif"}

E = lambda m, p, perm, desc, page=False, csv=False, public=False, ctype="application/json": dict(m=m, p=p, perm=perm, desc=desc, page=page, csv=csv, public=public, ctype=ctype)
ENDPOINTS = [
    E("POST", "/auth/login", None, "Sign in {username, password, remember} → Me + httpOnly cookie. 401 attempts left, 403 disabled, 429 locked", public=True),
    E("POST", "/auth/logout", None, "Sign out (clears cookie)", public=True),
    E("GET", "/me", None, "Current user, permissions, preferences, company summary"),
    E("PUT", "/me/preferences", None, "Save UI preferences (theme, density, text size, accent)"),
    E("GET", "/me/views?table=sales", None, "Saved list views for a table"),
    E("POST", "/me/views", None, "Save a list view {table, name, query}"),
    E("DELETE", "/me/views?table=sales&name=x", None, "Delete a saved view"),
    E("PUT", "/me/password", None, "Change own password {current, next, confirm}; other sessions revoked"),
    E("GET", "/dashboard", None, "KPIs, charts, deadlines, low stock for the current VAT period"),
    E("GET", "/search?q=bay", None, "Global search (invoices, parties, items)"),
    E("GET", "/notifications", None, "Notifications for the current user {items, unread}"),
    E("POST", "/notifications/read", None, "Mark read {ids} | {all: true}"),
    E("GET", "/sales", None, "Sales invoices — Page<Sale> with facets/totals", page=True, csv=True),
    E("POST", "/sales", "doc.create", "Create invoice (process=Approved also needs doc.approve; stock checked)"),
    E("GET", "/sales/{sale}", None, "One invoice with history"),
    E("PUT", "/sales/{sale}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/sales/{sale}", None, "Approve {process:Approved} (doc.approve) or cancel {process:Cancelled, reason≥10} (doc.cancel)"),
    E("DELETE", "/sales/{sale}", "doc.delete", "Delete a draft → trash (409 if not a draft)"),
    E("POST", "/sales/{sale}/restore", "doc.delete", "Restore from trash"),
    E("POST", "/sales/bulk", "doc.approve", "Bulk approve {ids, action:approve} → {done, skipped}"),
    E("GET", "/purchases", None, "Purchases — Page<Purchase>", page=True, csv=True),
    E("POST", "/purchases", "doc.create", "Create purchase"),
    E("GET", "/purchases/{purchase}", None, "One purchase with history"),
    E("PUT", "/purchases/{purchase}", "doc.edit", "Replace a draft"),
    E("PATCH", "/purchases/{purchase}", None, "Approve / cancel (reverses stock; 409 if consumed)"),
    E("DELETE", "/purchases/{purchase}", "doc.delete", "Delete a draft → trash"),
    E("POST", "/purchases/{purchase}/restore", "doc.delete", "Restore from trash"),
    E("POST", "/purchases/bulk", "doc.approve", "Bulk approve"),
    E("GET", "/items", None, "Items with stock — Page<ItemWithStock>", page=True, csv=True),
    E("POST", "/items", "master.edit", "Create item (SKU unique)"),
    E("GET", "/items/{item}", None, "One item with stock"),
    E("PUT", "/items/{item}", "master.edit", "Update item"),
    E("GET", "/items/{item}/ledger", None, "Stock ledger (opening, movements, balance); ?branch=b1 → one branch incl. transfers in/out"),
    E("GET", "/stock", None, "Stock by branch — Page<StockRow> (+ branches, branchValue); ?branch= holds stock there", page=True, csv=True),
    E("GET", "/transfers", None, "Stock transfers (Mushak 6.5) — Page<Transfer>; facets process/fromBranch/toBranch", page=True, csv=True),
    E("POST", "/transfers", "doc.create", "Create transfer {fromBranchId, toBranchId, date, vehicle?, note?, lines[{itemId, qty}], process} (422 sameBranch/unknownBranch; approve checks source stock)"),
    E("GET", "/transfers/{transfer}", None, "One transfer with history"),
    E("PUT", "/transfers/{transfer}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/transfers/{transfer}", None, "Approve (doc.approve; moves stock) or cancel {reason≥10} (doc.cancel; 409 if goods already used at destination)"),
    E("DELETE", "/transfers/{transfer}", "doc.delete", "Delete a draft (409 if not a draft)"),
    E("GET", "/damage", None, "Damage & wastage — Page<Damage>; facets process/branch/reason", page=True, csv=True),
    E("POST", "/damage", "doc.create", "Create damage entry {branchId, date, reason, note (≥10 when lost), lines, process}"),
    E("GET", "/damage/{damage}", None, "One damage entry with history"),
    E("PUT", "/damage/{damage}", "doc.edit", "Replace a draft"),
    E("PATCH", "/damage/{damage}", None, "Approve (writes stock off) / cancel (restores it)"),
    E("DELETE", "/damage/{damage}", "doc.delete", "Delete a draft"),
    E("GET", "/units", None, "Units of measure — Page<UnitRow> (inUse = items using it); ?active=1", page=True),
    E("POST", "/units", "master.edit", "Create unit {code, name, decimals 0–3, active} (422 duplicate)"),
    E("GET", "/units/un1", None, "One unit"),
    E("PUT", "/units/un1", "master.edit", "Update unit (422 unitInUse when re-coding a unit items use)"),
    E("DELETE", "/units/un7", "master.edit", "Delete unit (409 when items use it — deactivate instead)"),
    E("GET", "/customers?view=table", None, "Customers — Page<PartyRow>", page=True, csv=True),
    E("POST", "/customers", "master.edit", "Create customer (422 duplicate/customerMode)"),
    E("GET", "/customers/c1", None, "One customer with aggregates"),
    E("PUT", "/customers/c1", "master.edit", "Update customer (422 modeLocked when it has documents)"),
    E("DELETE", "/customers/c1", "master.edit", "Delete → trash (409 in-use:N when it has documents)"),
    E("POST", "/customers/c1/restore", "master.edit", "Restore from trash"),
    E("GET", "/vendors?view=table", None, "Vendors — Page<PartyRow>", page=True, csv=True),
    E("POST", "/vendors", "master.edit", "Create vendor"),
    E("GET", "/vendors/v1", None, "One vendor"),
    E("PUT", "/vendors/v1", "master.edit", "Update vendor"),
    E("DELETE", "/vendors/v1", "master.edit", "Delete → trash (409 when in use)"),
    E("POST", "/vendors/v1/restore", "master.edit", "Restore from trash"),
    E("GET", "/users", "users.manage", "Users — Page<User>, facets role/status", page=True, csv=True),
    E("POST", "/users", "users.manage", "Invite {username,…,role} → {user, tempPassword} (shown once)"),
    E("GET", "/users/u3", "users.manage", "One user"),
    E("PUT", "/users/u3", "users.manage", "Update profile/role/active (422 self, lastAdmin; deactivation revokes sessions)"),
    E("POST", "/users/u3/reset-password", "users.manage", "New one-time password; forces change; revokes sessions"),
    E("GET", "/company", None, "Company profile"),
    E("PUT", "/company", "settings.manage", "Update company profile (BIN/TIN/NID validated)"),
    E("GET", "/tariff?view=table", None, "NBR tariff — Page<TariffLine>; ?hs=12345678 → one line or 404", page=True, csv=True),
    # R2 — purchase & inventory
    E("GET", "/purchases?category=service", None, "Service purchases (R2) — same Page<Purchase>; category=goods (default) | service | all", page=True, csv=True),
    E("GET", "/services", None, "NBR service codes for service purchases [{id, code, name, vatRate, vds, unit}]"),
    E("GET", "/purchases/{purchase}/returnable", None, "Lines still returnable on an approved purchase [{itemId, purchasedQty, returnedQty, remaining, …}]; ?exclude=<debitNoteId>"),
    E("GET", "/debit-notes", None, "Debit notes (Mushak 6.8) — Page<DebitNote>; facets process/reason/vendor/branch; ?purchase=<id>", page=True, csv=True),
    E("POST", "/debit-notes", "doc.create", "Create {purchaseId, issueDate, issueTime, reason, note?, issuedBy, designation, lines[{itemId, qty}], process} (422 notApproved/exceedsRemaining; approve returns stock)"),
    E("GET", "/debit-notes/{debit}", None, "One debit note with history"),
    E("PUT", "/debit-notes/{debit}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/debit-notes/{debit}", None, "Approve (doc.approve; stock out, credit reversed) / cancel {reason≥10} (doc.cancel; stock back)"),
    E("DELETE", "/debit-notes/{debit}", "doc.delete", "Delete a draft (409 if not a draft)"),
    E("GET", "/opening-stock", None, "Opening stock entries — Page<OpeningEntry>; facets process/branch/inputTax", page=True, csv=True),
    E("POST", "/opening-stock", "doc.create", "Create {itemId, branchId, date, inputTax, qty, price, vatPaid?, note?, process} (approve adds to item opening + branch stock)"),
    E("GET", "/opening-stock/{opening}", None, "One opening entry with history"),
    E("PUT", "/opening-stock/{opening}", "doc.edit", "Replace a draft"),
    E("PATCH", "/opening-stock/{opening}", None, "Approve / cancel (reverts the opening)"),
    E("DELETE", "/opening-stock/{opening}", "doc.delete", "Delete a draft"),
    E("GET", "/master-items", None, "Master items with tariff comparison — Page<MasterItemRow> (rates, tariff, overrides[], items); facets group/status/override", page=True, csv=True),
    E("POST", "/master-items", "master.edit", "Create {hsCode, name, group, category, unit, priceMethod, description?, rates{vat,sd,cd,rd,ait,at}, overrideReason (required when rates ≠ tariff), active}"),
    E("GET", "/master-items/m1", None, "One master item with linked SKUs"),
    E("PUT", "/master-items/m1", "master.edit", "Update (renames flow to linked SKUs; 422 overrideReason)"),
    E("GET", "/mushak/6.1?item=i6&from=2026-07-01&to=2026-09-25", None, "Mushak 6.1 purchase book for an input item {company, item, rows, totals, opening, closing}; from/to default to the fiscal year to date; format=csv", csv=True),
    E("GET", "/mushak/6.2?item=i17&from=2026-07-01&to=2026-09-25", None, "Mushak 6.2 sales book for a finished-goods item; 6.10 below; 9.1 lives at /vat/returns", csv=True),
    # R3 — sales & production
    E("GET", "/sales?category=service", None, "Service sales (R3) — same Page<Sale>; category=goods (default, incl. exports) | service | all; facet trade=local|export|deemed", page=True, csv=True),
    E("GET", "/sale-services", None, "Service codes for service sales [{id, code, name, vatRate, vds, unit}]"),
    E("GET", "/sales/{sale}/creditable", None, "Lines still returnable on an approved sale {sale, lines[{itemId, soldQty, returnedQty, remaining, …}]}; ?exclude=<creditNoteId>"),
    E("GET", "/credit-notes", None, "Credit notes (Mushak 6.7) — Page<CreditNote>; facets process/reason/customer/branch; ?sale=<id>", page=True, csv=True),
    E("POST", "/credit-notes", "doc.create", "Create {saleId, issueDate, issueTime, reason, note?, issuedBy, designation, lines[{itemId, qty}], process} (422 notApproved/exceedsRemaining; approve restores stock, reduces output VAT)"),
    E("GET", "/credit-notes/{credit}", None, "One credit note with history"),
    E("PUT", "/credit-notes/{credit}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/credit-notes/{credit}", None, "Approve (doc.approve) / cancel {reason≥10} (doc.cancel; 409 if the returned goods were used)"),
    E("DELETE", "/credit-notes/{credit}", "doc.delete", "Delete a draft (409 if not a draft)"),
    E("GET", "/production/boms", None, "Price declarations (Mushak 4.3), one row per version — Page<Bom>; facets process/item", page=True, csv=True),
    E("POST", "/production/boms", "master.edit", "Create {itemId, effectiveDate, licenseDate?, inputs[{itemId, qty, wastagePct, price}], costs[{head, amount}], amendmentReason (v2+), note?, process}; 409 when the item already has a draft"),
    E("GET", "/production/boms/{bom}", None, "One declaration with all versions of the item"),
    E("PUT", "/production/boms/{bom}", "master.edit", "Replace a draft (409 if not a draft — amend instead)"),
    E("PATCH", "/production/boms/{bom}", None, "Approve (doc.approve; supersedes the previous version) / cancel a draft (doc.cancel)"),
    E("DELETE", "/production/boms/{bom}", "master.edit", "Delete a draft"),
    E("GET", "/production/work-orders", None, "Work orders — Page<WorkOrder>; facets process/status; ?item=<id>", page=True, csv=True),
    E("POST", "/production/work-orders", "doc.create", "Create {requisitionNo?, issueDate, dueDate?, remark?, lines[{itemId, qty}], process} (items need an approved BOM)"),
    E("GET", "/production/work-orders/{wo}", None, "One work order with progress and its batches"),
    E("PUT", "/production/work-orders/{wo}", "doc.edit", "Replace a draft"),
    E("PATCH", "/production/work-orders/{wo}", None, "Approve / cancel (409 while live batches exist)"),
    E("DELETE", "/production/work-orders/{wo}", "doc.delete", "Delete a draft"),
    E("GET", "/production/batches", None, "Production batches — Page<Batch>; facets mode (inHouse|contractual|opening)/process; ?workOrder=<id>", page=True, csv=True),
    E("POST", "/production/batches", "doc.create", "Create {mode, issueDate, receiveDate?, vendorId?, remark?, issuedBy, designation, lines[{itemId, workOrderId?, issueQty, receiveQty, damageQty, unitCost?}], consumption?, process} (approve consumes inputs at the BOM, adds finished goods)"),
    E("GET", "/production/batches/{batch}", None, "One batch with consumption and history"),
    E("PUT", "/production/batches/{batch}", "doc.edit", "Replace a draft"),
    E("PATCH", "/production/batches/{batch}", None, "Approve (input stock checked) / cancel (409 if its goods were sold)"),
    E("DELETE", "/production/batches/{batch}", "doc.delete", "Delete a draft"),
    E("POST", "/production/batches/{batch}/receive", "doc.edit", "Contractual batch: goods back from the contractor {receiveDate, lines[{receiveQty, damageQty}]} (409 if not contractual/approved or already received)"),
    E("GET", "/production/config", None, "Production procedure (directStock|workOrder) and consumption method (standard|actual)"),
    E("PUT", "/production/config", "settings.manage", "Update the production config"),
    E("GET", "/production/lots?item=i18", None, "Finished-goods lots with stock left [{batchId, batchNo, date, itemId, received, sold, available}]; ?all=1, ?exclude=<saleId>"),
    # R4 — accounting
    E("GET", "/accounting/accounts", None, "Bank, mobile-wallet and cash accounts with running balances — Page<MoneyAccountRow>; facets kind/active", page=True, csv=True),
    E("POST", "/accounting/accounts", "master.edit", "Create {kind: bank|mobile|cash, provider, accountNo, branch?, owner, bankType|walletType, authorised? (mobile), serviceCharge 0–10, openingBalance, openingDate, active} (422 duplicate accountNo)"),
    E("GET", "/accounting/accounts/{account}", None, "One account with its movements"),
    E("PUT", "/accounting/accounts/{account}", "master.edit", "Update an account"),
    E("DELETE", "/accounting/accounts/{account}", "master.edit", "Delete an unused account (409 once it has movements)"),
    E("GET", "/accounting/open-invoices?kind=receipt&party=c1", None, "Approved invoices with an amount due for a customer (receipt) or supplier (payment) [{id, no, date, total, paid, due}]"),
    E("GET", "/accounting/receipts", None, "Customer receipts (money receipts) — Page<MoneyDoc>; facets process/method/party/account; ?invoice=<saleId>", page=True, csv=True),
    E("POST", "/accounting/receipts", "doc.create", "Create {partyId, date, method: cash|bankTransfer|cheque|mobile, accountId, chequeNo/chequeDate/chequeBank (cheque), reference (bank transfer, mobile), amount, charge, allocations[{docId, amount}], note?, process} (422 dateClosed/exceedsDue/method)"),
    E("GET", "/accounting/receipts/{receipt}", None, "One receipt with allocations and history"),
    E("PUT", "/accounting/receipts/{receipt}", "doc.edit", "Replace a draft (409 if not a draft)"),
    E("PATCH", "/accounting/receipts/{receipt}", None, "Approve (doc.approve; settles the invoices) / cancel {reason≥10} (doc.cancel; reopens them). 409 when the books are closed"),
    E("DELETE", "/accounting/receipts/{receipt}", "doc.delete", "Delete a draft"),
    E("GET", "/accounting/payments", None, "Supplier payments (vouchers) — same shape as receipts; ?invoice=<purchaseId>", page=True, csv=True),
    E("POST", "/accounting/payments", "doc.create", "Create a payment — same body as a receipt, allocated to purchases"),
    E("GET", "/accounting/payments/{payment}", None, "One payment with allocations and history"),
    E("PUT", "/accounting/payments/{payment}", "doc.edit", "Replace a draft"),
    E("PATCH", "/accounting/payments/{payment}", None, "Approve / cancel {reason≥10}"),
    E("DELETE", "/accounting/payments/{payment}", "doc.delete", "Delete a draft"),
    E("GET", "/accounting/statement?kind=customer&party=c1&from=2025-07-01&to=2026-09-25", None, "Party ledger {party, opening, rows[{date, type, ref, debit, credit, balance}], closing, ageing, open invoices, reconciled}; kind=customer|vendor; format=csv", csv=True),
    E("GET", "/accounting/config", None, "Accounting config (books closed up to, default accounts, receipt/voucher numbering)"),
    E("PUT", "/accounting/config", "settings.manage", "Update the accounting config"),
    # R4 — NBR VAT
    E("GET", "/vat/periods", None, "Tax periods, newest first, one entry each (D-15) [{period, status, due, locked}]"),
    E("GET", "/vat/compliance?period=2026-08", None, "Compliance centre for a period {return summary, shortfall, deposits, VDS to issue/awaited, drafts}"),
    E("GET", "/vat/returns", None, "Mushak 9.1 returns — Page<VatReturnRow> + periods; facets status/type", page=True, csv=True),
    E("POST", "/vat/returns", "doc.create", "Start a return {period} (409 if it exists or the previous period is not submitted)"),
    E("GET", "/vat/returns/{period}", None, "The return for a period: every note (1–68) computed live from approved documents, manual notes, shortfall, lock state; 404 for unknown periods"),
    E("PUT", "/vat/returns/{period}", "doc.edit", "Save manual notes of a draft {submissionDate, activities, manual{…}} (409 once submitted)"),
    E("PATCH", "/vat/returns/{period}", "doc.approve", "Submit {action: submit} — 409 until the period has ended, the previous return is submitted and note 58 covers note 50; locks the period"),
    E("DELETE", "/vat/returns/{period}", "doc.delete", "Discard a draft return (409 once submitted)"),
    E("GET", "/vat/returns/{period}/notes/4", None, "Sub-form: the source documents behind a note {note, rows, totals}; format=csv (legacy HTTP 500, D-04)", csv=True),
    E("GET", "/vat/treasury", None, "Treasury deposits (TR-6) — Page<TreasuryDeposit>; facets process/head/taxPeriod/mode", page=True, csv=True),
    E("POST", "/vat/treasury", "doc.create", "Create {head, taxPeriod, challanNo, challanDate, mode, bank, bankBranch, district, accountId?, amount, depositor, designation, address, description, process}; economic code from head + zone (422 periodLocked)"),
    E("GET", "/vat/treasury/{treasury}", None, "One deposit with history"),
    E("PUT", "/vat/treasury/{treasury}", "doc.edit", "Replace a draft"),
    E("PATCH", "/vat/treasury/{treasury}", None, "Approve / cancel {reason≥10} (409 in a locked period)"),
    E("DELETE", "/vat/treasury/{treasury}", "doc.delete", "Delete a draft"),
    E("GET", "/vat/vds", None, "VDS entries and Mushak 6.6 certificates — Page<VdsEntry>; facets mode (purchase|sales)/process/taxPeriod", page=True, csv=True),
    E("GET", "/vat/vds/eligible?mode=purchase", None, "Invoices VDS can still be recorded against [{docId, no, party, vat, withheld, remaining}]; ?exclude=<vdsId>"),
    E("POST", "/vat/vds", "doc.create", "Create {mode, docId, amount ≤ remaining VAT, certificateNo (sales), certificateDate, treasuryId?, remark?, process}"),
    E("GET", "/vat/vds/{vds}", None, "One VDS entry with history"),
    E("PUT", "/vat/vds/{vds}", "doc.edit", "Replace a draft"),
    E("PATCH", "/vat/vds/{vds}", None, "Approve / cancel {reason≥10}"),
    E("DELETE", "/vat/vds/{vds}", "doc.delete", "Delete a draft"),
    E("GET", "/vat/adjustments", None, "VAT adjustments (9.1 notes 27, 32, 38, 39) — Page<VatAdjustment>; facets process/kind/taxPeriod", page=True, csv=True),
    E("POST", "/vat/adjustments", "doc.create", "Create {kind, issueDate, taxPeriod, amount, description ≥ 10, reference?, process} (422 periodLocked)"),
    E("GET", "/vat/adjustments/{adjustment}", None, "One adjustment with history"),
    E("PUT", "/vat/adjustments/{adjustment}", "doc.edit", "Replace a draft"),
    E("PATCH", "/vat/adjustments/{adjustment}", None, "Approve / cancel {reason≥10}"),
    E("DELETE", "/vat/adjustments/{adjustment}", "doc.delete", "Delete a draft"),
    E("GET", "/vat/settings", None, "NBR settings: commissionerate/zone code, return notes, input/output tax setup"),
    E("PUT", "/vat/settings", "settings.manage", "Update the NBR settings (explicit edit mode in the UI)"),
    E("GET", "/mushak/6.10?from=2026-08-01&to=2026-08-31", None, "Mushak 6.10 — purchases and sales above Tk 2,00,000 {company, from, to, purchases, sales, totals} (legacy \"totalPurchase\" error, D-05)", csv=True),
    E("GET", "/audit", "audit.view", "Audit trail — Page<AuditEvent>; filters q/from/to/entity/action/actor/entityId", page=True, csv=True),
    E("GET", "/audit/verify", "audit.view", "R6: verify the tamper-evident SHA-256 audit chain {ok, algorithm, count, head, checkedAt, broken?}"),
    E("GET", "/vat/exports?from=2025-07-01&to=2026-09-25", None, "R6 (RMG): export & deemed-export register {from, to, rows (LC/UD/EXP/FC + NBR conditions met / missing), totals}; ?kind=direct|deemed, ?risk=1", csv=True),
    # R6.2 — RMG depth + enlistment gaps
    E("GET", "/vat/exports?proceeds=overdue", None, "R6.2: proceeds filter realised|partial|outstanding|overdue; rows also carry realisedFc, outstandingFc, proceedsDue (shipment + 120 days), proceeds; totals.unrealised / totals.overdue {count, value}", csv=True),
    E("GET", "/vat/uds?customer=c10", None, "R6.2 (RMG): UD / UP register {rows (lines with used / remaining / pct / uses, usedPct, state, invoices, daysLeft), bonds (bond-licence watch-list), totals}", csv=True),
    E("POST", "/vat/uds", "doc.create", "Add a UD / UP {kind, no, date, customerId (exporter), masterLcNo, buyer?, expiry, lines [{itemId, qty}], status?, note?} — 422 duplicate no / notExporter / expiryBeforeDate"),
    E("GET", "/vat/uds/{ud}", None, "One UD with usage"),
    E("PUT", "/vat/uds/{ud}", "doc.edit", "Update a UD; once invoices use it, number and exporter are locked (422)"),
    E("DELETE", "/vat/uds/{ud}", "doc.delete", "Delete a UD while unused (409 udInUse)"),
    E("POST", "/vat/uds/fit", None, "Does a deemed-export invoice fit its UD? {customerId, issueDate, udNo, lines, saleId?} → {ok, udId, problems (notListed / exceeds / expired / closed), lines}, or null when the UD is not in the register"),
    E("POST", "/sales/{sale}/realisations", "doc.edit", "Record export proceeds (PRC) {date, bank, prcNo, fcAmount, rate, note?} on an approved FC export — 409 notRealisable; 422 over outstanding + 0.5 %, future date, duplicate PRC"),
    E("DELETE", "/sales/{sale}/realisations?rid=x", "doc.approve", "Remove a PRC entered in error (audited)"),
    E("GET", "/production/subcontract?from=2026-07-01&to=2026-09-25", None, "R6.2: subcontracting (Mushak 6.4) register {rows (process, issued / received / damaged / pending, days out, status), totals}; ?status, ?days=30 — 422 when to < from", csv=True),
    E("GET", "/mushak/6.2.1?item=i6&from=2026-07-01&to=2026-09-25", None, "R6.2: Mushak 6.2.1 purchase-sales book of a traded item (purchases and sales side by side)", csv=True),
    E("POST", "/import", "master.edit", "R6.2 bulk import {entity: items|customers|vendors, dryRun, rows (≤ 2,000, canonical field names)} → {total, valid, created, duplicates, issues [{row, field, message}]}; all-or-nothing; 201 when records were created"),
    E("GET", "/backups", "settings.manage", "R6.2: backup status {timezone, schedule [02:00, 14:00], retention 30, storage, today, next, last, rows}"),
    E("POST", "/backups", "settings.manage", "Take a backup now (201)"),
    E("GET", "/backups/{backup}", "settings.manage", "Download a backup (application/gzip, `X-Backup-SHA256`); audited", ctype="application/gzip"),
    E("POST", "/backups/{backup}/verify", "settings.manage", "Re-hash a stored backup {id, ok, sha256, size, checkedAt}"),
]

# Free-text notes written under the endpoint table by --doc
NOTES = [
    "**R6.2 — VAT officer:** `POST/PUT /users` accept `role: \"vatOfficer\"` with `accessUntil` (YYYY-MM-DD, today … +90 days;",
    "422 required / accessPast / accessTooLong). After that date `POST /auth/login` answers `403 expired` and existing",
    "sessions get 401. Every officer request is logged in the audit trail (entity `access`, action `viewed`).",
]

sessions = {}
def S(user):
    if user is None: return requests.Session()
    if user not in sessions:
        s = requests.Session(); r = s.post(BASE + "/auth/login", json={"username": user, "password": PW})
        assert r.ok, f"login {user}: {r.status_code}"; sessions[user] = s
    return sessions[user]

fails, passes = [], 0
def check(cond, msg):
    global passes
    if cond: passes += 1
    else: fails.append(msg); print("FAIL", msg)
def is_problem(r): return r.headers.get("content-type", "").startswith("application/problem+json") and "title" in r.json()

def fixtures():
    s = S("arif")
    sale = s.get(BASE + "/sales?process=Approved&size=1").json()["data"][0]["id"]
    purchase = s.get(BASE + "/purchases?process=Approved&size=1").json()["data"][0]["id"]
    transfer = s.get(BASE + "/transfers?process=Approved&size=1").json()["data"][0]["id"]
    damage = s.get(BASE + "/damage?process=Approved&size=1").json()["data"][0]["id"]
    debit = s.get(BASE + "/debit-notes?process=Approved&size=1").json()["data"][0]["id"]
    opening = s.get(BASE + "/opening-stock?process=Approved&size=1").json()["data"][0]["id"]
    draft = s.get(BASE + "/purchases?category=all&process=Created&size=1").json()["data"][0]["id"]
    line = s.get(BASE + f"/purchases/{purchase}").json()["lines"][0]["itemId"]
    goods_sale = s.get(BASE + "/sales?process=Approved&trade=local&size=1").json()["data"][0]
    credit = s.get(BASE + "/credit-notes?process=Approved&size=1").json()["data"][0]["id"]
    bom = s.get(BASE + "/production/boms?process=Approved&size=1").json()["data"][0]["id"]
    wo = s.get(BASE + "/production/work-orders?process=Approved&size=1").json()["data"][0]["id"]
    batch = s.get(BASE + "/production/batches?process=Approved&mode=inHouse&size=1").json()["data"][0]["id"]
    first = lambda path: s.get(BASE + path).json()["data"][0]["id"]
    r4 = {"receipt": first("/accounting/receipts?process=Approved&size=1"), "payment": first("/accounting/payments?process=Approved&size=1"),
          "treasury": first("/vat/treasury?process=Approved&size=1"), "vds": first("/vat/vds?process=Approved&size=1"),
          "adjustment": first("/vat/adjustments?process=Approved&size=1"), "account": "ac1", "period": "2026-08"}
    return {**r4, "goodsSale": goods_sale["id"], "saleLine": goods_sale["lines"][0]["itemId"], "credit": credit, "bom": bom, "wo": wo, "batch": batch,"sale": sale, "purchase": purchase, "item": "i1", "transfer": transfer, "damage": damage, "debit": debit, "opening": opening, "draftPurchase": draft, "purchaseLine": line}

def run():
    fx = fixtures()
    # R6.2 fixtures: a UD and a stored backup (one is taken if none exists yet — harmless)
    fx["ud"] = S("arif").get(BASE + "/vat/uds").json()["rows"][0]["id"]
    adm = S("admin"); rows = adm.get(BASE + "/backups").json().get("rows") or []
    fx["backup"] = rows[0]["id"] if rows else adm.post(BASE + "/backups", json={}).json()["id"]
    for e in ENDPOINTS:
        path = e["p"].format(**fx); url = BASE + path; m = e["m"]
        # 401 for anonymous
        if not e["public"]:
            r = requests.request(m, url, json={})
            check(r.status_code == 401 and is_problem(r), f"{m} {path} anonymous → {r.status_code} (want 401 problem+json)")
        # 403 for a role without the permission
        if e["perm"] and LACKS.get(e["perm"]):
            r = S(LACKS[e["perm"]]).request(m, url, json={})
            check(r.status_code == 403 and is_problem(r) and e["perm"] in r.json()["title"], f"{m} {path} as {LACKS[e['perm']]} → {r.status_code} (want 403 naming {e['perm']})")
        # shape for readable endpoints
        if m == "GET":
            r = S(HAS.get(e["perm"], "arif")).get(url)
            check(r.status_code == 200 and r.headers["content-type"].startswith(e["ctype"]), f"GET {path} → {r.status_code} {r.headers.get('content-type')}")
            if e["page"] and r.ok:
                d = r.json()
                check(all(k in d for k in ("data", "total", "page", "size", "facets")) and isinstance(d["data"], list), f"GET {path} is not a Page")
            if e["csv"]:
                sep = "&" if "?" in path else "?"
                r = S(HAS.get(e["perm"], "arif")).get(url + sep + "format=csv")
                check(r.ok and r.headers["content-type"].startswith("text/csv"), f"GET {path} CSV → {r.status_code} {r.headers.get('content-type')}")

    # Specific error contracts: (user, method, path, body, status, error-key or None)
    rnd = f"nobody{random.randint(1000, 9999)}"
    pbody = {"issueDate": "2026-09-20", "challanNo": "CT-1", "challanDate": "2026-09-20", "method": "Bank", "discount": 0, "paid": 0, "issuedBy": "Contract", "designation": "Tester", "process": "Created"}
    imp_line = {"itemId": "i6", "qty": 10, "usd": 100, "usdRate": 122, "cdRate": 10, "rdRate": 0, "sdRate": 0, "vatRate": 15, "aitRate": 5, "atRate": 5}
    dnbody = {"purchaseId": fx["purchase"], "issueDate": "2026-09-24", "issueTime": "10:00", "reason": "damaged", "issuedBy": "Contract", "designation": "Tester", "process": "Created", "lines": [{"itemId": fx["purchaseLine"], "qty": 1}]}
    sbody = {"issueDate": "2026-09-24", "issueTime": "10:00", "method": "Bank", "discount": 0, "paid": 0, "vds": False, "issuedBy": "Contract", "designation": "Tester", "process": "Created"}
    cnbody = {"saleId": fx["goodsSale"], "issueDate": "2026-09-25", "issueTime": "10:00", "reason": "quality", "issuedBy": "Contract", "designation": "Tester", "process": "Created", "lines": [{"itemId": fx["saleLine"], "qty": 1}]}
    cases = [
        (None, "POST", "/auth/login", {}, 422, "username"),
        (None, "POST", "/auth/login", {"username": rnd, "password": "x"}, 401, "_"),
        ("arif", "GET", "/sales/nope", None, 404, None),
        ("arif", "GET", "/purchases/nope", None, 404, None),
        ("arif", "GET", "/items/nope", None, 404, None),
        ("arif", "POST", "/sales", {}, 422, "customerId"),
        ("arif", "POST", "/purchases", {}, 422, "vendorId"),
        ("arif", "PUT", f"/sales/{fx['sale']}", {}, 409, None),
        ("arif", "DELETE", f"/sales/{fx['sale']}", None, 409, None),
        ("arif", "PATCH", f"/sales/{fx['sale']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "POST", "/items", {}, 422, "name"),
        ("arif", "POST", "/customers", {}, 422, "name"),
        ("arif", "DELETE", "/customers/c1", None, 409, None),
        ("arif", "GET", "/tariff?hs=99999999", None, 404, None),
        ("arif", "POST", "/notifications/read", {}, 422, None),
        ("arif", "PUT", "/me/password", {"current": "wrong-one", "next": "abcd12345", "confirm": "abcd12345"}, 422, "current"),
        ("arif", "PUT", "/me/password", {"current": PW, "next": "short", "confirm": "short"}, 422, "next"),
        ("admin", "GET", "/users/nope", None, 404, None),
        ("admin", "POST", "/users", {}, 422, "username"),
        ("admin", "POST", "/users", {"username": "arif", "name": "Dup User", "designation": "Tester", "email": "x@y.co", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "username"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@rupsha-flexipack.example", "mobile": "", "department": "", "role": "viewer", "active": True}, 422, "role"),
        ("admin", "PUT", "/users/u5", {"name": "System Administrator", "designation": "IT", "email": "it@rupsha-flexipack.example", "mobile": "", "department": "", "role": "admin", "active": False}, 422, "active"),
        ("admin", "POST", "/users/u5/reset-password", None, 422, None),
        ("admin", "PUT", "/company", {}, 422, "name"),
        # Sprint 4 — branches, stock documents, units
        ("arif", "POST", "/sales", {"branchId": "b2"}, 422, None),
        ("arif", "GET", "/transfers/nope", None, 404, None),
        ("arif", "GET", "/damage/nope", None, 404, None),
        ("arif", "GET", "/units/nope", None, 404, None),
        ("arif", "POST", "/transfers", {}, 422, "fromBranchId"),
        ("arif", "POST", "/transfers", {"fromBranchId": "b1", "toBranchId": "b1", "date": "2026-09-20", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "toBranchId"),
        ("arif", "POST", "/transfers", {"fromBranchId": "b1", "toBranchId": "b2", "date": "2026-09-20", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "toBranchId"),
        ("arif", "PUT", f"/transfers/{fx['transfer']}", {}, 409, None),
        ("arif", "DELETE", f"/transfers/{fx['transfer']}", None, 409, None),
        ("arif", "PATCH", f"/transfers/{fx['transfer']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "POST", "/damage", {}, 422, "branchId"),
        ("arif", "POST", "/damage", {"branchId": "b1", "date": "2026-09-20", "reason": "lost", "note": "gone", "lines": [{"itemId": "i1", "qty": 1}], "process": "Created"}, 422, "note"),
        ("arif", "DELETE", f"/damage/{fx['damage']}", None, 409, None),
        ("arif", "POST", "/units", {}, 422, "code"),
        ("arif", "POST", "/units", {"code": "Kg", "name": "Kilogram again", "decimals": 2, "active": True}, 422, "code"),
        ("arif", "PUT", "/units/un1", {"code": "KGX", "name": "Kilogram", "decimals": 3, "active": True}, 422, "code"),
        ("arif", "DELETE", "/units/un1", None, 409, None),
        # R2 — imports, services, debit notes, opening stock, master items, Mushak books
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v1", "category": "service", "lines": [{"itemId": "sv1", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 10}]}, 422, "vendorId"),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v7", "category": "service", "lines": [{"itemId": "i1", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 15}]}, 422, None),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v2", "lines": [imp_line]}, 422, "boe"),
        ("arif", "POST", "/purchases", {**pbody, "vendorId": "v2", "lines": [imp_line], "boe": {"lcNo": "LC-1", "lcDate": "2026-09-21", "customsHouse": "301", "origin": "China"}}, 422, "boe.lcDate"),
        ("arif", "GET", "/purchases/nope/returnable", None, 404, None),
        ("arif", "GET", "/debit-notes/nope", None, 404, None),
        ("arif", "POST", "/debit-notes", {}, 422, "purchaseId"),
        ("arif", "POST", "/debit-notes", {**dnbody, "purchaseId": fx["draftPurchase"]}, 422, "purchaseId"),
        ("arif", "POST", "/debit-notes", {**dnbody, "lines": [{"itemId": fx["purchaseLine"], "qty": 99999999}]}, 422, "lines.0.qty"),
        ("arif", "PUT", f"/debit-notes/{fx['debit']}", {}, 409, None),
        ("arif", "DELETE", f"/debit-notes/{fx['debit']}", None, 409, None),
        ("arif", "PATCH", f"/debit-notes/{fx['debit']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "GET", "/opening-stock/nope", None, 404, None),
        ("arif", "POST", "/opening-stock", {}, 422, "itemId"),
        ("arif", "DELETE", f"/opening-stock/{fx['opening']}", None, 409, None),
        ("arif", "GET", "/master-items/nope", None, 404, None),
        ("arif", "POST", "/master-items", {}, 422, "hsCode"),
        ("arif", "POST", "/master-items", {"hsCode": "76071110", "name": "Contract override", "group": "Raw Material", "category": "general", "unit": "Kg", "priceMethod": "average", "rates": {"vat": 10, "sd": 0, "cd": 5, "rd": 0, "ait": 5, "at": 5}, "active": True}, 422, "overrideReason"),
        ("arif", "GET", "/mushak/6.1?item=i17&from=2026-07-01&to=2026-09-25", None, 422, "item"),
        ("arif", "GET", "/mushak/6.2?item=i6&from=2026-07-01&to=2026-09-25", None, 422, "item"),
        ("arif", "GET", "/mushak/6.1?item=i6&from=2026-09-10&to=2026-09-01", None, 422, "to"),
        ("arif", "GET", "/mushak/6.1?item=i6&from=bad&to=2026-09-25", None, 422, "from"),
        ("arif", "GET", "/mushak/9.1?item=i6&from=2026-07-01&to=2026-09-25", None, 404, None),
        # R3 — sales & production
        ("arif", "POST", "/sales", {**sbody, "customerId": "c8", "lines": [{"itemId": "i17", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 0}]}, 422, "export"),
        ("arif", "POST", "/sales", {**sbody, "customerId": "c8", "category": "service", "lines": [{"itemId": "ss1", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 15}]}, 422, "customerId"),
        ("arif", "POST", "/sales", {**sbody, "customerId": "c1", "lines": [{"itemId": "i17", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 0}], "export": {"deemed": False, "lcNo": "L", "lcDate": "2026-09-01", "customsHouse": "301", "country": "UAE", "billNo": "B", "billDate": "2026-09-24", "shippingAddress": "x"}}, 422, "export.deemed"),
        ("arif", "POST", "/sales", {**sbody, "customerId": "c1", "lines": [{"itemId": "i17", "qty": 1, "price": 100, "sdRate": 0, "vatRate": 0}], "export": {"deemed": True, "lcNo": "L"}}, 422, "export.lcDate"),
        ("arif", "GET", "/sales/nope/creditable", None, 404, None),
        ("arif", "GET", "/credit-notes/nope", None, 404, None),
        ("arif", "POST", "/credit-notes", {}, 422, "saleId"),
        ("arif", "POST", "/credit-notes", {**cnbody, "lines": [{"itemId": fx["saleLine"], "qty": 99999999}]}, 422, "lines.0.qty"),
        ("arif", "PUT", f"/credit-notes/{fx['credit']}", {}, 409, None),
        ("arif", "DELETE", f"/credit-notes/{fx['credit']}", None, 409, None),
        ("arif", "PATCH", f"/credit-notes/{fx['credit']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "GET", "/production/boms/nope", None, 404, None),
        ("arif", "POST", "/production/boms", {}, 422, "itemId"),
        ("arif", "POST", "/production/boms", {"itemId": "i20", "effectiveDate": "2026-10-01", "inputs": [{"itemId": "i1", "qty": 1, "wastagePct": 0, "price": 1}], "costs": [], "amendmentReason": "Contract test amendment", "process": "Created"}, 409, None),
        ("arif", "PUT", f"/production/boms/{fx['bom']}", {}, 409, None),
        ("arif", "DELETE", f"/production/boms/{fx['bom']}", None, 409, None),
        ("arif", "GET", "/production/work-orders/nope", None, 404, None),
        ("arif", "POST", "/production/work-orders", {}, 422, "lines"),
        ("arif", "PUT", f"/production/work-orders/{fx['wo']}", {}, 409, None),
        ("arif", "GET", "/production/batches/nope", None, 404, None),
        ("arif", "POST", "/production/batches", {}, 422, "mode"),
        ("arif", "PUT", f"/production/batches/{fx['batch']}", {}, 409, None),
        ("arif", "DELETE", f"/production/batches/{fx['batch']}", None, 409, None),
        ("arif", "POST", f"/production/batches/{fx['batch']}/receive", {"receiveDate": "2026-09-25", "lines": [{"receiveQty": 1}]}, 409, None),
        ("arif", "POST", "/production/batches/nope/receive", {}, 404, None),
        ("admin", "PUT", "/production/config", {}, 422, "procedure"),
        # R4 — accounting
        ("arif", "GET", "/accounting/accounts/nope", None, 404, None),
        ("arif", "POST", "/accounting/accounts", {}, 422, "kind"),
        ("arif", "DELETE", "/accounting/accounts/ac1", None, 409, None),
        ("arif", "GET", "/accounting/receipts/nope", None, 404, None),
        ("arif", "POST", "/accounting/receipts", {}, 422, "partyId"),
        ("arif", "POST", "/accounting/receipts", {"partyId": "c1", "date": "2026-06-15", "method": "cash", "accountId": "ac6", "amount": 100, "charge": 0, "allocations": [], "process": "Created"}, 422, "date"),
        ("arif", "POST", "/accounting/receipts", {"partyId": "c1", "date": "2026-09-20", "method": "cheque", "accountId": "ac1", "amount": 100, "charge": 0, "allocations": [], "process": "Created"}, 422, "chequeNo"),
        ("arif", "POST", "/accounting/receipts", {"partyId": "c1", "date": "2026-09-20", "method": "cash", "accountId": "ac1", "amount": 100, "charge": 0, "allocations": [], "process": "Created"}, 422, "accountId"),
        ("arif", "POST", "/accounting/receipts", {"partyId": "c1", "date": "2026-09-20", "method": "cash", "accountId": "ac6", "amount": 100, "charge": 150, "allocations": [], "process": "Created"}, 422, "charge"),
        ("arif", "PUT", f"/accounting/receipts/{fx['receipt']}", {}, 409, None),
        ("arif", "DELETE", f"/accounting/receipts/{fx['receipt']}", None, 409, None),
        ("arif", "PATCH", f"/accounting/receipts/{fx['receipt']}", {"process": "Cancelled", "reason": "short"}, 422, "reason"),
        ("arif", "GET", "/accounting/payments/nope", None, 404, None),
        ("arif", "POST", "/accounting/payments", {}, 422, "partyId"),
        ("arif", "DELETE", f"/accounting/payments/{fx['payment']}", None, 409, None),
        ("arif", "GET", "/accounting/statement?kind=customer&party=nope", None, 422, "party"),
        ("arif", "GET", "/accounting/statement?kind=customer&party=c1&from=2026-09-10&to=2026-09-01", None, 422, "to"),
        # R4 — NBR VAT
        ("arif", "GET", "/vat/compliance?period=2019-01", None, 422, "period"),
        ("arif", "GET", "/vat/returns/2031-01", None, 404, None),
        ("arif", "POST", "/vat/returns", {}, 422, "period"),
        ("arif", "POST", "/vat/returns", {"period": "2026-08"}, 409, None),
        ("arif", "PUT", "/vat/returns/2026-08", {}, 409, None),
        ("arif", "PATCH", "/vat/returns/2026-08", {"action": "submit"}, 409, None),
        ("arif", "DELETE", "/vat/returns/2026-08", None, 409, None),
        ("arif", "GET", "/vat/returns/2026-08/notes/99", None, 404, None),
        ("arif", "GET", "/vat/treasury/nope", None, 404, None),
        ("arif", "POST", "/vat/treasury", {}, 422, "challanNo"),
        ("arif", "PUT", f"/vat/treasury/{fx['treasury']}", {}, 409, None),
        ("arif", "DELETE", f"/vat/treasury/{fx['treasury']}", None, 409, None),
        ("arif", "GET", "/vat/vds/nope", None, 404, None),
        ("arif", "POST", "/vat/vds", {}, 422, "docId"),
        ("arif", "DELETE", f"/vat/vds/{fx['vds']}", None, 409, None),
        ("arif", "GET", "/vat/adjustments/nope", None, 404, None),
        ("arif", "POST", "/vat/adjustments", {}, 422, "description"),
        ("arif", "POST", "/vat/adjustments", {"kind": "otherIncrease", "issueDate": "2026-08-20", "taxPeriod": "2026-08", "amount": 100, "description": "Contract test in a locked period", "process": "Created"}, 422, "taxPeriod"),
        ("arif", "PUT", f"/vat/adjustments/{fx['adjustment']}", {}, 409, None),
        ("arif", "GET", "/mushak/6.10?from=bad&to=2026-08-31", None, 422, "from"),
        ("admin", "PUT", "/vat/settings", {}, 422, None),
        ("admin", "PUT", "/accounting/config", {}, 422, None),
    ]
    for user, m, path, body, status, key in cases:
        r = S(user).request(m, BASE + path, json=body)
        good = r.status_code == status and is_problem(r) and (key is None or key in (r.json().get("errors") or {}))
        check(good, f"{m} {path} as {user} → {r.status_code} {r.text[:120]} (want {status}{' errors.' + key if key else ''})")

def write_doc():
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "API.md"); os.makedirs(os.path.dirname(out), exist_ok=True)
    lines = ["# DiziVAT — API contract (v1)", "",
             "Generated by `scripts/contract.py --doc` from the table the contract tests run against. Base path `/api/v1`.", "",
             "**Conventions** — JSON bodies; session cookie `dizivat_session` (httpOnly). Errors are RFC 9457 `application/problem+json` "
             "`{type, title, status, errors?: {field: [code]}}`. 401 = no/expired session, 403 = role lacks the permission (title names it), "
             "404 unknown id, 409 state conflict, 422 validation (field → codes), 429 sign-in locked. "
             "Lists accept `page, size, sort=field.asc|desc, q, from, to` and facet params (comma-separated) and return "
             "`Page<T> = {data, total, page, size, totals, facets}`; add `format=csv` for an export.", "",
             "| Method | Path | Permission | Description |", "|---|---|---|---|"]
    for e in ENDPOINTS:
        perm = "public" if e["public"] else (f"`{e['perm']}`" if e["perm"] else "signed in")
        extra = " · CSV" if e["csv"] else ""
        desc = e['desc'].replace('|', chr(92) + '|')  # escape pipes inside table cells
        lines.append(f"| {e['m']} | `{e['p'].replace('{', ':').replace('}', '')}` | {perm} | {desc}{extra} |")
    lines += [""] + NOTES
    lines += ["", "## Roles", "", "| Permission | admin | approver | operator | viewer | vatOfficer |", "|---|---|---|---|---|---|"]
    roles = {"admin": set(LACKS), "approver": set(LACKS) - {"users.manage", "settings.manage"},
             "operator": {"doc.create", "doc.edit", "doc.delete", "export"}, "viewer": {"audit.view", "export"},
             "vatOfficer": {"audit.view", "export"}}
    for p_ in LACKS: lines.append(f"| `{p_}` | " + " | ".join("✓" if p_ in roles[r] else "—" for r in roles) + " |")
    open(out, "w").write("\n".join(lines) + "\n"); print("wrote", os.path.normpath(out))

if __name__ == "__main__":
    run()
    if "--doc" in sys.argv: write_doc()
    print(f"\ncontract: {passes} checks passed, {len(fails)} failed over {len(ENDPOINTS)} endpoints")
    if fails: sys.exit(1)
