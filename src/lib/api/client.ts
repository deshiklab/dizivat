import type { AuditIntegrity, ExportRegister, ComplianceSummary, MoneyAccountRow, MoneyDoc, Mushak610, OpenInvoice, PartyStatement, ReturnView, SubForm, TaxPeriod, TreasuryDeposit, VatAdjustment, VatReturnRow, VatSettings, VdsEligible, VdsEntry, AccountingConfig, Batch, BomRow, CreditNote, Lot, ProductionConfig, SaleService, WorkOrder, AppNotification, AuditEvent, Branch, Company, Damage, DebitNote, MasterItemRow, MushakBook, OpeningEntry, ServiceType, StockRow, Transfer, UnitRow, DashboardData, Item, ItemLedger, ItemWithStock, ListParams, Page, Party, PartyRow, Purchase, Sale, SearchHit, TariffLine } from "../types"
import type { AccountInput, AccountingConfigInput, AdjustmentInput, MoneyInput, ReturnInput, TreasuryInput, VatSettingsInput, VdsInput, BatchInput, BatchReceiveInput, BomFormInput, CreditNoteInput, ProductionConfigInput, WorkOrderInput, CompanyInput, DamageInput, DebitNoteInput, ImportInput, MasterItemInput, OpeningInput, ItemInput, PartyInput, PasswordChange, PurchaseInput, SaleInput, TransferInput, UnitInput, UserInput } from "../schemas"
import type { Me, Preferences, SavedView, User } from "../auth/roles"
import type { PenaltyExposure, PenaltyQuote, SdEligible } from "../types"
import type { BackupRow, BackupStatus, BackupVerify, ImportEntity, ImportResult, Sale as R62Sale, SubconRegister, UdRecord, UdRegister, UdRow } from "../types"
import type { RealisationInput, UdInput } from "../schemas"
import type { UdFit } from "../rmg"
import { appPathname, appUrl } from "../base-path"

/**
 * Typed API client. Today it calls the Next.js mock handlers at /api/v1;
 * set NEXT_PUBLIC_API_BASE to the Symfony gateway (e.g. https://vat.example.com/api/v1) to switch.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/api/v1"

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors?: Record<string, string[]>) { super(message) }
}

export function qs(params: ListParams = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", accept: "application/json", ...init?.headers } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // Session expired mid-use → back to sign-in, returning here afterwards
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      const [, locale = "en", ...rest] = appPathname(window.location.pathname).split("/")
      const next = "/" + rest.join("/") + window.location.search
      window.location.assign(appUrl(`/${locale}/login?reason=expired&next=${encodeURIComponent(next)}`))
    }
    throw new ApiError(res.status, body.title ?? res.statusText, body.errors)
  }
  return res.json()
}

export type ListResult<T> = Page<T> & { facetLabels?: Record<string, Record<string, string>> }

type Party$ = "customers" | "vendors"
const parties = (kind: Party$) => ({
  /** Active parties for pickers */
  options: (q = "") => req<Party[]>(`/${kind}${qs({ q })}`),
  list: (p: ListParams) => req<ListResult<PartyRow>>(`/${kind}${qs({ ...p, view: "table" })}`),
  get: (id: string) => req<PartyRow>(`/${kind}/${id}`),
  create: (b: PartyInput) => req<Party>(`/${kind}`, { method: "POST", body: JSON.stringify(b) }),
  update: (id: string, b: PartyInput) => req<Party>(`/${kind}/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  remove: (id: string) => req<{ ok: true }>(`/${kind}/${id}`, { method: "DELETE" }),
  restore: (id: string) => req<Party>(`/${kind}/${id}/restore`, { method: "POST" }),
  csvUrl: (p: ListParams) => `${BASE}/${kind}${qs({ ...p, view: "table", page: undefined, size: undefined, format: "csv" })}`,
})

/** Standard document resource: list / get / create / update / approve-cancel / delete / CSV. */
function docResource<T, I, G = T>(path: string) {
  return {
    list: (p: ListParams) => req<ListResult<T>>(`${path}${qs(p)}`),
    get: (id: string) => req<G>(`${path}/${id}`),
    create: (b: I) => req<T>(path, { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: I) => req<T>(`${path}/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<T>(`${path}/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`${path}/${id}`, { method: "DELETE" }),
    csvUrl: (p: ListParams) => `${BASE}${path}${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  }
}

type StockDoc$ = "transfers" | "damage"
function stockDocs<T, I>(path: StockDoc$) {
  return {
    list: (p: ListParams) => req<ListResult<T>>(`/${path}${qs(p)}`),
    get: (id: string) => req<T>(`/${path}/${id}`),
    create: (b: I) => req<T>(`/${path}`, { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: I) => req<T>(`/${path}/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<T>(`/${path}/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/${path}/${id}`, { method: "DELETE" }),
    csvUrl: (p: ListParams) => `${BASE}/${path}${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  }
}

export type CancelBody = { process: "Cancelled"; reason: string } | { process: "Approved" }

export const api = {
  auth: {
    login: (b: { username: string; password: string; remember?: boolean }) => req<Me>("/auth/login", { method: "POST", body: JSON.stringify(b) }),
    logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  },
  me: {
    get: () => req<Me>("/me"),
    savePrefs: (p: Preferences) => req<Preferences>("/me/preferences", { method: "PUT", body: JSON.stringify(p) }),
    views: (table: string) => req<SavedView[]>(`/me/views${qs({ table })}`),
    saveView: (table: string, v: SavedView) => req<SavedView[]>("/me/views", { method: "POST", body: JSON.stringify({ table, ...v }) }),
    deleteView: (table: string, name: string) => req<SavedView[]>(`/me/views${qs({ table, name })}`, { method: "DELETE" }),
    changePassword: (b: PasswordChange) => req<Me>("/me/password", { method: "PUT", body: JSON.stringify(b) }),
  },
  users: {
    list: (p: ListParams) => req<ListResult<User>>(`/users${qs(p)}`),
    get: (id: string) => req<User>(`/users/${id}`),
    invite: (b: UserInput) => req<{ user: User; tempPassword: string }>("/users", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: Omit<UserInput, "username">) => req<User>(`/users/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    resetPassword: (id: string) => req<{ tempPassword: string }>(`/users/${id}/reset-password`, { method: "POST" }),
    csvUrl: (p: ListParams) => `${BASE}/users${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  company: {
    get: () => req<Company>("/company"),
    update: (b: CompanyInput) => req<Company>("/company", { method: "PUT", body: JSON.stringify(b) }),
  },
  tariff: {
    list: (p: ListParams) => req<ListResult<TariffLine> & { fy: string }>(`/tariff${qs({ ...p, view: "table" })}`),
    lookup: (hs: string) => req<TariffLine>(`/tariff${qs({ hs })}`),
    csvUrl: (p: ListParams) => `${BASE}/tariff${qs({ ...p, view: "table", page: undefined, size: undefined, format: "csv" })}`,
  },
  audit: {
    list: (p: ListParams) => req<ListResult<AuditEvent>>(`/audit${qs(p)}`),
    csvUrl: (p: ListParams) => `${BASE}/audit${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
    /** R6: verify the tamper-evident SHA-256 chain */
    verify: () => req<AuditIntegrity>("/audit/verify"),
  },
  notifications: {
    list: () => req<{ items: AppNotification[]; unread: number }>("/notifications"),
    read: (b: { ids: string[] } | { all: true }) => req<{ items: AppNotification[]; unread: number }>("/notifications/read", { method: "POST", body: JSON.stringify(b) }),
  },
  dashboard: () => req<DashboardData>("/dashboard"),
  search: (q: string) => req<SearchHit[]>(`/search${qs({ q })}`),
  sales: {
    list: (p: ListParams) => req<ListResult<Sale>>(`/sales${qs(p)}`),
    get: (id: string) => req<Sale>(`/sales/${id}`),
    create: (b: SaleInput) => req<Sale>("/sales", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: SaleInput) => req<Sale>(`/sales/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<Sale>(`/sales/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/sales/${id}`, { method: "DELETE" }),
    restore: (id: string) => req<Sale>(`/sales/${id}/restore`, { method: "POST" }),
    bulkApprove: (ids: string[]) => req<{ done: string[]; skipped: string[] }>("/sales/bulk", { method: "POST", body: JSON.stringify({ ids, action: "approve" }) }),
    csvUrl: (p: ListParams) => `${BASE}/sales${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  purchases: {
    list: (p: ListParams) => req<ListResult<Purchase>>(`/purchases${qs(p)}`),
    get: (id: string) => req<Purchase>(`/purchases/${id}`),
    create: (b: PurchaseInput | ImportInput) => req<Purchase>("/purchases", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: PurchaseInput | ImportInput) => req<Purchase>(`/purchases/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<Purchase>(`/purchases/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/purchases/${id}`, { method: "DELETE" }),
    restore: (id: string) => req<Purchase>(`/purchases/${id}/restore`, { method: "POST" }),
    bulkApprove: (ids: string[]) => req<{ done: string[]; skipped: string[] }>("/purchases/bulk", { method: "POST", body: JSON.stringify({ ids, action: "approve" }) }),
    csvUrl: (p: ListParams) => `${BASE}/purchases${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  items: {
    list: (p: ListParams) => req<ListResult<ItemWithStock>>(`/items${qs(p)}`),
    create: (b: ItemInput) => req<ItemWithStock>("/items", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: ItemInput) => req<ItemWithStock>(`/items/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    get: (id: string) => req<ItemWithStock>(`/items/${id}`),
    ledger: (id: string, branch?: string) => req<ItemLedger>(`/items/${id}/ledger${qs({ branch })}`),
    csvUrl: (p: ListParams) => `${BASE}/items${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  units: {
    list: (p: ListParams = {}) => req<ListResult<UnitRow>>(`/units${qs(p)}`),
    /** active units for pickers */
    options: () => req<ListResult<UnitRow>>(`/units${qs({ active: "1", size: 100 })}`).then((r) => r.data),
    create: (b: UnitInput) => req<UnitRow>("/units", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: UnitInput) => req<UnitRow>(`/units/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/units/${id}`, { method: "DELETE" }),
  },
  stock: {
    list: (p: ListParams) => req<ListResult<StockRow> & { branches: Branch[]; branchValue: Record<string, number> }>(`/stock${qs(p)}`),
    csvUrl: (p: ListParams) => `${BASE}/stock${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  transfers: stockDocs<Transfer, TransferInput>("transfers"),
  damage: stockDocs<Damage, DamageInput>("damage"),
  customers: parties("customers"),
  vendors: parties("vendors"),
  /* ── R2 ── */
  services: () => req<ServiceType[]>("/services"),
  returnable: (purchaseId: string, exclude?: string) => req<{ purchase: { id: string; invoiceNo: string; process: string; issueDate: string }; lines: Returnable[] }>(`/purchases/${purchaseId}/returnable${qs({ exclude })}`),
  debitNotes: {
    list: (p: ListParams) => req<ListResult<DebitNote>>(`/debit-notes${qs(p)}`),
    get: (id: string) => req<DebitNote>(`/debit-notes/${id}`),
    create: (b: DebitNoteInput) => req<DebitNote>("/debit-notes", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: DebitNoteInput) => req<DebitNote>(`/debit-notes/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<DebitNote>(`/debit-notes/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/debit-notes/${id}`, { method: "DELETE" }),
    csvUrl: (p: ListParams) => `${BASE}/debit-notes${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  opening: {
    list: (p: ListParams) => req<ListResult<OpeningEntry>>(`/opening-stock${qs(p)}`),
    get: (id: string) => req<OpeningEntry>(`/opening-stock/${id}`),
    create: (b: OpeningInput) => req<OpeningEntry>("/opening-stock", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: OpeningInput) => req<OpeningEntry>(`/opening-stock/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    setProcess: (id: string, b: CancelBody) => req<OpeningEntry>(`/opening-stock/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
    remove: (id: string) => req<{ ok: true }>(`/opening-stock/${id}`, { method: "DELETE" }),
    csvUrl: (p: ListParams) => `${BASE}/opening-stock${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  masterItems: {
    list: (p: ListParams) => req<ListResult<MasterItemRow>>(`/master-items${qs(p)}`),
    options: () => req<ListResult<MasterItemRow>>(`/master-items${qs({ status: "active", size: 200 })}`).then((r) => r.data),
    get: (id: string) => req<MasterItemRow & { skus: ItemWithStock[] }>(`/master-items/${id}`),
    create: (b: MasterItemInput) => req<MasterItemRow>("/master-items", { method: "POST", body: JSON.stringify(b) }),
    update: (id: string, b: MasterItemInput) => req<MasterItemRow>(`/master-items/${id}`, { method: "PUT", body: JSON.stringify(b) }),
    csvUrl: (p: ListParams) => `${BASE}/master-items${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
  },
  /* ── R3 ── */
  saleServices: () => req<SaleService[]>("/sale-services"),
  creditable: (saleId: string, exclude?: string) => req<{ sale: { id: string; invoiceNo: string; process: string; issueDate: string; customerName: string; category: string }; lines: Creditable[] }>(`/sales/${saleId}/creditable${qs({ exclude })}`),
  creditNotes: docResource<CreditNote, CreditNoteInput>("/credit-notes"),
  production: {
    boms: docResource<BomRow, BomFormInput, BomRow & { versions: BomRow[] }>("/production/boms"),
    workOrders: docResource<WorkOrder, WorkOrderInput, WorkOrder & { batches: WorkOrderBatch[] }>("/production/work-orders"),
    batches: {
      ...docResource<Batch, BatchInput>("/production/batches"),
      receive: (id: string, b: BatchReceiveInput) => req<Batch>(`/production/batches/${id}/receive`, { method: "POST", body: JSON.stringify(b) }),
    },
    config: () => req<ProductionConfig>("/production/config"),
    saveConfig: (b: ProductionConfigInput) => req<ProductionConfig>("/production/config", { method: "PUT", body: JSON.stringify(b) }),
    lots: (item: string, exclude?: string) => req<Lot[]>(`/production/lots${qs({ item, exclude })}`),
    /** R6.2 (RMG): subcontracting register (contractual batches, Mushak 6.4) */
    subcontract: (p: { from: string; to: string; status?: string; days?: number }) => req<SubconRegister>(`/production/subcontract${qs(p)}`),
    subcontractCsvUrl: (p: { from: string; to: string; status?: string; days?: number }) => `${BASE}/production/subcontract${qs({ ...p, format: "csv" })}`,
  },
  mushak: {
    book: (form: "6.1" | "6.2" | "6.2.1", p: { item: string; from: string; to: string }) => req<MushakBook>(`/mushak/${form}${qs(p)}`),
    csvUrl: (form: "6.1" | "6.2" | "6.2.1", p: { item: string; from: string; to: string }) => `${BASE}/mushak/${form}${qs({ ...p, format: "csv" })}`,
    m610: (p: { from: string; to: string }) => req<Mushak610>(`/mushak/6.10${qs(p)}`),
    m610CsvUrl: (p: { from: string; to: string }) => `${BASE}/mushak/6.10${qs({ ...p, format: "csv" })}`,
  },
  /* ── R4 ── */
  accounting: {
    accounts: {
      list: (p: ListParams) => req<ListResult<MoneyAccountRow>>(`/accounting/accounts${qs(p)}`),
      /** active accounts for pickers */
      options: () => req<ListResult<MoneyAccountRow>>(`/accounting/accounts${qs({ status: "active", size: 100 })}`).then((r) => r.data),
      get: (id: string) => req<MoneyAccountRow>(`/accounting/accounts/${id}`),
      create: (b: AccountInput) => req<MoneyAccountRow>("/accounting/accounts", { method: "POST", body: JSON.stringify(b) }),
      update: (id: string, b: AccountInput) => req<MoneyAccountRow>(`/accounting/accounts/${id}`, { method: "PUT", body: JSON.stringify(b) }),
      remove: (id: string) => req<{ ok: true }>(`/accounting/accounts/${id}`, { method: "DELETE" }),
      csvUrl: (p: ListParams) => `${BASE}/accounting/accounts${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
    },
    receipts: docResource<MoneyDoc, MoneyInput>("/accounting/receipts"),
    payments: docResource<MoneyDoc, MoneyInput>("/accounting/payments"),
    openInvoices: (kind: "receipt" | "payment", party: string) => req<OpenInvoice[]>(`/accounting/open-invoices${qs({ kind, party })}`),
    statement: (p: { kind: "customer" | "vendor"; party: string; from: string; to: string }) => req<PartyStatement>(`/accounting/statement${qs(p)}`),
    statementCsvUrl: (p: { kind: "customer" | "vendor"; party: string; from: string; to: string }) => `${BASE}/accounting/statement${qs({ ...p, format: "csv" })}`,
    config: () => req<AccountingConfig>("/accounting/config"),
    saveConfig: (b: AccountingConfigInput) => req<AccountingConfig>("/accounting/config", { method: "PUT", body: JSON.stringify(b) }),
  },
  vat: {
    treasury: docResource<TreasuryDeposit, TreasuryInput>("/vat/treasury"),
    vds: docResource<VdsEntry, VdsInput>("/vat/vds"),
    vdsEligible: (mode: "purchase" | "sales", exclude?: string) => req<VdsEligible[]>(`/vat/vds/eligible${qs({ mode, exclude })}`),
    adjustments: docResource<VatAdjustment, AdjustmentInput>("/vat/adjustments"),
    /** R6.3: SD-paid purchase lines and their six-month export window (note 40) */
    sdEligible: (exclude?: string) => req<SdEligible>(`/vat/sd-eligible${qs({ exclude })}`),
    /** R6.3: §127 interest + late-return penalty — exposure (no period) or a what-if quote for one period */
    penaltyExposure: () => req<PenaltyExposure>("/vat/penalty"),
    penalty: (p: { period: string; vat?: number; sd?: number; paidOn?: string; filedOn?: string; latePenalty?: number }) =>
      req<PenaltyQuote>(`/vat/penalty${qs({ period: p.period, vat: p.vat, sd: p.sd, paidOn: p.paidOn, filedOn: p.filedOn, latePenalty: p.latePenalty })}`),
    returns: {
      list: (p: ListParams) => req<ListResult<VatReturnRow> & { periods: TaxPeriod[] }>(`/vat/returns${qs(p)}`),
      get: (period: string) => req<ReturnView>(`/vat/returns/${period}`),
      start: (period: string) => req<ReturnView>("/vat/returns", { method: "POST", body: JSON.stringify({ period }) }),
      update: (period: string, b: ReturnInput) => req<ReturnView>(`/vat/returns/${period}`, { method: "PUT", body: JSON.stringify(b) }),
      submit: (period: string) => req<ReturnView>(`/vat/returns/${period}`, { method: "PATCH", body: JSON.stringify({ action: "submit" }) }),
      remove: (period: string) => req<{ ok: true }>(`/vat/returns/${period}`, { method: "DELETE" }),
      note: (period: string, note: number) => req<SubForm>(`/vat/returns/${period}/notes/${note}`),
      noteCsvUrl: (period: string, note: number) => `${BASE}/vat/returns/${period}/notes/${note}?format=csv`,
      csvUrl: (p: ListParams) => `${BASE}/vat/returns${qs({ ...p, page: undefined, size: undefined, format: "csv" })}`,
    },
    periods: () => req<TaxPeriod[]>("/vat/periods"),
    compliance: (period?: string) => req<ComplianceSummary>(`/vat/compliance${qs({ period })}`),
    settings: () => req<VatSettings>("/vat/settings"),
    saveSettings: (b: VatSettingsInput) => req<VatSettings>("/vat/settings", { method: "PUT", body: JSON.stringify(b) }),
    /** R6 (RMG): export & deemed-export register */
    exports: (p: { from: string; to: string; kind?: string; risk?: string; proceeds?: string }) => req<ExportRegister>(`/vat/exports${qs(p)}`),
    exportsCsvUrl: (p: { from: string; to: string; kind?: string; risk?: string; proceeds?: string }) => `${BASE}/vat/exports${qs({ ...p, format: "csv" })}`,
    /** R6.2 (RMG): UD / UP register and bond licence watch-list */
    uds: {
      register: (customer?: string) => req<UdRegister>(`/vat/uds${qs({ customer })}`),
      csvUrl: () => `${BASE}/vat/uds?format=csv`,
      get: (id: string) => req<UdRow>(`/vat/uds/${id}`),
      create: (b: UdInput) => req<UdRecord>("/vat/uds", { method: "POST", body: JSON.stringify(b) }),
      update: (id: string, b: UdInput) => req<UdRow>(`/vat/uds/${id}`, { method: "PUT", body: JSON.stringify(b) }),
      remove: (id: string) => req<{ ok: true }>(`/vat/uds/${id}`, { method: "DELETE" }),
      fit: (b: { saleId?: string; customerId: string; issueDate: string; udNo?: string; lines: { itemId: string; qty: number }[] }) => req<UdFit | null>("/vat/uds/fit", { method: "POST", body: JSON.stringify(b) }),
    },
    /** R6.2 (RMG): export proceeds realised (PRC) */
    realise: (saleId: string, b: RealisationInput) => req<R62Sale>(`/sales/${saleId}/realisations`, { method: "POST", body: JSON.stringify(b) }),
    unrealise: (saleId: string, rid: string) => req<R62Sale>(`/sales/${saleId}/realisations${qs({ rid })}`, { method: "DELETE" }),
  },
  /* ── R6.2 (NBR enlistment) ── */
  backups: {
    status: () => req<BackupStatus>("/backups"),
    create: () => req<BackupRow>("/backups", { method: "POST" }),
    verify: (id: string) => req<BackupVerify>(`/backups/${id}/verify`, { method: "POST" }),
    downloadUrl: (id: string) => `${BASE}/backups/${id}`,
  },
  import: {
    run: (b: { entity: ImportEntity; dryRun: boolean; rows: Record<string, unknown>[] }) => req<ImportResult>("/import", { method: "POST", body: JSON.stringify(b) }),
  },
}

export interface Returnable { itemId: string; name: string; hsCode: string; uom: string; price: number; sdRate: number; vatRate: number; purchasedQty: number; returnedQty: number; remaining: number; import: boolean }

export interface Creditable { itemId: string; name: string; hsCode: string; uom: string; price: number; sdRate: number; vatRate: number; soldQty: number; returnedQty: number; remaining: number }
export interface WorkOrderBatch { id: string; no: string; mode: Batch["mode"]; issueDate: string; process: Batch["process"]; totalIssue: number; totalReceive: number }

export type { Item }
