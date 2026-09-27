/**
 * Sprint 4 seed: units of measure, inter-branch transfers (Mushak 6.5) and damage / wastage entries.
 * Deterministic — quantities are fractions of each item's stock at seed time so no branch ever goes negative.
 */
import type { Damage, DamageReason, HistoryEntry, Item, Process, StockLine, Transfer, Unit } from "../types"

const SEEDED = "2025-07-01T03:00:00.000Z"
export const seedUnits = (): Unit[] => [
  { id: "un1", code: "Kg", name: "Kilogram", decimals: 2, active: true, createdAt: SEEDED },
  { id: "un2", code: "Pcs", name: "Pieces", decimals: 0, active: true, createdAt: SEEDED },
  { id: "un3", code: "Roll", name: "Roll", decimals: 0, active: true, createdAt: SEEDED },
  { id: "un4", code: "Meter", name: "Metre", decimals: 2, active: true, createdAt: SEEDED },
  { id: "un5", code: "Ltr", name: "Litre", decimals: 2, active: true, createdAt: SEEDED },
  { id: "un6", code: "Box", name: "Box / carton", decimals: 0, active: true, createdAt: SEEDED },
  { id: "un7", code: "Ton", name: "Metric ton", decimals: 3, active: false, createdAt: SEEDED },
]

const round2 = (n: number) => Math.round(n * 100) / 100
const STORE = "Md. Kamal Uddin"
const APPROVERS = ["Arif Hossain", "Farzana Akter"]
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`
const addHours = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 36e5).toISOString()

/** Quantity as a fraction of available stock, rounded to something a storekeeper would count. */
function qtyOf(it: Item, avail: number, frac: number) {
  const raw = avail * frac
  const q = it.unit === "Pcs" && raw > 1000 ? Math.round(raw / 100) * 100 : it.unit === "Pcs" ? Math.max(1, Math.round(raw)) : Math.max(1, Math.round(raw))
  return q <= avail ? q : Math.floor(avail)
}
export const stockLine = (it: Item, qty: number): StockLine => ({ itemId: it.id, name: it.name, sku: it.sku, uom: it.unit, qty, cost: it.costPrice, value: round2(qty * it.costPrice) })
const totals = (lines: StockLine[]) => ({ totalQty: round2(lines.reduce((a, l) => a + l.qty, 0)), totalValue: round2(lines.reduce((a, l) => a + l.value, 0)) })

function history(created: string, process: Process, i: number, cancelNote?: string): HistoryEntry[] {
  const h: HistoryEntry[] = [{ at: created, by: STORE, action: "created" }]
  if (process !== "Created") h.push({ at: addHours(created, 2 + (i % 3)), by: APPROVERS[i % 2], action: "approved" })
  if (process === "Cancelled") h.push({ at: addHours(created, 20), by: APPROVERS[(i + 1) % 2], action: "cancelled", note: cancelNote })
  return h
}

type TPlan = [date: string, from: "b1" | "b3", to: "b1" | "b3", process: Process, lines: [itemId: string, frac: number][], vehicle: string, note: string, cancel?: string]
const TRANSFERS: TPlan[] = [
  ["2026-07-08", "b1", "b3", "Approved", [["i17", 0.12], ["i19", 0.1]], "Dhaka Metro-Ta 11-4821", "Monthly replenishment of the Mirpur store"],
  ["2026-07-22", "b1", "b3", "Approved", [["i21", 0.15], ["i22", 0.1]], "Dhaka Metro-Ta 11-4821", "Pouches and roll stock for city customers"],
  ["2026-08-05", "b1", "b3", "Approved", [["i18", 0.15], ["i20", 0.1]], "Dhaka Metro-Ta 14-0937", "Pharma laminates ahead of Q2 orders"],
  ["2026-08-19", "b1", "b3", "Approved", [["i17", 0.08], ["i21", 0.08]], "Dhaka Metro-Ta 11-4821", "Top-up after stock count"],
  ["2026-09-02", "b1", "b3", "Cancelled", [["i19", 0.05]], "Dhaka Metro-Ta 14-0937", "Blister film for RIVERVIEW order", "Customer moved the order to factory pickup; nothing was loaded."],
  ["2026-09-09", "b1", "b3", "Approved", [["i22", 0.06], ["i20", 0.06]], "Dhaka Metro-Ta 11-4821", "September replenishment"],
  ["2026-09-16", "b3", "b1", "Approved", [["i18", 0.2]], "Dhaka Metro-Ta 14-0937", "Slow-moving Alu-Alu returned to the factory store"],
  ["2026-09-23", "b1", "b3", "Created", [["i17", 0.05], ["i19", 0.05]], "Dhaka Metro-Ta 11-4821", "Draft — awaiting vehicle confirmation"],
]

type DPlan = [date: string, branch: "b1" | "b3", reason: DamageReason, process: Process, lines: [itemId: string, frac: number][], note: string, cancel?: string]
const DAMAGES: DPlan[] = [
  ["2026-07-15", "b1", "wastage", "Approved", [["i4", 0.008], ["i6", 0.005]], "Edge trim and set-up waste on laminator L2 (job cards JC-0715-02/03)"],
  ["2026-08-11", "b1", "damaged", "Approved", [["i14", 0.02]], "Cartons soaked by a roof leak in store 2"],
  ["2026-08-28", "b3", "expired", "Approved", [["i19", 0.1]], "Shelf life exceeded (24 months) — QA rejection report QA-0826-07"],
  ["2026-09-05", "b3", "damaged", "Cancelled", [["i22", 0.05]], "Rolls crushed during unloading", "Rolls were re-inspected by QA and passed; no write-off needed."],
  ["2026-09-12", "b1", "lost", "Approved", [["i12", 0.005]], "Drum leak during unloading; gate pass GP-0912-03, insurance claim filed"],
  ["2026-09-20", "b1", "damaged", "Created", [["i13", 0.05]], "Cylinder surface scratched during mounting"],
]

/**
 * Builds the stock documents. `avail(itemId, branchId)` returns the branch's stock at that point in the
 * sequence; `apply` records an approved movement so later documents see it.
 */
export function seedStockDocs(items: Item[], branchName: (id: string) => string, avail: (itemId: string, branch: string) => number, apply: (itemId: string, branch: string, qty: number) => void) {
  const item = (id: string) => items.find((i) => i.id === id)!
  const events = [
    ...TRANSFERS.map((p, i) => ({ date: p[0], kind: "t" as const, i })),
    ...DAMAGES.map((p, i) => ({ date: p[0], kind: "d" as const, i })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const transfers: Transfer[] = [], damages: Damage[] = []
  const seq: Record<string, number> = {}
  const no = (prefix: "TR" | "DM", date: string) => {
    const key = `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`
    seq[key] = (seq[key] ?? 0) + 1
    return `${key}${String(seq[key]).padStart(4, "0")}`
  }
  for (const e of events) {
    if (e.kind === "t") {
      const [date, from, to, process, plan, vehicle, note, cancel] = TRANSFERS[e.i]
      const lines = plan.map(([id, f]) => stockLine(item(id), qtyOf(item(id), avail(id, from), f))).filter((l) => l.qty > 0)
      if (process === "Approved") for (const l of lines) { apply(l.itemId, from, -l.qty); apply(l.itemId, to, l.qty) }
      const createdAt = at(date, "04:30")
      transfers.push({
        kind: "transfer", id: `t${e.i + 1}`, no: no("TR", date), date, process, lines, ...totals(lines), note, vehicle,
        fromBranchId: from, fromBranch: branchName(from), toBranchId: to, toBranch: branchName(to),
        issuedBy: STORE, createdAt, cancelReason: cancel, history: history(createdAt, process, e.i, cancel),
      })
    } else {
      const [date, branch, reason, process, plan, note, cancel] = DAMAGES[e.i]
      const lines = plan.map(([id, f]) => stockLine(item(id), qtyOf(item(id), avail(id, branch), f))).filter((l) => l.qty > 0)
      if (process === "Approved") for (const l of lines) apply(l.itemId, branch, -l.qty)
      const createdAt = at(date, "06:10")
      damages.push({
        kind: "damage", id: `d${e.i + 1}`, no: no("DM", date), date, process, lines, ...totals(lines), note, reason,
        branchId: branch, branch: branchName(branch), issuedBy: STORE, createdAt, cancelReason: cancel, history: history(createdAt, process, e.i + 1, cancel),
      })
    }
  }
  // Newest first matches the list default; ids stay in plan order
  transfers.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  damages.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  return { transfers, damages }
}
