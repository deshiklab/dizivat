/**
 * R6.3 — late payment interest (§127) and late-return penalty for a Mushak 9.1 tax period.
 *
 * Interest: simple interest at 1 % per month (or part of a month) on tax not paid by the due date, for at most 24
 * months — separately on VAT (9.1 note 41, based on note 35) and on SD (note 42, based on note 37). The late-return
 * penalty (note 43) applies when the return is filed after the due date. Rates come from the effective-dated rules
 * table, so a Finance Act change is a data change. Pure module: mock API, compat layer and browser.
 */
import { returnDueDate, rule, ruleRow } from "./rules"
import type { PenaltyInput, PenaltyResult, VatSettings } from "./types"

const parse = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Whole months from `due` to `paid`, counting a started month as a full one (paid 1 day late = 1 month;
 * due 15 Oct, paid 16 Nov = 2 months). 0 when paid on or before the due date.
 */
export function monthsLate(due: string, paid: string) {
  if (paid <= due) return 0
  const a = parse(due), b = parse(paid)
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() > a.getUTCDate()) m++
  return Math.max(1, m)
}

export function penaltyCalc(i: PenaltyInput, settings?: Pick<VatSettings, "profile"> | null): PenaltyResult {
  const dueDate = returnDueDate(i.period, settings)
  const paidOn = i.paidOn.slice(0, 10)
  const ratePct = rule("interest.monthlyPct", dueDate), maxMonths = rule("interest.maxMonths", dueDate)
  const daysLate = Math.max(0, Math.round((parse(paidOn).getTime() - parse(dueDate).getTime()) / 864e5))
  const months = monthsLate(dueDate, paidOn)
  const chargedMonths = Math.min(months, maxMonths)
  const vat = r2(Math.max(0, i.vat || 0)), sd = r2(Math.max(0, i.sd || 0))
  const interestVat = r2((vat * ratePct * chargedMonths) / 100)
  const interestSd = r2((sd * ratePct * chargedMonths) / 100)
  const filedOn = i.filedOn ? i.filedOn.slice(0, 10) : undefined
  const lateFiling = (filedOn ?? paidOn) > dueDate
  const penaltyLate = lateFiling ? r2(Math.max(0, i.latePenalty ?? rule("penalty.lateReturn", dueDate))) : 0
  return {
    period: i.period, dueDate, paidOn, filedOn, daysLate, months, chargedMonths, capped: months > maxMonths, ratePct, maxMonths,
    vat, sd, interestVat, interestSd, lateFiling, penaltyLate, total: r2(interestVat + interestSd + penaltyLate),
    refs: { interest: ruleRow("interest.monthlyPct", dueDate)?.ref ?? "§127", penalty: ruleRow("penalty.lateReturn", dueDate)?.ref ?? "§85" },
  }
}
