/**
 * R6.2 — the exporters' Utilization Declarations (BGMEA / BKMEA) and Utilization Permissions (customs): what a
 * garment maker may procure duty- and VAT-free for one export order, and what of it a deemed-export supplier has
 * already supplied.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r62.ts, reused through the compat
 * bundle): what a body may contain, the exporter that must be one, the SKU every input has to be, the number that is
 * unique per exporter, the quantity that cannot drop below what was already supplied, the amendment a change of
 * quantities or of the LC value becomes and the reason and date it needs, the state and the remaining days of a
 * declaration, the bond licence watch-list beside the register and the register's CSV columns — all come from the
 * same code the Next.js mock and the static demo run, so the responses, error codes and audit events cannot drift.
 * What changed is underneath:
 *   - a declaration is a row in `uds` and every input it permits a row in `ud_lines`, so what a garment order may
 *     still procure, and how much of it is left, can be summed in SQL;
 *   - an exporter's declaration number is unique in the database as well (a deleted declaration frees its number, as
 *     the mock's array did), so two requests cannot give one exporter the same number;
 *   - a deleted declaration keeps its row with `deleted_at`: the mock removed it from its array and its id counter
 *     moved on, so the row is what stops a later declaration from taking the same id;
 *   - the register, one declaration and the fit question read the rows; every write goes through the state guard,
 *     and the in-memory copy stays in step: the bond register, the export statements, the drawback claims and the
 *     sales form's live fit check still read *every* declaration, and most of them are still compat state, so the
 *     mirror this module keeps is what holds the two copies together.
 */
import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, sql } from "drizzle-orm"
import type { ZodError } from "zod"
import type { Request, Response } from "express"
import { toCSV } from "@/lib/mock/query"
import { udInput } from "@/lib/schemas"
import type { UdRecord, VatSettings } from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import type { UdWrite } from "@/app/api/v1/_r62"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { udLines, uds } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type UdDb = typeof uds.$inferSelect
/** An input either way round — the row the table holds and what the mapper writes back are the same shape. */
type UdLineShape = { itemId: string; name: string; hsCode: string; uom: string; qty: number; value: number | null }
/** The audit trail keeps the declaration's number and the exporter it belongs to as its reference. */
const ENTITY = "ud" as const
const LABEL = "UD not found"
const today = () => new Date().toISOString().slice(0, 10)

/* ── mappers ───────────────────────────────────────────────────────────── */

/** A row and its inputs as the rules and the pages know the declaration: optional fields absent, not null. */
export function toUd(r: UdDb, lines: UdLineShape[]): UdRecord {
  const u: UdRecord = {
    id: r.id, no: r.no, date: r.date, kind: r.kind as UdRecord["kind"],
    customerId: r.customerId, customerName: r.customerName, customerBin: r.customerBin,
    masterLcNo: r.masterLcNo, expiry: r.expiry, status: r.status as UdRecord["status"],
    lines: lines.map((l) => ({
      itemId: l.itemId, name: l.name, hsCode: l.hsCode, uom: l.uom, qty: l.qty,
      ...(l.value != null ? { value: l.value } : {}),
    })),
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.buyer != null) u.buyer = r.buyer
  if (r.note != null) u.note = r.note
  if (r.masterLcValue != null) u.masterLcValue = r.masterLcValue
  if (r.currency != null) u.currency = r.currency
  if (r.amendments) u.amendments = r.amendments
  if (r.updatedAt) u.updatedAt = r.updatedAt.toISOString()
  if (r.history) u.history = r.history
  return u
}
/** The declaration's head as the columns hold it. */
export const udValues = (u: UdRecord) => ({
  id: u.id, no: u.no, date: u.date, kind: u.kind,
  customerId: u.customerId, customerName: u.customerName, customerBin: u.customerBin,
  masterLcNo: u.masterLcNo, buyer: u.buyer ?? null, expiry: u.expiry, status: u.status,
  note: u.note ?? null, masterLcValue: u.masterLcValue ?? null, currency: u.currency ?? null,
  amendments: u.amendments ?? null, createdBy: u.createdBy, createdAt: new Date(u.createdAt),
  updatedAt: u.updatedAt ? new Date(u.updatedAt) : null, history: u.history ?? null,
})
/** Its inputs: one row each, in the order they were entered. */
export const udLineRows = (u: UdRecord) => u.lines.map((l, i) => ({
  udId: u.id, ord: i, itemId: l.itemId, name: l.name, hsCode: l.hsCode, uom: l.uom, qty: l.qty, value: l.value ?? null,
}))

/** Every declaration in `rows` with its inputs, the lines read in one statement. */
export async function assembleUds(rows: UdDb[]): Promise<UdRecord[]> {
  if (!rows.length) return []
  const lines = await db.select().from(udLines).where(inArray(udLines.udId, rows.map((r) => r.id)))
  const byUd = new Map<string, UdLineShape[]>()
  for (const l of lines) {
    const list = byUd.get(l.udId)
    if (list) list.push(l)
    else byUd.set(l.udId, [l])
  }
  return rows.map((r) => toUd(r, byUd.get(r.id) ?? []))
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class UdsService {
  /** Every live declaration in insertion order — the order the mock's array had. */
  async all(): Promise<UdRecord[]> { return this.some(await db.select().from(uds).where(sql`${uds.deletedAt} is null`).orderBy(asc(uds.ord))) }

  /** The declarations among `rows`, with their inputs. */
  some(rows: UdDb[]) { return assembleUds(rows) }

  /** One declaration by id: the register, the fit check and the audit trail link the id, not the number. */
  async byId(id: string): Promise<UdRecord | undefined> {
    return (await assembleUds(await db.select().from(uds).where(sql`${uds.id} = ${id} and ${uds.deletedAt} is null`)))[0]
  }

  /**
   * Stores a new declaration with its inputs. `make` runs the rules inside the lock — which is where `newUdId`
   * claims the mock's own counter, and where the declaration is pushed into the in-memory copy — so two creates in
   * flight cannot take the same id or give one exporter the same number.
   */
  async create(make: () => UdWrite): Promise<UdRecord> {
    let made: UdRecord | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        made = w.ud
        const [row] = await tx.insert(uds).values(udValues(made)).returning()
        await replaceChildren(tx, made)
        return toUd(row, udLineRows(made))
      })
      mirror.putUd(saved) // what the columns actually stored (a value they rounded) is the copy the pages read
      markUds([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeUd(made.id); forgetUd(made.id) }
      if (uniqueViolation(e) !== null) throw new Problem(409, "That UD number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces a declaration and its inputs — an edit, or the amendment an edit of the quantities becomes. */
  async update(u: UdRecord, before: UdRecord): Promise<UdRecord> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(uds).set(udValues(u)).where(eq(uds.id, u.id)).returning()
        if (!row) throw new Problem(404, LABEL)
        await replaceChildren(tx, u)
        return toUd(row, udLineRows(u))
      })
      mirror.putUd(saved)
      markUds([saved])
      return saved
    } catch (e) {
      mirror.putUd(before) // the rules edit in place: a failed transaction leaves the old declaration behind
      markUds([before])
      throw e as Error
    }
  }

  /**
   * Delete a declaration no invoice has drawn on: the row is stamped and leaves the register. There is no undo, but
   * the row stays — the mock's id counter moved on when it was removed, so the row is what keeps the id retired.
   */
  async remove(u: UdRecord, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(uds).set({ ...udValues(u), deletedAt: new Date(at) }).where(eq(uds.id, u.id))
    })
    forgetUd(u.id) // the rules have already taken it out of the in-memory copy
  }
}

/** An edit may drop an input or add one: the rows are replaced, so a declaration's lines are always its own. */
async function replaceChildren(tx: Tx, u: UdRecord) {
  await tx.delete(udLines).where(eq(udLines.udId, u.id))
  const rows = udLineRows(u)
  if (rows.length) await tx.insert(udLines).values(rows)
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The declarations are rows now, but the in-memory copy stays: the bond register, the export statements, the
 * drawback claims and the sales form's fit check all read them. A compat handler that writes through the mock's array
 * — a restored backup, the demo runtime — is written back here. See common/writeback.ts.
 */
const udWb = new WriteBack<UdRecord>("uds", () => mirror.uds(), (u) => u.id)
export const markUds = (list: UdRecord[]) => udWb.mark(list)
export const forgetUd = (id: string) => udWb.forget(id)
export const udDelta = () => udWb.delta()
type UdDelta = ReturnType<typeof udDelta>
export const commitUdDelta = (d: UdDelta) => udWb.commit(d)

/**
 * Applies the delta inside the persist transaction and reads the saved declarations back into memory, so a value a
 * column type rounded is not rewritten on every request.
 *
 * A declaration that left the in-memory list was deleted by a handler that still runs the mock's code: the row is
 * stamped — which is what keeps its id retired — and the write-back forgets it.
 */
export async function applyUdDelta(tx: Tx, d: UdDelta) {
  for (const u of [...d.insert, ...d.update]) {
    const values = udValues(u)
    const [row] = await tx.insert(uds).values(values).onConflictDoUpdate({ target: uds.id, set: values }).returning()
    await replaceChildren(tx, u)
    mirror.putUd(toUd(row, udLineRows(u)))
    markUds([u])
  }
  for (const id of d.missing) {
    const stored = udWb.stored(id)
    if (stored) {
      await tx.update(uds).set({ ...udValues(stored), deletedAt: new Date() }).where(eq(uds.id, id))
      mirror.removeUd(id)
      forgetUd(id)
      continue
    }
    console.warn(`[uds] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/* ── what the rules read ───────────────────────────────────────────────── */

/**
 * What the rules are handed: the declarations, the invoices that draw on them, the exporters and the SKUs. The
 * in-memory copy is what a write belongs to — the rules push into it, as the mock's handlers did — while a read
 * hands the rules the rows instead (see `readSource`).
 */
const writeSource = () => ({
  uds: mirror.uds(), sales: mirror.sales(), customers: mirror.parties("customer"), items: mirror.items(),
})
/** The same, with the declarations read back from the table: what the register, one declaration and the fit answer. */
const readSource = async (all: UdRecord[]) => ({ ...writeSource(), uds: all })

/** The company block the bond watch-list is built from: the licence the NBR profile carries. */
const udHead = () => ({
  name: mirror.company().name, profile: mirror.vatSettings().profile as VatSettings["profile"],
})

/* ── controller ────────────────────────────────────────────────────────── */

/** R6.2: does this deemed-export invoice fit inside the exporter's declaration? Read-only, asked live by the sales
 *  form and the invoice view. Registered before `vat/uds/:id`, or "fit" would be read as a declaration id. */
@Controller("api/v1/vat/uds/fit")
export class UdFitController {
  constructor(@Inject(UdsService) private readonly svc: UdsService) {}

  /** A read with a body, so it is a POST — but it creates nothing, so it answers 200 as the mock did. */
  @Post() @Authed() @HttpCode(200)
  async check(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const parsed = c.udFitInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    res.json(c.udFitAnswer(parsed.data, await readSource(await this.svc.all())))
  }
}

/**
 * The five declaration endpoints. The behaviour is shared with the mock handlers (see the header); this class only
 * adds storage, the state guard and the audit trail.
 */
@Controller("api/v1/vat/uds")
export class UdsController {
  constructor(
    @Inject(UdsService) private readonly svc: UdsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: every exporter's declarations with the quantities already supplied, newest first, beside the bond
   *  licence watch-list. `?customer=` keeps one exporter's own; `?format=csv` prints one row per input. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const reg = c.udRegister(today(), sp.get("customer") || undefined, await readSource(await this.svc.all()), udHead())
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.udCsvRows(reg) as never[], c.udCsvColumns as never[]), `ud-register-${today()}.csv`)
      return
    }
    res.json(reg)
  }

  /** One new declaration: the exporter, the inputs it may procure and the export order behind them. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = udInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const at = new Date().toISOString()
    const ud = await this.svc.create(() => compat().udCreate(parsed.data, user, today(), writeSource(), Date.now().toString(36)))
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: ud.id, ref: ud.no, action: "created" })
    res.status(201).json(ud)
  }

  /** One declaration with its usage per line (every deemed-export invoice that drew on it). */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, LABEL)
    res.json(compat().udAnswer(cur, today(), await readSource(await this.svc.all())))
  }

  /**
   * Edit (amendment) — the exporter and the number cannot change once the declaration is in use, nor a quantity drop
   * below what was already supplied. The rules are `_r62.ts`'s, shared with the mock.
   */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, LABEL)
    const parsed = udInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const at = new Date().toISOString()
    const before = structuredClone(cur) // the rules edit the declaration in place: what a failed write restores
    const w = compat().udUpdate(cur, parsed.data, user, today(), writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.update(w.ud, before)
    await this.audit.record({
      at, actor: user, entity: ENTITY, entityId: saved.id, ref: w.ref, action: "edited",
      changes: w.changes, ...(w.note ? { note: w.note } : {}),
    })
    res.json(compat().udAnswer(saved, today(), await readSource(await this.svc.all())))
  }

  /** Only a declaration no invoice refers to can be deleted (otherwise close it). */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, LABEL)
    const w = compat().udRemove(cur, writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const at = new Date().toISOString()
    const user: User = req.dz!.user
    await this.svc.remove(cur, at)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: cur.id, ref: w.ref, action: "deleted" })
    res.json({ ok: true })
  }
}
