/**
 * R6.3 mock API — late payment interest / late-return penalty (compliance centre).
 * SD on exported inputs lives with the VAT adjustments (_r4.ts); UD amendments and BB-LC tracking with the UD routes.
 */
import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import { computeReturn } from "@/lib/mock/vat-return"
import { penaltyCalc } from "@/lib/penalty"
import { periodOf } from "@/lib/r4"
import type { PenaltyExposure, PenaltyExposureRow, PenaltyQuote } from "@/lib/types"
import { json, problem, withAuth } from "./_lib"
import { taxPeriods } from "./_r4"

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** What a period still owes: payable (notes 50/51) less deposits (58/59), and when its return was filed. */
function basisOf(period: string): PenaltyQuote["basis"] {
  const r = db.returns.find((x) => x.period === period)
  const c = r?.snapshot ?? computeReturn(db, period, r?.manual)
  const status: PenaltyQuote["basis"]["status"] = r?.status === "submitted" ? "submitted" : r ? "draft" : "none"
  return {
    status, payableVat: c.payableVat, payableSd: c.payableSd, depositedVat: c.depositedVat, depositedSd: c.depositedSd, shortVat: c.shortVat, shortSd: c.shortSd,
    submittedOn: status === "submitted" ? r?.submissionDate : undefined,
  }
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
  if (!period) {
    const rows: PenaltyExposureRow[] = []
    for (const p of taxPeriods()) {
      const b = basisOf(p.period)
      const result = penaltyCalc({ period: p.period, vat: b.shortVat, sd: b.shortSd, paidOn: TODAY, filedOn: b.submittedOn }, db.vatSettings)
      // a period not yet due owes nothing today; one not filed yet is late once its due date has passed
      if (TODAY <= result.dueDate && b.status !== "submitted") { result.lateFiling = false; result.penaltyLate = 0; result.total = result.interestVat + result.interestSd }
      rows.push({ period: p.period, dueDate: result.dueDate, status: b.status, submittedOn: b.submittedOn, shortVat: b.shortVat, shortSd: b.shortSd, lateFiling: result.lateFiling, result })
    }
    rows.reverse()
    const out: PenaltyExposure = { asOf: TODAY, rows, total: Math.round(rows.reduce((a, r) => a + r.result.total, 0) * 100) / 100, periodsAtRisk: rows.filter((r) => r.result.total > 0).length }
    return json(out)
  }
  const errors: Record<string, string[]> = {}
  const first = db.returns.reduce((m, r) => (r.period < m ? r.period : m), periodOf(TODAY))
  if (!PERIOD_RE.test(period) || period > periodOf(TODAY) || period < first) errors.period = ["outOfRange"]
  const num = (k: string) => {
    const v = sp.get(k)
    if (v == null || v === "") return undefined
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) { errors[k] = ["min0"]; return undefined }
    return n
  }
  const day = (k: string) => {
    const v = sp.get(k)
    if (!v) return undefined
    if (!DAY_RE.test(v) || Number.isNaN(Date.parse(v))) { errors[k] = ["date"]; return undefined }
    return v
  }
  const vat = num("vat"), sd = num("sd"), latePenalty = num("latePenalty"), paidOn = day("paidOn"), filedOn = day("filedOn")
  if (Object.keys(errors).length) return problem(422, "Validation failed", errors)
  const basis = basisOf(period)
  const input = { period, vat: vat ?? basis.shortVat, sd: sd ?? basis.shortSd, paidOn: paidOn ?? TODAY, filedOn: filedOn ?? basis.submittedOn, latePenalty }
  if (input.paidOn < `${period}-01`) return problem(422, "Validation failed", { paidOn: ["beforePeriodEnd"] })
  const out: PenaltyQuote = { input, result: penaltyCalc(input, db.vatSettings), basis }
  return json(out)
})
