import { TODAY } from "@/lib/company"
import { db, withStock } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import type { ItemLedger, LedgerEntry, LedgerType } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { json, problem, withAuth } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }
const FY_START = "2025-07-01"
const ORDER: Record<LedgerType, number> = { opening: 0, purchase: 1, prodReceive: 2, sale: 3, prodIssue: 4, damage: 5 }

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

/**
 * Stock ledger (Mushak 6.1/6.2 style movement register) for one item.
 * Purchases and sales are real approved documents; production and damage are monthly summaries until R3.
 */
export const GET = withAuth<Ctx>(null, async (_req, { params }) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  if (!it) return problem(404, "Item not found")
  await delay(150)
  const rows: Omit<LedgerEntry, "balance">[] = [{ date: FY_START, type: "opening", in: it.opening, out: 0 }]
  const qtyOf = (lines: { itemId: string; qty: number }[]) => lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.qty, 0)

  for (const p of db.purchases) {
    if (p.process !== "Approved") continue
    const q = qtyOf(p.lines)
    if (q) rows.push({ date: p.issueDate, type: "purchase", ref: p.invoiceNo, refId: p.id, party: p.vendorName, in: q, out: 0 })
  }
  for (const s of db.sales) {
    if (s.process !== "Approved") continue
    const q = qtyOf(s.lines)
    if (q) rows.push({ date: s.issueDate, type: "sale", ref: s.invoiceNo, refId: s.id, party: s.customerName, in: 0, out: q })
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
  if (it.damage) rows.push({ date: monthEnd(months[months.length - 2] ?? months[0]), type: "damage", in: 0, out: it.damage, summary: true })

  rows.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type])
  let bal = 0
  const entries: LedgerEntry[] = rows.map((r) => { bal = round2(bal + r.in - r.out); return { ...r, balance: bal } })
  const body: ItemLedger = {
    item: withStock(it),
    entries,
    totals: { in: round2(rows.reduce((a, r) => a + r.in, 0)), out: round2(rows.reduce((a, r) => a + r.out, 0)) },
  }
  return json(body)
})
