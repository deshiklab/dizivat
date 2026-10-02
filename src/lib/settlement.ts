/**
 * R6.5 (RMG) — UD / UP bond settlement.
 *
 * A direct garment exporter imports its bonded inputs against a Utilization Declaration (BGMEA / BKMEA) or a
 * Utilization Permission (Bond Commissionerate) for each export order. After the order has shipped (or the UD has
 * expired) the Bond Commissionerate settles the UD: inputs imported against it are matched with what its exports
 * consumed through the input–output coefficient (BOM gross quantity incl. wastage, Mushak 4.3). A left-over balance is
 * either carried forward to another of the exporter's UDs or cleared on payment of the full duty; imports beyond the
 * UD quantity attract duty too. Consumption beyond the UD's own imports was met from other stock (duty-paid inputs —
 * drawback — or local purchases) and needs no settlement.
 *
 * The statement is per UD (customs settles UD by UD), so it can differ from the FIFO bond register, which follows the
 * stock across all UDs; a duty-paid clearance at settlement leaves the bond register too (see bond.ts).
 */
import { bomOn } from "./bond"
import { proceedsSummary } from "./proceeds"
import { daysBetween } from "./sd-export"
import { round2 } from "./vat"
import type { Bom, BondUd, BondUdRegister, BondUdRow, BondUdWarning, Purchase, Sale, UdGarmentProgress, UdSettlementLine, UdStatementLine } from "./types"

const EPS = 0.0005
const q3 = (n: number) => Math.round(n * 1000) / 1000
export const normUd = (s?: string) => (s ?? "").trim().toUpperCase()

export interface UdSource { purchases: Purchase[]; sales: Sale[]; boms: Bom[]; bondUds: BondUd[] }

/** Approved, non-service exports shipped under the UD (direct and deemed). */
const exportsOf = (ud: BondUd, sales: Sale[], process: Sale["process"] = "Approved") =>
  sales.filter((s) => s.process === process && s.category !== "service" && !!s.export && normUd(s.export.ownUdNo) === normUd(ud.no))

/** Live settlement statement of one UD (inputs brought in vs consumed by its exports). */
export function udStatement(ud: BondUd, src: UdSource): { lines: UdStatementLine[]; noCoefficient: BondUdRow["noCoefficient"] } {
  const lines = new Map<string, UdStatementLine>()
  const line = (itemId: string, name: string, uom: string, hsCode: string) => {
    let l = lines.get(itemId)
    if (!l) {
      l = { itemId, name, uom, hsCode, permitted: 0, broughtForward: 0, imported: 0, available: 0, consumed: 0, fromOtherStock: 0, balance: 0, excessImport: 0, dutyForegone: 0, dutyPerUnit: 0, dutyOnBalance: 0, boes: [], carriedIn: [], state: "balanced" }
      lines.set(itemId, l)
    }
    return l
  }
  for (const i of ud.inputs) line(i.itemId, i.name, i.uom, i.hsCode).permitted += i.qty
  // imported under bond against the UD
  for (const p of src.purchases) {
    if (p.process !== "Approved" || p.mode !== "Foreign" || !p.boe?.bonded || normUd(p.boe.udNo) !== normUd(ud.no)) continue
    for (const pl of p.lines) {
      if (!(pl.qty > 0)) continue
      const l = line(pl.itemId, pl.name, pl.uom, pl.hsCode)
      l.imported += pl.qty
      l.dutyForegone += pl.duty?.foregone?.total ?? 0
      l.boes.push({ purchaseId: p.id, purchaseNo: p.invoiceNo, boeNo: p.boe.no || p.challanNo, boeDate: p.boe.date || p.challanDate, qty: pl.qty })
    }
  }
  // brought forward from earlier settlements
  for (const o of src.bondUds) {
    if (o.id === ud.id || !o.settlement) continue
    for (const sl of o.settlement.lines) {
      if (!(sl.carryQty > 0) || normUd(sl.carryTo) !== normUd(ud.no)) continue
      const l = line(sl.itemId, sl.name, sl.uom, sl.hsCode)
      l.broughtForward += sl.carryQty
      l.dutyForegone += sl.carryQty * sl.dutyPerUnit
      l.carriedIn.push({ fromUd: o.no, qty: sl.carryQty })
    }
  }
  // consumption by the UD's exports, only for the inputs the statement tracks
  const noCoefficient: BondUdRow["noCoefficient"] = []
  for (const s of exportsOf(ud, src.sales)) {
    for (const sl of s.lines) {
      const bom = bomOn(src.boms, sl.itemId, s.issueDate)
      if (!bom) { noCoefficient.push({ saleId: s.id, invoiceNo: s.invoiceNo, itemId: sl.itemId, name: sl.name }); continue }
      for (const inp of bom.inputs) {
        const l = lines.get(inp.itemId)
        if (l && inp.grossQty > 0) l.consumed += sl.qty * inp.grossQty
      }
    }
  }
  const out = [...lines.values()].map((l) => {
    l.permitted = q3(l.permitted); l.imported = q3(l.imported); l.broughtForward = q3(l.broughtForward); l.consumed = q3(l.consumed)
    l.available = q3(l.imported + l.broughtForward)
    const diff = q3(l.available - l.consumed)
    l.balance = Math.max(0, diff)
    l.fromOtherStock = Math.max(0, q3(-diff))
    l.excessImport = Math.max(0, q3(l.available - l.permitted))
    l.dutyForegone = round2(l.dutyForegone)
    l.dutyPerUnit = l.available > EPS ? Math.round((l.dutyForegone / l.available) * 1e4) / 1e4 : 0
    l.dutyOnBalance = round2(l.balance * l.dutyPerUnit)
    l.state = l.balance > EPS ? "leftover" : l.fromOtherStock > EPS ? "topUp" : "balanced"
    return l
  })
  return { lines: out, noCoefficient }
}

/** Register row: statement (frozen once settled), shipment progress, state and warnings. */
export function bondUdRow(ud: BondUd, src: UdSource, today: string): BondUdRow {
  const live = udStatement(ud, src)
  const shipped = exportsOf(ud, src.sales)
  const garmentsProgress: UdGarmentProgress[] = ud.garments.map((g) => {
    const ex = shipped.flatMap((s) => s.lines.filter((l) => l.itemId === g.itemId).map((l) => ({ saleId: s.id, invoiceNo: s.invoiceNo, date: s.issueDate, qty: l.qty, deemed: !!s.export?.deemed })))
    const q = q3(ex.reduce((a, x) => a + x.qty, 0))
    return { itemId: g.itemId, name: g.name, uom: g.uom, ordered: g.qty, shipped: q, pct: g.qty ? Math.round((q / g.qty) * 1000) / 10 : 0, exports: ex }
  })
  const ordered = garmentsProgress.reduce((a, g) => a + g.ordered, 0)
  const shippedPct = ordered ? Math.min(100, Math.round((garmentsProgress.reduce((a, g) => a + Math.min(g.shipped, g.ordered), 0) / ordered) * 1000) / 10) : 0
  const drafts = exportsOf(ud, src.sales, "Created").length
  const daysLeft = daysBetween(today, ud.expiry)
  const st = ud.settlement
  const lines = st ? st.lines : live.lines
  const fullyShipped = garmentsProgress.length > 0 && garmentsProgress.every((g) => g.shipped + EPS >= g.ordered)
  const state = st ? "settled" : fullyShipped || daysLeft < 0 ? "ready" : "inProgress"
  const warnings: BondUdWarning[] = []
  if (lines.some((l) => l.excessImport > EPS)) warnings.push("excessImport")
  if (!st && live.noCoefficient.length) warnings.push("noCoefficient")
  if (!st && drafts) warnings.push("draftExports")
  if (!st && daysLeft < 0) warnings.push("expired")
  if (garmentsProgress.some((g) => g.shipped > g.ordered + EPS)) warnings.push("overShipped")
  // R6.6: the Bond Commissionerate settles a UD on the export documents incl. the PRCs — flag exports still unrealised
  const proceeds = proceedsSummary(shipped.map((x) => x.id), src.sales, today)
  if (!st && state === "ready" && proceeds.pending) warnings.push("proceedsPending")
  return {
    ...ud, lines, garmentsProgress, shippedPct, state, daysLeft, warnings, drafts,
    dutyOnBalance: st ? 0 : round2(live.lines.reduce((a, l) => a + l.dutyOnBalance, 0)),
    noCoefficient: live.noCoefficient,
    proceeds,
  }
}

const STATE_ORDER = { ready: 0, inProgress: 1, settled: 2 }
export function bondUdRegister(src: UdSource, today: string): BondUdRegister {
  const rows = src.bondUds.map((u) => bondUdRow(u, src, today))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.no.localeCompare(b.no)))
  const settled = rows.filter((r) => r.settlement)
  return {
    rows,
    totals: {
      inProgress: rows.filter((r) => r.state === "inProgress").length, ready: rows.filter((r) => r.state === "ready").length, settled: settled.length,
      dutyOnBalance: round2(rows.reduce((a, r) => a + r.dutyOnBalance, 0)),
      dutyPaid: round2(settled.reduce((a, r) => a + (r.settlement?.dutyPaid ?? 0), 0)),
      carried: settled.reduce((a, r) => a + (r.settlement?.lines.filter((l) => l.carryQty > 0).length ?? 0), 0),
    },
  }
}

export interface SettleInput {
  date: string; bondRef: string; paymentRef?: string; note?: string
  lines: { itemId: string; dutyPaidQty: number; carryQty: number; carryTo?: string }[]
}

/**
 * Validates a settlement against the live statement. Every left-over balance must be disposed of in full —
 * cleared on duty and / or carried to another open UD of ours that lists the input.
 */
export function settleCheck(row: BondUdRow, live: UdStatementLine[], d: SettleInput, uds: BondUd[], today: string): { errors?: Record<string, string[]>; lines?: UdSettlementLine[]; dutyPaid?: number } {
  const errors: Record<string, string[]> = {}
  if (row.state === "inProgress") errors.state = ["notReady"]
  if (row.drafts > 0) errors.state = ["draftExports"]
  if (d.date > today) errors.date = ["afterToday"]
  else if (d.date < row.date) errors.date = ["beforeUd"]
  const byItem = new Map(d.lines.map((l, i) => [l.itemId, { ...l, i }]))
  d.lines.forEach((l, i) => { if (!live.some((x) => x.itemId === l.itemId)) errors[`lines.${i}.itemId`] = ["unknownLine"] })
  const out: UdSettlementLine[] = live.map((l) => {
    const x = byItem.get(l.itemId)
    const dutyPaidQty = q3(x?.dutyPaidQty ?? 0), carryQty = q3(x?.carryQty ?? 0)
    const key = (f: string) => (x ? `lines.${x.i}.${f}` : "lines")
    if (Math.abs(dutyPaidQty + carryQty - l.balance) > EPS * 2) errors[key("dutyPaidQty")] = [l.balance > EPS ? "mustEqualBalance" : "noBalance"]
    let carryTo: string | undefined
    if (carryQty > 0) {
      const target = uds.find((u) => normUd(u.no) === normUd(x?.carryTo))
      if (!target || target.id === row.id || target.settlement || !target.inputs.some((i) => i.itemId === l.itemId)) errors[key("carryTo")] = ["carryTarget"]
      else carryTo = target.no
    }
    return { ...l, dutyPaidQty, carryQty, carryTo, dutyPaid: round2(dutyPaidQty * l.dutyPerUnit) }
  })
  if (Object.keys(errors).length) return { errors }
  return { lines: out, dutyPaid: round2(out.reduce((a, l) => a + l.dutyPaid, 0)) }
}
