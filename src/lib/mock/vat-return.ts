/**
 * Mushak 9.1 engine (pure): computes every note of the VAT return for a tax period from the source documents,
 * and lists the documents behind a note (the sub-forms). Used by the seed, the API and the period lock.
 */
import type { CreditNote, DebitNote, Purchase, ReturnComputation, ReturnManual, ReturnNote, Sale, SubFormRow, TreasuryDeposit, VatAdjustment, VatReturn, VdsEntry } from "../types"
import { economicCode, HEAD_NOTE, NON_BANK_LIMIT, periodOf, prevPeriod, RETURN_NOTES, TREASURY_HEADS } from "../r4"
import { round2 } from "../vat"

export interface ReturnSource {
  sales: Sale[]; purchases: Purchase[]; creditNotes: CreditNote[]; debitNotes: DebitNote[]
  vds: VdsEntry[]; adjustments: VatAdjustment[]; treasury: TreasuryDeposit[]; returns: VatReturn[]
  vatSettings: { zoneCode: string }
}

export const EMPTY_MANUAL: ReturnManual = {
  interestVat: 0, interestSd: 0, penaltyLate: 0, penaltyOther: 0, excise: 0, devSurcharge: 0, ictSurcharge: 0, healthSurcharge: 0, envSurcharge: 0,
  refund: false, refundVat: 0, refundSd: 0,
}

const approved = <T extends { process: string }>(rows: T[]) => rows.filter((r) => r.process === "Approved")
const isImport = (p: Purchase) => p.mode === "Foreign" && p.category !== "service"

/** Part 3 note of a sales line. */
export function saleNote(s: Sale, vatRate: number): number {
  if (s.export) return s.export.deemed ? 2 : 1
  if (vatRate === 0) return 3
  return vatRate === 15 ? 4 : 7
}
/** Part 4 note of a purchase line. */
export function purchaseNote(p: Purchase, l: Purchase["lines"][number]): number {
  const imp = isImport(p)
  if (p.mode === "Non-registered") return 20
  if (!l.rebateable) return imp ? 22 : 21
  if (l.vatRate === 0) return imp ? 13 : 12
  if (l.vatRate === 15) return imp ? 15 : 14
  return imp ? 17 : 16
}
const ADMISSIBLE = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18])
/** Purchases whose input tax is reversed because they were paid in cash above the limit (note 25). */
export const nonBankPurchase = (p: Purchase) => p.method === "Cash" && p.netTotal > NON_BANK_LIMIT && p.rebate > 0

/** The submitted return that locks a date's tax period, if any. */
export function lockingReturn(src: Pick<ReturnSource, "returns">, date: string) {
  const p = periodOf(date)
  return src.returns.find((r) => r.period === p && r.status === "submitted")
}

export function computeReturn(src: ReturnSource, period: string, manual: ReturnManual = EMPTY_MANUAL): ReturnComputation {
  const inP = (d: string) => periodOf(d) === period
  const n = new Map<number, ReturnNote>(RETURN_NOTES.map((d) => [d.note, { note: d.note, part: d.part, ...(d.kind === "amount" ? { amount: 0 } : { value: 0, vat: 0, ...(d.kind === "vsv" ? { sd: 0 } : {}) }), count: 0 }]))
  const add = (note: number, v: { value?: number; sd?: number; vat?: number; amount?: number }, count = 1) => {
    const x = n.get(note)!
    if (v.value != null) x.value = round2((x.value ?? 0) + v.value)
    if (v.sd != null) x.sd = round2((x.sd ?? 0) + v.sd)
    if (v.vat != null) x.vat = round2((x.vat ?? 0) + v.vat)
    if (v.amount != null) x.amount = round2((x.amount ?? 0) + v.amount)
    x.count = (x.count ?? 0) + count
  }
  const set = (note: number, amount: number) => { n.get(note)!.amount = round2(amount) }
  const amt = (note: number) => n.get(note)!.amount ?? 0

  // Part 3 — supplies
  const sales = approved(src.sales).filter((s) => inP(s.issueDate))
  for (const s of sales) {
    const seen = new Set<number>()
    for (const l of s.lines) { const k = saleNote(s, l.vatRate); add(k, { value: l.subtotal, sd: l.sd, vat: l.vat }, seen.has(k) ? 0 : 1); seen.add(k) }
  }
  for (let k = 1; k <= 8; k++) { const x = n.get(k)!; add(9, { value: x.value, sd: x.sd, vat: x.vat }, x.count) }

  // Part 4 — purchases
  const purchases = approved(src.purchases).filter((p) => inP(p.issueDate))
  let at = 0
  for (const p of purchases) {
    const seen = new Set<number>()
    for (const l of p.lines) {
      const k = purchaseNote(p, l)
      add(k, { value: l.subtotal, vat: l.vat }, seen.has(k) ? 0 : 1); seen.add(k)
      if (l.rebateable && l.duty) at += l.duty.at
    }
  }
  const t23 = n.get(23)!
  for (let k = 10; k <= 22; k++) {
    const x = n.get(k)!
    t23.value = round2((t23.value ?? 0) + (x.value ?? 0))
    if (ADMISSIBLE.has(k)) t23.vat = round2((t23.vat ?? 0) + (x.vat ?? 0))
    t23.count = (t23.count ?? 0) + (x.count ?? 0)
  }

  // Part 5 — increasing adjustments
  const vds = approved(src.vds).filter((v) => v.taxPeriod === period)
  for (const v of vds) add(v.mode === "purchase" ? 24 : 29, { amount: v.amount })
  for (const p of purchases.filter(nonBankPurchase)) add(25, { amount: p.rebate })
  for (const d of approved(src.debitNotes).filter((x) => inP(x.issueDate))) add(26, { amount: d.rebate })
  const adj = approved(src.adjustments).filter((a) => a.taxPeriod === period)
  for (const a of adj) add(a.note, { amount: a.amount })
  set(28, amt(24) + amt(25) + amt(26) + amt(27))

  // Part 6 — decreasing adjustments
  if (at) add(30, { amount: at }, purchases.filter((p) => p.lines.some((l) => l.rebateable && l.duty?.at)).length)
  const cns = approved(src.creditNotes).filter((x) => inP(x.issueDate))
  for (const c of cns) { add(31, { amount: c.vat }); if (c.sd) add(39, { amount: c.sd }) }
  set(33, amt(29) + amt(30) + amt(31) + amt(32))

  // Part 7 — net tax
  const prev = src.returns.find((r) => r.period === prevPeriod(period) && r.status === "submitted")?.snapshot
  const openingVat = prev?.closingVat ?? 0, openingSd = prev?.closingSd ?? 0
  set(52, openingVat); set(53, openingSd)
  const out = n.get(9)!, inp = n.get(23)!
  set(34, (out.vat ?? 0) - (inp.vat ?? 0) + amt(28) - amt(33))
  set(35, amt(34) - (amt(52) + amt(56)))
  set(36, (out.sd ?? 0) + amt(38) - (amt(39) + amt(40)))
  set(37, amt(36) - (amt(53) + amt(57)))
  set(41, manual.interestVat); set(42, manual.interestSd); set(43, manual.penaltyLate); set(44, manual.penaltyOther)
  set(45, manual.excise); set(46, manual.devSurcharge); set(47, manual.ictSurcharge); set(48, manual.healthSurcharge); set(49, manual.envSurcharge)
  set(50, amt(35) + amt(41) + amt(43) + amt(44))
  set(51, amt(37) + amt(42))

  // Part 9 — treasury deposits counted toward this period
  const zone = src.vatSettings.zoneCode
  for (const h of TREASURY_HEADS) { const x = n.get(HEAD_NOTE[h])!; x.code ??= economicCode(h, zone) }
  for (const d of approved(src.treasury).filter((x) => x.taxPeriod === period)) add(HEAD_NOTE[d.head], { amount: d.amount })

  // Part 11 & 10
  if (manual.refund) { set(67, manual.refundVat); set(68, manual.refundSd) }
  set(65, amt(58) - (amt(50) + amt(67)))
  set(66, amt(59) - (amt(51) + amt(68)))

  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 29, 30, 31, 32, 39, 38, 58, 59, 60, 61, 62, 63, 64]) {
    const x = n.get(k)!
    if (x.count) x.drill = true
  }
  const inPeriodDrafts = [
    ...src.sales.filter((s) => s.process === "Created" && inP(s.issueDate)), ...src.purchases.filter((p) => p.process === "Created" && inP(p.issueDate)),
    ...src.creditNotes.filter((x) => x.process === "Created" && inP(x.issueDate)), ...src.debitNotes.filter((x) => x.process === "Created" && inP(x.issueDate)),
    ...src.vds.filter((x) => x.process === "Created" && x.taxPeriod === period), ...src.adjustments.filter((x) => x.process === "Created" && x.taxPeriod === period),
    ...src.treasury.filter((x) => x.process === "Created" && x.taxPeriod === period),
  ]
  const dn = approved(src.debitNotes).filter((x) => inP(x.issueDate))
  return {
    period,
    notes: [...n.values()],
    outputVat: out.vat ?? 0, inputVat: inp.vat ?? 0, increasing: amt(28), decreasing: amt(33),
    netVat: amt(34), netVatAfter: amt(35), netSd: amt(36), netSdAfter: amt(37),
    payableVat: amt(50), payableSd: amt(51), depositedVat: amt(58), depositedSd: amt(59),
    closingVat: amt(65), closingSd: amt(66), openingVat, openingSd,
    dashboardNet: round2((out.vat ?? 0) - cns.reduce((a, c) => a + c.vat, 0) - purchases.reduce((a, p) => a + p.rebate, 0) + dn.reduce((a, d) => a + d.rebate, 0)),
    shortVat: round2(Math.max(0, amt(50) - amt(58))), shortSd: round2(Math.max(0, amt(51) - amt(59))),
    drafts: inPeriodDrafts.length,
  }
}

/** Source documents behind one note (9.1 sub-form). Totals equal the note. */
export function subForm(src: ReturnSource, period: string, note: number): SubFormRow[] {
  const inP = (d: string) => periodOf(d) === period
  const rows: SubFormRow[] = []
  if ((note >= 1 && note <= 9)) {
    for (const s of approved(src.sales).filter((x) => inP(x.issueDate))) {
      const ls = s.lines.filter((l) => note === 9 || saleNote(s, l.vatRate) === note)
      if (!ls.length) continue
      rows.push({ date: s.issueDate, ref: s.invoiceNo, refId: s.id, href: `/sales/${s.id}`, party: s.customerName, bin: s.customerBin, value: round2(ls.reduce((a, l) => a + l.subtotal, 0)), sd: round2(ls.reduce((a, l) => a + l.sd, 0)), vat: round2(ls.reduce((a, l) => a + l.vat, 0)), note: s.challanNo })
    }
  } else if (note >= 10 && note <= 23) {
    for (const p of approved(src.purchases).filter((x) => inP(x.issueDate))) {
      const ls = p.lines.filter((l) => note === 23 || purchaseNote(p, l) === note)
      if (!ls.length) continue
      const vat = note === 23 ? ls.filter((l) => ADMISSIBLE.has(purchaseNote(p, l))).reduce((a, l) => a + l.vat, 0) : ls.reduce((a, l) => a + l.vat, 0)
      rows.push({ date: p.issueDate, ref: p.invoiceNo, refId: p.id, href: `/purchases/${p.id}`, party: p.vendorName, bin: p.vendorBin, value: round2(ls.reduce((a, l) => a + l.subtotal, 0)), vat: round2(vat), note: p.boe?.no ?? p.challanNo })
    }
  } else if (note === 24 || note === 29) {
    for (const v of approved(src.vds).filter((x) => x.taxPeriod === period && x.mode === (note === 24 ? "purchase" : "sales")))
      rows.push({ date: v.certificateDate, ref: v.no, refId: v.id, href: `/vat/vds?view=${v.id}`, party: v.partyName, bin: v.partyBin, value: v.docValue, vat: v.amount, note: `${v.docNo}${v.certificateNo ? ` · ${v.certificateNo}` : ""}` })
  } else if (note === 25) {
    for (const p of approved(src.purchases).filter((x) => inP(x.issueDate) && nonBankPurchase(x)))
      rows.push({ date: p.issueDate, ref: p.invoiceNo, refId: p.id, href: `/purchases/${p.id}`, party: p.vendorName, bin: p.vendorBin, value: p.netTotal, vat: p.rebate, note: "Cash" })
  } else if (note === 26) {
    for (const d of approved(src.debitNotes).filter((x) => inP(x.issueDate)))
      rows.push({ date: d.issueDate, ref: d.no, refId: d.id, href: `/purchases/debit-notes?view=${d.id}`, party: d.vendorName, bin: d.vendorBin, value: d.subtotal, vat: d.rebate, note: d.purchaseNo })
  } else if (note === 30) {
    for (const p of approved(src.purchases).filter((x) => inP(x.issueDate))) {
      const a = p.lines.reduce((s, l) => s + (l.rebateable && l.duty ? l.duty.at : 0), 0)
      if (a) rows.push({ date: p.issueDate, ref: p.invoiceNo, refId: p.id, href: `/purchases/${p.id}`, party: p.vendorName, bin: p.vendorBin, value: p.subtotal, vat: round2(a), note: p.boe?.no })
    }
  } else if (note === 31 || note === 39) {
    for (const c of approved(src.creditNotes).filter((x) => inP(x.issueDate) && (note === 31 || x.sd)))
      rows.push({ date: c.issueDate, ref: c.no, refId: c.id, href: `/sales/credit-notes?view=${c.id}`, party: c.customerName, bin: c.customerBin, value: c.subtotal, vat: note === 31 ? c.vat : c.sd, note: c.saleNo })
    if (note === 39) for (const a of approved(src.adjustments).filter((x) => x.taxPeriod === period && x.note === 39))
      rows.push({ date: a.issueDate, ref: a.no, refId: a.id, href: `/vat/adjustments?view=${a.id}`, value: 0, vat: a.amount, note: a.description })
  } else if (note === 27 || note === 32 || note === 38) {
    for (const a of approved(src.adjustments).filter((x) => x.taxPeriod === period && x.note === note))
      rows.push({ date: a.issueDate, ref: a.no, refId: a.id, href: `/vat/adjustments?view=${a.id}`, value: 0, vat: a.amount, note: a.description })
  } else if (note >= 58 && note <= 64) {
    for (const d of approved(src.treasury).filter((x) => x.taxPeriod === period && HEAD_NOTE[x.head] === note))
      rows.push({ date: d.challanDate, ref: d.challanNo, refId: d.id, href: `/vat/tr-6?view=${d.id}`, party: d.bank, value: 0, vat: d.amount, note: `${d.no} · ${d.head}` })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref))
}
