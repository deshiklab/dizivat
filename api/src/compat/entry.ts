/**
 * Compat bundle (dist/compat.js): the mock route handlers plus the helpers the native modules need from the same
 * in-memory world. Loaded once at boot, after main.ts has put the saved state into the globals.
 */
export { routeModules } from "./routes.gen"
export { db, stockBranches, usedBranchIds, withStock } from "@/lib/mock/db"
export { badUnit, unitUsage } from "@/lib/mock/units"
export { auditStore, dhakaDay, diff } from "@/lib/mock/audit"
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

// R5.3: how a purchase body becomes the document it stores — the local, the service and the import (Bill of Entry,
// duty per line) variants, priced by the same functions the mock and the static demo run.
export { buildPurchaseFields } from "@/lib/mock/build"
export { periodLocked } from "@/app/api/v1/_r4"
export { branchLabels, postStock, stockShortfall } from "@/lib/mock/db"
