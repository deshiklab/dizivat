/**
 * R6.4 (RMG) — bond consumption register and duty drawback.
 *
 * A bonded garment factory imports fabric, yarn and accessories without paying duty: the Bill of Entry is a
 * warehousing entry (IM-7) secured by the general bond, and the goods may only leave the bond inside exported
 * garments. Customs Act s.114 makes the licensee keep a register of those goods (s.114(3): duty-paid and locally
 * bought inputs too); the Bond Commissionerate audits it every year, settles each UD / UP after export and charges
 * the full duty on anything it cannot account for.
 *
 * Consumption is not counted at the cutting table but through the input–output coefficient: every export line ×
 * the gross quantity (incl. wastage) of each input in the approved BOM (Mushak 4.3) in force on the export date.
 *
 * One chronological pass per input item; export consumption is met
 *   1. from bonded lots, oldest Bill of Entry first (bonded inputs exist for export production),
 *   2. then from duty-paid import lots, oldest first — the customs duty on those is refundable as drawback,
 *   3. then from local purchases and go-live stock; anything left is "unsourced" (records out of line).
 *
 * Bonding period (SRO, special bonded warehouse / direct exporter): 24 months from the Bill of Entry, extendable by
 * the Commissioner for at most 6 months; after that the duty on the balance is payable.
 * Drawback (DEDO, Mushak-22): customs duty + regulatory duty on imported inputs consumed in an export, claimed
 * within 6 months of the export. VAT and AT are already input credit in the return, SD on exported inputs goes
 * through 9.1 note 40 and AIT is an income-tax advance — none of them is counted here.
 */
import { addMonths, daysBetween } from "./sd-export"
import { calcImportLine, round2 } from "./vat"
import type { Bom, BondItemRow, BondLot, BondRegister, BondRow, DrawbackRow, Item, Line, OpeningEntry, Purchase, Sale } from "./types"

/**
 * R6.4: a bonded (IM-7) Bill-of-Entry line — the duty stack is assessed as usual but suspended under the bond, so
 * nothing is payable, nothing is creditable (9.1 note 11) and the landed cost is the assessable value alone.
 */
export function bondedLine(it: Pick<Item, "id" | "name" | "hsCode" | "unit">, l: { qty: number; usd: number; usdRate: number; cdRate: number; rdRate: number; sdRate: number; vatRate: number; aitRate: number; atRate: number }, c: ReturnType<typeof calcImportLine>): Line {
  return {
    itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty, price: c.unitAv, sdRate: l.sdRate, vatRate: l.vatRate,
    subtotal: c.av, sd: 0, vat: 0, total: c.av, tti: 0, rebateable: true, vds: false,
    duty: {
      usd: l.usd, usdRate: l.usdRate, av: c.av, cdRate: l.cdRate, cd: 0, rdRate: l.rdRate, rd: 0, aitRate: l.aitRate, ait: 0, atRate: l.atRate, at: 0,
      foregone: { cd: c.cd, rd: c.rd, sd: c.sd, vat: c.vat, ait: c.ait, at: c.at, total: c.tti },
    },
  }
}

export const BOND_PERIOD_MONTHS = 24
export const BOND_EXTENSION_MONTHS = 6
/** a lot is "expiring" this many days before the end of the bonding period */
export const BOND_EXPIRING_DAYS = 90
export const DRAWBACK_MONTHS = 6
export const DRAWBACK_EXPIRING_DAYS = 30

const q3 = (n: number) => Math.round(n * 1000) / 1000
const EPS = 0.0005

export interface BondSource {
  purchases: Purchase[]
  sales: Sale[]
  boms: Bom[]
  items: Item[]
  openings: OpeningEntry[]
}

/** Approved BOM (input–output coefficient) of a finished good in force on `date`: latest effective date, then version. */
export function bomOn(boms: Bom[], itemId: string, date: string): Bom | undefined {
  return boms
    .filter((b) => b.itemId === itemId && b.process === "Approved" && b.effectiveDate <= date)
    .sort((a, b) => (a.effectiveDate === b.effectiveDate ? b.version - a.version : a.effectiveDate < b.effectiveDate ? 1 : -1))[0]
}

/** Exports that consume bonded inputs: approved direct and deemed export invoices of goods. */
export const isExport = (s: Sale) => !!s.export && s.process === "Approved" && s.category !== "service"

type Receipt =
  | { kind: "bonded"; date: string; lot: BondLot }
  | { kind: "paid"; date: string; purchase: Purchase; qty: number; cdPer: number; rdPer: number }
  | { kind: "local"; date: string; qty: number }
type Use = { kind: "use"; date: string; sale: Sale; qty: number }
type Ev = Receipt | Use

function lotState(l: BondLot, asOf: string): BondLot["state"] {
  if (l.balance <= EPS) return "cleared"
  if (asOf > l.extendedDue) return "overdue"
  if (asOf > l.dueDate) return "extension"
  return l.daysLeft <= BOND_EXPIRING_DAYS ? "expiring" : "open"
}

export interface BondOptions {
  today: string
  from?: string
  to?: string
  licence: BondRow
  /** stock on hand per item today — compared with the bonded book balance when the range ends today */
  stock: (itemId: string) => number
}

export function bondRegister(src: BondSource, o: BondOptions): BondRegister {
  const to = o.to && o.to < o.today ? o.to : o.today
  const from = o.from && o.from <= to ? o.from : "0000-01-01"
  const fg = new Set(src.items.filter((i) => i.group === "Finished Goods").map((i) => i.id))
  const itemOf = new Map(src.items.map((i) => [i.id, i]))
  const events = new Map<string, Ev[]>()
  const push = (itemId: string, e: Ev) => { if (!fg.has(itemId)) (events.get(itemId) ?? events.set(itemId, []).get(itemId)!).push(e) }

  // receipts — go-live stock (a bonded part may be brought forward with its Bill of Entry)
  for (const os of src.openings) {
    if (os.process !== "Approved" || os.date > to) continue
    const bq = os.bond ? Math.min(os.bond.qty, os.qty) : 0
    if (os.bond && bq > 0) {
      push(os.itemId, { kind: "bonded", date: os.date, lot: newLot("opening", os.id, os.no, os.bond.boeNo, os.bond.boeDate, os.itemId, os.name, os.uom, bq, os.bond.dutyForegone) })
    }
    if (os.qty - bq > 0) push(os.itemId, { kind: "local", date: os.date, qty: os.qty - bq })
  }
  // receipts — purchases
  for (const p of src.purchases) {
    if (p.process !== "Approved" || p.category === "service" || p.issueDate > to) continue
    const imp = p.mode === "Foreign"
    p.lines.forEach((l, i) => {
      if (!(l.qty > 0)) return
      if (imp && p.boe?.bonded) {
        push(l.itemId, { kind: "bonded", date: p.issueDate, lot: newLot("import", p.id, p.invoiceNo, p.boe.no || p.challanNo, p.boe.date || p.challanDate, l.itemId, l.name, l.uom, l.qty, l.duty?.foregone?.total ?? 0, i) })
      } else if (imp) {
        push(l.itemId, { kind: "paid", date: p.issueDate, purchase: p, qty: l.qty, cdPer: (l.duty?.cd ?? 0) / l.qty, rdPer: (l.duty?.rd ?? 0) / l.qty })
      } else {
        push(l.itemId, { kind: "local", date: p.issueDate, qty: l.qty })
      }
    })
  }
  // consumption — exports × coefficient
  const noCoefficient: BondRegister["noCoefficient"] = []
  for (const s of src.sales) {
    if (!isExport(s) || s.issueDate > to) continue
    for (const l of s.lines) {
      const bom = bomOn(src.boms, l.itemId, s.issueDate)
      if (!bom) {
        if (s.issueDate >= from) noCoefficient.push({ saleId: s.id, invoiceNo: s.invoiceNo, date: s.issueDate, itemId: l.itemId, name: l.name, qty: l.qty })
        continue
      }
      for (const inp of bom.inputs) if (inp.grossQty > 0) push(inp.itemId, { kind: "use", date: s.issueDate, sale: s, qty: l.qty * inp.grossQty })
    }
  }

  const rows: BondItemRow[] = []
  const lots: BondLot[] = []
  const draw = new Map<string, DrawbackRow>()
  for (const [itemId, evs] of events) {
    const it = itemOf.get(itemId)
    if (!it) continue
    // receipts before consumption on the same day; stable otherwise
    evs.sort((a, b) => (a.date === b.date ? (a.kind === "use" ? 1 : 0) - (b.kind === "use" ? 1 : 0) : a.date < b.date ? -1 : 1))
    const bonded: BondLot[] = []
    const paid: { r: Extract<Receipt, { kind: "paid" }>; left: number }[] = []
    let local = 0
    const row: BondItemRow = {
      itemId, name: it.name, uom: it.unit, hsCode: it.hsCode, opening: 0, bondedIn: 0, bondedUsed: 0, closing: 0, dutyPaidIn: 0, localIn: 0,
      exportUse: 0, fromDutyPaid: 0, fromLocal: 0, unsourced: 0, physical: null, shortfall: 0, dutyPerUnit: 0, dutyOnBalance: 0, dutyAtRisk: 0, state: "ok",
    }
    let ever = false
    for (const e of evs) {
      const inRange = e.date >= from
      if (e.kind === "bonded") { bonded.push(e.lot); ever = true; if (inRange) row.bondedIn += e.lot.qty; else row.opening += e.lot.qty; continue }
      if (e.kind === "paid") { paid.push({ r: e, left: e.qty }); if (inRange) row.dutyPaidIn += e.qty; continue }
      if (e.kind === "local") { local += e.qty; if (inRange) row.localIn += e.qty; continue }
      // consumption
      let need = e.qty
      for (const l of bonded) {
        if (need <= EPS) break
        const take = Math.min(need, l.qty - l.consumed)
        if (take <= 0) continue
        l.consumed += take; need -= take
        if (inRange) row.bondedUsed += take; else row.opening -= take
      }
      for (const p of paid) {
        if (need <= EPS) break
        const take = Math.min(need, p.left)
        if (take <= 0) continue
        p.left -= take; need -= take
        if (inRange) { row.fromDutyPaid += take; addDrawback(draw, e.sale, p.r, it, take) }
      }
      if (need > EPS) { const take = Math.min(need, local); local -= take; need -= take; if (inRange) row.fromLocal += take }
      if (inRange) { row.exportUse += e.qty; if (need > EPS) row.unsourced += need }
    }
    const consumedInRange = row.exportUse > 0
    if (!ever && !consumedInRange) continue
    for (const l of bonded) {
      l.consumed = q3(l.consumed)
      l.balance = q3(l.qty - l.consumed)
      l.dutyOnBalance = l.qty ? round2((l.dutyForegone * l.balance) / l.qty) : 0
      l.daysLeft = daysBetween(to, l.dueDate)
      l.state = lotState(l, to)
      lots.push(l)
    }
    row.opening = q3(row.opening); row.bondedIn = q3(row.bondedIn); row.bondedUsed = q3(row.bondedUsed)
    row.closing = q3(row.opening + row.bondedIn - row.bondedUsed)
    row.dutyPaidIn = q3(row.dutyPaidIn); row.localIn = q3(row.localIn); row.exportUse = q3(row.exportUse)
    row.fromDutyPaid = q3(row.fromDutyPaid); row.fromLocal = q3(row.fromLocal); row.unsourced = q3(row.unsourced)
    row.dutyOnBalance = round2(bonded.reduce((a, l) => a + l.dutyOnBalance, 0))
    row.dutyPerUnit = row.closing > EPS ? round2(row.dutyOnBalance / row.closing) : 0
    if (to === o.today) {
      row.physical = q3(Math.max(0, o.stock(itemId)))
      row.shortfall = q3(Math.max(0, row.closing - row.physical))
    }
    const overdueDuty = bonded.filter((l) => l.state === "overdue").reduce((a, l) => a + l.dutyOnBalance, 0)
    row.dutyAtRisk = round2(Math.min(row.dutyOnBalance, row.shortfall * row.dutyPerUnit + overdueDuty))
    row.state = row.shortfall > EPS ? "shortfall" : row.unsourced > EPS ? "overUsed" : !ever || (row.closing <= EPS && row.bondedIn <= EPS && row.bondedUsed <= EPS) ? "idle" : "ok"
    rows.push(row)
  }
  const order = { shortfall: 0, overUsed: 1, ok: 2, idle: 3 }
  rows.sort((a, b) => order[a.state] - order[b.state] || b.dutyOnBalance - a.dutyOnBalance || a.itemId.localeCompare(b.itemId, "en", { numeric: true }))
  const lotOrder = { overdue: 0, extension: 1, expiring: 2, open: 3, cleared: 4 }
  lots.sort((a, b) => lotOrder[a.state] - lotOrder[b.state] || (a.boeDate < b.boeDate ? -1 : a.boeDate > b.boeDate ? 1 : a.key.localeCompare(b.key)))

  const drawRows = [...draw.values()].map((r) => {
    r.cd = round2(r.inputs.reduce((a, x) => a + x.cd, 0))
    r.rd = round2(r.inputs.reduce((a, x) => a + x.rd, 0))
    r.total = round2(r.cd + r.rd)
    r.inputs.forEach((x) => { x.qty = q3(x.qty); x.cd = round2(x.cd); x.rd = round2(x.rd) })
    r.daysLeft = daysBetween(to, r.deadline)
    r.state = r.daysLeft < 0 ? "lapsed" : r.daysLeft <= DRAWBACK_EXPIRING_DAYS ? "expiring" : "open"
    return r
  }).filter((r) => r.total > 0).sort((a, b) => (a.exportDate < b.exportDate ? 1 : a.exportDate > b.exportDate ? -1 : a.saleId.localeCompare(b.saleId)))
  const sum = (xs: DrawbackRow[]) => round2(xs.reduce((a, r) => a + r.total, 0))

  return {
    asOf: to, from: from === "0000-01-01" ? "" : from, to,
    licence: o.licence,
    rows, lots,
    drawback: {
      rows: drawRows,
      totals: { claimable: sum(drawRows.filter((r) => r.state !== "lapsed")), expiring: sum(drawRows.filter((r) => r.state === "expiring")), lapsed: sum(drawRows.filter((r) => r.state === "lapsed")) },
    },
    noCoefficient,
    totals: {
      bondedItems: rows.filter((r) => r.state !== "idle").length,
      dutyOnBalance: round2(rows.reduce((a, r) => a + r.dutyOnBalance, 0)),
      dutyAtRisk: round2(rows.reduce((a, r) => a + r.dutyAtRisk, 0)),
      shortfallItems: rows.filter((r) => r.state === "shortfall").length,
      overUsedItems: rows.filter((r) => r.unsourced > EPS).length,
      lotsExpiring: lots.filter((l) => l.state === "expiring").length,
      lotsExtension: lots.filter((l) => l.state === "extension").length,
      lotsOverdue: lots.filter((l) => l.state === "overdue").length,
    },
  }
}

function newLot(source: BondLot["source"], docId: string, docNo: string, boeNo: string, boeDate: string, itemId: string, name: string, uom: string, qty: number, dutyForegone: number, line = 0): BondLot {
  const dueDate = addMonths(boeDate, BOND_PERIOD_MONTHS)
  return {
    key: `${docId}|${line}`, source, docId, docNo, boeNo, boeDate, itemId, name, uom, qty, consumed: 0, balance: qty, dutyForegone: round2(dutyForegone), dutyOnBalance: 0,
    dueDate, extendedDue: addMonths(boeDate, BOND_PERIOD_MONTHS + BOND_EXTENSION_MONTHS), daysLeft: 0, state: "open",
  }
}

function addDrawback(m: Map<string, DrawbackRow>, s: Sale, r: Extract<Receipt, { kind: "paid" }>, it: Item, qty: number) {
  const exportDate = s.export?.billDate || s.issueDate
  const row = m.get(s.id) ?? m.set(s.id, {
    saleId: s.id, invoiceNo: s.invoiceNo, exportDate, billNo: s.export?.billNo ?? "", deemed: !!s.export?.deemed, customerName: s.customerName,
    inputs: [], cd: 0, rd: 0, total: 0, deadline: addMonths(exportDate, DRAWBACK_MONTHS), daysLeft: 0, state: "open",
  }).get(s.id)!
  const p = r.purchase
  const x = row.inputs.find((i) => i.purchaseId === p.id && i.itemId === it.id)
  const cd = qty * r.cdPer, rd = qty * r.rdPer
  if (x) { x.qty += qty; x.cd += cd; x.rd += rd }
  else row.inputs.push({ purchaseId: p.id, purchaseNo: p.invoiceNo, boeNo: p.boe?.no || p.challanNo, itemId: it.id, name: it.name, uom: it.unit, qty, cd, rd })
}
