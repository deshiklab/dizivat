/**
 * R8.3 — the schedule on its own tables: the reminder settings row, the reminders the tick has fired, the
 * delivery schedules and their log. The rules are the mock's own (`src/app/api/v1/_r83.ts`, served through the
 * compat bundle): what the settings may hold, which deadlines stand today, what a run of the schedule does —
 * so the two runtimes cannot drift, not even the order the log lists. What changed is underneath:
 *   - the tick applies its plan inside one transaction under the state guard, so a day cannot fire twice even
 *     with two instances briefly side by side (the reminders' ids and the log's (schedule, day) unique index
 *     are the idempotency keys);
 *   - the delivered document is the frozen jsonb the row carries — re-printing a past delivery shows the very
 *     figures the recipients saw;
 *   - the in-memory copies the notification feed reads stay in step on every write.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, sql } from "drizzle-orm"
import type { Request, Response } from "express"
import { runQuery } from "@/lib/mock/query"
import type { DeliveryLogRow, DeliverySchedule, FiredReminder, ReminderSettings } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams } from "../common/http"
import { lockState } from "../common/state-guard"
import { db } from "../db/client"
import { deliveryLog, deliverySchedules, reminderSettings, reminders } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"
import { returnSource } from "./returns"
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/mock/seed-r83"
import { TODAY } from "@/lib/company"

/* ── row mappers ───────────────────────────────────────────────────────── */

type ReminderDb = typeof reminders.$inferSelect
type ScheduleDb = typeof deliverySchedules.$inferSelect
type LogDb = typeof deliveryLog.$inferSelect

export const reminderValues = (r: FiredReminder) => ({ id: r.id, kind: r.kind, due: r.due, lead: r.lead, period: r.period, at: new Date(r.at) })
export const toFiredReminder = (r: ReminderDb): FiredReminder => ({ id: r.id, kind: r.kind, due: r.due, lead: r.lead, period: r.period, at: r.at.toISOString() })

export const scheduleValues = (s: DeliverySchedule) => ({
  id: s.id, kind: s.kind, frequency: s.frequency, day: s.day, recipients: s.recipients, enabled: s.enabled,
  lastRun: s.lastRun ?? null, nextRun: s.nextRun, note: s.note ?? null, createdBy: s.createdBy, createdAt: new Date(s.createdAt),
})
export const toDeliverySchedule = (r: ScheduleDb): DeliverySchedule => {
  const s: DeliverySchedule = {
    id: r.id, kind: r.kind, frequency: r.frequency, day: r.day, recipients: r.recipients, enabled: r.enabled,
    nextRun: r.nextRun, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.lastRun != null) s.lastRun = r.lastRun
  if (r.note != null) s.note = r.note
  return s
}

export const deliveryLogValues = (l: DeliveryLogRow) => ({
  id: l.id, scheduleId: l.scheduleId, kind: l.kind, period: l.period ?? null, asOf: l.asOf,
  generatedAt: new Date(l.generatedAt), recipients: l.recipients, document: l.document as unknown as Record<string, unknown>,
})
export const toDeliveryLog = (r: LogDb): DeliveryLogRow => {
  const l: DeliveryLogRow = {
    id: r.id, scheduleId: r.scheduleId, kind: r.kind, asOf: r.asOf, generatedAt: r.generatedAt.toISOString(),
    recipients: r.recipients, document: r.document as unknown as DeliveryLogRow["document"],
  }
  if (r.period != null) l.period = r.period
  return l
}

/* ── the service ───────────────────────────────────────────────────────── */

@Injectable()
export class ScheduleService {
  /** The one settings row; boot and the adoption leg write it, so a missing row is only a guard. */
  async settings(): Promise<ReminderSettings> {
    const [row] = await db.select().from(reminderSettings).where(eq(reminderSettings.id, 1))
    return row ? row.settings : DEFAULT_REMINDER_SETTINGS
  }

  async putSettings(s: ReminderSettings): Promise<ReminderSettings> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      const values = { id: 1, settings: s }
      await tx.insert(reminderSettings).values(values).onConflictDoUpdate({ target: reminderSettings.id, set: values })
    })
    mirror.putReminderSettings(s)
    return s
  }

  /** The fired reminders, oldest first (the feed re-orders them anyway). */
  async allReminders(): Promise<FiredReminder[]> {
    return (await db.select().from(reminders).orderBy(asc(reminders.at))).map(toFiredReminder)
  }

  /** The schedules in insertion order. */
  async allSchedules(): Promise<DeliverySchedule[]> {
    return (await db.select().from(deliverySchedules).orderBy(asc(deliverySchedules.ord))).map(toDeliverySchedule)
  }

  async scheduleById(id: string): Promise<DeliverySchedule | undefined> {
    const [row] = await db.select().from(deliverySchedules).where(eq(deliverySchedules.id, id))
    return row ? toDeliverySchedule(row) : undefined
  }

  /** The log, oldest first — the register reverses it (newest first). */
  async allLog(): Promise<DeliveryLogRow[]> {
    return (await db.select().from(deliveryLog).orderBy(asc(deliveryLog.ord))).map(toDeliveryLog)
  }

  async logById(id: string): Promise<DeliveryLogRow | undefined> {
    const [row] = await db.select().from(deliveryLog).where(eq(deliveryLog.id, id))
    return row ? toDeliveryLog(row) : undefined
  }

  /**
   * A new schedule: the id is claimed inside the lock (`ds` + one above the highest number ever used), the same
   * way the mock's own counter hands ids out, so two requests cannot share one.
   */
  async createSchedule(make: (ident: { id: string }) => DeliverySchedule): Promise<DeliverySchedule> {
    const id = await db.transaction(async (tx) => {
      await lockState(tx)
      const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${deliverySchedules.id}, '\\D', '', 'g'), '')::bigint), 0) + 1` }).from(deliverySchedules)
      const s = make({ id: `ds${n}` })
      await tx.insert(deliverySchedules).values(scheduleValues(s))
      return s.id
    })
    return (await this.scheduleById(id))!
  }

  /** An edit keeps the row (and its insertion order); `nextRun` re-derives from the new cadence. */
  async putSchedule(id: string, s: DeliverySchedule): Promise<DeliverySchedule> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(deliverySchedules).set(scheduleValues(s)).where(eq(deliverySchedules.id, id))
    })
    mirror.putDeliverySchedule(s)
    return s
  }

  async deleteSchedule(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.delete(deliverySchedules).where(eq(deliverySchedules.id, id))
    })
    mirror.removeDeliverySchedule(id)
  }

  /**
   * Applies a run of the schedule: the fired reminders stored, the pruned ones deleted, the delivered reports
   * logged (the id claimed inside the lock, `dx` + one above the highest ever used) and the schedules advanced —
   * one transaction under the state guard, so a re-run of the day changes nothing.
   */
  async applyRun(plan: {
    fire: Omit<FiredReminder, "at">[]; prune: FiredReminder[]
    deliver: { schedule: DeliverySchedule; row: Omit<DeliveryLogRow, "id" | "generatedAt"> }[]
    advance: DeliverySchedule[]
  }, at: string): Promise<DeliveryLogRow[]> {
    const delivered = await db.transaction(async (tx) => {
      await lockState(tx)
      if (plan.fire.length) await tx.insert(reminders).values(plan.fire.map((r) => reminderValues({ ...r, at })))
      if (plan.prune.length) await tx.delete(reminders).where(inArray(reminders.id, plan.prune.map((r) => r.id)))
      const rows: DeliveryLogRow[] = []
      for (const d of plan.deliver) {
        const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${deliveryLog.id}, '\\D', '', 'g'), '')::bigint), 0) + 1` }).from(deliveryLog)
        const row: DeliveryLogRow = { id: `dx${n}`, ...d.row, generatedAt: at }
        await tx.insert(deliveryLog).values(deliveryLogValues(row))
        await tx.update(deliverySchedules).set({ lastRun: d.row.asOf, nextRun: d.schedule.nextRun }).where(eq(deliverySchedules.id, d.schedule.id))
        rows.push(row)
      }
      return rows
    })
    // the in-memory copies the notification feed reads stay in step
    mirror.putReminders(await this.allReminders())
    mirror.putDeliverySchedules(await this.allSchedules())
    mirror.putDeliveryLog(await this.allLog())
    return delivered
  }
}

/* ── the controllers ───────────────────────────────────────────────────── */

@Controller("api/v1/schedule")
export class ScheduleController {
  constructor(
    @Inject(ScheduleService) private readonly svc: ScheduleService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The reminder settings. */
  @Get("settings") @Authed()
  async getSettings(@Res() res: Response) { res.json(await this.svc.settings()) }

  @Put("settings") @Authed("settings.manage")
  async putSettings(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const prev = await this.svc.settings()
    const rule = c.reminderSettingsRule(jsonBody(req), req.dz!.user.name)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const before = structuredClone(prev)
    const saved = await this.svc.putSettings(rule.fields)
    await this.audit.record({ actor: req.dz!.user, entity: "schedule", ref: "Reminder settings", action: "updated", changes: c.diff(before, saved, c.REMINDER_DIFF_FIELDS) })
    res.json(saved)
  }

  /** The delivery schedules. */
  @Get("deliveries") @Authed()
  async listSchedules(@Res() res: Response) { res.json({ rows: await this.svc.allSchedules() }) }

  @Post("deliveries") @Authed("settings.manage")
  async createSchedule(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const rule = c.deliveryRule(jsonBody(req))
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const user = req.dz!.user
    const s = await this.svc.createSchedule((ident) => ({
      id: ident.id, ...rule.fields, nextRun: c.nextRunAfter(rule.fields, TODAY), createdBy: user.name, createdAt: new Date().toISOString(),
    }))
    await this.audit.record({ actor: user, entity: "schedule", entityId: s.id, ref: c.scheduleRef(s), action: "created" })
    res.status(201).json(s)
  }

  @Get("deliveries/:id") @Authed()
  async oneSchedule(@Param("id") id: string, @Res() res: Response) {
    const s = await this.svc.scheduleById(id)
    if (!s) throw new Problem(404, "Schedule not found")
    res.json(s)
  }

  @Put("deliveries/:id") @Authed("settings.manage")
  async editSchedule(@Req() req: AuthedRequest, @Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const s = await this.svc.scheduleById(id)
    if (!s) throw new Problem(404, "Schedule not found")
    const rule = c.deliveryRule(jsonBody(req), s)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const before = { ...s }
    const saved = await this.svc.putSchedule(id, { ...s, ...rule.fields, nextRun: c.nextRunAfter(rule.fields, TODAY) })
    await this.audit.record({
      actor: req.dz!.user, entity: "schedule", entityId: s.id, ref: c.scheduleRef(saved), action: "updated", changes: [
        ...(before.frequency !== saved.frequency ? [{ field: "frequency", from: before.frequency, to: saved.frequency }] : []),
        ...(before.day !== saved.day ? [{ field: "day", from: String(before.day), to: String(saved.day) }] : []),
        ...(before.enabled !== saved.enabled ? [{ field: "enabled", from: String(before.enabled), to: String(saved.enabled) }] : []),
        ...(before.recipients.join(",") !== saved.recipients.join(",") ? [{ field: "recipients", from: before.recipients.join(", "), to: saved.recipients.join(", ") }] : []),
      ],
    })
    res.json(saved)
  }

  @Delete("deliveries/:id") @Authed("settings.manage")
  async deleteSchedule(@Req() req: AuthedRequest, @Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const s = await this.svc.scheduleById(id)
    if (!s) throw new Problem(404, "Schedule not found")
    await this.svc.deleteSchedule(id)
    await this.audit.record({ actor: req.dz!.user, entity: "schedule", entityId: s.id, ref: c.scheduleRef(s), action: "deleted", note: "Delivery schedule deleted" })
    res.json({ ok: true })
  }

  /** The delivery log — Page, newest first, through the mock's own query engine. */
  @Get("log") @Authed()
  async log(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "generatedAt.desc")
    const r = runQuery([...await this.svc.allLog()].reverse(), sp, c.deliveryLogSpec)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json(page)
  }

  @Get("log/:id") @Authed()
  async oneLog(@Param("id") id: string, @Res() res: Response) {
    const l = await this.svc.logById(id)
    if (!l) throw new Problem(404, "Delivery not found")
    res.json(l)
  }

  /** The delivered document: the frozen figures as a CSV (the default) or the printable HTML. */
  @Get("log/:id/document") @Authed()
  async document(@Req() req: Request, @Param("id") id: string, @Res() res: Response) {
    const l = await this.svc.logById(id)
    if (!l) throw new Problem(404, "Delivery not found")
    const r = compat().deliveryDocumentResponse(l, searchParams(req).get("format") ?? "csv")
    res.status(r.status)
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.send(await r.text())
  }

  /**
   * Run the schedule for today — the "Run now" button, and what a cron line calls (`POST /api/v1/schedule/tick`,
   * which is idempotent per day). The plan itself is the mock's own, computed from the live books, then applied
   * under the state guard; the reminders it fires own their deadlines in the notification feed from then on.
   */
  @Post("tick") @Authed("settings.manage")
  async tick(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const src = await returnSource()
    const [settings, rem, schedules, log] = await Promise.all([this.svc.settings(), this.svc.allReminders(), this.svc.allSchedules(), this.svc.allLog()])
    const plan = c.runSchedule(src, { settings, reminders: rem, schedules, log }, TODAY)
    const at = new Date().toISOString()
    const delivered = await this.svc.applyRun(plan, at)
    if (plan.fire.length || plan.deliver.length || plan.prune.length)
      await this.audit.record({
        actor: req.dz!.user, entity: "schedule", ref: "Schedule run", action: "updated",
        note: `${plan.fire.length} reminder${plan.fire.length === 1 ? "" : "s"} fired, ${delivered.length} report${delivered.length === 1 ? "" : "s"} delivered`,
      })
    // 200, not Nest's POST default 201: the tick is an action, not a creation — the mock answers 200 and the
    // contract pins it
    res.status(200).json({ date: TODAY, fired: plan.fire.map((r) => ({ ...r, at })), pruned: plan.prune.length, delivered })
  }
}
