import type { AuditChange, Branch, Damage, HistoryEntry, Item, ItemWithStock, Party, Purchase, Sale, StockDoc, Transfer, Unit } from "../types"
import * as seed from "./seed"
import { auditStore, recordAudit } from "./audit"
import { users } from "./users"
import { company } from "./company"
import { seedStockDocs, seedUnits } from "./seed-stock"

type Trash =
  | { kind: "sale"; doc: Sale; at: string }
  | { kind: "purchase"; doc: Purchase; at: string }
  | { kind: "customer" | "vendor"; doc: Party; at: string }
interface DB {
  sales: Sale[]; purchases: Purchase[]; items: Item[]; customers: Party[]; vendors: Party[]; trash: Trash[]
  /** Sprint 4 */
  units: Unit[]; transfers: Transfer[]; damages: Damage[]
  /** last id number handed out per stock-document kind (ids are never reused, even after a draft is deleted) */
  seq: { transfer: number; damage: number; unit: number }
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
  seedAudit(d.sales, d.purchases, [...transfers, ...damages])
  return { ...d, trash: [], units: seedUnits(), transfers, damages, seq: { transfer: transfers.length, damage: damages.length, unit: 7 } }
}

/** Seeds the global audit log from document histories, recent sign-ins and a few admin events. */
function seedAudit(sales: Sale[], purchases: Purchase[], stockDocs: StockDoc[]) {
  if (auditStore.events.length) return
  const raw: Parameters<typeof recordAudit>[0][] = []
  for (const [entity, docs] of [["sale", sales], ["purchase", purchases]] as const)
    for (const doc of docs) for (const h of doc.history ?? [])
      raw.push({ at: h.at, actor: h.by, entity, entityId: doc.id, ref: doc.invoiceNo, action: h.action, note: h.note })
  for (const doc of stockDocs) for (const h of doc.history ?? [])
    raw.push({ at: h.at, actor: h.by, entity: doc.kind, entityId: doc.id, ref: doc.no, action: h.action, note: h.note })
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
    { at: "2026-07-01T04:00:00.000Z", actor: "System Administrator", entity: "company", ref: "RUPSHA FLEXIPACK LTD", action: "updated", changes: [{ field: "phone", from: "0-27701234", to: "02-27701234" }] },
  )
  raw.sort((a, b) => a.at!.localeCompare(b.at!)).forEach((e) => recordAudit(e))
}

/** In-memory store kept on globalThis so it survives dev hot-reloads (resets on server restart). */
// NB: init() runs at module load — helpers it calls must be hoisted `function` declarations, not `const` arrows (TDZ).
const g = globalThis as unknown as { __rbsDb4?: DB }
export const db: DB = (g.__rbsDb4 ??= init())

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

export function nextNo(prefix: "S" | "P", issueDate: string) {
  const [y, m] = issueDate.split("-")
  const key = `${prefix}-${m}${y.slice(2)}`
  const list = prefix === "S" ? db.sales : db.purchases
  const trashed = db.trash.filter((t) => t.kind === (prefix === "S" ? "sale" : "purchase")).map((t) => t.doc as Sale | Purchase)
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
    const it = db.items.find((i) => i.id === l.itemId)!
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
