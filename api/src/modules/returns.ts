/**
 * R5.6 — the Mushak 9.1 return and the NBR settings.
 *
 * The return is the document every other document reads: sales, purchases, notes, the treasury deposits, the VDS
 * certificates and the VAT adjustments all refuse a date whose return has been submitted, so the period lock every
 * family checks was, until now, a read of `compat_state`. It is a row here — one per tax period, the period being
 * its id — which is what makes the lock a column of a table the API owns.
 *
 * The rules are the mock's own (src/app/api/v1/_r4.ts, reused through the compat bundle): what a period may be
 * filed for (in order, and not twice), what a submission needs (the period over, the previous return filed, a date
 * that is neither missing nor in the future, and note 58 covering note 50), the acknowledgement number it is given,
 * the register's spec and CSV columns, the note sub-forms, the compliance centre's answer and the settings row — so
 * the responses, error codes and audit events cannot drift. What changed is underneath:
 *   - a return is a row in `vat_returns`, and a submitted one carries the computation it was filed with: the
 *     documents it added up keep moving, the return does not;
 *   - the NBR settings are one row of `vat_settings`, by constraint, the way the accounting configuration is;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the Mushak books, the
 *     compliance centre, the R6.6 applications and every compat handler still read `db.returns` and
 *     `db.vatSettings`, so the mirror this module writes is what keeps the two copies one.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq } from "drizzle-orm"
import type { Request, Response } from "express"
import type { User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type { CreditNote, DebitNote, LateFiling, ReturnAmendment, VatReturn, VatSettings } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv } from "../common/http"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { vatReturns, vatSettings } from "../db/schema"
import { compat, G, mirror } from "../state"
import { compliancePack } from "@/lib/compliance-pack"
import { vatSource } from "./vat"
import { AuditService } from "./audit"

type ReturnDb = typeof vatReturns.$inferSelect
type SettingsDb = typeof vatSettings.$inferSelect
/** What the rules read: the VAT documents' own source plus the two note families and the R6.6 applications. */
export type ReturnSource = Awaited<ReturnType<typeof vatSource>> & {
  creditNotes: CreditNote[]; debitNotes: DebitNote[]
  lateFilings: LateFiling[]; returnAmendments: ReturnAmendment[]
}
const today = () => new Date().toISOString().slice(0, 10)

/* ── rows ⇄ documents ──────────────────────────────────────────────────── */

export const toReturn = (r: ReturnDb): VatReturn => ({
  id: r.id, period: r.period, type: r.type, activities: r.activities, status: r.status, manual: r.manual,
  createdAt: r.createdAt.toISOString(),
  ...(r.amendReason != null ? { amendReason: r.amendReason } : {}),
  ...(r.submissionDate != null ? { submissionDate: r.submissionDate } : {}),
  ...(r.snapshot != null ? { snapshot: r.snapshot } : {}),
  ...(r.ackNo != null ? { ackNo: r.ackNo } : {}),
  ...(r.submittedBy != null ? { submittedBy: r.submittedBy } : {}),
  ...(r.submittedAt != null ? { submittedAt: r.submittedAt.toISOString() } : {}),
  ...(r.updatedAt != null ? { updatedAt: r.updatedAt.toISOString() } : {}),
  ...(r.history != null ? { history: r.history } : {}),
})
export const returnValues = (r: VatReturn) => ({
  id: r.id, period: r.period, type: r.type, amendReason: r.amendReason ?? null, activities: r.activities,
  status: r.status, submissionDate: r.submissionDate ?? null, manual: r.manual,
  snapshot: r.snapshot ?? null, ackNo: r.ackNo ?? null, submittedBy: r.submittedBy ?? null,
  submittedAt: r.submittedAt ? new Date(r.submittedAt) : null,
  createdAt: new Date(r.createdAt), updatedAt: r.updatedAt ? new Date(r.updatedAt) : null,
  history: r.history ?? null,
})
export const toVatSettings = (r: SettingsDb): VatSettings => ({
  zoneCode: r.zoneCode,
  ...(r.profile != null ? { profile: r.profile } : {}),
  ...(r.updatedAt != null ? { updatedAt: r.updatedAt.toISOString() } : {}),
  ...(r.updatedBy != null ? { updatedBy: r.updatedBy } : {}),
})
export const vatSettingsValues = (s: VatSettings) => ({
  id: 1, zoneCode: s.zoneCode, profile: s.profile ?? null,
  updatedAt: s.updatedAt ? new Date(s.updatedAt) : null, updatedBy: s.updatedBy ?? null,
})

/**
 * What the rules read, built from the tables: the parties, the invoices and both note families through the mirror
 * (which the modules that own those tables keep in step), the VAT documents from theirs, and the two R6.6
 * applications from the compat state they are still part of.
 */
export async function returnSource(): Promise<ReturnSource> {
  const world = G.__dzDb as unknown as { lateFilings?: LateFiling[]; returnAmendments?: ReturnAmendment[] }
  const vat = await vatSource()
  return { ...vat, creditNotes: mirror.creditNotes(), debitNotes: mirror.debitNotes(), lateFilings: world.lateFilings ?? [], returnAmendments: world.returnAmendments ?? [] }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * A compat handler that writes through the mock's arrays — the R6.6 applications amending a return, a restored
 * backup, the demo runtime — is written back here. See common/writeback.ts.
 */
const returnWb = new WriteBack<VatReturn>("vat_returns", () => mirror.returns(), (r) => r.id)
/** The settings are one row, so their write-back is a collection of one. */
const settingsWb = new WriteBack<VatSettings>("vat_settings", () => [mirror.vatSettings()], () => "main")
export type ReturnDelta = Delta<VatReturn>
export type SettingsDelta = Delta<VatSettings>
export const markReturns = (list: VatReturn[]) => returnWb.mark(list)
export const markVatSettings = () => settingsWb.mark([mirror.vatSettings()])
export const returnDelta = (): ReturnDelta => returnWb.delta()
export const vatSettingsDelta = (): SettingsDelta => settingsWb.delta()
export const commitReturnDelta = (d: ReturnDelta) => returnWb.commit(d)
export const commitVatSettingsDelta = (d: SettingsDelta) => settingsWb.commit(d)

/**
 * Applies both deltas inside the persist transaction and reads the saved rows back into memory, so a value a
 * column type rounded is not rewritten on every request.
 */
export async function applyReturnDeltas(tx: Tx, d: { returns: ReturnDelta; settings: SettingsDelta }) {
  for (const r of [...d.returns.insert, ...d.returns.update]) {
    const values = returnValues(r)
    const [row] = await tx.insert(vatReturns).values(values)
      .onConflictDoUpdate({ target: vatReturns.id, set: values }).returning()
    mirror.putReturn(toReturn(row))
  }
  for (const id of d.returns.missing) {
    await tx.delete(vatReturns).where(eq(vatReturns.id, id))
    returnWb.forget(id)
  }
  for (const s of [...d.settings.insert, ...d.settings.update]) {
    const values = vatSettingsValues(s)
    const [row] = await tx.insert(vatSettings).values(values)
      .onConflictDoUpdate({ target: vatSettings.id, set: values }).returning()
    mirror.putVatSettings(toVatSettings(row))
  }
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class ReturnsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Every return, in the order they were started (`ord` keeps the mock's insertion order). */
  async all(): Promise<VatReturn[]> {
    return (await db.select().from(vatReturns).orderBy(asc(vatReturns.ord))).map(toReturn)
  }
  async find(period: string): Promise<VatReturn | undefined> {
    const [row] = await db.select().from(vatReturns).where(eq(vatReturns.id, period))
    return row ? toReturn(row) : undefined
  }
  /** The register's rows: the totals, the due date and whether the return was filed late. */
  async rows(src: ReturnSource) {
    return (await this.all()).map((r) => compat().returnRow(r, src))
  }

  /** Start a return for a period: the rule decides whether it may be started, and the period is its id. */
  async create(period: string, user: User, src: ReturnSource, at = new Date().toISOString()) {
    const rule = compat().returnCreateRule(period, src)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const r: VatReturn = { id: rule.period, period: rule.period, type: "original", activities: true, status: "draft", manual: { ...compat().EMPTY_MANUAL }, createdAt: at, history: [] }
    compat().stampLifeHistory(r, user.name, "created", undefined, at)
    const [row] = await db.insert(vatReturns).values(returnValues(r)).returning()
    const saved = toReturn(row)
    mirror.putReturn(saved)
    markReturns([saved])
    await this.audit.record({ at, actor: user, entity: "vatReturn", entityId: saved.period, ref: compat().returnRef(saved.period), action: "created" })
    return saved
  }

  /** Edit a draft: the rule holds what may be given and the changes the audit trail records. */
  async update(id: string, body: unknown, user: User, src: ReturnSource) {
    const cur = await this.find(id)
    if (!cur) throw new Problem(404, "Tax period not found")
    const rule = compat().returnEditRule(id, body, src)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const next: VatReturn = { ...cur, ...rule.fields }
    const at = new Date().toISOString()
    compat().stampLifeHistory(next, user.name, "edited", undefined, at)
    const [row] = await db.update(vatReturns).set(returnValues(next)).where(eq(vatReturns.id, id)).returning()
    const saved = toReturn(row)
    mirror.putReturn(saved)
    markReturns([saved])
    await this.audit.record({ at, actor: user, entity: "vatReturn", entityId: saved.period, ref: compat().returnRef(saved.period), action: "edited", changes: rule.changes })
    return saved
  }

  /** Submit: freeze the computation, record the acknowledgement, and say so in the audit trail. */
  async submit(id: string, body: { action?: string }, user: User, src: ReturnSource) {
    const cur = await this.find(id)
    if (!cur) throw new Problem(404, "Tax period not found")
    const rule = compat().returnSubmitRule(body, id, src)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    const next: VatReturn = { ...cur, type: rule.type, status: "submitted", snapshot: rule.computation, ackNo: rule.ackNo, submittedBy: user.name, submittedAt: at }
    compat().stampLifeHistory(next, user.name, "submitted", `Acknowledgement ${rule.ackNo}`, at)
    const [row] = await db.update(vatReturns).set(returnValues(next)).where(eq(vatReturns.id, id)).returning()
    const saved = toReturn(row)
    mirror.putReturn(saved)
    markReturns([saved])
    await this.audit.record({ at, actor: user, entity: "vatReturn", entityId: saved.period, ref: compat().returnRef(saved.period), action: "submitted", note: `Acknowledgement ${rule.ackNo}` })
    return saved
  }

  /** Delete a draft. A submitted return cannot be — an amended one has to be filed in the NBR portal instead. */
  async remove(id: string, user: User, src: ReturnSource) {
    const cur = await this.find(id)
    if (!cur) throw new Problem(404, "Tax period not found")
    const rule = compat().returnDeleteRule(id, src)
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    await db.delete(vatReturns).where(eq(vatReturns.id, id))
    mirror.removeReturn(id)
    await this.audit.record({ at, actor: user, entity: "vatReturn", entityId: cur.period, ref: compat().returnRef(cur.period), action: "deleted" })
  }

  /** The NBR settings: the one row, read through the mirror the compat handlers share. */
  settings(): VatSettings { return mirror.vatSettings() }

  async saveSettings(body: unknown, user: User, src: ReturnSource) {
    const rule = compat().vatSettingsRule(body, user.name, src)
    if ("status" in rule) throw new Problem(rule.status, rule.title, rule.errors)
    const before = structuredClone(this.settings())
    const [row] = await db.insert(vatSettings).values(vatSettingsValues(rule.fields))
      .onConflictDoUpdate({ target: vatSettings.id, set: vatSettingsValues(rule.fields) }).returning()
    const saved = toVatSettings(row)
    mirror.putVatSettings(saved)
    markVatSettings()
    const at = saved.updatedAt ?? new Date().toISOString()
    await this.audit.record({ at, actor: user, entity: "vatSettings", ref: "VAT settings", action: "updated",
      changes: compat().diff(before, saved, compat().VAT_SETTINGS_DIFF_FIELDS) })
    return saved
  }
}

/* ── controllers ───────────────────────────────────────────────────────── */

@Controller("api/v1/vat/returns")
export class ReturnsController {
  constructor(
    @Inject(ReturnsService) private readonly svc: ReturnsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<VatReturnRow> with the two facets, the totals and every tax period, or the CSV. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "period.desc")
    const src = await returnSource()
    const r = runQuery(await this.svc.rows(src), sp, compat().returnSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, compat().RETURN_CSV_COLUMNS as never[]), `${compat().returnCsvName()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, periods: compat().taxPeriods(src) })
  }

  /** Start a return for a tax period (201, with the return it started). */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const body = jsonBody(req) as { period?: string }
    const saved = await this.svc.create(String(body?.period ?? ""), req.dz!.user, await returnSource())
    res.status(201).json(compat().returnView(saved.period, await returnSource()))
  }

  /** One return with its computation — a period nothing has been filed for answers a live draft of one. */
  @Get(":period") @Authed()
  async one(@Param("period") period: string, @Res() res: Response) {
    const v = compat().returnView(period, await returnSource())
    if (!v) throw new Problem(404, "Tax period not found")
    res.json(v)
  }

  @Put(":period") @Authed("doc.edit")
  async update(@Param("period") period: string, @Req() req: AuthedRequest, @Res() res: Response) {
    await this.svc.update(period, jsonBody(req), req.dz!.user, await returnSource())
    res.json(compat().returnView(period, await returnSource()))
  }

  @Patch(":period") @Authed("doc.approve")
  async submit(@Param("period") period: string, @Req() req: AuthedRequest, @Res() res: Response) {
    await this.svc.submit(period, jsonBody(req) as { action?: string }, req.dz!.user, await returnSource())
    res.json(compat().returnView(period, await returnSource()))
  }

  @Delete(":period") @Authed("doc.delete")
  async remove(@Param("period") period: string, @Req() req: AuthedRequest, @Res() res: Response) {
    await this.svc.remove(period, req.dz!.user, await returnSource())
    res.json({ ok: true })
  }
}

/** The documents behind one note of the return's computation (the sub-forms). */
@Controller("api/v1/vat/returns/:period/notes")
export class ReturnSubFormController {
  @Get(":note") @Authed()
  async one(@Param("period") period: string, @Param("note") note: string, @Req() req: Request, @Res() res: Response) {
    const answer = compat().subFormAnswer(period, Number(note), await returnSource())
    if ("title" in answer) throw new Problem(answer.status, answer.title)
    if (searchParams(req).get("format") === "csv") {
      sendCsv(res, toCSV(answer.rows, compat().SUBFORM_CSV_COLUMNS(answer.note) as never[]), `mushak-9.1-${period}-note-${note}.csv`)
      return
    }
    res.json(answer)
  }
}

/** Every tax period the company files for, with the state its return is in. */
@Controller("api/v1/vat/periods")
export class PeriodsController {
  @Get() @Authed()
  async list(@Res() res: Response) {
    res.json(compat().taxPeriods(await returnSource()))
  }
}

/** The compliance centre: one period's return, deposits and VDS — and R7.2's one-click submission set. */
@Controller("api/v1/vat/compliance")
export class ComplianceController {
  @Get() @Authed()
  async one(@Req() req: Request, @Res() res: Response) {
    const answer = compat().complianceAnswer(searchParams(req).get("period") || compat().currentPeriod(), await returnSource())
    if ("title" in answer) throw new Problem(answer.status, answer.title, answer.errors)
    res.json(answer)
  }

  /**
   * R7.2 — the period's compliance pack: a zip with the sales and purchase registers, Mushak 6.10, the TR-6
   * challans and VDS certificates of the period, the 9.1 return as it stands, and a manifest + checklist.
   * The file set and the zip itself are the shared `src/lib/compliance-pack.ts` the mock's route also runs.
   */
  @Get("pack") @Authed()
  async pack(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const period = searchParams(req).get("period") || c.currentPeriod()
    const src = await returnSource()
    const answer = c.complianceAnswer(period, src)
    if ("title" in answer) throw new Problem(answer.status, answer.title, answer.errors)
    const [y, m] = period.split("-").map(Number)
    const m610 = c.mushak610Book({ from: `${period}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }, src, mirror.company())
    if ("status" in m610) throw new Problem(m610.status, m610.title, m610.errors)
    const zip = compliancePack(period, { sales: src.sales, purchases: src.purchases, treasury: src.treasury, vds: src.vds, returns: src.returns },
      mirror.company(), { summary: answer, m610 })
    res.setHeader("content-type", "application/zip")
    res.setHeader("content-disposition", `attachment; filename="compliance-pack-${period}.zip"`)
    res.end(zip)
  }
}

/** The NBR settings: the zone the economic codes come from and the company's own profile. */
@Controller("api/v1/vat/settings")
export class VatSettingsController {
  constructor(@Inject(ReturnsService) private readonly svc: ReturnsService) {}

  @Get() @Authed()
  async one(@Res() res: Response) {
    res.json(this.svc.settings())
  }

  @Put() @Authed("settings.manage")
  async update(@Req() req: AuthedRequest, @Res() res: Response) {
    res.json(await this.svc.saveSettings(jsonBody(req), req.dz!.user, await returnSource()))
  }
}
