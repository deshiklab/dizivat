import type { UdRecord, AccountingConfig, MoneyAccount, MoneyDoc, TreasuryDeposit, VatAdjustment, VatReturn, VatSettings, VdsEntry, AuditChange, Batch, Bom, Branch, CreditNote, Damage, DebitNote, HistoryEntry, Item, ItemWithStock, MasterItem, OpeningEntry, Party, ProductionConfig, Purchase, Sale, StockDoc, Transfer, Unit, WorkOrder } from "../types"
import * as seed from "./seed"
import { auditStore, recordAudit } from "./audit"
import { users } from "./users"
import { company } from "./company"
import { seedStockDocs, seedUnits } from "./seed-stock"
import { seedSdImports } from "./seed-r63"
import { EXTRA_VENDORS, enrichImports, seedDebitNotes, seedMasterItems, seedOpening, seedServicePurchases } from "./seed-r2"
import { EXTRA_CUSTOMERS, enrichCustomers, enrichExports, seedBoms, seedCreditNotes, seedProduction, seedR3Sales } from "./seed-r3"
import { seedR4 } from "./seed-r4"
import { seedRealisations, seedUds } from "./seed-r6"

type Trash =
  | { kind: "sale"; doc: Sale; at: string }
  | { kind: "purchase"; doc: Purchase; at: string }
  | { kind: "customer" | "vendor"; doc: Party; at: string }
interface DB {
  sales: Sale[]; purchases: Purchase[]; items: Item[]; customers: Party[]; vendors: Party[]; trash: Trash[]
  /** Sprint 4 */
  units: Unit[]; transfers: Transfer[]; damages: Damage[]
  /** last id number handed out per stock-document kind (ids are never reused, even after a draft is deleted) */
  seq: { transfer: number; damage: number; unit: number; debitNote: number; opening: number; masterItem: number; creditNote: number; bom: number; workOrder: number; batch: number; account: number; receipt: number; payment: number; treasury: number; vds: number; adjustment: number; ud: number }
  /** R2 */
  debitNotes: DebitNote[]; openings: OpeningEntry[]; masterItems: MasterItem[]
  /** R3 */
  creditNotes: CreditNote[]; boms: Bom[]; workOrders: WorkOrder[]; batches: Batch[]; productionConfig: ProductionConfig
  /** R4 */
  moneyAccounts: MoneyAccount[]; moneyDocs: MoneyDoc[]; treasury: TreasuryDeposit[]; vds: VdsEntry[]; adjustments: VatAdjustment[]; returns: VatReturn[]
  accountingConfig: AccountingConfig; vatSettings: VatSettings
  /** R6.2 (RMG): exporters' UD / UP records */
  uds: UdRecord[]
}

const APPROVERS = ["Arif Hossain", "Farzana Akter"]
const CANCEL_REASONS = [
  "Customer revised the order quantity before delivery; replaced by a new invoice.",
  "Wrong customer selected at entry — re-issued to the correct buyer.",
  "Goods returned at the gate on the day of issue (damaged cartons).",
]
const addHours = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 36e5).toISOString()

function init(): DB {
  const d = structuredClone({ sales: seed.sales, purchases: seed.purchases, items: seed.items, customers: seed.customers, vendors: seed.vendors })
  const item = (id: string) => d.items.find((i) => i.id === id)!
  // Stock posts only on approval (the seed counted drafts as moved stock).
  for (const s of d.sales) if (s.process === "Created") for (const l of s.lines) item(l.itemId).sold -= l.qty
  for (const p of d.purchases) if (p.process !== "Approved") for (const l of p.lines) item(l.itemId).purchased -= l.qty
  for (const it of d.items) {
    const remain = it.opening + it.purchased + it.prodReceive - it.prodIssue - it.sold - it.damage
    if (remain < 0) it.prodIssue = Math.max(0, it.prodIssue + remain)
  }
  // R2: service providers, Bill-of-Entry duty stacks on imports, service purchases (no stock)
  d.vendors.push(...structuredClone(EXTRA_VENDORS))
  enrichImports(d.purchases, d.vendors)
  // R3: EPZ customer, credit terms / VDS status, export shipping documents
  d.customers.push(...structuredClone(EXTRA_CUSTOMERS))
  enrichCustomers(d.customers)
  enrichExports(d.sales, d.customers)
  const services = seedServicePurchases(d.purchases.length + 1, { id: "b1", name: "" })
  d.purchases.push(...services)
  // Audit trail
  const trail = (doc: Sale | Purchase, i: number) => {
    const h: HistoryEntry[] = [{ at: doc.createdAt, by: doc.issuedBy, action: "created" }]
    if (doc.process !== "Created") h.push({ at: addHours(doc.createdAt, 1 + (i % 5)), by: APPROVERS[i % 2], action: "approved" })
    if (doc.process === "Cancelled") {
      doc.cancelReason = CANCEL_REASONS[i % CANCEL_REASONS.length]
      h.push({ at: addHours(doc.createdAt, 26), by: APPROVERS[(i + 1) % 2], action: "cancelled", note: doc.cancelReason })
    }
    doc.history = h
  }
  d.sales.forEach(trail); d.purchases.forEach(trail)
  for (const p of services) if (p.process === "Cancelled") {
    p.cancelReason = "Duplicate bill — the same trips were billed on another invoice."
    p.history = p.history!.map((h) => (h.action === "cancelled" ? { ...h, note: p.cancelReason } : h))
  }
  for (const p of [...d.customers, ...d.vendors]) p.active = true
  // Every seeded document belongs to the main (factory) branch
  const main = mainBranchId(), mainName = branchName(main)
  for (const doc of [...d.sales, ...d.purchases]) { doc.branchId = main; doc.branchName = mainName }
  // Transfers / damage: replay against a running per-branch balance so no branch goes negative
  const bal = new Map<string, number>()
  const key = (itemId: string, b: string) => `${itemId}|${b}`
  for (const it of d.items) bal.set(key(it.id, main), Math.max(0, it.opening + it.purchased + it.prodReceive - it.prodIssue - it.sold - it.damage))
  const { transfers, damages } = seedStockDocs(d.items, branchName, (id, b) => bal.get(key(id, b)) ?? 0, (id, b, q) => bal.set(key(id, b), (bal.get(key(id, b)) ?? 0) + q))
  for (const dm of damages) if (dm.process === "Approved") for (const l of dm.lines) item(l.itemId).damage += l.qty
  // R2: debit notes (approved returns leave the factory stock), opening entries, master items
  const debitNotes = seedDebitNotes(d.purchases, (id) => bal.get(key(id, main)) ?? 0)
  for (const dn of debitNotes) if (dn.process === "Approved") for (const l of dn.lines) { item(l.itemId).purchased -= l.qty; bal.set(key(l.itemId, main), (bal.get(key(l.itemId, main)) ?? 0) - l.qty) }
  const store = stockBranches().find((b) => b.id !== main) ?? { id: main, name: mainName }
  const openings = seedOpening(d.items, { id: main, name: mainName }, { id: store.id, name: store.name })
  const masterItems = seedMasterItems(d.items)
  // R3: service sales + deemed exports, credit notes, 4.3 declarations, work orders and batches (factory stock)
  const balMain = { get: (id: string) => bal.get(key(id, main)) ?? 0, add: (id: string, q: number) => bal.set(key(id, main), (bal.get(key(id, main)) ?? 0) + q) }
  d.sales.push(...seedR3Sales(d.sales.length + 1, d.sales, d.customers, d.items, { id: main, name: mainName }, balMain))
  seedRealisations(d.sales)
  const uds = seedUds(d.customers, d.items)
  const creditNotes = seedCreditNotes(d.sales, d.items, balMain)
  const boms = seedBoms(d.items)
  const { workOrders, batches } = seedProduction(d.items, boms, d.vendors, { id: main, name: mainName }, balMain)
  // R6.3: SD-paid packing imports (9.1 note 40 — SD on inputs of exported goods)
  seedSdImports(d.purchases, d.vendors, d.items, { id: main, name: mainName })
  const r4 = seedR4({ sales: d.sales, purchases: d.purchases, creditNotes, debitNotes, customers: d.customers, vendors: d.vendors })
  const r2Docs = [
    ...debitNotes.map((x) => ({ entity: "debitNote" as const, id: x.id, ref: x.no, history: x.history })),
    ...openings.map((x) => ({ entity: "opening" as const, id: x.id, ref: x.no, history: x.history })),
    ...masterItems.map((x) => ({ entity: "masterItem" as const, id: x.id, ref: `${x.hsCode} · ${x.name}`, history: x.history })),
    ...creditNotes.map((x) => ({ entity: "creditNote" as const, id: x.id, ref: x.no, history: x.history })),
    ...boms.map((x) => ({ entity: "bom" as const, id: x.id, ref: x.no, history: x.history })),
    ...workOrders.map((x) => ({ entity: "workOrder" as const, id: x.id, ref: x.no, history: x.history })),
    ...batches.map((x) => ({ entity: "batch" as const, id: x.id, ref: x.no, history: x.history })),
    ...r4.moneyAccounts.map((x) => ({ entity: "account" as const, id: x.id, ref: `${x.provider} · ${x.accountNo}`, history: [{ at: x.createdAt, by: "System Administrator", action: "created" as const }] })),
    ...r4.moneyDocs.map((x) => ({ entity: x.kind, id: x.id, ref: x.no, history: x.history })),
    ...r4.vds.map((x) => ({ entity: "vds" as const, id: x.id, ref: x.no, history: x.history })),
    ...r4.adjustments.map((x) => ({ entity: "adjustment" as const, id: x.id, ref: x.no, history: x.history })),
    ...r4.treasury.map((x) => ({ entity: "treasury" as const, id: x.id, ref: x.no, history: x.history })),
    ...r4.returns.map((x) => ({ entity: "vatReturn" as const, id: x.period, ref: `9.1 · ${x.period.slice(5)}-${x.period.slice(0, 4)}`, history: x.history })),
    ...uds.map((x) => ({ entity: "ud" as const, id: x.id, ref: `${x.no} · ${x.customerName}`, history: x.history })),
  ]
  seedAudit(d.sales, d.purchases, [...transfers, ...damages], r2Docs)
  return {
    ...d, trash: [], units: seedUnits(), transfers, damages, debitNotes, openings, masterItems,
    creditNotes, boms, workOrders, batches, productionConfig: { procedure: "directStock", consumption: "standard" },
    ...r4,
    uds,
    seq: {
      transfer: transfers.length, damage: damages.length, unit: 7, debitNote: debitNotes.length, opening: openings.length, masterItem: masterItems.length,
      creditNote: creditNotes.length, bom: boms.length, workOrder: workOrders.length, batch: batches.length,
      account: r4.moneyAccounts.length, receipt: r4.moneyDocs.filter((x) => x.kind === "receipt").length, payment: r4.moneyDocs.filter((x) => x.kind === "payment").length,
      treasury: r4.treasury.length, vds: r4.vds.length, adjustment: r4.adjustments.length, ud: uds.length,
    },
  }
}

/** Seeds the global audit log from document histories, recent sign-ins and a few admin events. */
type R2Doc = { entity: "debitNote" | "opening" | "masterItem" | "creditNote" | "bom" | "workOrder" | "batch" | "account" | "receipt" | "payment" | "vds" | "adjustment" | "treasury" | "vatReturn" | "ud"; id: string; ref: string; history?: HistoryEntry[] }
function seedAudit(sales: Sale[], purchases: Purchase[], stockDocs: StockDoc[], r2Docs: R2Doc[]) {
  if (auditStore.events.length) return
  const raw: Parameters<typeof recordAudit>[0][] = []
  for (const [entity, docs] of [["sale", sales], ["purchase", purchases]] as const)
    for (const doc of docs) for (const h of doc.history ?? [])
      raw.push({ at: h.at, actor: h.by, entity, entityId: doc.id, ref: doc.invoiceNo, action: h.action, note: h.note })
  for (const doc of stockDocs) for (const h of doc.history ?? [])
    raw.push({ at: h.at, actor: h.by, entity: doc.kind, entityId: doc.id, ref: doc.no, action: h.action, note: h.note })
  for (const doc of r2Docs) for (const h of doc.history ?? [])
    raw.push({ at: h.at, actor: h.by, entity: doc.entity, entityId: doc.id, ref: doc.ref, action: h.action, note: h.note })
  // Working-day sign-ins for the last 3 weeks (Fri is the weekend in Bangladesh)
  const active = users.filter((u) => u.active)
  for (let back = 21; back >= 1; back--) {
    const day = new Date(Date.UTC(2026, 8, 25 - back, 3, 0))
    if (day.getUTCDay() === 5) continue
    active.forEach((u, j) => {
      if (u.role === "viewer" && back % 7) return // the consultant visits weekly
      raw.push({ at: new Date(day.getTime() + (j * 11 + back) * 60_000).toISOString(), actor: u, entity: "session", entityId: u.id, ref: u.username, action: "signedIn" })
    })
  }
  raw.push(
    { at: "2026-09-22T02:58:00.000Z", actor: "Md. Kamal Uddin", entity: "session", entityId: "u3", ref: "kamal", action: "signInFailed", note: "Wrong password" },
    { at: "2026-01-12T04:05:00.000Z", actor: "System Administrator", entity: "user", entityId: "u4", ref: "auditor", action: "invited", note: "Role: viewer" },
    { at: "2026-03-31T05:10:00.000Z", actor: "System Administrator", entity: "user", entityId: "u6", ref: "jewel", action: "deactivated", note: "Left the company" },
    { at: "2026-07-01T04:00:00.000Z", actor: "System Administrator", entity: "company", ref: "KANCHANJHARA APPAREL COMPOSITE LTD", action: "updated", changes: [{ field: "phone", from: "0-27701234", to: "02-27701234" }] },
  )
  raw.sort((a, b) => a.at!.localeCompare(b.at!)).forEach((e) => recordAudit(e))
}

/** In-memory store kept on globalThis so it survives dev hot-reloads (resets on server restart). */
// NB: init() runs at module load — helpers it calls must be hoisted `function` declarations, not `const` arrows (TDZ).
const g = globalThis as unknown as { __dzDb?: DB }
export const db: DB = (g.__dzDb ??= init())
// R6.2: state saved by an earlier release (the PostgreSQL compat snapshot) has no UD register yet
db.uds ??= []
db.seq.ud ??= db.uds.length

export const withStock = (i: Item): ItemWithStock => ({
  ...i,
  remain: Math.round((i.opening + i.purchased + i.prodReceive - i.prodIssue - i.sold - i.damage) * 100) / 100,
})

/**
 * Next document id (s223, p86 …): one above the highest number ever used, trash included, so ids are never reused.
 * Sequential ids also let the static GitHub Pages demo pre-render pages for documents created in the browser.
 */
export function nextDocId(prefix: "s" | "p", docs: { id: string }[]) {
  const max = docs.reduce((m, d) => Math.max(m, Number(/^[sp](\d+)/.exec(d.id)?.[1] ?? 0)), 0)
  return `${prefix}${max + 1}`
}

export function nextNo(prefix: "S" | "SS" | "P" | "PS", issueDate: string) {
  const [y, m] = issueDate.split("-")
  const key = `${prefix}-${m}${y.slice(2)}`
  const isSale = prefix === "S" || prefix === "SS"
  const list = isSale ? db.sales : db.purchases
  const trashed = db.trash.filter((t) => t.kind === (isSale ? "sale" : "purchase")).map((t) => t.doc as Sale | Purchase)
  const n = [...list, ...trashed].filter((d) => d.invoiceNo.startsWith(key)).length + 1
  return `${key}${String(n).padStart(4, "0")}`
}

/* ── Branches (S4-04/05) ─────────────────────────────────────────────────── */

/** The factory holds whatever is not explicitly at another branch (opening stock, production, legacy documents). */
export function mainBranchId() { return (company.branches.find((b) => b.category === "factory") ?? company.branches[0]).id }
export function branchName(id: string) { return company.branches.find((b) => b.id === id)?.name ?? id }
/** Branches that can hold stock (a head office cannot). */
export function stockBranches(): Branch[] { return company.branches.filter((b) => b.category !== "office") }
/** Branches referenced by any document (they cannot be removed or turned into an office). */
export function usedBranchIds() {
  const ids = new Set<string>([mainBranchId()])
  for (const d of [...db.sales, ...db.purchases]) ids.add(d.branchId)
  for (const t of db.transfers) { ids.add(t.fromBranchId); ids.add(t.toBranchId) }
  for (const d of db.damages) ids.add(d.branchId)
  for (const d of [...db.debitNotes, ...db.openings, ...db.creditNotes, ...db.batches]) ids.add(d.branchId)
  return ids
}
/** id → name for list facet labels (all branches, so renamed/removed ones still read well). */
export function branchLabels() { return Object.fromEntries(company.branches.map((b) => [b.id, b.name])) }
/** "" → main branch; unknown or non-stock branch → null. */
export function resolveBranch(id?: string) { return stockBranches().find((b) => b.id === (id || mainBranchId())) ?? null }

/**
 * Stock of every item split by branch. Non-main branches = their approved documents
 * (purchases in, sales out, transfers in/out, damage out); the main branch holds the rest.
 */
export function stockByBranch(): Map<string, Record<string, number>> {
  const main = mainBranchId()
  const moves = new Map<string, Record<string, number>>()
  const add = (itemId: string, b: string, q: number) => {
    if (b === main) return
    const r = moves.get(itemId) ?? {}
    r[b] = (r[b] ?? 0) + q
    moves.set(itemId, r)
  }
  for (const s of db.sales) if (s.process === "Approved") for (const l of s.lines) add(l.itemId, s.branchId, -l.qty)
  for (const p of db.purchases) if (p.process === "Approved") for (const l of p.lines) add(l.itemId, p.branchId, l.qty)
  for (const t of db.transfers) if (t.process === "Approved") for (const l of t.lines) { add(l.itemId, t.fromBranchId, -l.qty); add(l.itemId, t.toBranchId, l.qty) }
  for (const d of db.damages) if (d.process === "Approved") for (const l of d.lines) add(l.itemId, d.branchId, -l.qty)
  for (const d of db.debitNotes) if (d.process === "Approved") for (const l of d.lines) add(l.itemId, d.branchId, -l.qty)
  for (const o of db.openings) if (o.process === "Approved") add(o.itemId, o.branchId, o.qty)
  for (const c of db.creditNotes) if (c.process === "Approved") for (const l of c.lines) add(l.itemId, c.branchId, l.qty)
  for (const b of db.batches) if (b.process === "Approved") {
    for (const x of b.consumption) add(x.itemId, b.branchId, -x.qty)
    for (const l of b.lines) add(l.itemId, b.branchId, l.receiveQty)
  }
  const out = new Map<string, Record<string, number>>()
  for (const it of db.items) {
    const r = moves.get(it.id) ?? {}
    const others = Object.values(r).reduce((a, q) => a + q, 0)
    const row: Record<string, number> = { [main]: Math.round((withStock(it).remain - others) * 100) / 100 }
    for (const b of stockBranches()) if (b.id !== main) row[b.id] = Math.round((r[b.id] ?? 0) * 100) / 100
    out.set(it.id, row)
  }
  return out
}

/** Returns field errors for lines that would drive stock negative (aggregated per item) — at one branch when given. */
export function stockShortfall(lines: { itemId: string; qty: number }[], branchId?: string) {
  const byBranch = branchId ? stockByBranch() : null
  const need = new Map<string, number>()
  lines.forEach((l) => need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty))
  const errors: Record<string, string[]> = {}
  const details: string[] = []
  for (const [itemId, qty] of need) {
    const it = db.items.find((i) => i.id === itemId)
    if (!it) continue
    const avail = byBranch ? byBranch.get(itemId)?.[branchId!] ?? 0 : withStock(it).remain
    if (qty > avail + 1e-9) {
      details.push(`${it.name}: ${avail} ${it.unit} available${byBranch ? ` at ${branchName(branchId!)}` : ""}, ${qty} requested`)
      lines.forEach((l, i) => { if (l.itemId === itemId) errors[`lines.${i}.qty`] = ["insufficient"] })
    }
  }
  return details.length ? { errors, detail: details.join("; ") } : null
}

/** Post (+1) or reverse (−1) a document's stock movement. */
export function postStock(kind: "sale" | "purchase", lines: { itemId: string; qty: number }[], sign: 1 | -1) {
  for (const l of lines) {
    const it = db.items.find((i) => i.id === l.itemId)
    if (!it) continue // service lines (sv* / ss*) carry no stock
    if (kind === "sale") it.sold += sign * l.qty
    else it.purchased += sign * l.qty
  }
}

/** Appends to the document's own history AND the global audit trail. */
export function addHistory(doc: Sale | Purchase, by: string, action: HistoryEntry["action"], note?: string, changes?: AuditChange[]) {
  const at = new Date().toISOString()
  doc.history = [...(doc.history ?? []), { at, by, action, note }]
  doc.updatedAt = at
  recordAudit({ at, actor: by, entity: "customerId" in doc ? "sale" : "purchase", entityId: doc.id, ref: doc.invoiceNo, action, note, changes })
}
