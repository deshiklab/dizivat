/**
 * R8.3 — the statutory reminder and report-delivery schedule.
 *
 * A garment factory's compliance calendar is only useful if somebody watches it: the Mushak 9.1 has to be filed by
 * the 15th, the TR-6 deposit has to precede it and the VDS certificates (Mushak 6.6) have to be issued within their
 * window. The settings say how many days ahead each of the three deadlines should be reminded — every lead time that
 * has arrived fires a stored reminder, which then owns the deadline in the notification feed (the ambient D-21
 * window keeps showing it until the first lead fires, so a default install behaves exactly as before).
 *
 * Beside the reminders sit the delivery schedules: the monthly VAT digest (the 9.1 figures as they stand, frozen at
 * delivery time) and the weekly receivables digest (open customer invoices and their ageing), each delivered to a
 * list of users and kept in a log whose rows carry the very figures the recipients saw. A tick — the "Run now"
 * button on the page, or the cron line in the deployment — fires the day's reminders and runs the day's deliveries,
 * idempotently: a reminder id is its (deadline, due date, lead), and a delivery is keyed by (schedule, day).
 *
 * Shared with the NestJS build the same way `_r8` is: the mock handlers and the API's native module both call
 * `reminderTargets` / `runSchedule` / the document builders, so the two runtimes cannot drift.
 */
import { complianceAnswer, openInvoices, taxPeriods, type ReturnSource } from "./_r4"
import { invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { deliveryInput, reminderSettingsInput } from "@/lib/schemas"
import { delay, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { TODAY } from "@/lib/company"
import { round2 } from "@/lib/vat"
import { periodLabel, prevPeriod, periodOf } from "@/lib/r4"
import { RECEIVABLES_CSV, VAT_DIGEST_CSV, addDays, dayBefore, daysBetween, nextRunAfter, reminderId, vatDigestDocument } from "@/lib/schedule"
import type { DeliveryKind, DeliveryLogRow, DeliverySchedule, FiredReminder, ReceivablesDigestDoc, ReminderKind, ReminderSettings } from "@/lib/types"

/* ── input ─────────────────────────────────────────────────────────────── */

/* ── the reminder targets ──────────────────────────────────────────────── */

/** What a reminder is about: the deadline's own due date and the tax period it belongs to. */
export interface ReminderTarget { kind: ReminderKind; due: string; period: string }

/**
 * The deadlines as they stand on `date`: the earliest period the company has not filed yet carries the 9.1 (its due
 * date) and the TR-6 deposit (the day before); the same period carries the VDS certificates only while purchases
 * still owe some. Pure — the source is a parameter.
 */
export function reminderTargets(src: ReturnSource, date = TODAY): ReminderTarget[] {
  const p = taxPeriods(src).find((x) => x.status !== "submitted")
  if (!p) return []
  const out: ReminderTarget[] = [
    { kind: "return91", due: p.due, period: p.period },
    { kind: "treasury", due: dayBefore(p.due), period: p.period },
  ]
  const answer = complianceAnswer(p.period, src)
  if (!("title" in answer) && answer.vds.toIssue > 0 && answer.vds.issueBy && answer.vds.issueBy >= date)
    out.push({ kind: "vds", due: answer.vds.issueBy, period: p.period })
  return out
}

/**
 * The reminders that have arrived as of `date` — every lead time the calendar has reached. Firing one is the
 * caller's job (the id makes it idempotent); this only says which (deadline, lead) pairs are due.
 */
export function dueReminders(settings: ReminderSettings, targets: ReminderTarget[], date = TODAY): Omit<FiredReminder, "at">[] {
  const out: Omit<FiredReminder, "at">[] = []
  for (const t of targets) {
    const s = settings[t.kind]
    if (!s?.enabled) continue
    const days = daysBetween(date, t.due)
    for (const lead of [...s.leads].sort((a, b) => b - a)) if (days <= lead) out.push({ id: reminderId(t.kind, t.due, lead), kind: t.kind, due: t.due, lead, period: t.period })
  }
  return out
}

/* ── the digests ───────────────────────────────────────────────────────── */

/** The weekly receivables digest: every customer's open invoices, aged the way the party statements age them. */
export function receivablesDigestDocument(src: ReturnSource, asOf = TODAY): ReceivablesDigestDoc {
  const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  const per = new Map<string, { name: string; amount: number }>()
  let count = 0, amount = 0
  for (const c of src.customers) {
    const open = openInvoices("receipt", c.id, src)
    if (!open.length) continue
    const due = round2(open.reduce((s, o) => s + o.due, 0))
    count += open.length
    amount = round2(amount + due)
    per.set(c.id, { name: c.name, amount: due })
    for (const o of open) {
      const k = o.days <= 30 ? "d0_30" : o.days <= 60 ? "d31_60" : o.days <= 90 ? "d61_90" : "d90"
      ageing[k] = round2(ageing[k] + o.due)
    }
  }
  return {
    kind: "receivablesDigest", asOf,
    invoices: { count, amount },
    ageing,
    top: [...per.entries()].map(([partyId, v]) => ({ partyId, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    advances: round2(src.moneyDocs?.filter((m) => m.kind === "receipt" && m.process !== "Cancelled").reduce((s, m) => s + (m.unallocated ?? 0), 0) ?? 0),
  }
}

/** The document a schedule delivers: the VAT digest freezes the period as it stands, the receivables digest the day. */
export function deliveryDocument(kind: DeliveryKind, src: ReturnSource, date = TODAY) {
  return kind === "vatDigest" ? vatDigestDocument(src, prevPeriod(periodOf(date))) : receivablesDigestDocument(src, date)
}

/* ── the tick ──────────────────────────────────────────────────────────── */

/** What a run of the schedule does: the reminders to store, the reports to deliver, and the schedules it advances. */
export interface ScheduleRun {
  /** reminders whose lead time has arrived and that are not stored yet */
  fire: Omit<FiredReminder, "at">[]
  /** stored reminders that have lost their subject (the return was filed, the VDS issued) or long expired */
  prune: FiredReminder[]
  /** the deliveries whose day has come — `row` still needs its id and its `generatedAt` */
  deliver: { schedule: DeliverySchedule; row: Omit<DeliveryLogRow, "id" | "generatedAt"> }[]
  /** schedules whose `lastRun` / `nextRun` the run advances */
  advance: DeliverySchedule[]
}

/**
 * The tick's plan, pure: given the settings, the stored reminders, the schedules and the log as they stand, what a
 * run on `date` does. Both runtimes apply the very same plan — the mock to its arrays, the API inside a transaction
 * — so a day can be re-run (on either runtime) without firing anything twice.
 */
export function runSchedule(src: ReturnSource, state: {
  settings: ReminderSettings; reminders: FiredReminder[]; schedules: DeliverySchedule[]; log: DeliveryLogRow[]
}, date = TODAY): ScheduleRun {
  const targets = reminderTargets(src, date)
  const due = dueReminders(state.settings, targets, date)
  const fire = due.filter((d) => !state.reminders.some((r) => r.id === d.id))
  // a reminder whose subject is gone (the period was filed) or whose deadline is long past leaves the feed
  const filed = new Set(taxPeriods(src).filter((p) => p.status === "submitted").map((p) => p.period))
  const prune = state.reminders.filter((r) =>
    ((r.kind === "return91" || r.kind === "treasury") && filed.has(r.period)) || daysBetween(r.due, date) > 30)
  const deliver: ScheduleRun["deliver"] = []
  const advance: DeliverySchedule[] = []
  for (const s of state.schedules) {
    if (!s.enabled || s.nextRun > date) continue
    if (state.log.some((l) => l.scheduleId === s.id && l.asOf === date)) continue // already delivered today
    deliver.push({ schedule: s, row: { scheduleId: s.id, kind: s.kind, ...(s.kind === "vatDigest" ? { period: prevPeriod(periodOf(date)) } : {}), asOf: date, recipients: s.recipients, document: deliveryDocument(s.kind, src, date) } })
    advance.push({ ...s, lastRun: date, nextRun: nextRunAfter(s, addDays(date, 1)) })
  }
  return { fire, prune, deliver, advance }
}

/* ── the rules ─────────────────────────────────────────────────────────── */

/** What an edit of the reminder settings records in the audit trail. */
export const REMINDER_DIFF_FIELDS = ["return91.enabled", "return91.leads", "treasury.enabled", "treasury.leads", "vds.enabled", "vds.leads"]

export function reminderSettingsRule(body: unknown, by: string): RuleProblem | { fields: ReminderSettings } {
  const parsed = reminderSettingsInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const norm = (k: ReminderKind) => ({ enabled: parsed.data[k].enabled, leads: [...new Set(parsed.data[k].leads)].sort((a, b) => b - a) })
  return { fields: { return91: norm("return91"), treasury: norm("treasury"), vds: norm("vds"), updatedAt: new Date().toISOString(), updatedBy: by } }
}

/** What an edit of a delivery schedule records in the audit trail. */
export const DELIVERY_DIFF_FIELDS = ["kind", "frequency", "day", "recipients", "enabled", "note"]

export function deliveryRule(body: unknown, _prev?: DeliverySchedule): RuleProblem | { fields: Omit<DeliverySchedule, "id" | "lastRun" | "nextRun" | "createdBy" | "createdAt"> } {
  const parsed = deliveryInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  if (_prev && _prev.kind !== parsed.data.kind) return { status: 409, title: "A schedule cannot change its report — delete it and create a new one." }
  return { fields: { kind: parsed.data.kind, frequency: parsed.data.frequency, day: parsed.data.day, recipients: parsed.data.recipients, enabled: parsed.data.enabled, note: parsed.data.note || undefined } }
}

/* ── the registers ─────────────────────────────────────────────────────── */

/** The log's register: what it searches and the facet it counts. */
export const deliveryLogSpec: QuerySpec<DeliveryLogRow> = {
  search: (x) => `${x.kind} ${x.period ?? ""} ${x.asOf}`,
  facets: { kind: (x) => x.kind },
}

/* ── the routes (mock) ─────────────────────────────────────────────────── */

/** GET / PUT the reminder settings. */
export const reminderSettingsRoutes = {
  GET: withAuth(null, async () => { await delay(); return json(db.reminderSettings) }),
  PUT: withAuth("settings.manage", async (req, _ctx, user) => {
    const rule = reminderSettingsRule(await req.json().catch(() => ({})), user.name)
    if ("status" in rule) return ruleResponse(rule)
    const before = structuredClone(db.reminderSettings)
    db.reminderSettings = rule.fields
    recordAudit({ actor: user.name, entity: "schedule", ref: "Reminder settings", action: "updated", changes: diff(before, db.reminderSettings, REMINDER_DIFF_FIELDS) })
    return json(db.reminderSettings)
  }),
}

/** GET the schedules / POST one. */
export function deliveryRoutes() {
  const GET = withAuth(null, async () => {
    await delay()
    return json({ rows: db.deliverySchedules })
  })
  const POST = withAuth("settings.manage", async (req, _ctx, user) => {
    const rule = deliveryRule(await req.json().catch(() => ({})))
    if ("status" in rule) return ruleResponse(rule)
    const at = new Date().toISOString()
    const n = Math.max(0, ...db.deliverySchedules.map((s) => Number(s.id.slice(2)) || 0)) + 1
    const s: DeliverySchedule = { id: `ds${n}`, ...rule.fields, nextRun: nextRunAfter(rule.fields, TODAY), createdBy: user.name, createdAt: at }
    db.deliverySchedules.push(s)
    recordAudit({ actor: user.name, entity: "schedule", entityId: s.id, ref: scheduleRef(s), action: "created" })
    return json(s, { status: 201 })
  })
  return { GET, POST }
}

/** One schedule: read, edit, delete. */
export const deliveryDocRoutes = {
  GET: withAuth<{ params: Promise<{ id: string }> }>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(80)
    const s = db.deliverySchedules.find((x) => x.id === id)
    return s ? json(s) : problem(404, "Schedule not found")
  }),
  PUT: withAuth<{ params: Promise<{ id: string }> }>("settings.manage", async (req, { params }, user) => {
    const { id } = await params
    const s = db.deliverySchedules.find((x) => x.id === id)
    if (!s) return problem(404, "Schedule not found")
    const rule = deliveryRule(await req.json().catch(() => ({})), s)
    if ("status" in rule) return ruleResponse(rule)
    const before = { ...s }
    Object.assign(s, rule.fields, { nextRun: nextRunAfter({ frequency: rule.fields.frequency, day: rule.fields.day }, TODAY) })
    recordAudit({ actor: user.name, entity: "schedule", entityId: s.id, ref: scheduleRef(s), action: "updated", changes: [
      ...(before.frequency !== s.frequency ? [{ field: "frequency", from: before.frequency, to: s.frequency }] : []),
      ...(before.day !== s.day ? [{ field: "day", from: String(before.day), to: String(s.day) }] : []),
      ...(before.enabled !== s.enabled ? [{ field: "enabled", from: String(before.enabled), to: String(s.enabled) }] : []),
      ...(before.recipients.join(",") !== s.recipients.join(",") ? [{ field: "recipients", from: before.recipients.join(", "), to: s.recipients.join(", ") }] : []),
    ] })
    return json(s)
  }),
  DELETE: withAuth<{ params: Promise<{ id: string }> }>("settings.manage", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.deliverySchedules.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Schedule not found")
    const [s] = db.deliverySchedules.splice(i, 1)
    recordAudit({ actor: user.name, entity: "schedule", entityId: s.id, ref: scheduleRef(s), action: "deleted", note: "Delivery schedule deleted" })
    return json({ ok: true })
  }),
}

export const scheduleRef = (s: DeliverySchedule) =>
  `${s.kind === "vatDigest" ? "VAT digest" : "Receivables digest"} · ${s.frequency === "monthly" ? `day ${s.day}` : `weekday ${s.day}`}`

/** The delivery log, newest first, and one row of it. */
export const deliveryLogRoutes = {
  GET: withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "generatedAt.desc")
    const r = runQuery([...db.deliveryLog].reverse(), sp, deliveryLogSpec)
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  }),
}

export const deliveryLogDocRoutes = {
  GET: withAuth<{ params: Promise<{ id: string }> }>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(80)
    const l = db.deliveryLog.find((x) => x.id === id)
    return l ? json(l) : problem(404, "Delivery not found")
  }),
}

/** The delivered document — `?format=csv` (the default) or the printable HTML. Both runtimes serve this. */
export function deliveryDocumentResponse(l: DeliveryLogRow, format = "csv"): Response {
  const doc = l.document
  if (format === "html") return htmlDocument(l)
  if (doc.kind === "vatDigest") return csvResponse(toCSV([doc], VAT_DIGEST_CSV), `${l.kind}-${l.period ?? l.asOf}.csv`)
  return csvResponse(toCSV([doc], RECEIVABLES_CSV), `${l.kind}-${l.asOf}.csv`)
}

/** The delivered document: `?format=csv` (default) or the printable HTML. */
export const deliveryDocumentRoutes = {
  GET: withAuth<{ params: Promise<{ id: string }> }>(null, async (req, { params }) => {
    const { id } = await params
    const l = db.deliveryLog.find((x) => x.id === id)
    if (!l) return problem(404, "Delivery not found")
    return deliveryDocumentResponse(l, new URL(req.url).searchParams.get("format") ?? "csv")
  }),
}

function csvResponse(csv: string, name: string) {
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } })
}

/** The printable HTML — the same figures the page's viewer shows, as a standalone document the log can re-print. */
function htmlDocument(l: DeliveryLogRow) {
  const d = l.document
  const title = d.kind === "vatDigest" ? `VAT digest — ${periodLabel(d.period)}` : `Receivables digest — ${d.asOf}`
  const row = (label: string, v: string | number) => `<tr><th>${label}</th><td>${v}</td></tr>`
  const body = d.kind === "vatDigest"
    ? [
      row("Tax period", periodLabel(d.period)), row("Status", d.status), row("Due date", d.due),
      ...(d.submittedAt ? [row("Submitted", d.submittedAt)] : []),
      row("Output VAT (14)", d.outputVat.toFixed(2)), row("Input tax credit (22)", d.inputVat.toFixed(2)),
      row("Net VAT (50)", d.netVat.toFixed(2)), row("Payable VAT", d.payableVat.toFixed(2)), row("Payable SD", d.payableSd.toFixed(2)),
      row("VAT deposited (58)", d.depositedVat.toFixed(2)), row("Shortfall", d.shortVat.toFixed(2)),
      row("Closing balance (65)", d.closingVat.toFixed(2)),
      row("TR-6 deposits", `${d.deposits.count} (${d.deposits.amount.toFixed(2)})`),
      row("VDS certificates (6.6)", `${d.vdsIssued.count} (${d.vdsIssued.amount.toFixed(2)})`),
    ].join("")
    : [
      row("As of", d.asOf), row("Open invoices", d.invoices.count), row("Amount due", d.invoices.amount.toFixed(2)),
      row("0–30 days", d.ageing.d0_30.toFixed(2)), row("31–60 days", d.ageing.d31_60.toFixed(2)),
      row("61–90 days", d.ageing.d61_90.toFixed(2)), row("Over 90 days", d.ageing.d90.toFixed(2)),
      row("Customer advances", d.advances.toFixed(2)),
      ...d.top.map((t) => row(t.name, t.amount.toFixed(2))),
    ].join("")
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:720px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.25rem}table{border-collapse:collapse;width:100%;margin-top:1rem}th,td{border:1px solid #cbd5e1;padding:.4rem .6rem;text-align:left}
th{width:16rem;background:#f8fafc;font-weight:600}p{color:#64748b}</style></head>
<body><h1>${title}</h1><p>Delivered ${l.generatedAt.slice(0, 10)} · ${l.recipients.length} recipient${l.recipients.length === 1 ? "" : "s"}</p>
<table>${body}</table></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } })
}

/** Run the schedule for today: fire the arrived reminders, deliver the day's reports. Idempotent per day. */
export const tickRoutes = {
  POST: withAuth("settings.manage", async (_req, _ctx, user) => {
    const plan = runSchedule(db, { settings: db.reminderSettings, reminders: db.reminders, schedules: db.deliverySchedules, log: db.deliveryLog }, TODAY)
    const at = new Date().toISOString()
    for (const r of plan.fire) db.reminders.push({ ...r, at })
    if (plan.prune.length) {
      const gone = new Set(plan.prune.map((r) => r.id))
      db.reminders = db.reminders.filter((r) => !gone.has(r.id))
    }
    const delivered: DeliveryLogRow[] = []
    for (const d of plan.deliver) {
      const n = Math.max(0, ...db.deliveryLog.map((l) => Number(l.id.slice(2)) || 0)) + 1
      const row: DeliveryLogRow = { id: `dx${n}`, ...d.row, generatedAt: at }
      db.deliveryLog.push(row)
      delivered.push(row)
      const s = db.deliverySchedules.find((x) => x.id === d.schedule.id)
      if (s) Object.assign(s, plan.advance.find((a) => a.id === s.id))
    }
    if (plan.fire.length || plan.deliver.length || plan.prune.length)
      recordAudit({ actor: user.name, entity: "schedule", ref: "Schedule run", action: "updated",
        note: `${plan.fire.length} reminder${plan.fire.length === 1 ? "" : "s"} fired, ${delivered.length} report${delivered.length === 1 ? "" : "s"} delivered` })
    return json({ date: TODAY, fired: plan.fire.map((r) => ({ ...r, at })), pruned: plan.prune.length, delivered })
  }),
}
