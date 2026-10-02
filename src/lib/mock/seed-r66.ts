/**
 * R6.6 seed — bank PRC-file batches over the R6.2 realisations (plus one reversed batch), two Mushak 9.3 late-filing
 * applications (December 2025 refused — the return went in late and paid the Tk 10,000 penalty; September 2026 filed,
 * awaiting the Commissioner) and two Mushak 9.4 amendments (March 2026 under-declared jhut sales: approved, amended
 * return filed with the difference and 2 months' interest; July 2026 wrong rate on the jhut sales: filed, pending).
 * Must not import mock/build.ts.
 */
import { amendEffect, applyCorrections, noteValue } from "../return-apps"
import type { AmendCorrection, HistoryEntry, LateFiling, PrcBatch, ReturnAmendment, Sale, VatReturn, VatSettings } from "../types"
import { round2 } from "../vat"

const at = (d: string, hm = "10:00") => new Date(`${d}T${hm}:00+06:00`).toISOString()
const FARZANA = "Farzana Akter", ARIF = "Arif Hossain"
const h = (d: string, by: string, action: HistoryEntry["action"], note?: string, hm?: string): HistoryEntry => ({ at: at(d, hm), by, action, ...(note ? { note } : {}) })

/** Realisations from the last quarter become two posted bank-file batches (one per month); one batch was reversed. */
export function seedPrcBatches(sales: Sale[]): PrcBatch[] {
  const recent = sales.flatMap((s) => (s.export?.realisations ?? []).filter((r) => r.date >= "2026-05-01").map((r) => ({ s, r })))
    .sort((a, b) => a.r.date.localeCompare(b.r.date))
  const byMonth = new Map<string, typeof recent>()
  for (const x of recent) byMonth.set(x.r.date.slice(0, 7), [...(byMonth.get(x.r.date.slice(0, 7)) ?? []), x])
  const out: PrcBatch[] = []
  let n = 0
  for (const [month, xs] of byMonth) {
    const id = `pb${++n}`
    const last = xs[xs.length - 1].r.date
    const no = `PB-${month.slice(5, 7)}${month.slice(2, 4)}${String(n).padStart(4, "0")}`
    const lines: PrcBatch["lines"] = xs.map(({ s, r }, i) => {
      r.batchId = id
      return {
        line: i + 2, prcNo: r.prcNo, date: r.date, bank: r.bank, currency: s.export!.currency ?? "USD", fcAmount: r.fcAmount, rate: r.rate, bdt: r.bdt,
        expNo: s.export!.expNo, lcNo: s.export!.lcNo, remitter: s.customerName,
        allocations: [{ saleId: s.id, invoiceNo: s.invoiceNo, customer: s.customerName, fcAmount: r.fcAmount, basis: s.export!.expNo ? "exp" : "lc", realisationId: r.id }],
      }
    })
    out.push({
      id, no, fileName: `EBL-OEMS-PRC-${last}.csv`, status: "posted", lines, skipped: 0, invoices: lines.length,
      fcTotals: [{ currency: "USD", fc: round2(lines.reduce((a, l) => a + l.fcAmount, 0)) }], bdt: round2(lines.reduce((a, l) => a + l.bdt, 0)),
      createdBy: FARZANA, createdAt: at(last, "15:10"), history: [h(last, FARZANA, "created", `${lines.length} PRC(s) posted from the bank file`, "15:10")],
    })
  }
  // a batch posted from a file the bank later withdrew — reversed, its realisation removed
  const s182 = sales.find((s) => s.id === "s182")
  if (s182?.export) {
    const id = `pb${++n}`
    out.push({
      id, no: `PB-0926${String(n).padStart(4, "0")}`, fileName: "EBL-OEMS-PRC-2026-09-17.csv", status: "reversed", skipped: 1, invoices: 1,
      lines: [{
        line: 2, prcNo: "PRC/26/051877", date: "2026-09-17", bank: "Eastern Bank PLC, Gulshan", currency: "USD", fcAmount: 40000, rate: 121.5, bdt: 4_860_000,
        lcNo: s182.export.lcNo, remitter: s182.customerName,
        allocations: [{ saleId: s182.id, invoiceNo: s182.invoiceNo, customer: s182.customerName, fcAmount: 40000, basis: "lc", realisationId: `prc-${s182.id}-pb${n}` }],
      }],
      fcTotals: [{ currency: "USD", fc: 40000 }], bdt: 4_860_000,
      reversedOn: "2026-09-19", reverseReason: "Bank withdrew the statement — the credit belonged to another exporter's account (re-issued file has no such PRC).",
      createdBy: FARZANA, createdAt: at("2026-09-17", "16:40"),
      history: [h("2026-09-17", FARZANA, "created", "1 PRC posted from the bank file", "16:40"), h("2026-09-19", ARIF, "cancelled", "Reversed — bank withdrew the statement", "11:05")],
    })
  }
  return out
}

/** Mushak 9.3: December 2025 refused, September 2026 awaiting a decision. */
export function seedLateFilings(): LateFiling[] {
  return [
    {
      id: "lf1", no: "LF-01260001", period: "2025-12", reasonKind: "systemFailure", status: "rejected",
      reason: "Migration of the accounting server to the new data centre (3–20 January 2026); purchase and sales registers for December not accessible.",
      requestedDate: "2026-01-25", filedOn: "2026-01-06", filedRef: "CVAT/DHK-N/LF/2026/0031",
      decidedOn: "2026-01-12", commissionerRef: "CVAT/DHK-N/2026/0418",
      rejectReason: "Planned migration — the return could have been prepared from the books before it started. Application refused (rule 48).",
      createdBy: FARZANA, createdAt: at("2026-01-05", "16:20"),
      history: [h("2026-01-05", FARZANA, "created", undefined, "16:20"), h("2026-01-06", FARZANA, "submitted", "Filed — CVAT/DHK-N/LF/2026/0031", "11:00"), h("2026-01-12", ARIF, "cancelled", "Refused by the Commissioner — CVAT/DHK-N/2026/0418", "15:30")],
    },
    {
      id: "lf2", no: "LF-09260002", period: "2026-09", reasonKind: "systemFailure", status: "filed",
      reason: "Head-office data centre moves from Konabari to Gazipur between 8 and 26 October 2026; the September books will be off-line for most of the filing window.",
      requestedDate: "2026-11-05", filedOn: "2026-09-24", filedRef: "CVAT/DHK-N/LF/2026/0287",
      createdBy: FARZANA, createdAt: at("2026-09-23", "17:05"),
      history: [h("2026-09-23", FARZANA, "created", undefined, "17:05"), h("2026-09-24", FARZANA, "submitted", "Filed — CVAT/DHK-N/LF/2026/0287", "10:40")],
    },
  ]
}

/** Mushak 9.4: March 2026 (increase, amended return filed) and July 2026 (decrease, pending). */
export function seedReturnAmendments(returns: VatReturn[], settings: Pick<VatSettings, "profile">): ReturnAmendment[] {
  const out: ReturnAmendment[] = []
  const mar = returns.find((r) => r.period === "2026-03" && r.status === "submitted" && r.snapshot)
  if (mar) {
    const base = mar.snapshot!
    const corrections: AmendCorrection[] = [
      { note: 4, field: "value", from: noteValue(base, 4, "value"), to: round2(noteValue(base, 4, "value") + 325_000), explanation: "Jhut (cutting waste) sold to a local buyer on manual challan 0417 — Tk 3,25,000 left out of the sales register." },
      { note: 4, field: "vat", from: noteValue(base, 4, "vat"), to: round2(noteValue(base, 4, "vat") + 48_750), explanation: "VAT 15 % on the same jhut sale." },
    ]
    const corrected = applyCorrections(base, corrections)
    const paidOn = "2026-06-10"
    const effect = amendEffect(base, corrected, { period: mar.period, settings, submittedOn: mar.submissionDate!, paidOn })
    const computation = applyCorrections(base, corrections, { interestVat: effect.interestVat, interestSd: effect.interestSd, paidVat: round2(Math.max(0, effect.deltaVat) + effect.interestVat), paidSd: round2(Math.max(0, effect.deltaSd) + effect.interestSd) })
    out.push({
      id: "am1", no: "AM-05260001", period: "2026-03", reasonKind: "underpaid", revision: 1, noAudit: true, corrections,
      description: "Internal audit found the March jhut sale (manual challan 0417) outside the system; output VAT under-declared by Tk 48,750.",
      status: "amended", filedOn: "2026-05-20", filedRef: "CVAT/DHK-N/AMD/2026/0118", decidedOn: "2026-06-02", commissionerRef: "CVAT/DHK-N/2026/2291",
      amended: { date: paidOn, ackNo: "NBR-91A-202603-0004417", payment: { challanNo: "2526-4100098861", date: paidOn, amount: effect.toPay }, effect, computation },
      createdBy: FARZANA, createdAt: at("2026-05-19", "15:00"),
      history: [
        h("2026-05-19", FARZANA, "created", undefined, "15:00"), h("2026-05-20", FARZANA, "submitted", "Filed — CVAT/DHK-N/AMD/2026/0118", "11:20"),
        h("2026-06-02", ARIF, "approved", "Permitted by the Commissioner — CVAT/DHK-N/2026/2291", "16:00"),
        h(paidOn, ARIF, "edited", `Amended return filed — NBR-91A-202603-0004417 · ৳ ${effect.toPay.toFixed(2)} deposited (challan 2526-4100098861)`, "12:30"),
      ],
    })
  }
  const jul = returns.find((r) => r.period === "2026-07" && r.status === "submitted" && r.snapshot)
  if (jul) {
    const base = jul.snapshot!
    const corrections: AmendCorrection[] = [
      { note: 4, field: "value", from: noteValue(base, 4, "value"), to: round2(noteValue(base, 4, "value") - 360_000), explanation: "Jhut sales of July (challans 0521–0527) keyed under standard rate." },
      { note: 4, field: "vat", from: noteValue(base, 4, "vat"), to: round2(noteValue(base, 4, "vat") - 54_000), explanation: "15 % VAT taken on them in note 4." },
      { note: 7, field: "value", from: noteValue(base, 7, "value"), to: round2(noteValue(base, 7, "value") + 360_000), explanation: "Same sales at the reduced rate they were invoiced at." },
      { note: 7, field: "vat", from: noteValue(base, 7, "vat"), to: round2(noteValue(base, 7, "vat") + 27_000), explanation: "VAT 7.5 % as charged on the invoices." },
    ]
    out.push({
      id: "am2", no: "AM-09260002", period: "2026-07", reasonKind: "clerical", revision: 1, noAudit: true, corrections,
      description: "Clerical error: July jhut sales invoiced at 7.5 % were declared at 15 % in note 4 — net tax over-declared by Tk 27,000.",
      status: "filed", filedOn: "2026-09-10", filedRef: "CVAT/DHK-N/AMD/2026/0164",
      createdBy: FARZANA, createdAt: at("2026-09-09", "14:45"),
      history: [h("2026-09-09", FARZANA, "created", undefined, "14:45"), h("2026-09-10", FARZANA, "submitted", "Filed — CVAT/DHK-N/AMD/2026/0164", "10:15")],
    })
  }
  return out
}
