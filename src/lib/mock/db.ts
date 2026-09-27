import type { AuditChange, HistoryEntry, Item, ItemWithStock, Party, Purchase, Sale } from "../types"
import * as seed from "./seed"
import { auditStore, recordAudit } from "./audit"
import { users } from "./users"

type Trash =
  | { kind: "sale"; doc: Sale; at: string }
  | { kind: "purchase"; doc: Purchase; at: string }
  | { kind: "customer" | "vendor"; doc: Party; at: string }
interface DB { sales: Sale[]; purchases: Purchase[]; items: Item[]; customers: Party[]; vendors: Party[]; trash: Trash[] }

const APPROVERS = ["Chanchal Mahmud", "Nusrat Jahan"]
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
  seedAudit(d.sales, d.purchases)
  return { ...d, trash: [] }
}

/** Seeds the global audit log from document histories, recent sign-ins and a few admin events. */
function seedAudit(sales: Sale[], purchases: Purchase[]) {
  if (auditStore.events.length) return
  const raw: Parameters<typeof recordAudit>[0][] = []
  for (const [entity, docs] of [["sale", sales], ["purchase", purchases]] as const)
    for (const doc of docs) for (const h of doc.history ?? [])
      raw.push({ at: h.at, actor: h.by, entity, entityId: doc.id, ref: doc.invoiceNo, action: h.action, note: h.note })
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
    { at: "2026-09-22T02:58:00.000Z", actor: "Md. Rafiqul Islam", entity: "session", entityId: "u3", ref: "rafiqul", action: "signInFailed", note: "Wrong password" },
    { at: "2026-01-12T04:05:00.000Z", actor: "System Administrator", entity: "user", entityId: "u4", ref: "auditor", action: "invited", note: "Role: viewer" },
    { at: "2026-03-31T05:10:00.000Z", actor: "System Administrator", entity: "user", entityId: "u6", ref: "shafiq", action: "deactivated", note: "Left the company" },
    { at: "2026-07-01T04:00:00.000Z", actor: "System Administrator", entity: "company", ref: "PUL INDUSTRIES LTD", action: "updated", changes: [{ field: "phone", from: "0-28919534", to: "02-28919534" }] },
  )
  raw.sort((a, b) => a.at!.localeCompare(b.at!)).forEach((e) => recordAudit(e))
}

/** In-memory store kept on globalThis so it survives dev hot-reloads (resets on server restart). */
const g = globalThis as unknown as { __rbsDb2?: DB }
export const db: DB = (g.__rbsDb2 ??= init())

export const withStock = (i: Item): ItemWithStock => ({
  ...i,
  remain: Math.round((i.opening + i.purchased + i.prodReceive - i.prodIssue - i.sold - i.damage) * 100) / 100,
})

export function nextNo(prefix: "S" | "P", issueDate: string) {
  const [y, m] = issueDate.split("-")
  const key = `${prefix}-${m}${y.slice(2)}`
  const list = prefix === "S" ? db.sales : db.purchases
  const trashed = db.trash.filter((t) => t.kind === (prefix === "S" ? "sale" : "purchase")).map((t) => t.doc as Sale | Purchase)
  const n = [...list, ...trashed].filter((d) => d.invoiceNo.startsWith(key)).length + 1
  return `${key}${String(n).padStart(4, "0")}`
}

/** Returns field errors for lines that would drive stock negative (aggregated per item). */
export function stockShortfall(lines: { itemId: string; qty: number }[]) {
  const need = new Map<string, number>()
  lines.forEach((l) => need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty))
  const errors: Record<string, string[]> = {}
  const details: string[] = []
  for (const [itemId, qty] of need) {
    const it = db.items.find((i) => i.id === itemId)
    if (!it) continue
    const avail = withStock(it).remain
    if (qty > avail + 1e-9) {
      details.push(`${it.name}: ${avail} ${it.unit} available, ${qty} requested`)
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
