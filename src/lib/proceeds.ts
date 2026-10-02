/**
 * R6.6 (RMG) — export proceeds matching from the bank's PRC file.
 *
 * The AD bank reports every foreign-currency realisation (Proceeds Realisation Certificate) in a statement / OEMS
 * export. Each row is matched to the open export invoices: by EXP number first, then the invoice number, then the
 * export LC / BB-LC (oldest invoice first), and only as a last resort by an exact amount in the same currency. A
 * row larger than its invoice spills over to the other open invoices of the same LC; rows that cannot be placed are
 * left for review with the closest candidates. Nothing posts until the user confirms — the API re-validates every
 * allocation and posts the batch as R6.2 realisations, reversible as a whole.
 * Pure module: mock API, compat layer and browser.
 */
import { addDays, daysBetween, EXPORT_CURRENCIES, PROCEEDS_DAYS, proceedsOf } from "./rmg"
import { round2 } from "./vat"
import type {
  ExportProceedsSummary, PrcAllocation, PrcBasis, PrcBatch, PrcCandidate, PrcFileRow, PrcMatchResult, PrcMatchRow, PrcProblem, PrcRowState,
  ProceedsOverview, ProceedsState, Sale,
} from "./types"

export const PRC_MAX_ROWS = 500
export const PRC_FIELDS = ["date", "prcNo", "bank", "currency", "fcAmount", "rate", "expNo", "lcNo", "invoiceRef", "remitter"] as const
export type PrcField = (typeof PRC_FIELDS)[number]
export const PRC_REQUIRED: PrcField[] = ["date", "prcNo", "currency", "fcAmount", "rate"]

/** Column headings banks use for each field (compared lower-case, letters and digits only). */
const ALIASES: Record<PrcField, string[]> = {
  date: ["date", "valuedate", "realisationdate", "realizationdate", "creditdate", "prcdate"],
  prcNo: ["prcno", "prc", "prcnumber", "certificateno", "prcref", "brcno"],
  bank: ["bank", "adbank", "bankname", "branch", "bankbranch"],
  currency: ["currency", "ccy", "cur", "fccurrency"],
  fcAmount: ["fcamount", "amount", "amountfc", "realisedamount", "realizedamount", "fcvalue", "proceeds"],
  rate: ["rate", "exchangerate", "conversionrate", "bdtrate", "fxrate"],
  expNo: ["expno", "exp", "expform", "expnumber"],
  lcNo: ["lcno", "lc", "lccontract", "contractno", "lccontractno", "bblcno", "exportlc"],
  invoiceRef: ["invoiceno", "invoice", "invoiceref", "billref", "exportbill", "billno"],
  remitter: ["remitter", "buyer", "applicant", "remittername", "ordering"],
}
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Read a parsed spreadsheet (first row = headings) into PRC rows; reports the required headings that are missing. */
export function mapPrcRows(table: string[][]): { rows: PrcFileRow[]; missing: PrcField[] } {
  const [head = [], ...body] = table
  const col = new Map<PrcField, number>()
  head.forEach((h, i) => {
    const k = key(h)
    const f = PRC_FIELDS.find((x) => ALIASES[x].includes(k))
    if (f && !col.has(f)) col.set(f, i)
  })
  const missing = PRC_REQUIRED.filter((f) => !col.has(f))
  if (missing.length) return { rows: [], missing }
  const get = (r: string[], f: PrcField) => (col.has(f) ? (r[col.get(f)!] ?? "").trim() : "")
  const rows = body.map((r, i) => ({
    line: i + 2,
    date: normDate(get(r, "date")), prcNo: get(r, "prcNo").toUpperCase(), bank: get(r, "bank"), currency: get(r, "currency").toUpperCase().slice(0, 3),
    fcAmount: num(get(r, "fcAmount")), rate: num(get(r, "rate")),
    ...opt("expNo", get(r, "expNo")), ...opt("lcNo", get(r, "lcNo")), ...opt("invoiceRef", get(r, "invoiceRef")), ...opt("remitter", get(r, "remitter")),
  }))
  return { rows, missing }
}
const opt = (k: string, v: string) => (v ? { [k]: v } : {})
/** "1,23,456.78" / "123456.78" → number; anything else → 0 (reported as a bad amount). */
const num = (s: string) => { const n = Number(s.replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : 0 }
/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY/MM/DD → YYYY-MM-DD (as typed when unrecognised). */
export function normDate(s: string): string {
  const t = s.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return t
}
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

/** EXP / LC / invoice references compared without spaces, slashes and dashes. */
export const normRef = (x?: string) => (x ?? "").replace(/[\s/\\\-_.]/g, "").toUpperCase()
const tolOf = (fcValue: number) => Math.max(0.01, round2(fcValue * 0.005))

export interface OpenExport extends PrcCandidate { customerId: string; fcValue: number; rate: number; shipDate: string }

/** Approved export invoices in a foreign currency with proceeds still to realise, oldest shipment first. */
export function openExports(sales: Sale[], today: string): OpenExport[] {
  return sales
    .filter((s) => s.process === "Approved" && s.export?.fcValue && s.export.currency && s.export.currency !== "BDT")
    .map((s) => ({ s, p: proceedsOf(s.export!, s.issueDate, today) }))
    .filter(({ p }) => p.outstandingFc > 0.005)
    .map(({ s, p }) => {
      const e = s.export!
      return {
        saleId: s.id, invoiceNo: s.invoiceNo, customer: s.customerName, customerId: s.customerId, date: s.issueDate, shipDate: e.billDate || s.issueDate,
        currency: e.currency!, outstandingFc: p.outstandingFc, fcValue: e.fcValue!, rate: e.exchangeRate ?? 0, lcNo: e.lcNo || undefined, expNo: e.expNo || undefined,
      }
    })
    .sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.invoiceNo.localeCompare(b.invoiceNo))
}

/** Every PRC number already realised (upper case). */
export const knownPrcs = (sales: Sale[]) => new Set(sales.flatMap((s) => (s.export?.realisations ?? []).map((r) => r.prcNo.toUpperCase())))

/** Row-level checks that do not depend on the invoices. */
export function rowProblems(r: PrcFileRow, today: string): PrcProblem[] {
  const p: PrcProblem[] = []
  if (!validDate(r.date)) p.push("date")
  else if (r.date > today) p.push("future")
  if (!(r.fcAmount > 0) || r.fcAmount > 1e10) p.push("amount")
  if (!(r.rate > 0) || r.rate > 1000) p.push("rate")
  if (!EXPORT_CURRENCIES.includes(r.currency as never) || r.currency === "BDT") p.push("currency")
  if ((r.prcNo ?? "").trim().length < 2) p.push("prcNo")
  return p
}

/**
 * Propose allocations for every row of a bank file. Rows are taken in file order and consume the outstanding amounts
 * as they go, so two rows for the same invoice do not both claim its full balance.
 */
export function matchPrc(input: PrcFileRow[], sales: Sale[], today: string): PrcMatchResult {
  const open = openExports(sales, today)
  const left = new Map(open.map((o) => [o.saleId, o.outstandingFc]))
  const known = knownPrcs(sales)
  const seen = new Set<string>()
  const rows: PrcMatchRow[] = input.map((r) => {
    const base = { ...r, prcNo: r.prcNo.trim().toUpperCase(), currency: r.currency.trim().toUpperCase() }
    const out = (state: PrcRowState, problems: PrcProblem[], allocations: PrcAllocation[] = [], candidates: PrcCandidate[] = []): PrcMatchRow => {
      const allocated = round2(allocations.reduce((a, x) => a + x.fcAmount, 0))
      return { ...base, state, problems, allocations, candidates, unallocated: allocations.length ? round2(Math.max(0, base.fcAmount - allocated)) : base.fcAmount > 0 ? base.fcAmount : 0, bdt: round2(allocated * (base.rate > 0 ? base.rate : 0)) }
    }
    const bad = rowProblems(base, today)
    if (bad.length) return out("invalid", bad)
    if (known.has(base.prcNo)) return out("duplicate", ["duplicatePrc"])
    if (seen.has(base.prcNo)) return out("duplicate", ["duplicateInFile"])
    seen.add(base.prcNo)

    const avail = (o: OpenExport) => (left.get(o.saleId) ?? 0) > 0.005
    const usable = (o: OpenExport) => avail(o) && o.currency === base.currency && o.date <= base.date
    const candidatesFor = () => open.filter(usable)
      .sort((a, b) => Math.abs((left.get(a.saleId) ?? 0) - base.fcAmount) - Math.abs((left.get(b.saleId) ?? 0) - base.fcAmount) || a.shipDate.localeCompare(b.shipDate))
      .slice(0, 6).map((o) => cand(o, left.get(o.saleId) ?? 0))

    // 1–3: by reference
    let basis: PrcBasis | undefined
    let target: OpenExport[] = []
    const tries: [PrcBasis, string | undefined, (o: OpenExport) => string | undefined][] = [["exp", base.expNo, (o) => o.expNo], ["invoice", base.invoiceRef, (o) => o.invoiceNo], ["lc", base.lcNo, (o) => o.lcNo]]
    for (const [b, ref, get] of tries) {
      if (!normRef(ref)) continue
      const hit = open.filter((o) => avail(o) && normRef(get(o)) === normRef(ref))
      if (hit.length) { basis = b; target = hit; break }
    }
    const problems: PrcProblem[] = []
    if (basis) {
      const ok = target.filter(usable)
      if (!ok.length) {
        problems.push(target.some((o) => o.currency !== base.currency) ? "currencyMismatch" : "beforeInvoice")
        return out("unmatched", problems, [], candidatesFor())
      }
      target = ok
    } else {
      // 4: exact amount (± rounding) in the same currency — only when unique
      const same = open.filter((o) => usable(o) && Math.abs((left.get(o.saleId) ?? 0) - base.fcAmount) <= tolOf(o.fcValue))
      if (same.length === 1) { basis = "amount"; target = same }
      else if (same.length > 1) return out("ambiguous", ["ambiguous"], [], same.map((o) => cand(o, left.get(o.saleId) ?? 0)))
      else return out("unmatched", ["noOpenExport"], [], candidatesFor())
    }

    // spill-over: the rest of the same LC (same buyer), oldest first
    const first = target[0]
    const spill = basis === "lc" ? [] : open.filter((o) => usable(o) && !target.includes(o) && o.customerId === first.customerId && !!first.lcNo && normRef(o.lcNo) === normRef(first.lcNo))
    const allocations: PrcAllocation[] = []
    let rest = base.fcAmount
    for (const o of [...target, ...spill]) {
      if (rest <= 0.005) break
      const l = left.get(o.saleId) ?? 0
      // a short payment within rounding of the balance closes the invoice
      const take = round2(Math.min(rest, l + (basis === "amount" ? tolOf(o.fcValue) : 0)))
      if (take <= 0.005) continue
      allocations.push({ saleId: o.saleId, invoiceNo: o.invoiceNo, customer: o.customer, fcAmount: take, outstandingFc: l, basis: target.includes(o) ? basis! : "lc" })
      left.set(o.saleId, round2(Math.max(0, l - take)))
      rest = round2(rest - take)
    }
    if (rest > 0.01) return out("excess", ["excess"], allocations, candidatesFor())
    if (allocations.length > 1) return out("split", [], allocations)
    const a = allocations[0]
    return out(a.fcAmount < a.outstandingFc - 0.005 ? "partial" : "matched", [], allocations)
  })
  return { rows, totals: matchTotals(rows) }
}
const cand = (o: OpenExport, outstandingFc: number): PrcCandidate => ({ saleId: o.saleId, invoiceNo: o.invoiceNo, customer: o.customer, date: o.date, currency: o.currency, outstandingFc: round2(outstandingFc), lcNo: o.lcNo, expNo: o.expNo })

/** States a user should look at before posting (they are not ticked by default). */
export const PRC_REVIEW: PrcRowState[] = ["excess", "ambiguous", "unmatched"]
export const PRC_SKIP: PrcRowState[] = ["duplicate", "invalid"]

function matchTotals(rows: PrcMatchRow[]): PrcMatchResult["totals"] {
  const postable = rows.filter((r) => r.allocations.length && !PRC_SKIP.includes(r.state))
  const cur = new Map<string, number>()
  for (const r of postable) cur.set(r.currency, round2((cur.get(r.currency) ?? 0) + r.allocations.reduce((a, x) => a + x.fcAmount, 0)))
  return {
    rows: rows.length, postable: postable.length,
    matched: rows.filter((r) => r.state === "matched" || r.state === "partial" || r.state === "split").length,
    review: rows.filter((r) => PRC_REVIEW.includes(r.state)).length, skipped: rows.filter((r) => PRC_SKIP.includes(r.state)).length,
    bdt: round2(postable.reduce((a, r) => a + r.bdt, 0)), byCurrency: [...cur].map(([currency, fc]) => ({ currency, fc })),
  }
}

export interface PostRow extends PrcFileRow { allocations: { saleId: string; fcAmount: number; basis: PrcBasis }[] }
/**
 * Re-check the allocations a user confirms (they may have picked invoices by hand): the row must be valid and new,
 * every invoice open, in the row's currency and dated on or before the realisation; a row cannot allocate more than
 * its amount, nor an invoice receive more than its balance (+0.5 % rounding) across the batch.
 */
export function postCheck(rows: PostRow[], sales: Sale[], today: string): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {}
  const open = new Map(openExports(sales, today).map((o) => [o.saleId, o]))
  const left = new Map([...open.values()].map((o) => [o.saleId, o.outstandingFc]))
  const known = knownPrcs(sales)
  const seen = new Set<string>()
  if (!rows.some((r) => r.allocations.length)) errors.rows = ["nothingToPost"]
  rows.forEach((r, i) => {
    if (!r.allocations.length) return
    const prc = r.prcNo.trim().toUpperCase()
    const bad = rowProblems({ ...r, currency: r.currency.toUpperCase() }, today)
    if (bad.length) { errors[`rows.${i}`] = bad; return }
    if (known.has(prc) || seen.has(prc)) { errors[`rows.${i}.prcNo`] = ["duplicate"]; return }
    seen.add(prc)
    const ids = new Set<string>()
    let sum = 0
    r.allocations.forEach((a, j) => {
      const o = open.get(a.saleId)
      const k = `rows.${i}.allocations.${j}`
      if (ids.has(a.saleId)) errors[k] = ["duplicate"]
      else if (!o) errors[k] = ["notOpen"]
      else if (o.currency !== r.currency.toUpperCase()) errors[k] = ["currencyMismatch"]
      else if (o.date > r.date) errors[k] = ["beforeInvoice"]
      else if (!(a.fcAmount > 0)) errors[k] = ["positive"]
      else if (a.fcAmount > (left.get(a.saleId) ?? 0) + tolOf(o.fcValue)) errors[k] = ["exceedsOutstanding"]
      else left.set(a.saleId, round2(Math.max(0, (left.get(a.saleId) ?? 0) - a.fcAmount)))
      ids.add(a.saleId)
      sum += a.fcAmount
    })
    if (round2(sum) > round2(r.fcAmount) + 0.01) errors[`rows.${i}.fcAmount`] = ["overAllocated"]
  })
  return Object.keys(errors).length ? errors : null
}

/** Proceeds of a set of export invoices (drawback claim, UD settlement). Cancelled / non-FC invoices are left out. */
export function proceedsSummary(saleIds: string[], sales: Sale[], today: string): ExportProceedsSummary {
  const lines: ExportProceedsSummary["lines"] = []
  for (const id of [...new Set(saleIds)]) {
    const s = sales.find((x) => x.id === id)
    if (!s?.export || s.process === "Cancelled") continue
    const p = proceedsOf(s.export, s.issueDate, today)
    if (p.state === "na") continue
    lines.push({ saleId: s.id, invoiceNo: s.invoiceNo, currency: s.export.currency, fcValue: s.export.fcValue ?? 0, realisedFc: p.realisedFc, state: p.state, prcNos: [...new Set((s.export.realisations ?? []).map((r) => r.prcNo))] })
  }
  return {
    exports: lines.length, realised: lines.filter((l) => l.state === "realised").length,
    pending: lines.filter((l) => l.state !== "realised").length, overdue: lines.filter((l) => l.state === "overdue").length, lines,
  }
}

/** Fiscal year start (1 July) for a date. */
const fyStart = (d: string) => `${Number(d.slice(0, 4)) - (d.slice(5, 7) >= "07" ? 0 : 1)}-07-01`

/** Proceeds page: what is outstanding (ageing against the 120-day limit), realised this fiscal year, and the batches. */
export function proceedsOverview(sales: Sale[], batches: PrcBatch[], today: string): ProceedsOverview {
  const open = openExports(sales, today).map((o) => {
    const due = addDays(o.shipDate, PROCEEDS_DAYS)
    const daysLeft = daysBetween(today, due)
    const s = sales.find((x) => x.id === o.saleId)!
    const state: ProceedsState = proceedsOf(s.export!, s.issueDate, today).state
    const { customerId: _c, shipDate: _s, ...rest } = o // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...rest, due, daysLeft, state }
  }).sort((a, b) => a.daysLeft - b.daysLeft || a.invoiceNo.localeCompare(b.invoiceNo))
  const bdt = (xs: typeof open) => round2(xs.reduce((a, o) => a + o.outstandingFc * o.rate, 0))
  const pick = (f: (o: (typeof open)[number]) => boolean) => { const xs = open.filter(f); return { count: xs.length, bdt: bdt(xs) } }
  const from = fyStart(today)
  const fy = sales.flatMap((s) => (s.process === "Cancelled" ? [] : (s.export?.realisations ?? []).filter((r) => r.date >= from && r.date <= today)))
  return {
    asOf: today,
    outstanding: pick(() => true), overdue: pick((o) => o.daysLeft < 0), dueSoon: pick((o) => o.daysLeft >= 0 && o.daysLeft <= 30),
    realisedFy: { count: fy.length, bdt: round2(fy.reduce((a, r) => a + r.bdt, 0)) },
    ageing: [
      { bucket: "overdue", ...pick((o) => o.daysLeft < 0) }, { bucket: "d30", ...pick((o) => o.daysLeft >= 0 && o.daysLeft <= 30) },
      { bucket: "d60", ...pick((o) => o.daysLeft > 30 && o.daysLeft <= 60) }, { bucket: "later", ...pick((o) => o.daysLeft > 60) },
    ],
    open,
    batches: [...batches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(({ lines: _l, history: _h, ...b }) => b), // eslint-disable-line @typescript-eslint/no-unused-vars
  }
}

/** CSV heading row of the bank-file template (any of the aliases above is accepted too). */
export const PRC_TEMPLATE_HEAD = ["Date", "PRC No", "Bank", "Currency", "FC Amount", "Rate", "EXP No", "LC No", "Invoice No", "Remitter"]
const csvCell = (v: string | number | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const prcCsv = (rows: (string | number | undefined)[][]) => [PRC_TEMPLATE_HEAD, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"

/**
 * A demonstration bank file built from what is open today, so it always has something to match: rows by EXP number,
 * by invoice number (short-paid by bank charges), by LC, an amount-only row that needs a manual pick, an exact-amount
 * row, and a PRC the system already has (duplicate).
 */
export function sampleBankFile(sales: Sale[], today: string, bank = "Eastern Bank PLC, Gulshan"): string {
  const open = openExports(sales, today)
  const known = knownPrcs(sales)
  let n = 52000 + known.size * 3
  const nextPrc = () => { let p: string; do { p = `PRC/${today.slice(2, 4)}/${String(++n).padStart(6, "0")}` } while (known.has(p)); return p }
  const date = today
  const rows: (string | number | undefined)[][] = []
  open.slice(0, 5).forEach((o, i) => {
    const rate = o.rate || 122
    const fc = o.outstandingFc
    if (i === 0) rows.push([date, nextPrc(), bank, o.currency, fc.toFixed(2), rate, o.expNo ?? "", o.lcNo ?? "", "", o.customer])
    else if (i === 1) rows.push([date, nextPrc(), bank, o.currency, Math.max(0.01, round2(fc - Math.min(25.5, fc / 10))).toFixed(2), rate, "", "", o.invoiceNo, o.customer])
    else if (i === 2) rows.push([date, nextPrc(), bank, o.currency, fc.toFixed(2), rate, "", o.lcNo ?? "", "", o.customer])
    else if (i === 3) rows.push([date, nextPrc(), bank, o.currency, Math.max(0.01, round2(Math.floor(fc / 2000) * 1000 || fc / 2)).toFixed(2), rate, "", "", "", o.customer])
    else rows.push([date, nextPrc(), bank, o.currency, fc.toFixed(2), rate, "", "", "", ""])
  })
  const dupSale = sales.find((s) => s.export?.realisations?.length)
  const dup = dupSale?.export?.realisations?.[0]
  if (dup) rows.push([dup.date, dup.prcNo, dup.bank, dupSale!.export!.currency ?? "USD", dup.fcAmount.toFixed(2), dup.rate, dupSale!.export!.expNo ?? "", "", "", ""])
  return prcCsv(rows)
}
