/**
 * R6.6 (NBR enlistment) — applications about a VAT return: Mushak 9.3 and Mushak 9.4.
 *
 * Mushak 9.3, late filing (VAT & SD Act 2012 s.65, rule 48): applied for within 7 days after the tax period ends; the
 * Commissioner may allow the return up to 1 month after the due date and decides within 7 days — no decision means
 * approved. The permission removes the late-return penalty (s.85) up to the allowed date, but neither moves the
 * payment due date nor the interest (s.127), which still runs from the original due date.
 *
 * Mushak 9.4, amended return (s.66, rule 49): for a submitted return, within 4 years of its submission and before any
 * VAT audit / enquiry starts; for clerical or computational errors — not to take an input credit or decreasing
 * adjustment whose time limit has passed. When the amendment lowers the net tax the Commissioner decides within 30
 * days (no decision means approved) and allows a decreasing adjustment in a later tax period; when it raises the tax
 * the difference is paid with interest from the original due date, without penalty.
 * Pure module: mock API, compat layer and browser.
 */
import { penaltyCalc } from "./penalty"
import { periodEnd, RETURN_NOTES } from "./r4"
import { returnDueDate } from "./rules"
import { addMonths, daysBetween } from "./sd-export"
import { round2 } from "./vat"
import type {
  AmendCorrection, AmendDirection, AmendEffect, AmendField, LateFiling, LateFilingRow, ReturnAmendment, ReturnAmendmentRow, ReturnComputation,
  ReturnNote, VatReturn, VatSettings,
} from "./types"

export const LATE_APPLY_DAYS = 7
export const LATE_DECIDE_DAYS = 7
export const LATE_MAX_MONTHS = 1
export const AMEND_YEARS = 4
export const AMEND_DECIDE_DAYS = 30
export const AMEND_MAX_LINES = 20

type Settings = Pick<VatSettings, "profile"> | null | undefined
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

/* ── Mushak 9.3 ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Due date, the latest date the Commissioner may allow, and the last day to apply. */
export function lateLimits(period: string, settings?: Settings) {
  const due = returnDueDate(period, settings)
  return { due, maxDate: addMonths(due, LATE_MAX_MONTHS), applyBy: addDays(periodEnd(period), LATE_APPLY_DAYS) }
}

export function lateFilingRow(lf: LateFiling, ret: VatReturn | undefined, settings: Settings, today: string): LateFilingRow {
  const lim = lateLimits(lf.period, settings)
  const deemedOn = lf.filedOn ? addDays(lf.filedOn, LATE_DECIDE_DAYS) : undefined
  const state = lf.status === "filed" && deemedOn && today > deemedOn ? "deemed" : lf.status
  const effectiveDate = state === "approved" ? lf.grantedDate : state === "deemed" ? lf.requestedDate : undefined
  const submitted = ret?.status === "submitted" ? ret.submissionDate : undefined
  return {
    ...lf, ...lim, state, deemedOn, effectiveDate,
    returnStatus: ret ? (ret.status === "submitted" ? "submitted" : "draft") : "none", returnSubmittedOn: submitted,
    withinExtension: submitted && effectiveDate ? submitted > lim.due && submitted <= effectiveDate : undefined,
  }
}

/** Filing date allowed for a period by its approved / deemed application, if any. */
export function extensionFor(period: string, lateFilings: LateFiling[] | undefined, settings: Settings, today: string): string | undefined {
  for (const lf of lateFilings ?? []) {
    if (lf.period !== period || lf.status === "rejected" || lf.status === "draft") continue
    const r = lateFilingRow(lf, undefined, settings, today)
    if (r.effectiveDate) return r.effectiveDate
  }
  return undefined
}

/* ── Mushak 9.4 ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Source notes an amendment may correct (totals and the tax computation follow from them). */
export const AMENDABLE_NOTES = RETURN_NOTES.filter((n) => (n.note >= 1 && n.note <= 8) || (n.note >= 10 && n.note <= 22) || (n.note >= 24 && n.note <= 27) || (n.note >= 29 && n.note <= 32) || (n.note >= 38 && n.note <= 40))
export const fieldsOf = (note: number): AmendField[] => {
  const d = AMENDABLE_NOTES.find((n) => n.note === note)
  return !d ? [] : d.kind === "vsv" ? ["value", "sd", "vat"] : d.kind === "vv" ? ["value", "vat"] : ["amount"]
}
/** Notes whose increase would claim a credit / decreasing adjustment (not allowed by amendment once its window passed). */
export const CREDIT_NOTES = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 29, 30, 31, 32, 39, 40])
const ADMISSIBLE = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18])

export const noteValue = (c: ReturnComputation, note: number, field: AmendField) => {
  const n = c.notes.find((x) => x.note === note) as (ReturnNote & Record<string, number | undefined>) | undefined
  return round2(n?.[field] ?? 0)
}

/**
 * The return with corrected source notes: totals (9, 23, 28, 33), net tax (34–37), payable (50, 51) and closing
 * balance (65, 66) recomputed. `extra` adds the interest paid with an amended return (41 / 42) and its deposit (58 / 59).
 */
export function applyCorrections(base: ReturnComputation, corrections: Pick<AmendCorrection, "note" | "field" | "to">[], extra?: { interestVat?: number; interestSd?: number; paidVat?: number; paidSd?: number }): ReturnComputation {
  const notes = base.notes.map((n) => ({ ...n }))
  const n = (k: number) => notes.find((x) => x.note === k) as ReturnNote & Record<string, number | undefined>
  for (const c of corrections) { const x = n(c.note); if (x) x[c.field] = round2(c.to) }
  const amt = (k: number) => n(k)?.amount ?? 0
  const set = (k: number, v: number) => { const x = n(k); if (x) x.amount = round2(v) }
  const t9 = n(9); t9.value = 0; t9.sd = 0; t9.vat = 0
  for (let k = 1; k <= 8; k++) { const x = n(k); t9.value = round2(t9.value + (x.value ?? 0)); t9.sd = round2(t9.sd + (x.sd ?? 0)); t9.vat = round2(t9.vat + (x.vat ?? 0)) }
  const t23 = n(23); t23.value = 0; t23.vat = 0
  for (let k = 10; k <= 22; k++) { const x = n(k); t23.value = round2(t23.value + (x.value ?? 0)); if (ADMISSIBLE.has(k)) t23.vat = round2(t23.vat + (x.vat ?? 0)) }
  set(28, amt(24) + amt(25) + amt(26) + amt(27))
  set(33, amt(29) + amt(30) + amt(31) + amt(32))
  set(34, (t9.vat ?? 0) - (t23.vat ?? 0) + amt(28) - amt(33))
  set(35, amt(34) - (amt(52) + amt(56)))
  set(36, (t9.sd ?? 0) + amt(38) - (amt(39) + amt(40)))
  set(37, amt(36) - (amt(53) + amt(57)))
  if (extra?.interestVat) set(41, amt(41) + extra.interestVat)
  if (extra?.interestSd) set(42, amt(42) + extra.interestSd)
  set(50, amt(35) + amt(41) + amt(43) + amt(44))
  set(51, amt(37) + amt(42))
  if (extra?.paidVat) set(58, amt(58) + extra.paidVat)
  if (extra?.paidSd) set(59, amt(59) + extra.paidSd)
  set(65, amt(58) - (amt(50) + amt(67)))
  set(66, amt(59) - (amt(51) + amt(68)))
  return {
    ...base, notes,
    outputVat: t9.vat ?? 0, inputVat: t23.vat ?? 0, increasing: amt(28), decreasing: amt(33),
    netVat: amt(34), netVatAfter: amt(35), netSd: amt(36), netSdAfter: amt(37),
    payableVat: amt(50), payableSd: amt(51), depositedVat: amt(58), depositedSd: amt(59), closingVat: amt(65), closingSd: amt(66),
    shortVat: round2(Math.max(0, amt(50) - amt(58))), shortSd: round2(Math.max(0, amt(51) - amt(59))),
  }
}

/**
 * Effect of the corrections on the net tax (notes 35 / 37). Later returns already carried the original closing balance
 * forward, so the whole difference is settled now: an increase is paid with interest from the original due date to
 * `paidOn` (no late-return penalty — the original return was on file); a decrease becomes a decreasing adjustment.
 */
export function amendEffect(base: ReturnComputation, corrected: ReturnComputation, o: { period: string; settings: Settings; submittedOn: string; paidOn: string }): AmendEffect {
  const deltaVat = round2(corrected.netVatAfter - base.netVatAfter), deltaSd = round2(corrected.netSdAfter - base.netSdAfter)
  const total = round2(deltaVat + deltaSd)
  const direction: AmendDirection = total > 0.004 ? "increase" : total < -0.004 ? "decrease" : "none"
  const up = direction === "increase"
  const p = up ? penaltyCalc({ period: o.period, vat: Math.max(0, deltaVat), sd: Math.max(0, deltaSd), paidOn: o.paidOn, filedOn: o.submittedOn, latePenalty: 0 }, o.settings) : null
  const interestVat = p?.interestVat ?? 0, interestSd = p?.interestSd ?? 0
  return {
    netVatFrom: base.netVatAfter, netVatTo: corrected.netVatAfter, netSdFrom: base.netSdAfter, netSdTo: corrected.netSdAfter,
    deltaVat, deltaSd, direction, interestVat, interestSd, months: p?.chargedMonths ?? 0, paidOn: up ? o.paidOn : undefined,
    toPay: up ? round2(Math.max(0, deltaVat) + Math.max(0, deltaSd) + interestVat + interestSd) : 0,
    decreaseVat: direction === "decrease" ? round2(Math.max(0, -deltaVat)) : 0, decreaseSd: direction === "decrease" ? round2(Math.max(0, -deltaSd)) : 0,
  }
}

/** The figures the next amendment of a period starts from: the latest amended return, else the submitted one. */
export function latestComputation(ret: VatReturn, amendments: ReturnAmendment[], beforeRevision = Infinity): { computation: ReturnComputation; revision: number } | null {
  const done = amendments.filter((a) => a.period === ret.period && a.status === "amended" && a.amended && a.revision < beforeRevision).sort((a, b) => b.revision - a.revision)[0]
  if (done) return { computation: done.amended!.computation, revision: done.revision + 1 }
  return ret.snapshot ? { computation: ret.snapshot, revision: 1 } : null
}

export function amendmentRow(a: ReturnAmendment, ret: VatReturn, amendments: ReturnAmendment[], settings: Settings, today: string): ReturnAmendmentRow {
  const base = latestComputation(ret, amendments, a.revision)?.computation ?? ret.snapshot!
  const submittedOn = ret.submissionDate ?? today
  const corrected = applyCorrections(base, a.corrections)
  const effect = a.amended?.effect ?? amendEffect(base, corrected, { period: a.period, settings, submittedOn, paidOn: today })
  const deemedOn = a.filedOn && effect.direction === "decrease" ? addDays(a.filedOn, AMEND_DECIDE_DAYS) : undefined
  const state = a.status === "filed" && deemedOn && today > deemedOn ? "deemed" : a.status
  return {
    ...a, effect, state, deemedOn,
    applyBy: addMonths(submittedOn, AMEND_YEARS * 12),
    original: { submissionDate: submittedOn, ackNo: ret.ackNo, type: ret.type, netVat: base.netVatAfter, netSd: base.netSdAfter, payableVat: base.payableVat, payableSd: base.payableSd },
    computation: a.amended?.computation ?? corrected,
    base,
  }
}

/** Days from a to b (re-exported for the forms). */
export { daysBetween }
