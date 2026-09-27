import { TODAY } from "@/lib/company"
import { db, mainBranchId, stockBranches, stockByBranch, withStock } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import type { ItemLedger, LedgerEntry, LedgerType } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { json, problem, withAuth } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }
const FY_START = "2025-07-01"
const ORDER: Record<LedgerType, number> = { opening: 0, purchase: 1, prodReceive: 2, transferIn: 3, sale: 4, transferOut: 5, prodIssue: 6, damage: 7 }

function monthsBetween(from: string, to: string) {
  const out: string[] = []
  let [y, m] = from.split("-").map(Number)
  const [ty, tm] = to.split("-").map(Number)
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  const d = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`
  return d > TODAY ? TODAY : d
}

/** Distribute `total` over buckets proportionally to `weights`; the last non-zero bucket absorbs rounding. */
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!total || !sum) return weights.map(() => 0)
  const out = weights.map((w) => round2((total * w) / sum))
  const last = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0).pop()!
  out[last] = round2(out[last] + total - out.reduce((a, b) => a + b, 0))
  return out
}

type Row = Omit<LedgerEntry, "balance"> & { at?: string; transfer?: boolean }

/**
 * Stock ledger (Mushak 6.1/6.2 style movement register) for one item.
 * Purchases, sales and damage entries are real approved documents; production is a monthly summary until R3.
 * `?branch=<id>` restricts it to one branch, where transfers in/out appear (company-wide they net to zero).
 */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  if (!it) return problem(404, "Item not found")
  const branch = new URL(req.url).searchParams.get("branch") || undefined
  if (branch && !stockBranches().some((b) => b.id === branch)) return problem(404, "Branch not found")
  await delay(150)
  const main = mainBranchId()
  // `at` = branch of the movement; undefined = the main branch (opening, production, legacy summaries)
  const rows: Row[] = [{ date: FY_START, type: "opening", in: it.opening, out: 0 }]
  const qtyOf = (lines: { itemId: string; qty: number }[]) => lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.qty, 0)

  for (const p of db.purchases) {
    if (p.process !== "Approved") continue
    const q = qtyOf(p.lines)
    if (q) rows.push({ date: p.issueDate, type: "purchase", ref: p.invoiceNo, refId: p.id, party: p.vendorName, in: q, out: 0, at: p.branchId })
  }
  for (const s of db.sales) {
    if (s.process !== "Approved") continue
    const q = qtyOf(s.lines)
    if (q) rows.push({ date: s.issueDate, type: "sale", ref: s.invoiceNo, refId: s.id, party: s.customerName, in: 0, out: q, at: s.branchId })
  }
  let damageDocs = 0
  for (const d of db.damages) {
    if (d.process !== "Approved") continue
    const q = qtyOf(d.lines)
    if (q) { damageDocs += q; rows.push({ date: d.date, type: "damage", ref: d.no, refId: d.id, party: d.branch, in: 0, out: q, at: d.branchId }) }
  }
  for (const t of db.transfers) {
    if (t.process !== "Approved") continue
    const q = qtyOf(t.lines)
    if (!q) continue
    rows.push({ date: t.date, type: "transferOut", ref: t.no, refId: t.id, party: t.toBranch, in: 0, out: q, at: t.fromBranchId, transfer: true })
    rows.push({ date: t.date, type: "transferIn", ref: t.no, refId: t.id, party: t.fromBranch, in: q, out: 0, at: t.toBranchId, transfer: true })
  }

  const months = monthsBetween(FY_START.slice(0, 7), TODAY.slice(0, 7))
  const byMonth = (type: "sale" | "purchase") => months.map((ym) => rows.filter((r) => r.type === type && r.date.startsWith(ym)).reduce((a, r) => a + r.in + r.out, 0))
  if (it.prodReceive) {
    allocate(it.prodReceive, byMonth("sale").map((v, i) => v + (i === 0 ? 1e-6 : 0))).forEach((q, i) => {
      if (q) rows.push({ date: `${months[i]}-01`, type: "prodReceive", in: q, out: 0, summary: true })
    })
  }
  if (it.prodIssue) {
    const pur = byMonth("purchase")
    allocate(it.prodIssue, pur.map((v) => v + it.opening / months.length)).forEach((q, i) => {
      if (q) rows.push({ date: monthEnd(months[i]), type: "prodIssue", in: 0, out: q, summary: true })
    })
  }
  // Damage recorded before damage entries existed (legacy) stays a summary row
  const legacyDamage = round2(it.damage - damageDocs)
  if (legacyDamage > 0) rows.push({ date: monthEnd(months[months.length - 2] ?? months[0]), type: "damage", in: 0, out: legacyDamage, summary: true })

  const shown = rows.filter((r) => (branch ? (r.at ?? main) === branch : !r.transfer))
  shown.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type])
  let bal = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const entries: LedgerEntry[] = shown.map(({ at, transfer, ...r }) => { bal = round2(bal + r.in - r.out); return { ...r, balance: bal } })
  const body: ItemLedger = {
    item: withStock(it),
    entries,
    totals: { in: round2(shown.reduce((a, r) => a + r.in, 0)), out: round2(shown.reduce((a, r) => a + r.out, 0)) },
    closing: bal,
    branchId: branch,
    branches: stockBranches().map((b) => ({ id: b.id, name: b.name })),
    byBranch: stockByBranch().get(it.id) ?? {},
  }
  return json(body)
})
