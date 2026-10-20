/**
 * R8.3 — the reminder and delivery schedule, as pure functions: what the settings may hold, when a cadence next
 * runs, the id that makes a fired reminder idempotent, and the frozen figure snapshot a delivered VAT digest is.
 * Shared by the mock handlers, the NestJS module and the page itself (the labels come from the catalogs), the
 * same way `lib/backup-schedule.ts` shares the backup slots. Everything here takes its data as a parameter.
 */
import { periodLabel, returnDue } from "./r4"
import { computeReturn, type ReturnSource } from "./mock/vat-return"
import { round2 } from "./vat"
import type { DeliverySchedule, ReminderKind, VatDigestDoc, VatSettings } from "./types"

/** The deadlines the settings can watch, in the order the settings page shows them. */
export const REMINDER_KINDS: ReminderKind[] = ["return91", "treasury", "vds"]
/** Where each reminder leads and what the notification calls it (a `notifications.deadline.*` key). */
export const REMINDER_TARGET: Record<ReminderKind, { href: string; title: string }> = {
  return91: { href: "/vat/return-9-1", title: "return91" },
  treasury: { href: "/vat/tr-6", title: "treasuryDeposit" },
  vds: { href: "/vat/vds", title: "vdsCertificates" },
}
/** The reports a delivery schedule can carry, and where each runs from. */
export const DELIVERY_KINDS = ["vatDigest", "receivablesDigest"] as const

/** `rem:return91:2026-10-15:14` — stable per (deadline, due date, lead), so one reminder fires once, ever. */
export const reminderId = (kind: ReminderKind, due: string, lead: number) => `rem:${kind}:${due}:${lead}`

const DAY = 864e5
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
/** TR-6 lands the day before the return it funds. */
export const dayBefore = (iso: string) => addDays(iso, -1)

/** The weekday of an ISO date, 1 = Monday … 7 = Sunday (the weekly schedules' `day`). */
export function weekdayOf(iso: string): number {
  const d = new Date(iso + "T00:00:00Z").getUTCDay() // 0 = Sunday
  return d === 0 ? 7 : d
}
function addMonth(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
}
/**
 * When the schedule next runs at or after `from` (an ISO date): a monthly schedule runs on its day of the month —
 * when `from` is past that day the next month's is taken (day 28 caps it, so February cannot be skipped); a
 * weekly schedule runs on its weekday, `from` itself when that is the day.
 */
export function nextRunAfter(schedule: Pick<DeliverySchedule, "frequency" | "day">, from: string): string {
  if (schedule.frequency === "weekly") {
    const wd = weekdayOf(from)
    return addDays(from, (schedule.day - wd + 7) % 7)
  }
  const sameMonth = `${from.slice(0, 7)}-${String(schedule.day).padStart(2, "0")}`
  return from <= sameMonth ? sameMonth : `${addMonth(from.slice(0, 7), 1)}-${String(schedule.day).padStart(2, "0")}`
}

/** The tone a reminder carries: urgent inside the last week, warning inside the last fortnight. */
export const reminderTone = (daysLeft: number) => (daysLeft <= 7 ? "danger" : daysLeft <= 14 ? "warning" : "info")

/**
 * The VAT digest of one tax period — the figures the delivered report freezes: what the 9.1 (as filed or as it
 * stands) says, what the treasury has received, and the VDS certificates the period's purchases carry. Pure: the
 * source is a parameter, so the seeder, the tick and the two runtimes all build the very same document.
 */
export function vatDigestDocument(src: ReturnSource, period: string): VatDigestDoc {
  const r = src.returns.find((x) => x.period === period)
  const c = r?.snapshot ?? computeReturn(src, period, r?.manual)
  const deposits = src.treasury.filter((t) => t.taxPeriod === period && t.process !== "Cancelled")
  const approved = deposits.filter((t) => t.process === "Approved")
  const issued = src.vds.filter((v) => v.mode === "purchase" && v.taxPeriod === period && v.process === "Approved")
  return {
    kind: "vatDigest",
    period, due: returnDue(period, src.vatSettings as VatSettings), // the live settings carry the profile the due date reads
    status: r?.status === "submitted" ? "submitted" : r ? "draft" : "open",
    ...(r?.submissionDate ? { submittedAt: r.submissionDate } : {}), ...(r?.ackNo ? { ackNo: r.ackNo } : {}),
    outputVat: c.outputVat, inputVat: c.inputVat,
    netVat: c.netVat, payableVat: c.payableVat, payableSd: c.payableSd,
    depositedVat: c.depositedVat, shortVat: c.shortVat, shortSd: c.shortSd,
    closingVat: c.closingVat, openingVat: c.openingVat, drafts: c.drafts,
    deposits: { count: deposits.length, amount: round2(approved.reduce((s, t) => s + t.amount, 0)), pending: deposits.length - approved.length },
    vdsIssued: { count: issued.length, amount: round2(issued.reduce((s, v) => s + v.amount, 0)) },
  }
}

/** The label the log and the page show for a period / an as-of date (the catalogs translate the month). */
export const digestPeriodLabel = (kind: DeliverySchedule["kind"], period: string | undefined, asOf: string) =>
  kind === "vatDigest" && period ? periodLabel(period) : asOf

/** What the CSV of each digest carries — the log's document viewer offers it beside the printable HTML. */
export const VAT_DIGEST_CSV: { key: string; label: string; get: (d: VatDigestDoc) => string | number }[] = [
  { key: "period", label: "Tax period", get: (d) => periodLabel(d.period) },
  { key: "status", label: "Status", get: (d) => d.status },
  { key: "due", label: "Due date", get: (d) => d.due },
  { key: "outputVat", label: "Output VAT (14)", get: (d) => d.outputVat },
  { key: "inputVat", label: "Input tax credit (22)", get: (d) => d.inputVat },
  { key: "netVat", label: "Net VAT (50)", get: (d) => d.netVat },
  { key: "payableVat", label: "Payable VAT", get: (d) => d.payableVat },
  { key: "payableSd", label: "Payable SD", get: (d) => d.payableSd },
  { key: "depositedVat", label: "VAT deposited (58)", get: (d) => d.depositedVat },
  { key: "shortVat", label: "Shortfall", get: (d) => d.shortVat },
  { key: "closingVat", label: "Closing balance (65)", get: (d) => d.closingVat },
  { key: "deposits", label: "TR-6 deposits", get: (d) => d.deposits.count },
  { key: "vdsIssued", label: "VDS certificates", get: (d) => d.vdsIssued.count },
]
export const RECEIVABLES_CSV: { key: string; label: string; get: (d: ReceivablesLine) => string | number }[] = [
  { key: "asOf", label: "As of", get: (d) => d.asOf },
  { key: "count", label: "Open invoices", get: (d) => d.invoices.count },
  { key: "amount", label: "Amount due", get: (d) => d.invoices.amount },
  { key: "d0_30", label: "0–30 days", get: (d) => d.ageing.d0_30 },
  { key: "d31_60", label: "31–60 days", get: (d) => d.ageing.d31_60 },
  { key: "d61_90", label: "61–90 days", get: (d) => d.ageing.d61_90 },
  { key: "d90", label: "Over 90 days", get: (d) => d.ageing.d90 },
  { key: "advances", label: "Customer advances", get: (d) => d.advances },
]
type ReceivablesLine = { asOf: string; invoices: { count: number; amount: number }; ageing: { d0_30: number; d31_60: number; d61_90: number; d90: number }; advances: number }
