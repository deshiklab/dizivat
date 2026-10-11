/**
 * R6.2 shared logic for the mock API (the PostgreSQL build runs the same code through the compat layer, except the
 * backups, which the native backup module owns, and the subcontracting register, whose rows the native API derives
 * from the batches' own table since R5.5 — the rules below are the ones it calls).
 *  - RMG: UD / UP register with bond licence watch-list, subcontracting (Mushak 6.4) register
 *  - NBR enlistment: bulk master-data import, database backups (GO 16/Mushak/2019: at least two a day)
 */
import { BACKUP_FORMAT, BACKUP_KEEP, BACKUP_SLOTS, dhakaDayOf, lastSlot, nextSlot } from "@/lib/backup-schedule"
import { db } from "@/lib/mock/db"
import { auditStore } from "@/lib/mock/audit"
import { userStore } from "@/lib/mock/users"
import { COMPANY } from "@/lib/company"
import { bondRows, daysBetween, registerFrom, udAmendment, udFitForSale, udRow, UD_WARN_PCT } from "@/lib/rmg"
import { z } from "zod"
import { itemInput, partyInput, type UdParsed } from "@/lib/schemas"
import type {
  AuditChange, BackupRow, BackupStatus, Batch, ImportEntity, ImportIssue, ImportResult, Item, Party, Sale, SubconProcess,
  SubconRegister, SubconRow, UdLine, UdRecord, UdRegister, UdRow, VatSettings, RestoreDrill,
} from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import { round2 } from "@/lib/vat"
import { badUnit } from "@/lib/mock/units"
import { diff as auditDiff } from "@/lib/mock/audit"
import { buildItem, newItemId } from "./_items"
import { invalidRule, type RuleProblem } from "./_lib"
import { newPartyId } from "./_parties"

/* ── UD / UP register ─────────────────────────────────────────────────────── */

/** What the UD register reads and writes: the declarations, the invoices that draw on them, the exporters and the SKUs. */
export type UdSource = { uds: UdRecord[]; sales: Sale[]; customers: Party[]; items: Item[] }
/** The company block the register's bond watch-list is built from: the licence the NBR profile carries. */
export type UdHead = { name: string; profile: VatSettings["profile"] }

/** The register: every exporter's declarations with the quantities already supplied, plus the bond licence watch-list. */
export function udRegister(today: string, customerId?: string, src: UdSource = db,
  head: UdHead = { name: COMPANY.name, profile: db.vatSettings.profile }): UdRegister {
  const rows = src.uds
    .filter((u) => !customerId || u.customerId === customerId)
    .map((u) => udRow(u, src.sales, today))
    .sort((a, b) => b.date.localeCompare(a.date) || a.no.localeCompare(b.no))
  const p = head.profile
  const own = p && (p.bondLicenseNo || p.segment === "rmgDirect" || p.segment === "rmgComposite")
    ? { name: head.name, licenceNo: p.bondLicenseNo, expiry: p.bondLicenseExpiry } : null
  const bonds = bondRows(own, src.customers.filter((c) => c.active !== false), today)
  return {
    rows, bonds,
    totals: {
      active: rows.filter((r) => r.state === "ok" || r.state === "warn").length,
      warn: rows.filter((r) => r.state === "warn" || r.state === "exhausted").length,
      over: rows.filter((r) => r.state === "over").length,
      expired: rows.filter((r) => r.state === "expired").length,
    },
  }
}
export { UD_WARN_PCT }

/** The columns the register's CSV prints — one row per input of every declaration. */
export const udCsvColumns = [
  { key: "no", label: "UD / UP No" }, { key: "kind", label: "Type" }, { key: "date", label: "Date" }, { key: "expiry", label: "Expiry" },
  { key: "customer", label: "Exporter" }, { key: "bin", label: "BIN" }, { key: "masterLcNo", label: "Export LC / contract" },
  { key: "name", label: "Item" }, { key: "hsCode", label: "HS code" }, { key: "uom", label: "Unit" }, { key: "qty", label: "UD quantity" },
  { key: "used", label: "Supplied" }, { key: "remaining", label: "Remaining" }, { key: "pct", label: "Used %" }, { key: "state", label: "Status" },
]
/** …and the rows: every line of every declaration in it. */
export const udCsvRows = (reg: UdRegister) =>
  reg.rows.flatMap((u) => u.lines.map((l) => ({ ...l, no: u.no, kind: u.kind, date: u.date, expiry: u.expiry, customer: u.customerName, bin: u.customerBin, masterLcNo: u.masterLcNo, state: u.state })))

/** Business rules for create / update: the customer must be an exporter, items must exist, numbers unique per customer. */
export function udCheck(d: UdParsed, selfId?: string, src: UdSource = db): { errors?: Record<string, string[]>; customer?: Party; lines?: UdLine[] } {
  const errors: Record<string, string[]> = {}
  const customer = src.customers.find((c) => c.id === d.customerId)
  if (!customer) errors.customerId = ["unknown"]
  else if (!customer.exporterType) errors.customerId = ["notExporter"]
  const no = d.no.trim().toUpperCase()
  if (src.uds.some((u) => u.id !== selfId && u.customerId === d.customerId && u.no.trim().toUpperCase() === no)) errors.no = ["duplicate"]
  const lines: UdLine[] = []
  d.lines.forEach((l, i) => {
    const it = src.items.find((x) => x.id === l.itemId)
    if (!it) { errors[`lines.${i}.itemId`] = ["unknown"]; return }
    lines.push({ itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty, ...(l.value != null && Number.isFinite(l.value) ? { value: Math.round(l.value * 100) / 100 } : {}) })
  })
  return Object.keys(errors).length ? { errors } : { customer, lines }
}

/** Quantity of a UD line already supplied on approved / draft invoices (a UD whose lines are in use cannot be deleted). */
export const udInUse = (udNo: string, customerId: string, sales: Sale[] = db.sales) =>
  sales.some((s) => s.customerId === customerId && s.process !== "Cancelled" && s.export?.deemed && (s.export.udNo ?? "").trim().toUpperCase() === udNo.trim().toUpperCase())

/** The id the next declaration takes — the mock's own counter, which the API keeps in the snapshot with the rest of `db.seq`. */
export const newUdId = (stamp: string) => `ud${++db.seq.ud}-${stamp}`

/** What a write hands back: the declaration as it stands, what the register shows, and what the audit trail should say. */
export type UdWrite = RuleProblem | {
  ud: UdRecord; row: UdRow
  action: "created" | "edited" | "deleted"; ref: string; changes?: AuditChange[]; note?: string
}

/**
 * Creating one: the rules above, then the document itself — the number in capitals, its inputs priced from the SKUs'
 * own names and units, and the history entry that opens it. Pushed into `src`, which is the mock's array or, in the
 * API, the rows that carry the collection.
 */
export function udCreate(d: UdParsed, user: User, today: string, src: UdSource = db, stamp = Date.now().toString(36)): UdWrite {
  const c = udCheck(d, undefined, src)
  if (c.errors) return { status: 422, title: "Validation failed", errors: c.errors }
  const at = new Date().toISOString()
  const ud: UdRecord = {
    id: newUdId(stamp), no: d.no.trim().toUpperCase(), kind: d.kind, date: d.date, expiry: d.expiry,
    customerId: c.customer!.id, customerName: c.customer!.name, customerBin: c.customer!.bin, masterLcNo: d.masterLcNo, buyer: d.buyer || undefined,
    lines: c.lines!, status: d.status, note: d.note || undefined, masterLcValue: d.masterLcValue, currency: d.currency, createdBy: user.name, createdAt: at,
    history: [{ at, by: user.name, action: "created" }],
  }
  src.uds.push(ud)
  return { ud, row: udRow(ud, src.sales, today), action: "created", ref: `${ud.no} · ${ud.customerName}` }
}

/**
 * Editing one — the exporter's customer and the number cannot change once the UD is used on an invoice, and a line
 * cannot drop below what was already supplied. A change of quantities or of the LC value is an amendment
 * (BGMEA / BKMEA amendment certificate), and once the UD is in use the amendment needs its reason: the date must be
 * the UD's own day or later, and not in the future. A line or the LC value sent without a value keeps the one on
 * file — clearing one needs an explicit 0.
 */
export function udUpdate(u: UdRecord, d: UdParsed, user: User, today: string, src: UdSource = db): UdWrite {
  const c = udCheck(d, u.id, src)
  if (c.errors) return { status: 422, title: "Validation failed", errors: c.errors }
  const row = udRow(u, src.sales, today)
  const used = row.lines.some((l) => l.used > 0) || udInUse(u.no, u.customerId, src.sales)
  if (used && (d.customerId !== u.customerId || d.no.trim().toUpperCase() !== u.no))
    return { status: 422, title: "Validation failed", errors: { [d.customerId !== u.customerId ? "customerId" : "no"]: ["udInUse"] } }
  const errors: Record<string, string[]> = {}
  row.lines.forEach((l) => {
    const i = d.lines.findIndex((x) => x.itemId === l.itemId)
    if (l.used > 0 && (i < 0 || d.lines[i].qty < l.used)) errors[i < 0 ? "lines" : `lines.${i}.qty`] = ["belowUsed"]
  })
  for (const l of c.lines!) if (l.value == null) { const old = u.lines.find((x) => x.itemId === l.itemId)?.value; if (old != null) l.value = old }
  if (d.masterLcValue == null) d.masterLcValue = u.masterLcValue
  const amendment = udAmendment(u, c.lines!, d.masterLcValue, { reason: d.amendReason, date: d.amendDate || today, by: user.name })
  if (amendment) {
    if (used && !amendment.reason) errors.amendReason = ["amendmentReason"]
    if (amendment.date < u.date) errors.amendDate = ["beforeIssue"]
    else if (amendment.date > today) errors.amendDate = ["future"]
  }
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const before = { ...u, lines: JSON.stringify(u.lines.map((l) => [l.itemId, l.qty, l.value ?? null])) }
  const at = new Date().toISOString()
  Object.assign(u, {
    no: d.no.trim().toUpperCase(), kind: d.kind, date: d.date, expiry: d.expiry, customerId: c.customer!.id, customerName: c.customer!.name, customerBin: c.customer!.bin,
    masterLcNo: d.masterLcNo, buyer: d.buyer || undefined, lines: c.lines!, status: d.status, note: d.note || undefined, updatedAt: at,
    masterLcValue: d.masterLcValue, currency: d.currency,
  })
  if (amendment) (u.amendments ??= []).push({ ...amendment, at })
  const after = { ...u, lines: JSON.stringify(u.lines.map((l) => [l.itemId, l.qty, l.value ?? null])) }
  const changes = auditDiff(before, after, ["no", "kind", "date", "expiry", "masterLcNo", "masterLcValue", "buyer", "status", "lines", "note"])
  ;(u.history ??= []).push({ at, by: user.name, action: "edited", note: amendment ? `Amendment ${amendment.no}${amendment.reason ? ` — ${amendment.reason}` : ""}` : changes.map((x) => x.field).join(", ") || undefined })
  return { ud: u, row: udRow(u, src.sales, today), action: "edited", ref: `${u.no} · ${u.customerName}`, changes,
    note: amendment ? `Amendment ${amendment.no}${amendment.reason ? ` — ${amendment.reason}` : ""}` : undefined }
}

/** Deleting one: only a UD no invoice refers to can go (otherwise close it). */
export function udRemove(u: UdRecord, src: UdSource = db): UdWrite {
  if (udInUse(u.no, u.customerId, src.sales)) return { status: 409, title: "udInUse" }
  src.uds.splice(src.uds.indexOf(u), 1)
  return { ud: u, row: udRow(u, src.sales, ""), action: "deleted", ref: `${u.no} · ${u.customerName}` }
}

/** One UD as the register and the invoice view see it — its lines with what the invoices have drawn on them. */
export const udAnswer = (u: UdRecord, today: string, src: UdSource = db) => udRow(u, src.sales, today)

/** What the fit question may be given: the exporter, the invoice's date, its lines, and the UD number it cites. */
export const udFitInput = z.object({
  saleId: z.string().optional(), customerId: z.string().min(1), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  udNo: z.string().optional().default(""),
  lines: z.array(z.object({ itemId: z.string(), qty: z.number() })).default([]),
})

/** R6.2: does this deemed-export invoice fit inside the exporter's UD? Read-only, asked live by the sales form. */
export function udFitAnswer(body: { saleId?: string; customerId: string; issueDate: string; udNo?: string; lines: { itemId: string; qty: number }[] },
  src: UdSource = db) {
  return udFitForSale({ id: body.saleId ?? "", customerId: body.customerId, issueDate: body.issueDate, lines: body.lines as never,
    export: { deemed: true, udNo: body.udNo ?? "" } as never }, src.uds, src.sales)
}

/* ── Subcontracting (Mushak 6.4) register ─────────────────────────────────── */

export const SUBCON_OVERDUE_DAYS = 30

export function subconRegister(from: string, to: string, today: string, overdueDays = SUBCON_OVERDUE_DAYS, src: Batch[] = db.batches): SubconRegister {
  const rows: SubconRow[] = src
    .filter((b) => b.mode === "contractual" && b.issueDate >= from && b.issueDate <= to)
    .map((b) => subconRow(b, today, overdueDays))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.no.localeCompare(a.no))
  const live = rows.filter((r) => r.status === "atContractor" || r.status === "partial" || r.status === "overdue")
  return {
    from, to, overdueDays, rows,
    totals: {
      atContractor: live.length,
      pendingValue: round2(live.reduce((a, r) => a + r.materialValue * (r.issued ? r.pending / r.issued : 0), 0)),
      overdue: rows.filter((r) => r.status === "overdue").length,
      returned: rows.filter((r) => r.status === "returned").length,
    },
  }
}

/** A date the register accepts: `YYYY-MM-DD`, as the mock's own route checked it. */
const SUBCON_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * What the subcontracting register answers for (R5.5: as data, so the API's native register answers with the same
 * 422 body): the range — by default the fiscal year the RMG registers run on, which `registerFrom` works out — the
 * overdue threshold in days, and the state `?status=` keeps.
 */
export function subconParams(sp: URLSearchParams, today: string): RuleProblem | { from: string; to: string; days: number; only: string | null } {
  const from = sp.get("from") || registerFrom(today)
  const to = sp.get("to") || today
  if (!SUBCON_DATE.test(from) || !SUBCON_DATE.test(to)) return invalidRule({ [SUBCON_DATE.test(from) ? "to" : "from"]: ["date"] })
  if (to < from) return invalidRule({ to: ["toBeforeFrom"] })
  const days = Math.min(365, Math.max(1, Number(sp.get("days")) || SUBCON_OVERDUE_DAYS))
  return { from, to, days, only: sp.get("status") }
}

/** The rows the register answers with: `?status=` keeps one state of the challan. */
export const subconRows = (reg: SubconRegister, only: string | null): SubconRow[] =>
  only ? reg.rows.filter((r) => r.status === only) : reg.rows

/** The register's CSV: one row per challan — sent and returned, what is pending, and for how long. */
export const SUBCON_CSV_COLUMNS = [
  { key: "no", label: "Batch No" }, { key: "issueDate", label: "Sent" }, { key: "receiveDate", label: "Returned" }, { key: "vendorName", label: "Contractor" },
  { key: "vendorBin", label: "BIN" }, { key: "process", label: "Process" }, { key: "issued", label: "Qty sent" }, { key: "received", label: "Qty returned" },
  { key: "damaged", label: "Wastage" }, { key: "pending", label: "Pending" }, { key: "days", label: "Days" }, { key: "materialValue", label: "Material value" },
  { key: "value", label: "Finished value" }, { key: "status", label: "Status" },
]
export const subconCsvName = (from: string, to: string) => `subcontract-register-${from}-${to}.csv`

function subconRow(b: Batch, today: string, overdueDays: number): SubconRow {
  const issued = b.totalIssue, received = b.totalReceive, damaged = b.totalDamage
  const pending = Math.max(0, round2(issued - received - damaged))
  const end = b.receivedAt ? b.receivedAt.slice(0, 10) : today
  const days = Math.max(0, daysBetween(b.issueDate, end))
  const status: SubconRow["status"] = b.process === "Cancelled" ? "cancelled" : b.process === "Created" ? "draft"
    : b.receivedAt && pending <= 1e-9 ? "returned"
    : days > overdueDays ? "overdue"
    : received > 0 ? "partial" : "atContractor"
  return {
    id: b.id, no: b.no, issueDate: b.issueDate, receiveDate: b.receivedAt?.slice(0, 10) ?? b.receiveDate, vendorId: b.vendorId,
    vendorName: b.vendorName ?? "", vendorBin: b.vendorBin ?? "", process: (b.jobProcess ?? "manufacture") as SubconProcess, state: b.process,
    materialValue: b.materialValue, value: b.value, issued, received, damaged, pending, days, status,
  }
}

/* ── Bulk import (items, customers, vendors) ──────────────────────────────── */

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim())
const num = (v: unknown, dflt: number) => { const s = str(v).replace(/,/g, ""); if (!s) return dflt; const n = Number(s); return Number.isFinite(n) ? n : NaN }
const bool = (v: unknown, dflt: boolean) => { const s = str(v).toLowerCase(); return !s ? dflt : !["0", "no", "false", "n", "inactive", "না"].includes(s) }
const GROUPS: Record<string, Item["group"]> = { raw: "Raw Material", "raw material": "Raw Material", consumable: "Consumable", packing: "Packing Materials", "packing materials": "Packing Materials", "packing material": "Packing Materials", finished: "Finished Goods", "finished goods": "Finished Goods" }

/** Units are matched case-insensitively against the Units master ("pcs" → "Pcs"). */
const unitCode = (u: string) => db.units.find((x) => x.code.toLowerCase() === u.toLowerCase())?.code ?? u
/** Map one spreadsheet row (header names already normalised to field names) to the item create payload. */
function itemPayload(r: Record<string, unknown>) {
  const hs = str(r.hsCode).replace(/\D/g, "")
  return {
    name: str(r.name), hsCode: hs.length === 10 ? hs.slice(0, 8) : hs, group: GROUPS[str(r.group).toLowerCase()] ?? str(r.group),
    unit: unitCode(str(r.unit)), sku: str(r.sku).toUpperCase(),
    purchasePrice: num(r.purchasePrice, 0), salePrice: num(r.salePrice, 0), vatRate: num(r.vatRate, 15), sdRate: num(r.sdRate, 0),
    reorderLevel: num(r.reorderLevel, 0), active: bool(r.active, true),
  }
}
function partyPayload(r: Record<string, unknown>) {
  const mode = str(r.mode) || "Local"
  const ex = str(r.exporterType).toLowerCase()
  return {
    name: str(r.name), mode: mode[0].toUpperCase() + mode.slice(1).toLowerCase(), bin: str(r.bin), country: str(r.country), mobile: str(r.mobile),
    email: str(r.email), contactPerson: str(r.contactPerson), address: str(r.address), active: bool(r.active, true),
    exporterType: ex === "direct" || ex === "deemed" ? ex : "", bondLicenseNo: str(r.bondLicenseNo), bondLicenseExpiry: str(r.bondLicenseExpiry), associationNo: str(r.associationNo),
  }
}

/**
 * Validates every row; rows that already exist (same SKU / same BIN or name) are skipped as duplicates, not errors.
 * All-or-nothing: with any issue nothing is created. dryRun only reports.
 */
/** What a bulk import reads and writes: the SKUs and the two party books. */
export type ImportSource = { items: Item[]; customers: Party[]; vendors: Party[] }

export function bulkImport(entity: ImportEntity, rows: Record<string, unknown>[], dryRun: boolean, actor: User,
  audit: (e: { entity: "item" | "customer" | "vendor" | "import"; entityId?: string; ref: string; note?: string }) => void,
  /** the collections the rows are checked against and created in — the mock's arrays, or the API's tables */
  src?: ImportSource): ImportResult {
  const world = src ?? (db as unknown as ImportSource)
  const issues: ImportIssue[] = []
  const toCreate: (() => void)[] = []
  let duplicates = 0
  const seen = new Set<string>()
  rows.forEach((raw, i) => {
    const row = i + 2 // spreadsheet row number (row 1 = header)
    if (entity === "items") {
      const p = itemPayload(raw)
      const parsed = itemInput.safeParse(p)
      if (!parsed.success) { for (const is of parsed.error.issues) issues.push({ row, field: is.path.join(".") || "_", message: is.message }); return }
      const d = parsed.data
      const key = d.sku.toLowerCase()
      if (seen.has(key)) { issues.push({ row, field: "sku", message: "duplicateInFile" }); return }
      seen.add(key)
      if (badUnit(d.unit)) { issues.push({ row, field: "unit", message: "unknownUnit" }); return }
      if (world.items.some((x) => x.sku.toLowerCase() === key)) { duplicates++; return }
      toCreate.push(() => {
        // the same stored shape the item form produces (R5.2: shared with the native handlers through _items.ts)
        const it = buildItem(d, d.name.split(" ")[0], newItemId(String(i)))
        world.items.push(it)
        audit({ entity: "item", entityId: it.id, ref: `${it.sku} · ${it.name}`, note: "Bulk import" })
      })
    } else {
      const k = entity === "customers" ? "customer" : "vendor"
      const parsed = partyInput.safeParse(partyPayload(raw))
      if (!parsed.success) { for (const is of parsed.error.issues) issues.push({ row, field: is.path.join(".") || "_", message: is.message }); return }
      const d = parsed.data
      if (k === "customer" && d.mode === "Non-registered") { issues.push({ row, field: "mode", message: "customerMode" }); return }
      const name = d.name.toUpperCase(), bin = d.bin.replace(/^NID /, "")
      const key = bin ? `b:${bin}` : `n:${name}`
      if (seen.has(key) || seen.has(`n:${name}`)) { issues.push({ row, field: bin ? "bin" : "name", message: "duplicateInFile" }); return }
      seen.add(key); seen.add(`n:${name}`)
      const coll = k === "customer" ? world.customers : world.vendors
      if (coll.some((p) => (bin && p.bin.replace(/^NID /, "") === bin) || p.name.trim().toUpperCase() === name)) { duplicates++; return }
      toCreate.push(() => {
        const { exporterType, bondLicenseNo, bondLicenseExpiry, associationNo, ...rest } = d
        const p: Party = {
          ...rest, name, id: newPartyId(k, String(i)), kind: k,
          bin: d.mode === "Non-registered" && d.bin && !d.bin.startsWith("NID ") ? `NID ${d.bin}` : d.bin,
          country: d.mode === "Foreign" ? d.country : undefined,
          exporterType: exporterType || undefined, bondLicenseNo: bondLicenseNo || undefined, bondLicenseExpiry: bondLicenseExpiry || undefined, associationNo: associationNo || undefined,
        }
        coll.push(p)
        audit({ entity: k, entityId: p.id, ref: p.name, note: "Bulk import" })
      })
    }
  })
  const valid = rows.length - new Set(issues.map((x) => x.row)).size
  const ok = issues.length === 0
  if (ok && !dryRun && toCreate.length) {
    toCreate.forEach((f) => f())
    audit({ entity: "import", ref: `${entity} · ${toCreate.length} created`, note: `${rows.length} rows, ${duplicates} already on file (skipped)` })
  }
  void actor
  return { entity, dryRun, total: rows.length, valid, created: ok && !dryRun ? toCreate.length : 0, duplicates, issues: issues.slice(0, 500) }
}

/* ── Backups (mock: in memory; the PostgreSQL build stores them in the backups table) ── */

export { BACKUP_KEEP, BACKUP_SLOTS, lastSlot, nextSlot } from "@/lib/backup-schedule"
interface Stored extends BackupRow { data: Uint8Array }
const bstore = (globalThis as unknown as { __dzBackups?: { rows: Stored[]; seq: number } }).__dzBackups ??= { rows: [], seq: 0 }

async function sha256(b: Uint8Array) {
  const h = await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("")
}
async function gzip(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip")
  const out = new Blob([text]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export function snapshotTables(): Record<string, unknown[]> {
  const t: Record<string, unknown[]> = {}
  for (const [k, v] of Object.entries(db)) if (Array.isArray(v)) t[k] = v
  t.auditEvents = auditStore.events
  t.users = userStore.users
  return t
}

export async function createBackup(kind: "scheduled" | "manual", by: string, slot: string): Promise<BackupRow> {
  const tables = snapshotTables()
  const at = new Date().toISOString()
  const data = await gzip(JSON.stringify({ format: BACKUP_FORMAT, at, company: COMPANY.name, tables, settings: { vat: db.vatSettings, accounting: db.accountingConfig } }))
  const row: Stored = {
    id: `bk${++bstore.seq}`, at, kind, slot, by, size: data.byteLength, sha256: await sha256(data),
    tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), data,
  }
  bstore.rows.unshift(row)
  bstore.rows.splice(BACKUP_KEEP)
  return strip(row)
}
const strip = ({ data, ...r }: Stored): BackupRow => (void data, r)

/** Scheduled backups run lazily in the mock: the first request after a slot takes the slot's backup. */
export async function ensureScheduled() {
  const { slot } = lastSlot()
  if (!bstore.rows.some((r) => r.slot === slot && r.kind === "scheduled")) await createBackup("scheduled", "System", slot)
}

export function backupStatus(): BackupStatus {
  const today = new Date(Date.now() + 6 * 36e5).toISOString().slice(0, 10)
  const rows = bstore.rows.map(strip)
  return {
    timezone: "Asia/Dhaka", schedule: [...BACKUP_SLOTS], retention: BACKUP_KEEP, storage: "memory",
    today: rows.filter((r) => dhakaDayOf(r.at) === today).length,
    next: nextSlot(), last: rows[0], rows,
    drill: MOCK_DRILL,
  }
}
/**
 * R6.3: the PostgreSQL build records each restore drill (api/dist/restore.js --record); the in-memory mock shows
 * the shape of a passed drill so the Settings → Backups card can be reviewed without a database.
 */
const MOCK_DRILL: RestoreDrill = {
  at: "2026-09-21T03:12:40.000Z", ok: true, backupId: "bk58", backupAt: "2026-09-20T20:00:00.000Z",
  sha256: "4f1c9a7be2d0583e6a91c4d7f0b2e8a35c6d9e1f0a7b4c2d8e5f3a6b9c0d1e2f", target: "127.0.0.1:5432/dizivat_restore_drill", ms: 21_480,
  tables: 9, rows: 3_412, documents: 1_386, auditChain: "ok", boot: "ok", mismatches: [], by: "CI restore drill (GitHub Actions)",
}
export const backupData = (id: string) => bstore.rows.find((r) => r.id === id)
export async function verifyBackup(id: string) {
  const r = backupData(id)
  if (!r) return null
  const h = await sha256(r.data)
  return { id, ok: h === r.sha256 && r.data.byteLength === r.size, sha256: h, size: r.data.byteLength, checkedAt: new Date().toISOString() }
}
