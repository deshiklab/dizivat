/**
 * R6.3 mock API — late payment interest / late-return penalty (compliance centre).
 * SD on exported inputs lives with the VAT adjustments (_r4.ts); UD amendments and BB-LC tracking with the UD routes.
 */
import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import { computeReturn } from "@/lib/mock/vat-return"
import { penaltyCalc } from "@/lib/penalty"
import { extensionFor } from "@/lib/return-apps"
import { periodOf } from "@/lib/r4"
import type { PenaltyExposure, PenaltyExposureRow, PenaltyQuote } from "@/lib/types"
import { json, problem, withAuth } from "./_lib"
import { taxPeriods, type ReturnSource } from "./_r4"

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** What the quote and the exposure read: the return's own computation world, the 9.3 applications and the settings. */
export type PenaltySource = ReturnSource

/** What a period still owes: payable (notes 50/51) less deposits (58/59), and when its return was filed. */
export function penaltyBasisOf(period: string, src: PenaltySource): PenaltyQuote["basis"] {
  const r = src.returns.find((x) => x.period === period)
  const c = r?.snapshot ?? computeReturn(src, period, r?.manual)
  const status: PenaltyQuote["basis"]["status"] = r?.status === "submitted" ? "submitted" : r ? "draft" : "none"
  return {
    status, payableVat: c.payableVat, payableSd: c.payableSd, depositedVat: c.depositedVat, depositedSd: c.depositedSd, shortVat: c.shortVat, shortSd: c.shortSd,
    submittedOn: status === "submitted" ? r?.submissionDate : undefined,
  }
}

/** The exposure every tax period carries as of today: unpaid tax and late filing, one row per period. */
export function penaltyExposureOf(src: PenaltySource): PenaltyExposure {
  const rows: PenaltyExposureRow[] = []
  for (const p of taxPeriods(src)) {
    const b = penaltyBasisOf(p.period, src)
    const extendedTo = extensionFor(p.period, src.lateFilings, src.vatSettings, TODAY)
    const result = penaltyCalc({ period: p.period, vat: b.shortVat, sd: b.shortSd, paidOn: TODAY, filedOn: b.submittedOn, extendedTo }, src.vatSettings)
    // a period not yet due (or still inside an approved 9.3 extension) owes no penalty today; one not filed yet is late once that date has passed
    if (TODAY <= (extendedTo ?? result.dueDate) && b.status !== "submitted") { result.lateFiling = false; result.penaltyLate = 0; result.total = result.interestVat + result.interestSd }
    rows.push({ period: p.period, dueDate: result.dueDate, status: b.status, submittedOn: b.submittedOn, shortVat: b.shortVat, shortSd: b.shortSd, lateFiling: result.lateFiling, result })
  }
  rows.reverse()
  return { asOf: TODAY, rows, total: Math.round(rows.reduce((a, r) => a + r.result.total, 0) * 100) / 100, periodsAtRisk: rows.filter((r) => r.result.total > 0).length }
}

/** One period's quote — the overrides arrive as the query strings came in, unparsed. */
export function penaltyQuoteOf(
  period: string,
  q: { vat?: string; sd?: string; latePenalty?: string; paidOn?: string; filedOn?: string },
  src: PenaltySource,
): PenaltyQuote | { status: 422; title: string; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {}
  const first = src.returns.reduce((m, r) => (r.period < m ? r.period : m), periodOf(TODAY))
  if (!PERIOD_RE.test(period) || period > periodOf(TODAY) || period < first) errors.period = ["outOfRange"]
  const num = (k: string) => {
    const v = q[k as keyof typeof q]
    if (v == null || v === "") return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) { errors[k] = ["min0"]; return undefined }
    return n
  }
  const day = (k: string) => {
    const v = q[k as keyof typeof q]
    if (!v) return undefined
    if (!DAY_RE.test(v) || Number.isNaN(Date.parse(v))) { errors[k] = ["date"]; return undefined }
    return v
  }
  const vat = num("vat"), sd = num("sd"), latePenalty = num("latePenalty"), paidOn = day("paidOn"), filedOn = day("filedOn")
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const basis = penaltyBasisOf(period, src)
  const extendedTo = extensionFor(period, src.lateFilings, src.vatSettings, TODAY)
  const input = { period, vat: vat ?? basis.shortVat, sd: sd ?? basis.shortSd, paidOn: paidOn ?? TODAY, filedOn: filedOn ?? basis.submittedOn, latePenalty, ...(extendedTo ? { extendedTo } : {}) }
  if (input.paidOn < `${period}-01`) return { status: 422, title: "Validation failed", errors: { paidOn: ["beforePeriodEnd"] } }
  return { input, result: penaltyCalc(input, src.vatSettings), basis }
}

/**
 * GET /vat/penalty — without `period`: exposure for every tax period as of today (unpaid tax and late filing).
 * With `period`: a quote — `vat`, `sd` (default: the period's unpaid tax), `paidOn` (default today), `filedOn`
 * (default the submission date) and `latePenalty` (default from the rules table) can be overridden for a what-if.
 */
export const penaltyRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  await delay(60)
  const period = sp.get("period")
  if (!period) return json(penaltyExposureOf(db))
  const out = penaltyQuoteOf(period, { vat: sp.get("vat") ?? undefined, sd: sp.get("sd") ?? undefined, latePenalty: sp.get("latePenalty") ?? undefined, paidOn: sp.get("paidOn") ?? undefined, filedOn: sp.get("filedOn") ?? undefined }, db)
  return "status" in out ? problem(out.status, out.title, out.errors) : json(out)
})
