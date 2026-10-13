/**
 * R6.6 — the NBR enlistment's own two applications: Mushak 9.3 (s.65, rule 48), which asks the Commissioner to
 * let one period's return be filed late, and Mushak 9.4 (s.66, rule 49), which amends a submitted return's 9.1
 * source notes within four years.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r66.ts, reused through the compat
 * bundle): which periods are open to a late filing and the dates it may ask for, what a correction may touch and
 * the "as filed" value it carries, the treasury deposit an increase needs, the tax period a decrease's adjustment
 * lands in, the state (including the Commissioner's silence turning into a deemed approval) and the register's CSV
 * columns. What changed is underneath:
 *   - an application is a row in `late_filings` / `return_amendments`, its corrections and the amended return it
 *     filed travelling with it as JSONB — records of what was asked and what was decided, the way a settlement
 *     travels with an own UD;
 *   - an application number is unique in the database as well (partial unique index over the live rows), and so is
 *     one live application per period — a rejected one frees the period, exactly as the mock's array did;
 *   - a deleted draft is stamped, not removed: its id retires with it, the way the mock's ever-forward counter had;
 *   - the register, one application and the action steps read the rows; every write goes through the state guard,
 *     and the in-memory copy stays in step: the VAT return view and the amendment-aware return computation still
 *     read *every* application, so the mirror this module keeps is what holds the two copies together;
 *   - an amend step that decreases the tax posts decreasing adjustments (notes 32 / 39, s.55 read with s.66) —
 *     cross-family writes the module persists beside the application row itself, in the same transaction.
 */
import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, sql } from "drizzle-orm"
import type { ZodError } from "zod"
import type { Request, Response } from "express"
import { toCSV } from "@/lib/mock/query"
import { amendActionInput, amendmentInput, lateActionInput, lateFilingInput } from "@/lib/schemas"
import { periodLabel } from "@/lib/r4"
import { amendmentRow, lateFilingRow } from "@/lib/return-apps"
import { round2 } from "@/lib/vat"
import type { LateFiling, ReturnAmendment, VatAdjustment } from "@/lib/types"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import type { AmWrite, LfWrite } from "@/app/api/v1/_r66"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { lateFilings, returnAmendments, vatAdjustments } from "../db/schema"
import { compat, mirror } from "../state"
import { adjustmentValues, markAdjustments } from "./vat"
import { AuditService } from "./audit"

type LateDb = typeof lateFilings.$inferSelect
type AmDb = typeof returnAmendments.$inferSelect
/** The audit trail keeps the application's number and period as its reference. */
const LF_ENTITY = "lateFiling" as const
const AM_ENTITY = "returnAmendment" as const
const LABEL = "Application not found"
import { TODAY } from "@/lib/company"

const today = () => new Date().toISOString().slice(0, 10)
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** A row as the rules and the pages know the application: optional fields absent, not null. */
export function toLateFiling(r: LateDb): LateFiling {
  const lf: LateFiling = {
    id: r.id, no: r.no, period: r.period, reasonKind: r.reasonKind as LateFiling["reasonKind"], reason: r.reason,
    requestedDate: r.requestedDate, status: r.status as LateFiling["status"], createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.filedOn) lf.filedOn = r.filedOn
  if (r.filedRef) lf.filedRef = r.filedRef
  if (r.decidedOn) lf.decidedOn = r.decidedOn
  if (r.commissionerRef) lf.commissionerRef = r.commissionerRef
  if (r.grantedDate) lf.grantedDate = r.grantedDate
  if (r.rejectReason) lf.rejectReason = r.rejectReason
  if (r.updatedAt) lf.updatedAt = r.updatedAt.toISOString()
  if (r.history) lf.history = r.history
  return lf
}
/** The application as the columns hold it. */
export const lateFilingValues = (lf: LateFiling) => ({
  id: lf.id, no: lf.no, period: lf.period, reasonKind: lf.reasonKind, reason: lf.reason, requestedDate: lf.requestedDate,
  status: lf.status, filedOn: lf.filedOn ?? null, filedRef: lf.filedRef ?? null, decidedOn: lf.decidedOn ?? null,
  commissionerRef: lf.commissionerRef ?? null, grantedDate: lf.grantedDate ?? null, rejectReason: lf.rejectReason ?? null,
  createdBy: lf.createdBy, createdAt: new Date(lf.createdAt), updatedAt: lf.updatedAt ? new Date(lf.updatedAt) : null,
  history: lf.history ?? null,
})

/** The same for a 9.4 application: its corrections and the amended return it filed travel as JSONB. */
export function toAmendment(r: AmDb): ReturnAmendment {
  const a: ReturnAmendment = {
    id: r.id, no: r.no, period: r.period, reasonKind: r.reasonKind as ReturnAmendment["reasonKind"], description: r.description,
    corrections: r.corrections, noAudit: r.noAudit, revision: r.revision, status: r.status as ReturnAmendment["status"],
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.filedOn) a.filedOn = r.filedOn
  if (r.filedRef) a.filedRef = r.filedRef
  if (r.decidedOn) a.decidedOn = r.decidedOn
  if (r.commissionerRef) a.commissionerRef = r.commissionerRef
  if (r.rejectReason) a.rejectReason = r.rejectReason
  if (r.adjustPeriod) a.adjustPeriod = r.adjustPeriod
  if (r.amended) a.amended = r.amended
  if (r.updatedAt) a.updatedAt = r.updatedAt.toISOString()
  if (r.history) a.history = r.history
  return a
}
export const amendmentValues = (a: ReturnAmendment) => ({
  id: a.id, no: a.no, period: a.period, reasonKind: a.reasonKind, description: a.description, corrections: a.corrections,
  noAudit: a.noAudit, revision: a.revision, status: a.status, filedOn: a.filedOn ?? null, filedRef: a.filedRef ?? null,
  decidedOn: a.decidedOn ?? null, commissionerRef: a.commissionerRef ?? null, rejectReason: a.rejectReason ?? null,
  adjustPeriod: a.adjustPeriod ?? null, amended: a.amended ?? null, createdBy: a.createdBy, createdAt: new Date(a.createdAt),
  updatedAt: a.updatedAt ? new Date(a.updatedAt) : null, history: a.history ?? null,
})

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class ReturnAppsService {
  /** Every live 9.3 application in insertion order — the order the mock's array had. */
  async allLate(): Promise<LateFiling[]> {
    return (await db.select().from(lateFilings).where(sql`${lateFilings.deletedAt} is null`).orderBy(asc(lateFilings.ord))).map(toLateFiling)
  }

  /** Every live 9.4 application, the same. */
  async allAmendments(): Promise<ReturnAmendment[]> {
    return (await db.select().from(returnAmendments).where(sql`${returnAmendments.deletedAt} is null`).orderBy(asc(returnAmendments.ord))).map(toAmendment)
  }

  /** One application by id or by number, the way the mock's routes found them. */
  async lateByIdOrNo(idOrNo: string): Promise<LateFiling | undefined> {
    const rows = await db.select().from(lateFilings).where(sql`${lateFilings.deletedAt} is null and (${lateFilings.id} = ${idOrNo} or ${lateFilings.no} = ${idOrNo})`)
    return rows.length ? toLateFiling(rows[0]) : undefined
  }

  async amendmentByIdOrNo(idOrNo: string): Promise<ReturnAmendment | undefined> {
    const rows = await db.select().from(returnAmendments).where(sql`${returnAmendments.deletedAt} is null and (${returnAmendments.id} = ${idOrNo} or ${returnAmendments.no} = ${idOrNo})`)
    return rows.length ? toAmendment(rows[0]) : undefined
  }

  /**
   * Stores a new application. `make` runs the rules inside the lock — which is where the number is claimed and the
   * application pushed into the in-memory copy — so two creates in flight cannot take the same id or number.
   */
  async createLate(make: () => LfWrite): Promise<LateFiling> {
    let made: LateFiling | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        made = w.lf
        const [row] = await tx.insert(lateFilings).values(lateFilingValues(made)).returning()
        return toLateFiling(row)
      })
      mirror.putLateFiling(saved)
      markLateFilings([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeLateFiling(made.id); forgetLateFiling(made.id) }
      if (uniqueViolation(e) !== null) throw new Problem(409, "That application number was just taken — please try again.")
      throw e as Error
    }
  }

  /** The same for a 9.4 application. */
  async createAmendment(make: () => AmWrite): Promise<ReturnAmendment> {
    let made: ReturnAmendment | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        made = w.a
        const [row] = await tx.insert(returnAmendments).values(amendmentValues(made)).returning()
        return toAmendment(row)
      })
      mirror.putReturnAmendment(saved)
      markReturnAmendments([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeReturnAmendment(made.id); forgetReturnAmendment(made.id) }
      if (uniqueViolation(e) !== null) throw new Problem(409, "That application number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces an application — an edit or one of the four action steps. */
  async updateLate(lf: LateFiling, before: LateFiling): Promise<LateFiling> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(lateFilings).set(lateFilingValues(lf)).where(eq(lateFilings.id, lf.id)).returning()
        if (!row) throw new Problem(404, LABEL)
        return toLateFiling(row)
      })
      mirror.putLateFiling(saved)
      markLateFilings([saved])
      return saved
    } catch (e) {
      mirror.putLateFiling(before) // the rules edit in place: a failed transaction leaves the old application behind
      markLateFilings([before])
      throw e as Error
    }
  }

  /**
   * Replaces a 9.4 application, storing the decreasing adjustments an amend step posted in the same transaction —
   * they are rows of the adjustments family (notes 32 / 39), so they move in and out with the step that created them.
   */
  async updateAmendment(a: ReturnAmendment, before: ReturnAmendment, adjustments: VatAdjustment[] = []): Promise<ReturnAmendment> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(returnAmendments).set(amendmentValues(a)).where(eq(returnAmendments.id, a.id)).returning()
        if (!row) throw new Problem(404, LABEL)
        for (const va of adjustments) await tx.insert(vatAdjustments).values(adjustmentValues(va))
        return toAmendment(row)
      })
      mirror.putReturnAmendment(saved)
      markReturnAmendments([saved])
      if (adjustments.length) markAdjustments(adjustments)
      return saved
    } catch (e) {
      mirror.putReturnAmendment(before)
      markReturnAmendments([before])
      for (const va of adjustments) mirror.removeAdjustment(va.id) // the rule pushed them into the in-memory copy
      throw e as Error
    }
  }

  /** Deletes a draft: the row is stamped, which is what keeps its id retired — the mock's counter never rewinds. */
  async removeLate(lf: LateFiling): Promise<void> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(lateFilings).set({ deletedAt: new Date() }).where(eq(lateFilings.id, lf.id))
    })
    mirror.removeLateFiling(lf.id)
    forgetLateFiling(lf.id)
  }

  async removeAmendment(a: ReturnAmendment): Promise<void> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(returnAmendments).set({ deletedAt: new Date() }).where(eq(returnAmendments.id, a.id))
    })
    mirror.removeReturnAmendment(a.id)
    forgetReturnAmendment(a.id)
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The applications are rows now, but the in-memory copy stays: the VAT return view and the amendment-aware return
 * computation read them. A compat handler that writes through the mock's array — a restored backup, the demo
 * runtime — is written back here. See common/writeback.ts.
 */
const lateFilingWb = new WriteBack<LateFiling>("lateFilings", () => mirror.lateFilings(), (x) => x.id)
export const markLateFilings = (list: LateFiling[]) => lateFilingWb.mark(list)
export const forgetLateFiling = (id: string) => lateFilingWb.forget(id)
export const lateFilingDelta = () => lateFilingWb.delta()
type LateFilingDelta = ReturnType<typeof lateFilingDelta>
export const commitLateFilingDelta = (d: LateFilingDelta) => lateFilingWb.commit(d)

const returnAmendmentWb = new WriteBack<ReturnAmendment>("returnAmendments", () => mirror.returnAmendments(), (x) => x.id)
export const markReturnAmendments = (list: ReturnAmendment[]) => returnAmendmentWb.mark(list)
export const forgetReturnAmendment = (id: string) => returnAmendmentWb.forget(id)
export const returnAmendmentDelta = () => returnAmendmentWb.delta()
type ReturnAmendmentDelta = ReturnType<typeof returnAmendmentDelta>
export const commitReturnAmendmentDelta = (d: ReturnAmendmentDelta) => returnAmendmentWb.commit(d)

/**
 * Applies the deltas inside the persist transaction and reads the saved applications back into memory, so a value
 * a column type rounded is not rewritten on every request.
 *
 * An application that left the in-memory list was dropped by a handler that still runs the mock's code (a restored
 * older backup): the row is stamped, which is what keeps its id retired — and the write-back forgets it.
 */
export async function applyReturnAppDeltas(tx: Tx, late: LateFilingDelta, amended: ReturnAmendmentDelta) {
  for (const lf of [...late.insert, ...late.update]) {
    const values = lateFilingValues(lf)
    const [row] = await tx.insert(lateFilings).values(values).onConflictDoUpdate({ target: lateFilings.id, set: values }).returning()
    mirror.putLateFiling(toLateFiling(row))
    markLateFilings([lf])
  }
  for (const id of late.missing) {
    const stored = lateFilingWb.stored(id)
    if (stored) {
      await tx.update(lateFilings).set({ ...lateFilingValues(stored), deletedAt: new Date() }).where(eq(lateFilings.id, id))
      mirror.removeLateFiling(id)
      forgetLateFiling(id)
      continue
    }
    console.warn(`[lateFilings] ${id} vanished from the in-memory state and has no stored row`)
  }
  for (const a of [...amended.insert, ...amended.update]) {
    const values = amendmentValues(a)
    const [row] = await tx.insert(returnAmendments).values(values).onConflictDoUpdate({ target: returnAmendments.id, set: values }).returning()
    mirror.putReturnAmendment(toAmendment(row))
    markReturnAmendments([a])
  }
  for (const id of amended.missing) {
    const stored = returnAmendmentWb.stored(id)
    if (stored) {
      await tx.update(returnAmendments).set({ ...amendmentValues(stored), deletedAt: new Date() }).where(eq(returnAmendments.id, id))
      mirror.removeReturnAmendment(id)
      forgetReturnAmendment(id)
      continue
    }
    console.warn(`[returnAmendments] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/* ── what the rules read ───────────────────────────────────────────────── */

/**
 * What the rules are handed: the returns (their due dates and submissions), the applications, the adjustments a
 * decrease posts and the settings. The in-memory copies are what a write belongs to — the rules push into them, as
 * the mock's handlers did — while a read hands the rules the rows instead (see `lateReadSource` / `amReadSource`).
 */
const writeSource = () => ({
  returns: mirror.returns(), lateFilings: mirror.lateFilings(), returnAmendments: mirror.returnAmendments(),
  adjustments: mirror.adjustments(), vatSettings: mirror.vatSettings(),
})
/** The same, with the family being served read back from its table: what the register and one application answer. */
const lateReadSource = async (all: LateFiling[]) => ({ ...writeSource(), lateFilings: all })
const amReadSource = async (all: ReturnAmendment[]) => ({ ...writeSource(), returnAmendments: all })
/** The register row of a 9.3 / 9.4 application, against whichever copy of the world the caller holds. */
const lfRowOf = (lf: LateFiling, src: ReturnType<typeof writeSource>) => lateFilingRow(lf, src.returns.find((r) => r.period === lf.period), src.vatSettings, TODAY)
const amRowOf = (a: ReturnAmendment, src: ReturnType<typeof writeSource>) => amendmentRow(a, src.returns.find((r) => r.period === a.period)!, src.returnAmendments, src.vatSettings, TODAY)

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * The six Mushak 9.3 endpoints. The behaviour is shared with the mock handlers (see the header); this class only
 * adds storage, the state guard and the audit trail. A filed application is refused before the body is even
 * parsed — the mock's own order, which the contract suite pins down.
 */
@Controller("api/v1/vat/late-filings")
export class LateFilingsController {
  constructor(
    @Inject(ReturnAppsService) private readonly svc: ReturnAppsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: every application with its due date, the date it asked for and the state the Commissioner left
   *  it in. `?status=` keeps one state's own; `?format=csv` prints the lot. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const status = sp.get("status")
    const src = await lateReadSource(await this.svc.allLate())
    const rows = src.lateFilings.map((lf) => lfRowOf(lf, src))
      .filter((r) => !status || r.state === status)
      .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.no < b.no ? 1 : -1))
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.lfCsvRows(rows) as never[], c.lfCsvColumns as never[]), `mushak-9.3-${today()}.csv`)
      return
    }
    res.json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, allowed: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, rejected: rows.filter((r) => r.state === "rejected").length } })
  }

  /** One new draft application. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = lateFilingInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const lf = await this.svc.createLate(() => compat().lfCreate(parsed.data, user, TODAY, writeSource(), Date.now().toString(36)))
    await this.audit.record({ actor: user, entity: LF_ENTITY, entityId: lf.id, ref: compat().lfRef(lf), action: "created" })
    res.status(201).json(lfRowOf(lf, await lateReadSource(await this.svc.allLate())))
  }

  /** One application: the dates, the reason and the state. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const cur = await this.svc.lateByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    res.json(lfRowOf(cur, writeSource()))
  }

  /** Edit a draft. A filed one is refused before the body is parsed, as the contract pins. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.lateByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status !== "draft") throw new Problem(409, `Only a draft application can be changed — ${cur.no} is ${cur.status}.`)
    const parsed = lateFilingInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const before = structuredClone(cur) // the rules edit in place: what a failed write restores
    const w = compat().lfUpdate(cur, parsed.data, user, TODAY, writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.updateLate(w.lf, before)
    await this.audit.record({ at: w.at, actor: user, entity: LF_ENTITY, entityId: saved.id, ref: w.ref, action: "edited", changes: w.changes })
    res.json(lfRowOf(saved, await lateReadSource(await this.svc.allLate())))
  }

  /** Remove a draft. A filed one is refused before the body is parsed, as the contract pins. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.lateByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status !== "draft") throw new Problem(409, `Only a draft application can be deleted — ${cur.no} is ${cur.status}.`)
    await this.svc.removeLate(cur)
    await this.audit.record({ actor: req.dz!.user, entity: LF_ENTITY, entityId: cur.id, ref: compat().lfRef(cur), action: "deleted" })
    res.json({ ok: true, id: cur.id })
  }

  /**
   * File / approve / reject an application. file is the applicant's own step; the Commissioner's two need the
   * approval permission, checked once the body says which step it is. The from-state is refused before the rules
   * run — a deemed approval cannot be rejected, with its own message.
   */
  @Post(":id/action") @Authed("doc.create") @HttpCode(200)
  async action(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.lateByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    const parsed = lateActionInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const d = parsed.data
    const user = req.dz!.user
    if (d.action !== "file") deny(user, "doc.approve")
    const row = lfRowOf(cur, writeSource())
    const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"] }[d.action]
    if (!from.includes(row.state)) {
      throw new Problem(409, row.state === "deemed" && d.action === "reject"
        ? `${cur.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 7 days.`
        : `Cannot ${d.action} a ${row.state} application (${cur.no}).`)
    }
    const before = structuredClone(cur)
    const w = compat().lfAction(cur, d, user, TODAY, writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.updateLate(w.lf, before)
    await this.audit.record({ at: w.at, actor: user, entity: LF_ENTITY, entityId: saved.id, ref: w.ref, action: w.action, ...(w.note ? { note: w.note } : {}) })
    res.json(lfRowOf(saved, await lateReadSource(await this.svc.allLate())))
  }
}

/**
 * The six Mushak 9.4 endpoints, the same shape. The fourth action step files the amended return itself: an increase
 * needs the treasury deposit of the difference + interest; a decrease posts the decreasing adjustments, which the
 * service stores beside the application row.
 */
@Controller("api/v1/vat/return-amendments")
export class ReturnAmendmentsController {
  constructor(
    @Inject(ReturnAppsService) private readonly svc: ReturnAppsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: every application with its corrections, their effect and what was filed. `?format=csv` prints
   *  one row per correction. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const status = sp.get("status")
    const src = await amReadSource(await this.svc.allAmendments())
    const rows = src.returnAmendments.filter((a) => src.returns.some((r) => r.period === a.period))
      .map((a) => amRowOf(a, src))
      .filter((r) => !status || r.state === status)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.amCsvRows(rows) as never[], c.amCsvColumns as never[]), `mushak-9.4-${today()}.csv`)
      return
    }
    res.json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, toFile: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, amended: rows.filter((r) => r.state === "amended").length, paid: round2(rows.reduce((a, r) => a + (r.amended?.payment?.amount ?? 0), 0)) } })
  }

  /** One new draft application with its corrections. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = amendmentInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const a = await this.svc.createAmendment(() => compat().amCreate(parsed.data, user, TODAY, writeSource(), Date.now().toString(36)))
    await this.audit.record({ actor: user, entity: AM_ENTITY, entityId: a.id, ref: compat().amRef(a), action: "created", note: `${a.corrections.length} correction(s)` })
    res.status(201).json(amRowOf(a, await amReadSource(await this.svc.allAmendments())))
  }

  /** One application: its corrections with their "as filed" values, the effect and what was filed. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const cur = await this.svc.amendmentByIdOrNo(id)
    if (!cur || !writeSource().returns.some((r) => r.period === cur.period)) throw new Problem(404, LABEL)
    res.json(amRowOf(cur, writeSource()))
  }

  /** Edit a draft. A filed one is refused before the body is parsed, as the contract pins. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.amendmentByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status !== "draft") throw new Problem(409, `Only a draft application can be changed — ${cur.no} is ${cur.status}.`)
    const parsed = amendmentInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const before = structuredClone(cur)
    const w = compat().amUpdate(cur, parsed.data, user, TODAY, writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.updateAmendment(w.a, before)
    await this.audit.record({ at: w.at, actor: user, entity: AM_ENTITY, entityId: saved.id, ref: w.ref, action: "edited", changes: w.changes })
    res.json(amRowOf(saved, await amReadSource(await this.svc.allAmendments())))
  }

  /** Remove a draft. A filed one is refused before the body is parsed, as the contract pins. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.amendmentByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status !== "draft") throw new Problem(409, `Only a draft application can be deleted — ${cur.no} is ${cur.status}.`)
    await this.svc.removeAmendment(cur)
    await this.audit.record({ actor: req.dz!.user, entity: AM_ENTITY, entityId: cur.id, ref: compat().amRef(cur), action: "deleted" })
    res.json({ ok: true, id: cur.id })
  }

  /**
   * File / approve / reject an application, or file the amended return (Mushak 9.1 type C). The three decisions
   * need the approval permission; the from-state is refused before the rules run. An amend step that decreases
   * the tax posts the decreasing adjustments — audited here, stored with the application.
   */
  @Post(":id/action") @Authed("doc.create") @HttpCode(200)
  async action(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.amendmentByIdOrNo(id)
    const src = writeSource()
    const ret = cur && src.returns.find((r) => r.period === cur.period)
    if (!cur || !ret) throw new Problem(404, LABEL)
    const parsed = amendActionInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const d = parsed.data
    const user = req.dz!.user
    if (d.action !== "file") deny(user, "doc.approve")
    const row = amRowOf(cur, src)
    const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"], amend: ["approved", "deemed"] }[d.action]
    if (!from.includes(row.state)) {
      throw new Problem(409, row.state === "deemed" && d.action === "reject"
        ? `${cur.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 30 days.`
        : `Cannot ${d.action} a ${row.state} application (${cur.no}).`)
    }
    const before = structuredClone(cur)
    const w = compat().amAction(cur, d, user, TODAY, src)
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.updateAmendment(w.a, before, w.adjustments ?? [])
    for (const va of w.adjustments ?? []) {
      await this.audit.record({ at: w.at, actor: user, entity: "adjustment", entityId: va.id, ref: va.no, action: "approved",
        note: `${cur.no} · ${periodLabel(va.taxPeriod)} · ৳ ${va.amount.toFixed(2)}` })
    }
    await this.audit.record({ at: w.at, actor: user, entity: AM_ENTITY, entityId: saved.id, ref: w.ref, action: w.action, ...(w.note ? { note: w.note } : {}) })
    res.json(amRowOf(saved, await amReadSource(await this.svc.allAmendments())))
  }
}
