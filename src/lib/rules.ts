/**
 * R6 — effective-dated NBR tax rules and the Bangladesh working-day calendar.
 *
 * Every rate, window and deadline that the law changes from time to time lives here with the date it took effect and
 * its legal reference, so a new Finance Act or SRO is a data change, not a code change. Pure module: used by the mock
 * API, the NestJS API (through the compat layer) and the browser.
 */
import type { VatProfile, VatSettings } from "./types"

export type RuleKey =
  | "return.dueDays" | "return.dueDaysExtended"
  | "itc.windowPeriods" | "at.adjustWindowPeriods" | "vds.supplierWindowPeriods"
  | "vds.certificateWorkingDays" | "vds.unregisteredDepositDays"
  | "at.rate.manufacturer" | "at.rate.commercial"
  | "interest.monthlyPct" | "interest.maxMonths"
  | "bank.channelLimit" | "m610.limit" | "software.mandatoryTurnover" | "registration.threshold"

export interface TaxRule { key: RuleKey; value: number; from: string; to?: string; ref: string }

/** Oldest first per key; `rule()` picks the row in force on the date. */
export const TAX_RULES: TaxRule[] = [
  { key: "return.dueDays", value: 15, from: "2019-07-01", ref: "VAT & SD Act 2012 §64; Ordinance approved by Cabinet 29-09-2026 (monthly, 15 days)" },
  { key: "return.dueDaysExtended", value: 20, from: "2026-07-01", ref: "§64 as amended — government/autonomous bodies, banks, insurers, zero-return filers" },
  { key: "itc.windowPeriods", value: 4, from: "2019-07-01", to: "2025-06-30", ref: "§46(2)" },
  { key: "itc.windowPeriods", value: 6, from: "2025-07-01", ref: "§46(2) as amended by Finance Ordinance 2025" },
  { key: "at.adjustWindowPeriods", value: 4, from: "2019-07-01", to: "2025-06-30", ref: "§31" },
  { key: "at.adjustWindowPeriods", value: 6, from: "2025-07-01", ref: "§31 as amended by Finance Ordinance 2025" },
  { key: "vds.supplierWindowPeriods", value: 3, from: "2021-07-01", to: "2025-06-30", ref: "VDS Guidelines 2021" },
  { key: "vds.supplierWindowPeriods", value: 6, from: "2025-07-01", ref: "VDS Guidelines 2025 (SRO 182-Ain/2025/310-Mushak)" },
  { key: "vds.certificateWorkingDays", value: 3, from: "2025-07-01", ref: "VDS Guidelines 2025 — Mushak 6.6 within 3 working days of filing the return" },
  { key: "vds.unregisteredDepositDays", value: 15, from: "2025-07-01", ref: "VDS Guidelines 2025 — unregistered withholders, A-challan / e-payment" },
  { key: "at.rate.manufacturer", value: 3, from: "2019-07-01", to: "2025-06-30", ref: "§31, Finance Act 2019" },
  { key: "at.rate.manufacturer", value: 2, from: "2025-07-01", ref: "Finance Ordinance 2025" },
  { key: "at.rate.commercial", value: 5, from: "2019-07-01", to: "2025-06-30", ref: "§31" },
  { key: "at.rate.commercial", value: 7.5, from: "2025-07-01", ref: "Finance Ordinance 2025" },
  { key: "interest.monthlyPct", value: 1, from: "2019-07-01", ref: "§127 — simple interest per month" },
  { key: "interest.maxMonths", value: 24, from: "2019-07-01", ref: "§127" },
  { key: "bank.channelLimit", value: 100_000, from: "2019-07-01", ref: "§46 — payments above Tk 1 lakh through bank / MFS" },
  { key: "m610.limit", value: 200_000, from: "2019-07-01", ref: "Rule 42 — Mushak 6.10" },
  { key: "software.mandatoryTurnover", value: 50_000_000, from: "2019-01-01", ref: "General Order 16/Mushak/2019 — NBR-enlisted VAT software above Tk 5 crore" },
  { key: "registration.threshold", value: 5_000_000, from: "2025-01-09", ref: "VAT & SD (Amendment) Ordinance 2025 — Tk 50 lakh" },
]

/** The value of a rule on a date (YYYY-MM-DD). Throws if no row covers the date (a gap in the table is a bug). */
export function rule(key: RuleKey, date: string): number {
  const r = TAX_RULES.find((x) => x.key === key && x.from <= date && (!x.to || date <= x.to))
  if (!r) throw new Error(`no tax rule ${key} on ${date}`)
  return r.value
}
export const ruleRow = (key: RuleKey, date: string) => TAX_RULES.find((x) => x.key === key && x.from <= date && (!x.to || date <= x.to))

/* ── Business profile ───────────────────────────────────────────────────── */

export const SEGMENTS = ["rmgDirect", "rmgDeemed", "rmgComposite", "manufacturer", "trader", "service"] as const
export const IMPORTER_TYPES = ["manufacturer", "commercial"] as const
export const FILER_CATEGORIES = ["standard", "extended"] as const

export const DEFAULT_PROFILE: VatProfile = {
  segment: "manufacturer", exportOriented: false, importerType: "manufacturer", filerCategory: "standard",
  bondLicenseNo: "", bondLicenseExpiry: "", associationNo: "", holidays: [],
}
export const profileOf = (s?: Pick<VatSettings, "profile"> | null): VatProfile => ({ ...DEFAULT_PROFILE, ...(s?.profile ?? {}) })
export const isRmg = (p: VatProfile) => p.segment.startsWith("rmg")

/** Advance tax (AT) at import for the company's importer type on a date. */
export const atRateFor = (p: Pick<VatProfile, "importerType">, date: string) => rule(p.importerType === "commercial" ? "at.rate.commercial" : "at.rate.manufacturer", date)

/* ── Working days ───────────────────────────────────────────────────────── */

/**
 * Fixed-date public holidays (Bangladesh). Moon-dependent holidays (Eid, Ashura, Shab-e-Barat …) and the government's
 * yearly additions are gazetted every year — the company adds them in VAT settings → Business profile → Holidays.
 */
export const FIXED_HOLIDAYS = ["02-21", "03-26", "04-14", "05-01", "12-16", "12-25"]
const pad = (n: number) => String(n).padStart(2, "0")
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)) }

/** Friday and Saturday are the weekly holidays in Bangladesh. */
export const isWeekend = (date: string) => { const w = parse(date).getUTCDay(); return w === 5 || w === 6 }
export const isHoliday = (date: string, extra: readonly string[] = []) => isWeekend(date) || FIXED_HOLIDAYS.includes(date.slice(5)) || extra.includes(date)
export function addDays(date: string, n: number) { const d = parse(date); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
/** The date itself if it is a working day, otherwise the next working day. */
export function nextWorkingDay(date: string, extra: readonly string[] = []) { let d = date; while (isHoliday(d, extra)) d = addDays(d, 1); return d }
/** `n` working days after `date` (the date itself not counted). */
export function addWorkingDays(date: string, n: number, extra: readonly string[] = []) { let d = date, k = 0; while (k < n) { d = addDays(d, 1); if (!isHoliday(d, extra)) k++ } return d }

/* ── Deadlines ──────────────────────────────────────────────────────────── */

const periodEndOf = (period: string) => { const [y, m] = period.split("-").map(Number); return iso(new Date(Date.UTC(y, m, 0))) }

/**
 * Return (and payment) due date of a monthly tax period: 15 days after the period ends — 20 days for the extended
 * category (government, banks, insurers, zero-return filers) — moved to the next working day when it falls on a
 * weekly or public holiday (§64 as amended; Cabinet-approved Ordinance of 29-09-2026).
 */
export function returnDueDate(period: string, settings?: Pick<VatSettings, "profile"> | null) {
  const p = profileOf(settings)
  const end = periodEndOf(period)
  const days = rule(p.filerCategory === "extended" ? "return.dueDaysExtended" : "return.dueDays", addDays(end, 1))
  return nextWorkingDay(addDays(end, days), p.holidays)
}

/** Last tax period in which a credit first available in `period` may still be claimed (period + window). */
export function claimDeadlinePeriod(period: string, key: "itc.windowPeriods" | "at.adjustWindowPeriods" | "vds.supplierWindowPeriods") {
  const n = rule(key, `${period}-01`)
  const [y, m] = period.split("-").map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

/**
 * Mushak 6.6 (VDS certificate) deadline for a registered withholder: within 3 working days of filing the return of the
 * period in which VAT was deducted (VDS Guidelines 2025). Uses the actual filing date when known, the return due date otherwise.
 */
export function vdsCertificateDue(period: string, settings?: Pick<VatSettings, "profile"> | null, filedOn?: string) {
  const p = profileOf(settings)
  const base = filedOn && filedOn.slice(0, 10) <= returnDueDate(period, settings) ? filedOn.slice(0, 10) : returnDueDate(period, settings)
  return addWorkingDays(base, rule("vds.certificateWorkingDays", base), p.holidays)
}
