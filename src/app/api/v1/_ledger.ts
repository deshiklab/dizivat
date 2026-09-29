import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import type { BookRow, Item, LedgerEntry, LedgerType } from "@/lib/types"
import { round2 } from "@/lib/vat"

export const FY_START = "2025-07-01"
export const ORDER: Record<LedgerType, number> = { opening: 0, purchase: 1, prodReceive: 2, saleReturn: 2.5, transferIn: 3, sale: 4, purchaseReturn: 5, transferOut: 6, prodIssue: 7, damage: 8 }

/** A movement with its branch (`at`, undefined = main) and — for documents — value and tax (Mushak 6.1/6.2). */
export type Row = Omit<LedgerEntry, "balance"> & {
  at?: string; transfer?: boolean
  value?: number; sd?: number; vat?: number
  challan?: string; refDate?: string; partyAddress?: string; partyBin?: string
}

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
 * Every stock movement of one item (unsorted, all branches). Purchases, returns, sales, damage, transfers and opening
 * entries are real approved documents. R3: production batches post real issue / receive rows and credit notes post sale
 * returns; production before the first batch (legacy history) stays a monthly summary.
 */
export function ledgerRows(it: Item): Row[] {
  const id = it.id
  const rows: Row[] = []
  const pick = (lines: { itemId: string; qty: number; subtotal?: number; sd?: number; vat?: number }[]) => {
    const ls = lines.filter((l) => l.itemId === id)
    return { q: round2(ls.reduce((a, l) => a + l.qty, 0)), value: round2(ls.reduce((a, l) => a + (l.subtotal ?? 0), 0)), sd: round2(ls.reduce((a, l) => a + (l.sd ?? 0), 0)), vat: round2(ls.reduce((a, l) => a + (l.vat ?? 0), 0)) }
  }

  // Opening: one row per approved opening entry (R2); items without entries keep a zero FY-start row
  const openings = db.openings.filter((o) => o.itemId === id && o.process === "Approved")
  const fromEntries = round2(openings.reduce((a, o) => a + o.qty, 0))
  for (const o of openings) rows.push({ date: o.date, type: "opening", ref: o.no, refId: o.id, party: o.branchName, in: o.qty, out: 0, at: o.branchId, value: o.value })
  if (!openings.length || Math.abs(fromEntries - it.opening) > 1e-9) {
    const q = round2(it.opening - fromEntries)
    rows.push({ date: FY_START, type: "opening", in: q, out: 0, value: round2(q * (it.purchasePrice || it.costPrice)) })
  }

  for (const p of db.purchases) {
    if (p.process !== "Approved" || p.category === "service") continue
    const x = pick(p.lines)
    if (x.q) rows.push({ date: p.issueDate, type: "purchase", ref: p.invoiceNo, refId: p.id, party: p.vendorName, partyAddress: p.vendorAddress, partyBin: p.vendorBin, challan: p.challanNo, refDate: p.challanDate, in: x.q, out: 0, at: p.branchId, value: x.value, sd: x.sd, vat: x.vat })
  }
  for (const n of db.debitNotes) {
    if (n.process !== "Approved") continue
    const x = pick(n.lines)
    if (x.q) rows.push({ date: n.issueDate, type: "purchaseReturn", ref: n.no, refId: n.id, party: n.vendorName, partyAddress: n.vendorAddress, partyBin: n.vendorBin, challan: n.purchaseNo, refDate: n.purchaseDate, in: 0, out: x.q, at: n.branchId, value: x.value, sd: x.sd, vat: x.vat })
  }
  for (const s of db.sales) {
    if (s.process !== "Approved") continue
    const x = pick(s.lines)
    if (x.q) rows.push({ date: s.issueDate, type: "sale", ref: s.invoiceNo, refId: s.id, party: s.customerName, partyAddress: s.customerAddress, partyBin: s.customerBin, challan: s.challanNo, refDate: s.issueDate, in: 0, out: x.q, at: s.branchId, value: x.value, sd: x.sd, vat: x.vat })
  }
  for (const n of db.creditNotes) {
    if (n.process !== "Approved") continue
    const x = pick(n.lines)
    if (x.q) rows.push({ date: n.issueDate, type: "saleReturn", ref: n.no, refId: n.id, party: n.customerName, partyAddress: n.customerAddress, partyBin: n.customerBin, challan: n.saleNo, refDate: n.saleDate, in: x.q, out: 0, at: n.branchId, value: x.value, sd: x.sd, vat: x.vat })
  }
  let batchIn = 0, batchOut = 0
  for (const b of db.batches) {
    if (b.process !== "Approved") continue
    const party = b.vendorName ?? b.branchName
    const rq = round2(b.lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.receiveQty, 0))
    if (rq) { batchIn += rq; rows.push({ date: b.receiveDate ?? b.issueDate, type: "prodReceive", ref: b.no, refId: b.id, party, in: rq, out: 0, at: b.branchId, value: round2(b.lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.value, 0)) }) }
    const c = b.consumption.find((x) => x.itemId === id)
    if (c?.qty) { batchOut += c.qty; rows.push({ date: b.issueDate, type: "prodIssue", ref: b.no, refId: b.id, party, in: 0, out: c.qty, at: b.branchId, value: c.value }) }
  }
  let damageDocs = 0
  for (const d of db.damages) {
    if (d.process !== "Approved") continue
    const q = d.lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.qty, 0)
    if (q) { damageDocs += q; rows.push({ date: d.date, type: "damage", ref: d.no, refId: d.id, party: d.branch, in: 0, out: q, at: d.branchId }) }
  }
  for (const t of db.transfers) {
    if (t.process !== "Approved") continue
    const q = t.lines.filter((l) => l.itemId === id).reduce((a, l) => a + l.qty, 0)
    if (!q) continue
    rows.push({ date: t.date, type: "transferOut", ref: t.no, refId: t.id, party: t.toBranch, in: 0, out: q, at: t.fromBranchId, transfer: true })
    rows.push({ date: t.date, type: "transferIn", ref: t.no, refId: t.id, party: t.fromBranch, in: q, out: 0, at: t.toBranchId, transfer: true })
  }

  const months = monthsBetween(FY_START.slice(0, 7), TODAY.slice(0, 7))
  const byMonth = (type: "sale" | "purchase") => months.map((ym) => rows.filter((r) => r.type === type && r.date.startsWith(ym)).reduce((a, r) => a + r.in + r.out, 0))
  const legacyReceive = round2(it.prodReceive - batchIn), legacyIssue = round2(it.prodIssue - batchOut)
  if (legacyReceive > 0) {
    allocate(legacyReceive, byMonth("sale").map((v, i) => v + (i === 0 ? 1e-6 : 0))).forEach((q, i) => {
      if (q) rows.push({ date: `${months[i]}-01`, type: "prodReceive", in: q, out: 0, summary: true })
    })
  }
  if (legacyIssue > 0) {
    const pur = byMonth("purchase")
    allocate(legacyIssue, pur.map((v) => v + it.opening / months.length)).forEach((q, i) => {
      if (q) rows.push({ date: monthEnd(months[i]), type: "prodIssue", in: 0, out: q, summary: true })
    })
  }
  // Damage recorded before damage entries existed (legacy) stays a summary row
  const legacyDamage = round2(it.damage - damageDocs)
  if (legacyDamage > 0) rows.push({ date: monthEnd(months[months.length - 2] ?? months[0]), type: "damage", in: 0, out: legacyDamage, summary: true })
  return rows
}

export const sortRows = <T extends Pick<Row, "date" | "type">>(rows: T[]) => rows.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type])

const DESC: Record<LedgerType, string> = {
  opening: "Opening balance", purchase: "Purchase", purchaseReturn: "Purchase return (debit note 6.8)", sale: "Sale", prodReceive: "Received from production",
  prodIssue: "Issued to production", saleReturn: "Sales return (credit note 6.7)", damage: "Damage / wastage", transferIn: "Transfer in", transferOut: "Transfer out",
}

/**
 * Mushak 6.1 (purchase book, inputs) / 6.2 (sales book, finished goods) for one item and period.
 * Quantities come from the stock ledger (company-wide, transfers net out); values use the weighted-average cost:
 * receipts at document value (purchase value excl. SD/VAT, opening value, production at standard cost),
 * issues at the running average. 6.2 sale rows show the sale value, SD and VAT charged.
 */
export function buildBook(form: "6.1" | "6.2", it: Item, from: string, to: string) {
  const rows = sortRows(ledgerRows(it).filter((r) => !r.transfer))
  let qty = 0, value = 0
  const avg = () => (qty > 0 ? value / qty : it.costPrice || it.purchasePrice)
  const out: BookRow[] = []
  let opening = { qty: 0, value: 0 }
  const totals = { inQty: 0, inValue: 0, sd: 0, vat: 0, outQty: 0, outValue: 0 }
  for (const r of rows) {
    if (r.date > to) break
    const openQty = round2(qty), openValue = round2(value)
    let inValue = 0, outValue = 0, cost = 0
    if (r.in) {
      inValue = r.value ?? round2(r.in * (it.costPrice || it.purchasePrice))
      qty += r.in; value += inValue
    } else {
      cost = r.type === "purchaseReturn" && r.value != null ? r.value : round2(r.out * avg())
      outValue = form === "6.2" && r.type === "sale" && r.value != null ? r.value : cost
      qty -= r.out; value -= cost
      if (Math.abs(qty) < 1e-9) { qty = 0; value = 0 }
    }
    if (r.date < from) { opening = { qty: round2(qty), value: round2(value) }; continue }
    const row: BookRow = {
      sl: out.length + 1, date: r.date, openQty, openValue, ref: r.ref, refId: r.refId, refDate: r.refDate, party: r.type === "opening" ? undefined : r.party,
      partyAddress: r.partyAddress, partyBin: r.partyBin, description: DESC[r.type] + (r.challan ? ` — ${r.challan}` : ""),
      inQty: r.in, inValue: round2(inValue), sd: r.sd ?? 0, vat: r.vat ?? 0, outQty: r.out, outValue: round2(outValue),
      closeQty: round2(qty), closeValue: round2(value), kind: r.type, summary: r.summary,
    }
    if (r.type === "purchaseReturn" || r.type === "saleReturn") { row.sd = -(r.sd ?? 0); row.vat = -(r.vat ?? 0) }
    totals.inQty += row.inQty; totals.inValue += row.inValue; totals.outQty += row.outQty; totals.outValue += row.outValue; totals.sd += row.sd; totals.vat += row.vat
    out.push(row)
  }
  if (!out.length && opening.qty === 0) opening = { qty: round2(qty), value: round2(value) }
  const r2 = (o: typeof totals) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)])) as typeof totals
  return { form, from, to, rows: out, totals: r2(totals), opening, closing: { qty: round2(qty), value: round2(value) } }
}
