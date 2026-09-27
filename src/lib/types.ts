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
}

/** Party row in master-data lists, with document aggregates. */
export type PartyRow = Party & { docs: number; turnover: number; due: number; lastDate?: string }

export interface Item {
  id: string
  hsCode: string
  group: ItemGroup
  masterItem: string
  brand: string
  name: string
  unit: "Kg" | "Pcs" | "Roll" | "Meter"
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
}

export type HistoryAction = "created" | "edited" | "approved" | "cancelled" | "deleted" | "restored"
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
}

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
}

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

export type LedgerType = "opening" | "purchase" | "sale" | "prodReceive" | "prodIssue" | "damage"
export interface LedgerEntry {
  date: string
  type: LedgerType
  ref?: string
  refId?: string
  party?: string
  in: number
  out: number
  balance: number
  /** monthly summary rows until the Production module (R3) supplies documents */
  summary?: boolean
}
export interface ItemLedger { item: ItemWithStock; entries: LedgerEntry[]; totals: { in: number; out: number } }

/* ── Sprint 3 ─────────────────────────────────────────────────────────────── */

/** Audit trail (FE-S3-03). One event per state change or sign-in; `changes` holds field-level before/after. */
export type AuditEntity = "sale" | "purchase" | "customer" | "vendor" | "item" | "user" | "company" | "session"
export type AuditAction =
  | "created" | "edited" | "approved" | "cancelled" | "deleted" | "restored"
  | "updated" | "activated" | "deactivated" | "roleChanged" | "invited" | "passwordReset" | "passwordChanged"
  | "signedIn" | "signedOut" | "signInFailed"
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
