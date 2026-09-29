/** Domain types — shaped to match the planned Symfony /api/v1 contract (see plan §5). */

export type Process = "Created" | "Approved" | "Cancelled"
export type SalesMode = "Local" | "Foreign"
export type PurchaseMode = "Local" | "Foreign" | "Non-registered"
export type PayMethod = "Bank" | "Cash" | "Cheque" | "Mobile" | "Transaction"
export type ItemGroup = "Raw Material" | "Consumable" | "Packing Materials" | "Finished Goods"

export interface Party {
  id: string
  name: string
  bin: string
  mobile: string
  address: string
  kind: "customer" | "vendor"
  mode: SalesMode | PurchaseMode
  country?: string
  email?: string
  contactPerson?: string
  active?: boolean
  /** R3 (customers): credit limit in BDT (0/absent = cash customer, no limit shown) */
  creditLimit?: number
  /** R3 (customers): buyer is a VAT-deduction-at-source entity (bank, NGO, listed company …) — VDS pre-ticked on sales */
  vdsWithholder?: boolean
}

/** Party row in master-data lists, with document aggregates. */
export type PartyRow = Party & { docs: number; turnover: number; due: number; lastDate?: string; /** R3: due on invoices older than 30 days */ overdue?: number; dueInvoices?: number }

export interface Item {
  id: string
  hsCode: string
  group: ItemGroup
  masterItem: string
  brand: string
  name: string
  /** unit-of-measure code from the Units master (Kg, Pcs, Roll …) */
  unit: string
  sku: string
  purchasePrice: number
  costPrice: number
  salePrice: number
  vatRate: number
  sdRate: number
  opening: number
  purchased: number
  prodReceive: number
  prodIssue: number
  sold: number
  damage: number
  reorderLevel: number
  active: boolean
}
export type ItemWithStock = Item & { remain: number }

export interface Line {
  itemId: string
  name: string
  hsCode: string
  uom: string
  qty: number
  price: number
  sdRate: number
  vatRate: number
  subtotal: number
  sd: number
  vat: number
  total: number
  /** purchase only */
  rebateable?: boolean
  vds?: boolean
  /** imports: total tax incidence (CD+RD+SD+VAT+AIT+AT) */
  tti?: number
  /** imports (R2): Bill of Entry duty breakdown — `subtotal` is then the assessable value (AV) */
  duty?: ImportDuty
  /** sales (R3): production batch (lot) the finished goods ship from */
  batchId?: string
  batchNo?: string
}

/**
 * Customs duty stack of one Bill-of-Entry line (NBR method, all amounts BDT, rates %):
 * AV = USD × rate · CD = AV·cd · RD = AV·rd · SD = (AV+CD+RD)·sd · VAT = (AV+CD+RD+SD)·vat · AIT = AV·ait · AT = (AV+CD+RD+SD)·at
 */
export interface ImportDuty { usd: number; usdRate: number; av: number; cdRate: number; cd: number; rdRate: number; rd: number; aitRate: number; ait: number; atRate: number; at: number }

export type HistoryAction = "created" | "edited" | "approved" | "cancelled" | "deleted" | "restored" | "submitted"
export interface HistoryEntry { at: string; by: string; action: HistoryAction; note?: string }

interface DocBase {
  id: string
  createdAt: string
  issueDate: string
  process: Process
  method: PayMethod
  subtotal: number
  sd: number
  vat: number
  discount: number
  netTotal: number
  paid: number
  due: number
  lines: Line[]
  issuedBy: string
  designation: string
  narration?: string
  updatedAt?: string
  cancelReason?: string
  history?: HistoryEntry[]
  /** branch / warehouse the goods leave (sale) or arrive at (purchase) */
  branchId: string
  branchName: string
}

export interface Sale extends DocBase {
  invoiceNo: string
  challanNo: string
  issueTime: string
  customerId: string
  customerName: string
  customerBin: string
  customerAddress: string
  deliveryAddress: string
  vehicle?: string
  mode: SalesMode
  vds: boolean
  /** R3: goods (stock) or service sale (no stock movement); absent = goods */
  category?: SaleCategory
  /** R3: export / deemed-export shipping documents (zero-rated) */
  export?: ExportInfo
}
export type SaleCategory = "goods" | "service"
/** Export header (legacy "New Export"): LC, customs station, destination and the Bill of Export. Deemed export = local supply against a back-to-back LC. */
export interface ExportInfo { deemed: boolean; lcNo: string; lcDate: string; customsHouse: string; country: string; billNo: string; billDate: string; shippingAddress: string; cnfFirm?: string }

export interface Purchase extends DocBase {
  invoiceNo: string
  challanNo: string
  challanDate: string
  vendorId: string
  vendorName: string
  vendorBin: string
  vendorAddress: string
  mode: PurchaseMode
  tti: number
  /** input tax credit claimable in Mushak 9.1 */
  rebate: number
  /** R2: goods (stock) or service purchase (no stock movement); absent = goods */
  category?: PurchaseCategory
  /** R2: import purchases (mode Foreign) — Bill of Entry header */
  boe?: BillOfEntry
}
export type PurchaseCategory = "goods" | "service"
export interface BillOfEntry { no: string; date: string; lcNo: string; lcDate: string; customsHouse: string; origin: string; cnfFirm?: string; receiveAddress?: string }

export interface Page<T, Totals = Record<string, number>> {
  data: T[]
  total: number
  page: number
  size: number
  totals: Totals
  facets: Record<string, Record<string, number>>
}

export interface ListParams {
  page?: number
  size?: number
  sort?: string
  q?: string
  from?: string
  to?: string
  [facet: string]: string | number | string[] | undefined
}

export interface DashboardData {
  period: { label: string; start: string; end: string; returnDue: string; daysLeft: number }
  kpis: {
    sales: number; salesPrev: number
    outputVat: number; outputVatPrev: number
    inputVat: number; inputVatPrev: number
    netPayable: number; netPayablePrev: number
    purchases: number; purchasesPrev: number
    receivable: number; payable: number
    pendingApproval: number
  }
  monthly: { month: string; sales: number; purchases: number; outputVat: number; inputVat: number }[]
  topCustomers: { name: string; amount: number; count: number }[]
  mix: { name: string; value: number }[]
  recentSales: Sale[]
  lowStock: ItemWithStock[]
  deadlines: { id: string; title: string; due: string; status: "due" | "done" | "overdue"; href?: string }[]
}

export interface SearchHit {
  type: "sale" | "purchase" | "item" | "customer" | "vendor"
  id: string
  title: string
  subtitle: string
  href: string
}

export type LedgerType = "opening" | "purchase" | "sale" | "prodReceive" | "prodIssue" | "damage" | "transferIn" | "transferOut" | "purchaseReturn" | "saleReturn"
export interface LedgerEntry {
  date: string
  type: LedgerType
  ref?: string
  refId?: string
  party?: string
  in: number
  out: number
  balance: number
  /** monthly summary rows for production posted before R3 batches (legacy history) */
  summary?: boolean
}
export interface ItemLedger {
  item: ItemWithStock
  entries: LedgerEntry[]
  totals: { in: number; out: number }
  closing: number
  /** set when the ledger is for one branch (transfers then appear as in/out rows) */
  branchId?: string
  /** stock-holding branches and this item's quantity at each */
  branches: { id: string; name: string }[]
  byBranch: Record<string, number>
}

/* ── Sprint 3 ─────────────────────────────────────────────────────────────── */

/** Audit trail (FE-S3-03). One event per state change or sign-in; `changes` holds field-level before/after. */
export type AuditEntity = "sale" | "purchase" | "transfer" | "damage" | "customer" | "vendor" | "item" | "unit" | "user" | "company" | "session" | "debitNote" | "opening" | "masterItem" | "creditNote" | "bom" | "workOrder" | "batch" | "productionConfig" | "account" | "receipt" | "payment" | "treasury" | "vds" | "adjustment" | "vatReturn" | "accountingConfig" | "vatSettings"
export type AuditAction =
  | "created" | "edited" | "approved" | "cancelled" | "deleted" | "restored"
  | "updated" | "activated" | "deactivated" | "roleChanged" | "invited" | "passwordReset" | "passwordChanged"
  | "signedIn" | "signedOut" | "signInFailed" | "submitted"
export interface AuditChange { field: string; from: string; to: string }
export interface AuditEvent {
  id: string
  at: string
  /** calendar day in Asia/Dhaka (YYYY-MM-DD) — used by the date filter */
  day: string
  actor: string
  actorId?: string
  entity: AuditEntity
  entityId?: string
  /** human reference: invoice no., party/item/user name */
  ref: string
  action: AuditAction
  changes?: AuditChange[]
  note?: string
}

/** Company profile (FE-S3-02) — mirrors legacy "Manage Organization" + online signature block. */
export type VatSlab = "standard" | "truncated" | "turnover" | "exempt"
export type BranchCategory = "factory" | "warehouse" | "office" | "sales"
export interface Branch { id: string; name: string; address: string; category: BranchCategory; code?: string }
export interface Company {
  name: string
  vatSlab: VatSlab
  bin: string
  tin: string
  mobile: string
  phone?: string
  email: string
  address: string
  owner: { name: string; nid?: string; mobile: string; designation?: string }
  /** authorised person printed on Mushak documents */
  signatory: { name: string; designation: string; mobile: string; email: string; nid: string }
  branches: Branch[]
  updatedAt?: string
  updatedBy?: string
}
export type CompanySummary = Pick<Company, "name" | "bin" | "address" | "vatSlab">

/** NBR customs & VAT tariff line (legacy "Tax Tariff"): rates in %. TTI = total tax incidence. */
export interface TariffLine { hsCode: string; description: string; cd: number; sd: number; vat: number; ait: number; rd: number; at: number; tti: number; chapter: string }

/** Server-driven notifications (FE-S3-06) */
export type NotificationKind = "approvals" | "decided" | "deadline" | "lowStock" | "security"
export interface AppNotification {
  id: string
  kind: NotificationKind
  at: string
  /** i18n key under notifications.* and its values; the UI renders the text */
  msg: string
  values?: Record<string, string | number>
  href?: string
  tone?: "info" | "warning" | "success" | "danger"
  read: boolean
}

/* ── Sprint 4 ─────────────────────────────────────────────────────────── */

/** Units-of-measure master (S4-04). `decimals` = quantity precision on forms. */
export interface Unit { id: string; code: string; name: string; decimals: number; active: boolean; createdAt: string }
export type UnitRow = Unit & { inUse: number }

/** Stock documents (S4-05): inter-branch transfer (Mushak 6.5) and damage / wastage entry. */
export type StockDocKind = "transfer" | "damage"
export type DamageReason = "damaged" | "expired" | "wastage" | "lost"
export interface StockLine { itemId: string; name: string; sku: string; uom: string; qty: number; /** unit cost at posting */ cost: number; value: number }
interface StockDocBase {
  id: string
  /** TR-MMYY#### / DM-MMYY#### */
  no: string
  date: string
  process: Process
  lines: StockLine[]
  totalQty: number
  totalValue: number
  note?: string
  issuedBy: string
  createdAt: string
  updatedAt?: string
  cancelReason?: string
  history?: HistoryEntry[]
}
export interface Transfer extends StockDocBase { kind: "transfer"; fromBranchId: string; fromBranch: string; toBranchId: string; toBranch: string; vehicle?: string }
export interface Damage extends StockDocBase { kind: "damage"; branchId: string; branch: string; reason: DamageReason }
export type StockDoc = Transfer | Damage

/** Item stock split by branch (branch id → qty) with valuation at cost. */
export type StockRow = ItemWithStock & { byBranch: Record<string, number>; value: number; saleValue: number }

/* ── R2 — Purchase & Inventory ─────────────────────────────────────────── */

/** NBR service code used on service purchases (illustrative subset; VDS = buyer withholds VAT at source). */
export interface ServiceType { id: string; code: string; name: string; vatRate: number; vds: boolean; unit: string }

/** Debit note (Mushak 6.8) — goods returned to the vendor against an approved purchase. */
export interface DebitLine {
  itemId: string; name: string; hsCode: string; uom: string
  /** quantity on the purchase line */
  purchasedQty: number
  qty: number; price: number; sdRate: number; vatRate: number
  subtotal: number; sd: number; vat: number; tti: number; total: number
  /** input tax given back (was claimable on the purchase) */
  rebate: number
}
export type DebitReason = "damaged" | "quality" | "excess" | "wrongItem" | "priceDispute"
export interface DebitNote {
  id: string
  /** DN-MMYY#### */
  no: string
  purchaseId: string; purchaseNo: string; purchaseDate: string; purchaseMode: PurchaseMode; challanNo: string
  vendorId: string; vendorName: string; vendorBin: string; vendorAddress: string
  branchId: string; branchName: string
  issueDate: string; issueTime: string
  reason: DebitReason; note?: string
  issuedBy: string; designation: string
  process: Process
  lines: DebitLine[]
  subtotal: number; sd: number; vat: number; tti: number; total: number; rebate: number
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** Opening stock entry (legacy "Opening Stock"): quantity brought forward with its purchase value and input-tax class. */
export type InputTaxClass = "standard" | "reduced" | "zero" | "exempt"
export interface OpeningEntry {
  id: string
  /** OS-MMYY#### */
  no: string
  itemId: string; name: string; hsCode: string; sku: string; uom: string
  branchId: string; branchName: string
  date: string
  inputTax: InputTaxClass
  qty: number; price: number; value: number
  /** VAT paid on this stock when bought (for the 6.1 opening value), BDT */
  vatPaid: number
  note?: string
  process: Process
  issuedBy: string; createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** Master item (HS-code product with its tax profile). Rates default from the tariff; differences are flagged overrides. */
export type MasterCategory = "general" | "commercialImporter" | "medicine" | "petroleum" | "superShop"
export type PriceMethod = "average" | "standard"
export interface TaxProfile { vat: number; sd: number; cd: number; rd: number; ait: number; at: number }
export interface MasterItem {
  id: string
  name: string
  hsCode: string
  group: ItemGroup
  category: MasterCategory
  unit: string
  priceMethod: PriceMethod
  description?: string
  rates: TaxProfile
  /** required when any rate differs from the tariff */
  overrideReason?: string
  active: boolean
  createdAt: string
  updatedAt?: string
  history?: HistoryEntry[]
}
export type MasterItemRow = MasterItem & { items: number; tariff: TaxProfile | null; overrides: (keyof TaxProfile)[]; tariffDescription?: string }

/** Mushak 6.1 (purchase book) / 6.2 (sales book) — one row per movement, NBR column order. */
export interface BookRow {
  sl: number
  date: string
  openQty: number; openValue: number
  ref?: string; refId?: string; refDate?: string
  party?: string; partyAddress?: string; partyBin?: string
  description: string
  /** purchase (6.1) / production (6.2) received, and sold (6.2) */
  inQty: number; inValue: number; sd: number; vat: number
  outQty: number; outValue: number
  closeQty: number; closeValue: number
  kind: LedgerType
  summary?: boolean
}
export interface MushakBook {
  form: "6.1" | "6.2"
  item: ItemWithStock
  from: string; to: string
  company: { name: string; address: string; bin: string }
  rows: BookRow[]
  totals: { inQty: number; inValue: number; sd: number; vat: number; outQty: number; outValue: number }
  opening: { qty: number; value: number }
  closing: { qty: number; value: number }
}

/* ── R3 — Sales & Production ───────────────────────────────────────────── */

/** Credit note (Mushak 6.7) — goods returned by the customer against an approved sale; output VAT is reduced. */
export interface CreditLine {
  itemId: string; name: string; hsCode: string; uom: string
  /** quantity on the sales invoice */
  soldQty: number
  qty: number; price: number; sdRate: number; vatRate: number
  subtotal: number; sd: number; vat: number; total: number
}
export type CreditReason = "damaged" | "quality" | "excess" | "wrongItem" | "priceAdjustment"
export interface CreditNote {
  id: string
  /** CN-MMYY#### */
  no: string
  saleId: string; saleNo: string; saleDate: string; saleMode: SalesMode; challanNo: string
  customerId: string; customerName: string; customerBin: string; customerAddress: string
  branchId: string; branchName: string
  issueDate: string; issueTime: string
  reason: CreditReason; note?: string
  issuedBy: string; designation: string
  process: Process
  lines: CreditLine[]
  subtotal: number; sd: number; vat: number; total: number
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** Service sold (NBR service code) — used on service sales (D-12). */
export type SaleService = ServiceType

/** Production configuration (legacy "Production Config"). */
export type ProductionProcedure = "directStock" | "workOrder"
export type ConsumptionMethod = "standard" | "actual"
export interface ProductionConfig { procedure: ProductionProcedure; consumption: ConsumptionMethod; updatedAt?: string; updatedBy?: string }

/** Bill of materials / input–output coefficient (Mushak 4.3), per ONE unit of the finished good. */
export interface BomInput {
  itemId: string; name: string; sku: string; uom: string
  /** net quantity per unit of output */
  qty: number
  wastagePct: number
  /** qty × wastage% */
  wastageQty: number
  /** qty + wastage */
  grossQty: number
  price: number
  /** grossQty × price */
  value: number
  wastageValue: number
}
export type CostHead = "labour" | "power" | "overhead" | "packing" | "admin" | "finance" | "profit" | "other"
export interface BomCost { head: CostHead; amount: number }
export interface Bom {
  id: string
  /** BOM-{sku}-v{n} */
  no: string
  itemId: string; itemName: string; sku: string; hsCode: string; uom: string
  version: number
  /** date the price declaration is submitted to / accepted by the VAT office */
  licenseDate?: string
  /** date the coefficients take effect (legacy "Initiate Date") */
  effectiveDate: string
  inputs: BomInput[]
  costs: BomCost[]
  materialValue: number; wastageValue: number; valueAdded: number
  /** declared price per unit = material + value added (incl. profit) */
  price: number
  /** cost per unit used to value production receipts (price − profit) */
  unitCost: number
  /** why this version replaced the previous one */
  amendmentReason?: string
  process: Process
  /** set when a newer version was approved */
  supersededAt?: string
  note?: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}
export type BomStatus = "active" | "draft" | "superseded" | "cancelled"
export type BomRow = Bom & { status: BomStatus; salePrice: number }

/** Production work order (PW-MMYY####): what the floor must produce, tracked by the batches that reference it. */
export interface WorkOrderLine { itemId: string; name: string; sku: string; uom: string; qty: number; /** put into production by approved batches */ issued?: number; received: number; damaged: number; /** still to put into production */ remaining: number }
export type WorkOrderStatus = "draft" | "open" | "partial" | "completed" | "cancelled"
export interface WorkOrder {
  id: string
  no: string
  requisitionNo?: string
  issueDate: string
  dueDate?: string
  remark?: string
  lines: WorkOrderLine[]
  process: Process
  status: WorkOrderStatus
  issuedBy: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** Production batch (PB-MMYY####): in-house, contractual (Mushak 6.4 challan to the contract manufacturer) or opening. */
export type BatchMode = "inHouse" | "contractual" | "opening"
export interface BatchLine {
  itemId: string; name: string; sku: string; uom: string
  workOrderId?: string; workOrderNo?: string
  /** quantity of finished goods put into production (inputs are consumed for this quantity) */
  issueQty: number
  receiveQty: number
  damageQty: number
  bomId?: string; bomVersion?: number
  unitCost: number
  value: number
}
export interface Consumption { itemId: string; name: string; sku: string; uom: string; qty: number; price: number; value: number }
export interface Batch {
  id: string
  no: string
  mode: BatchMode
  issueDate: string
  receiveDate?: string
  vendorId?: string; vendorName?: string; vendorBin?: string; vendorAddress?: string
  /** contractual: where the inputs are delivered */
  address?: string
  remark?: string
  issuedBy: string; designation: string; issueTime?: string
  lines: BatchLine[]
  consumption: Consumption[]
  totalIssue: number; totalReceive: number; totalDamage: number; materialValue: number; value: number
  process: Process
  /** contractual: finished goods received back from the contractor */
  receivedAt?: string
  branchId: string; branchName: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}
/** Finished-goods lot = one batch line received into stock; sales can draw from a lot. */
export interface Lot { batchId: string; batchNo: string; date: string; itemId: string; received: number; sold: number; available: number }

/* ── R4 — Accounting & NBR VAT ─────────────────────────────────────────── */

/** Company money account: bank account, mobile-wallet (MFS) account or cash in hand. */
export type AccountKind = "bank" | "mobile" | "cash"
export type BankAccountType = "current" | "savings" | "transaction" | "other"
export type WalletType = "personal" | "general" | "merchant"
export interface MoneyAccount {
  id: string
  kind: AccountKind
  /** bank name, wallet service (bKash, Nagad …) or cash-box name */
  provider: string
  /** bank: account number · mobile: wallet number · cash: optional code */
  accountNo: string
  owner: string
  branch?: string
  address?: string
  bankType?: BankAccountType
  walletType?: WalletType
  /** mobile: person authorised to operate the wallet */
  authorised?: string
  /** % the bank / MFS charges on incoming money */
  serviceCharge: number
  openingBalance: number
  /** date the opening balance is taken from */
  openingDate: string
  active: boolean
  createdAt: string; updatedAt?: string; history?: HistoryEntry[]
}
export type MoneyAccountRow = MoneyAccount & { inflow: number; outflow: number; balance: number; lastDate?: string; docs: number }

/** Customer receipt (MR-) or supplier payment (PV-), allocated to open invoices. */
export type MoneyKind = "receipt" | "payment"
export type MoneyMethod = "cash" | "bankTransfer" | "cheque" | "mobile"
export interface Allocation { docId: string; docNo: string; docDate: string; docTotal: number; amount: number }
export interface MoneyDoc {
  id: string
  /** MR-MMYY#### (receipt) / PV-MMYY#### (payment) */
  no: string
  kind: MoneyKind
  date: string
  partyId: string; partyName: string; partyBin: string
  method: MoneyMethod
  accountId: string; accountName: string
  chequeNo?: string; chequeDate?: string; chequeBank?: string
  /** mobile-wallet transaction id / bank reference */
  reference?: string
  amount: number
  /** bank / MFS charge deducted (receipts) */
  charge: number
  allocations: Allocation[]
  allocated: number
  /** advance / on-account amount not yet set against an invoice */
  unallocated: number
  note?: string
  process: Process
  issuedBy: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}
/** An invoice that can still take a receipt / payment. */
export interface OpenInvoice { id: string; no: string; challanNo: string; date: string; total: number; paid: number; due: number; days: number }

export interface AccountingConfig {
  /** receipts/payments dated on or before this date are rejected (legacy "Account close") */
  closedUpTo?: string
  /** allow receipts/payments larger than the invoices they settle (advance / on-account) */
  allowAdvance: boolean
  /** new receipts/payments pre-allocate oldest invoices first */
  autoAllocate: boolean
  updatedAt?: string; updatedBy?: string
}

/** Party statement (customer or supplier ledger) with ageing of the open balance. */
export type StatementRowType = "opening" | "invoice" | "settledOnInvoice" | "receipt" | "payment" | "vds" | "advance"
export interface StatementRow { date: string; type: StatementRowType; ref?: string; refId?: string; note?: string; debit: number; credit: number; balance: number }
export interface PartyStatement {
  kind: "customer" | "vendor"
  party: Party
  from: string; to: string
  opening: number
  rows: StatementRow[]
  totals: { debit: number; credit: number }
  closing: number
  /** open invoice balance by age (days since invoice) */
  ageing: { d0_30: number; d31_60: number; d61_90: number; d90: number }
  openInvoices: OpenInvoice[]
  /** unallocated receipts/payments (advances) */
  advances: number
  /** closing = Σ invoice due − advances; true when the ledger agrees with the invoice registers */
  reconciled: boolean
  invoiceDue: number
}

/** Treasury deposit (TR-6 challan) under an NBR economic code. */
export type TreasuryHead = "vat" | "vds" | "sd" | "interest" | "penalty" | "excise" | "devSurcharge" | "ictSurcharge" | "healthSurcharge" | "envSurcharge"
export type TreasuryMode = "cash" | "cheque" | "payOrder" | "draft" | "online"
export interface TreasuryDeposit {
  id: string
  /** TC-MMYY#### (internal number) */
  no: string
  head: TreasuryHead
  /** economic code, e.g. 1/1133/0015/0311 */
  code: string
  /** VAT return period the deposit counts toward (YYYY-MM) */
  taxPeriod: string
  challanNo: string
  challanDate: string
  mode: TreasuryMode
  bank: string; bankBranch: string; district: string; bankAddress?: string
  /** company bank account the money left (optional) */
  accountId?: string
  amount: number
  depositor: string; designation?: string; address: string
  description: string
  process: Process
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** VAT deducted at source: "purchase" = we withheld from a supplier (we issue Mushak 6.6); "sales" = a customer withheld from us (we receive 6.6). */
export type VdsMode = "purchase" | "sales"
export interface VdsEntry {
  id: string
  /** VDS-MMYY#### */
  no: string
  mode: VdsMode
  docId: string; docNo: string; challanNo: string; docDate: string
  partyId: string; partyName: string; partyBin: string; partyAddress: string
  /** value of the supply subject to VDS and the VAT charged on it */
  docValue: number; docVat: number
  amount: number
  certificateNo?: string
  certificateDate: string
  taxPeriod: string
  /** purchase VDS: treasury challan it was deposited with (optional) */
  treasuryId?: string; treasuryChallan?: string
  remark?: string
  /** part of `amount` that settled the invoice due when approved (reversed on cancel) */
  settled?: number
  process: Process
  issuedBy: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}
export interface VdsEligible { id: string; no: string; challanNo: string; date: string; partyId: string; partyName: string; value: number; vat: number; withheld: number; remaining: number }

/** Manual VAT adjustment feeding Mushak 9.1 notes 27 (increase), 32 (decrease) or the SD notes 38/39. */
export type AdjustmentKind = "otherIncrease" | "otherDecrease" | "sdIncrease" | "sdDecrease"
export interface VatAdjustment {
  id: string
  /** VA-MMYY#### */
  no: string
  kind: AdjustmentKind
  /** 9.1 note the amount lands in */
  note: 27 | 32 | 38 | 39
  issueDate: string
  taxPeriod: string
  amount: number
  description: string
  reference?: string
  process: Process
  issuedBy: string
  createdAt: string; updatedAt?: string; cancelReason?: string; history?: HistoryEntry[]
}

/** Mushak 9.1 VAT return. */
export type VatReturnType = "original" | "amended" | "full" | "late"
export type ReturnStatus = "draft" | "submitted"
export interface ReturnManual {
  /** notes 41–49 */
  interestVat: number; interestSd: number; penaltyLate: number; penaltyOther: number
  excise: number; devSurcharge: number; ictSurcharge: number; healthSurcharge: number; envSurcharge: number
  /** part 11 */
  refund: boolean; refundVat: number; refundSd: number
}
export type ReturnPart = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
export interface ReturnNote {
  note: number
  part: ReturnPart
  value?: number; sd?: number; vat?: number
  /** single-amount notes (parts 5–11) */
  amount?: number
  /** economic code (part 9) */
  code?: string
  /** has a sub-form (source documents) */
  drill?: boolean
  count?: number
}
export interface ReturnComputation {
  period: string
  notes: ReturnNote[]
  /** quick references */
  outputVat: number; inputVat: number; increasing: number; decreasing: number
  netVat: number; netVatAfter: number; netSd: number; netSdAfter: number
  payableVat: number; payableSd: number
  depositedVat: number; depositedSd: number
  closingVat: number; closingSd: number
  openingVat: number; openingSd: number
  /** dashboard-comparable net payable (output − input tax credit, before VDS / adjustments) */
  dashboardNet: number
  /** extra treasury deposit needed before the return can be submitted (0 when covered) */
  shortVat: number; shortSd: number
  /** documents dated in the period that are still drafts (not in the return) */
  drafts: number
}
export interface VatReturn {
  id: string
  period: string
  type: VatReturnType
  amendReason?: string
  activities: boolean
  submissionDate?: string
  status: ReturnStatus
  manual: ReturnManual
  /** frozen at submission */
  snapshot?: ReturnComputation
  submittedBy?: string; submittedAt?: string
  /** acknowledgement number from the NBR portal */
  ackNo?: string
  createdAt: string; updatedAt?: string; history?: HistoryEntry[]
}
export type VatReturnRow = VatReturn & { due: string; netPayable: number; deposited: number; closing: number; late: boolean }
export interface ReturnView extends VatReturnRow { computation: ReturnComputation; live: boolean; notStarted?: boolean }
/** One line of a 9.1 sub-form (the source documents behind a note). */
export interface SubFormRow { date: string; ref: string; refId?: string; href?: string; party?: string; bin?: string; value: number; sd?: number; vat: number; note?: string }

/** Tax period status for the compliance centre and the period lock. */
export interface TaxPeriod { period: string; due: string; status: "open" | "draft" | "submitted" | "overdue"; returnId?: string; submittedAt?: string; locked: boolean }

export interface VatSettings { zoneCode: string; updatedAt?: string; updatedBy?: string }

/** Compliance centre summary for one tax period. */
export interface ComplianceSummary {
  period: string; due: string; daysLeft: number; status: ReturnStatus; notStarted: boolean; locked: boolean
  submissionDate?: string; ackNo?: string
  computation: Pick<ReturnComputation, "outputVat" | "inputVat" | "increasing" | "decreasing" | "netVat" | "payableVat" | "payableSd" | "depositedVat" | "shortVat" | "shortSd" | "closingVat" | "openingVat" | "drafts">
  deposits: { count: number; amount: number; pending: number }
  vds: { toIssue: number; toIssueAmount: number; awaited: number; awaitedAmount: number }
  periods: TaxPeriod[]
}
export interface M610Row { sl: number; id: string; date: string; no: string; challanNo: string; party: string; address: string; bin: string; value: number; vat: number; total: number }
export interface Mushak610 {
  from: string; to: string; limit: number
  company: { name: string; address: string; bin: string }
  purchases: M610Row[]; sales: M610Row[]
  totals: Record<"purchases" | "sales", { value: number; vat: number; total: number }>
}
export interface SubForm { period: string; note: number; rows: SubFormRow[]; total: { value: number; sd: number; vat: number } }
