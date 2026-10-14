/**
 * Compat bundle (dist/compat.js): the helpers the native modules need from the mock's in-memory world — the
 * shared rules, the demo data set and its globals. Loaded once at boot, after main.ts has put the saved state
 * into the globals. The route table that once ran unported mock handlers inside NestJS is gone: it emptied
 * with R6.7's readers and the finale deleted it.
 */
export { db, stockBranches, usedBranchIds, withStock } from "@/lib/mock/db"
export { badUnit, unitUsage } from "@/lib/mock/units"
export { auditStore, dhakaDay, diff } from "@/lib/mock/audit"
export { cancelInput } from "@/lib/schemas"
export { zodErrors } from "@/app/api/v1/_lib"
export { tariff, TARIFF_FY } from "@/lib/mock/tariff"
export { userStore, DEMO_PASSWORD } from "@/lib/mock/users"
export { company } from "@/lib/mock/company"
// R5.2: the party rules (aggregates, duplicate/mode checks, stored shape, ids) are shared with the native module,
// so the PostgreSQL API and the mock handlers cannot drift. They read the documents, which are still compat state.
export {
  buildParty, newPartyId, normaliseParty, partyCsvColumns, partyDocs, partyErrors, partyLabel, partyRow, partySpec, PARTY_FIELDS,
} from "@/app/api/v1/_parties"
// R5.2: the item and master-item rules, shared the same way. `withStock` derives `remain` from the item's own
// counters; the branch split and the ledger stay derived from documents (compat state) until R5.3.
export {
  buildItem, buildMaster, flatMaster, itemCsvColumns, itemEdit, ITEM_FIELDS, itemSpec, itemStockValue, masterCsvColumns,
  MASTER_FIELDS, masterErrors, masterFields, masterRow, masterSpec, newItemId, skuTaken,
} from "@/app/api/v1/_items"
// R5.3: the stock-document rules, shared the same way — validation and pricing of the lines, the monthly numbers
// (which the audit trail takes part in), the branch-stock checks around approving and cancelling, the item counter
// a damage entry moves, the document's own history, and the register's spec and CSV columns. The documents
// themselves live in `stock_documents`; the branch split and an item's ledger derive from *every* movement document,
// and since R5.4 both are served from the rows (see `_derived` below).
export {
  approveDoc, buildStock, cancelDoc, findStockDoc, LABEL as STOCK_LABEL, nextStockNo, stampHistory as stampStockHistory,
  stockCsvColumns, stockCsvRows, stockDocs, stockDocDiff, stockSource, stockSpec,
  type DamageFields, type StockBuilt, type StockProblem, type TransferFields,
} from "@/app/api/v1/_stock"
// R5.3: the sale rules, shared the same way — what an invoice body may contain and how its lines are priced
// (_r3.parseSale), the numbers a new invoice takes, the stock and lot checks around approving and cancelling, the
// notes and settlements that block a cancellation, the export proceeds (PRC) entries, the document's own history,
// the diff an edit records and the register's spec, CSV columns and facet labels. The invoices themselves live in
// `sales`; the branch stock and the ledger are served from the rows since R5.4 (see `_derived` below), and the VAT
// returns still derive from every document, so they stay with the compat layer until R5.6.
export {
  approveRule, buildRealisation, cancelRule, deleteRule, docDiff, editDraftRule, parseRealisation, purchaseCategory,
  purchaseCategoryRule, purchaseCsvColumns, purchaseCsvRows, purchaseFacetLabels, purchaseIdentity, parsePurchase,
  purchaseSpec, realisableRule, realisationNotes, realisationRemovedNotes, saleCategory, saleCsvColumns, saleCsvRows,
  saleFacetLabels, saleIdentity, saleSpec, saleStockRule, stampDocHistory, noteDiff, noteDraftRule, stampNoteHistory,
  stampOpeningHistory, stampBatchHistory, stampBomHistory, stampWorkOrderHistory,
} from "@/app/api/v1/_docs"
// R5.3: the credit and debit note rules, shared the same way — what a note body may contain and how a returned line
// is priced pro rata, the numbers a new note takes, the source document that has to still be approved, the stock a
// cancellation needs, the registers' specs, filters and CSV columns. The notes themselves live in `notes`; what is
// still returnable on an invoice, a customer's credit and the VAT returns still derive from every document.
export {
  buildCredit, claimCreditId, creditApproveRule, creditCancelRule, creditCsvColumns, creditDeleteRule,
  creditFacetLabels, creditIdentity, creditMovedRule, creditSourceFilter, creditSpec, postCredit,
} from "@/app/api/v1/_r3"
export {
  buildDebit, claimDebitId, debitApproveRule, debitCancelRule, debitCsvColumns, debitDeleteRule, debitFacetLabels,
  debitIdentity, debitSourceFilter, debitSpec, debitStockRule, postDebit, returnable,
} from "@/app/api/v1/_r2"
// R5.4: the opening stock rules, shared the same way — what an entry body may contain, how the quantity is rounded
// to the unit's own decimals, the number a new entry takes, the stock an approval adds and a cancellation needs, and
// the register's spec, filter and CSV columns. The entries themselves live in `opening_entries`; the production
// batches have a table of their own now too, so the branch stock and an item's ledger are served from the rows (see
// `_derived` below).
export {
  buildOpening, claimOpeningId, openingApproveRule, openingCancelRule, openingCsvColumns, openingDeleteRule,
  openingDiff, openingDraftRule, openingFacetLabels, openingIdentity, openingItemFilter, openingSpec, postOpening,
} from "@/app/api/v1/_r2"
// R5.4: the production batch rules, shared the same way — what a batch body may contain and how the active BOM
// prices its lines and consumes its inputs, the number a new batch takes, the input stock an approval needs and a
// cancellation gives back, the contractor's receipt that completes a Mushak 6.4 challan, and the register's spec,
// work-order filter and CSV columns. The batches themselves live in `batches` (their lines in `batch_lines`, their
// consumption in `batch_consumption`); the price declarations and the production configuration they are built from
// have tables of their own since R5.5 (see below), and so do the work orders; the branch stock and an item's ledger
// are served from the rows (see `_derived` below).
export {
  applyBatchReceive, batchApproveRule, batchCancelRule, batchCsvColumns, batchCsvRows, batchDeleteRule, batchDiff,
  batchDraftRule, batchIdentity, batchReceiveChanges, batchReceiveStateRule, batchSpec, batchStockRule,
  batchWorkOrderFilter, buildBatch, buildBatchReceive, claimBatchId, postBatchIssue, postBatchReceive,
  type BatchFields, type BatchReceiveFields,
} from "@/app/api/v1/_r3"
export { creditable, parseSale } from "@/app/api/v1/_r3"
// R5.5: the price-declaration rules (the Mushak 4.3 bill of materials), shared the same way — what a body may
// contain and how `calcBom` prices it, which version of the item it becomes, what approving supersedes, the
// lifecycle a draft may go through, the register's spec, CSV columns, name and facet labels, and the production
// configuration's own schema and diff. The declarations live in `boms` (their inputs in `bom_inputs`, their cost
// heads in `bom_costs`) and the configuration in the one row of `production_config`; the work orders are compat
// state, and a batch still prices its lines from the declarations through the mirror this module writes.
export {
  activeBom, approveBom, bomApproveRule, bomCancelRule, bomCsvColumns, bomCsvName, bomDeleteRule, bomDiff,
  bomDraftRule, bomDraftTakenRule, bomFacetLabels, bomIdentity, bomRow, bomSpec, bomStatus, bomVersions, buildBom,
  buildConfig, claimBomId, configDiff, CONFIG_DIFF_FIELDS, BOM_DIFF_FIELDS,
  type BomFields, type BomSource,
} from "@/app/api/v1/_r3"
// R5.5: the work-order rules, shared the same way — what a body may contain (every line an active finished good with
// a declaration in force on the issue date), the number a new work order takes (which the audit trail takes part in),
// the progress the approved batches have made on it, the batches that block a cancellation or a deletion, the diff an
// edit records, and the register's spec, its `?item=` filter and its CSV columns. The work orders live in
// `work_orders` and their goods in `work_order_lines`; a batch reads the quantity one has left through the mirror.
// R5.6: the accounting rules, shared the same way — the money accounts (what a balance is derived from), the
// receipts and the payments with their allocations (what an invoice still owes), the party statement with its ageing,
// and the configuration that closes the books. They read the parties, the invoices and the treasury and VDS entries,
// which the native module hands them from the tables they live in.
export {
  ACCOUNT_CSV_COLUMNS, ACCOUNT_CSV_NAME, ACCOUNT_DIFF_FIELDS, accountDeleteRule, accountIdentity, accountSpec,
  accountRef, accountRow, accountingConfigDiff, AccountingSource, ACCOUNTING_CONFIG_DIFF_FIELDS, buildAccountingConfig,
  buildMoney, claimAccountId, claimMoneyId, closed, DEFAULT_ACCOUNTING_CONFIG, moneyApproveRule, moneyCancelRule,
  MONEY_DIFF_FIELDS, moneyCsvColumns, moneyCsvName, moneyFacetLabels, moneyIdentity, moneyInvoiceFilter, moneySpec,
  openInvoiceParams, openInvoices, parseAccount, stampMoneyHistory,
  partyOf, settle, statement, statementCsvColumns, statementCsvName, statementParams, stampAccountHistory,
} from "@/app/api/v1/_r4"
export {
  approvedBatchLines, buildWorkOrder, claimWorkOrderId, refreshWorkOrder, woApproveRule, woBatchRow, woBatchRows,
  woBatches, woCancelRule, woCsvColumns, woCsvName, woCsvRows, woDeleteRule, woDiff, woDraftRule, woIdentity,
  woItemFilter, woSpec, WORK_ORDER_DIFF_FIELDS,
  type ProgressLine, type WorkOrderBatch, type WorkOrderFields,
} from "@/app/api/v1/_r3"
// R5.4: the derived stock itself — the branch split (`/stock`) and one item's ledger (`/items/{id}/ledger`). Both add
// up every movement document, and every family has a table now, so the native module reads them back from the tables
// and hands them to the mock's own derivation: the register's spec, rows, per-branch valuation and CSV columns, and
// the ledger's sorted rows, running balance and totals. Nothing is stored here, so there is nothing to migrate.
export { branchCsvColumns, itemLedger, stockRegister } from "@/app/api/v1/_derived"
// R5.6: the Mushak books, the dashboard and the search, shared the same way — one item's book over a range (6.1 for
// inputs, 6.2 for finished goods, 6.2.1 for traded goods) with the range rule and the CSV columns the route used to
// hold itself, 6.10's purchases and sales above the limit, the home screen's KPIs, charts, deadlines and low stock,
// and the ⌘K palette's one query across the invoice registers, the SKUs and both party books. All three add up
// documents that live elsewhere, so they store nothing: the native module reads what each needs back from the
// tables and hands it to the mock's own derivation.
export {
  dashboardAnswer, mushak610Book, mushak610CsvColumns, mushakBook, mushakCsvColumns, searchAnswer,
  type DashboardSource, type SearchSource,
} from "@/app/api/v1/_derived"
// R5.6: the NBR service codes, the notifications (built on demand from the drafts awaiting an approval, the audit
// trail's decisions on the documents the user issued and the stock below its re-order level) and the bulk master-data
// import with its all-or-nothing rule, shared the same way.
export { notificationsFor, type NotificationSource } from "@/lib/mock/notifications"
export { notifReadInput } from "@/app/api/v1/_derived"
export { bulkImport, type ImportSource } from "@/app/api/v1/_r62"
// R6.2: the exporters' UD / UP register — its rows, its rules and its three writes, over whichever copy of the
// documents the caller holds
export { udRegister, udCheck, udInUse, udCreate, udUpdate, udRemove, udAnswer, udFitAnswer, udFitInput,
  udCsvColumns, udCsvRows, newUdId } from "@/app/api/v1/_r62"
export type { UdSource, UdHead, UdWrite } from "@/app/api/v1/_r62"
// R6.5: our own UDs / UP and their bond settlement — the same rules the mock's routes run, over whichever copy of
// the documents the caller holds (the register and the settlement statement are src/lib/settlement.ts's, shared
// with the pages already)
export { bondUdCreate, bondUdUpdate, bondUdSettle, bondUdInUse, bondUdLines, newBondUdId,
  bondUdCsvColumns, bondUdCsvRows } from "@/app/api/v1/_r65"
export type { BondUdSource, BondUdWrite, BondUdParsed, SettleParsed } from "@/app/api/v1/_r65"
// R6.5's second half: the drawback-claim rules, shared the same way — over whichever copy of the drawback view's
// rows, the claims and the sales the caller holds. The claim itself travels whole (its lines are a frozen copy).
export { claimCreate, claimRemove, claimAct, newClaimTag, CLAIM_ACTION_PERM, claimCsvColumns, claimCsvRows } from "@/app/api/v1/_r65"
export type { ClaimSource, ClaimWrite, ClaimParsed, ClaimActionParsed } from "@/app/api/v1/_r65"
// R6.6: the Mushak 9.3 (late filing) / 9.4 (amended return) rules, shared the same way — over whichever copy of the
// returns, the applications and the settings the caller holds. An amend step that decreases the tax also returns the
// decreasing adjustments it posts (notes 32 / 39), which the native module stores beside the application itself.
export { lfCheck, lfCreate, lfUpdate, lfRemove, lfAction, amCheck, amCreate, amUpdate, amRemove, amAction,
  lfRef, amRef, lfCsvColumns, lfCsvRows, amCsvColumns, amCsvRows } from "@/app/api/v1/_r66"
export type { LateSource, AmendSource, LfWrite, AmWrite, LfData, LateActionData, AmData, AmendActionData } from "@/app/api/v1/_r66"
// R6.6 (proceeds): the bank-file batch rules — the confirmed allocations become proceeds entries on the invoices and
// a batch row; a reversal removes them again. The caller records the audit entries the write carries.
export { prcBatchCreate, prcBatchReverse, newPrcBatchTag, proceedsOpenCsvColumns } from "@/app/api/v1/_r66"
export type { PrcSource, PrcAudit } from "@/app/api/v1/_r66"
export type { UdParsed } from "@/lib/schemas"
export { bulkImportInput } from "@/lib/schemas"
export { SERVICES } from "@/lib/r2"
export { SALE_SERVICES } from "@/lib/r3"
// R5.5: the two registers the rest of production is watched by, served the same way — the finished-goods lots (what
// an approved batch received less what the approved invoices drew on) and the subcontracting register (the
// contractual batches, what is still at the contractor and for how long). Both are derived, so they store nothing:
// the native module reads the batches and the invoices back from their tables and hands them to the mock's own
// derivation, including the range rule and the CSV columns the subcontracting route used to hold itself.
export { lots, lotsAnswer, type LotSource } from "@/app/api/v1/_r3"
export {
  SUBCON_CSV_COLUMNS, SUBCON_OVERDUE_DAYS, subconCsvName, subconParams, subconRegister, subconRows,
} from "@/app/api/v1/_r62"

// R5.3: how a purchase body becomes the document it stores — the local, the service and the import (Bill of Entry,
// duty per line) variants, priced by the same functions the mock and the static demo run.
export { buildPurchaseFields } from "@/lib/mock/build"
// R5.6: the NBR VAT documents' rules, shared the same way — the treasury deposits (TR-6), the VDS certificates
// (Mushak 6.6) and the manual VAT adjustments. What a body may hold, the economic code a head takes, the challan that
// must not be used twice, the invoices a certificate may still be written against and how much VAT each has left to
// withhold, the treasury challan a purchase certificate quotes, the six-month window an SD-on-exports claim lands in,
// the period lock, the balance a deposit needs, the VDS entries that keep a challan from being cancelled, the invoice
// a certificate settles, and each register's spec, CSV columns, name, facet labels and diff. The documents themselves
// live in `treasury_deposits`, `vds_entries` and `vat_adjustments`; the Mushak 9.1 return, the compliance centre and
// a party's statement still read them through the mirror this module writes.
export {
  ADJUSTMENT_CSV_COLUMNS, ADJUSTMENT_DIFF_FIELDS, adjustmentApproveRule, adjustmentBuild, adjustmentIdentity,
  adjustmentLockRule, adjustmentSpec, claimAdjustmentId, stampAdjustmentHistory,
  claimTreasuryId, claimVdsId, stampTreasuryHistory, stampVdsHistory,
  TREASURY_CSV_COLUMNS, TREASURY_DIFF_FIELDS, treasuryApproveRule, treasuryBuild, treasuryCancelRule, treasuryIdentity,
  treasuryLockRule, treasurySpec,
  VDS_CSV_COLUMNS, VDS_DIFF_FIELDS, vdsApproveRule, vdsBuild, vdsEligible, vdsFacetLabels, vdsIdentity, vdsLockRule,
  vdsSettle, vdsSpec,
  type VatSource,
} from "@/app/api/v1/_r4"
export { periodLocked } from "@/app/api/v1/_r4"
export { EMPTY_MANUAL } from "@/lib/mock/vat-return"
// R5.6: the Mushak 9.1 return and the NBR settings, shared the same way — one return per tax period, the period
// itself being its id, which is what every document is locked against. What a period may be filed for (in order, and
// not twice), what a submission needs (the period over, the previous return filed, a real date and note 58 covering
// note 50), the acknowledgement number it is given, the register's spec and CSV columns, the compliance centre's
// answer, the note sub-forms and the settings row. The returns live in `vat_returns` and the settings in
// `vat_settings`; the rest of the Mushak books still read them through the mirror this module writes.
export {
  RETURN_CSV_COLUMNS, RETURN_DIFF_FIELDS, SUBFORM_CSV_COLUMNS, VAT_SETTINGS_DIFF_FIELDS,
  complianceAnswer, currentPeriod, returnCreateRule, returnCsvName, returnDeleteRule, returnEditRule, returnRef,
  returnRow, returnSpec, returnSubmitRule, returnView, stampLifeHistory, subFormAnswer, taxPeriods, vatSettingsRule,
  type ComplianceAnswer, type ReturnFields, type ReturnSource, type SubFormAnswer,
} from "@/app/api/v1/_r4"
export { branchLabels, postStock, stockShortfall } from "@/lib/mock/db"
// R6 (the last four readers): the bond register's computation (the mock passes its own db, the native module the
// mirror's copies of the same collections) with its three CSV views, and the penalty quote / exposure the
// compliance centre's calculator serves — shared so the registers, the columns and the 422s cannot drift.
export {
  BOND_DRAWBACK_CSV, BOND_LOTS_CSV, BOND_REGISTER_CSV, bondCsvName, bondRegisterFrom, drawbackCsvRows, type BondWorld,
} from "@/app/api/v1/_r64"
export {
  penaltyBasisOf, penaltyExposureOf, penaltyQuoteOf, type PenaltySource,
} from "@/app/api/v1/_r63"
