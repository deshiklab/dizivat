/**
 * R6.5 — our own Utilization Declarations (BGMEA / BKMEA) and Utilization Permissions (the Bond Commissionerate):
 * the bonded inputs an export order of ours may be imported against, and the settlement the Bond Commissionerate
 * records once the order has shipped (or the UD has expired).
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r65.ts, reused through the compat
 * bundle): what a body may contain, the SKUs every input and garment has to be, the number that is unique among our
 * permits, the number that cannot change once a document quotes it, the settlement that has to dispose of every
 * left-over balance in full — cleared on duty and / or carried to another open UD that lists the input — the state
 * and the warnings a register row carries, and the register's CSV columns. What changed is underneath:
 *   - an own UD is a row in `bond_uds` and every input it permits a row in `bond_ud_inputs`, every garment it
 *     exports a row in `bond_ud_garments`, so the permits are rows like the declarations beside them;
 *   - a UD number of ours is unique in the database as well (partial unique index over the live rows), so two
 *     requests cannot take the same number;
 *   - the settlement travels with the head as JSONB — a record of what the Bond Commissionerate disposed of and
 *     how, not a figure anything adds up, the way a declaration's amendment certificates travel;
 *   - the register, one UD and the settlement statement read the rows; every write goes through the state guard,
 *     and the in-memory copy stays in step: the bond register's lot-to-UD links, the drawback view and the R6.4
 *     bond watch-list still read *every* own UD, and most of them are still compat state, so the mirror this module
 *     keeps is what holds the two copies together.
 */
import { Controller, Get, HttpCode, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, sql } from "drizzle-orm"
import type { ZodError } from "zod"
import type { Request, Response } from "express"
import { toCSV } from "@/lib/mock/query"
import { bondUdInput, settleInput } from "@/lib/schemas"
import { bondUdRegister, bondUdRow, normUd } from "@/lib/settlement"
import type { BondUd } from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import type { BondUdWrite } from "@/app/api/v1/_r65"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { bondUdGarments, bondUdInputs, bondUds } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type BondUdDb = typeof bondUds.$inferSelect
/** An input either way round — the row the table holds and what the mapper writes back are the same shape. */
type InputShape = { itemId: string; name: string; hsCode: string; uom: string; qty: number }
type GarmentShape = { itemId: string; name: string; uom: string; qty: number }
/** The audit trail keeps the UD's number as its reference. */
const ENTITY = "bondUd" as const
const LABEL = "UD not found"
const today = () => new Date().toISOString().slice(0, 10)

/* ── mappers ───────────────────────────────────────────────────────────── */

/** A row with its inputs and garments as the rules and the pages know the UD: optional fields absent, not null. */
export function toBondUd(r: BondUdDb, inputs: InputShape[], garments: GarmentShape[]): BondUd {
  const u: BondUd = {
    id: r.id, no: r.no, kind: r.kind as BondUd["kind"], issuer: r.issuer as BondUd["issuer"],
    date: r.date, expiry: r.expiry, masterLcNo: r.masterLcNo,
    inputs: inputs.map((l) => ({ itemId: l.itemId, name: l.name, hsCode: l.hsCode, uom: l.uom, qty: l.qty })),
    garments: garments.map((g) => ({ itemId: g.itemId, name: g.name, uom: g.uom, qty: g.qty })),
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.masterLcNo) u.masterLcNo = r.masterLcNo
  if (r.masterLcValue != null) u.masterLcValue = r.masterLcValue
  if (r.currency != null) u.currency = r.currency
  if (r.buyer != null) u.buyer = r.buyer
  if (r.note != null) u.note = r.note
  if (r.settlement) u.settlement = r.settlement
  if (r.updatedAt) u.updatedAt = r.updatedAt.toISOString()
  if (r.history) u.history = r.history
  return u
}
/** The UD's head as the columns hold it. */
export const bondUdValues = (u: BondUd) => ({
  id: u.id, no: u.no, kind: u.kind, issuer: u.issuer, date: u.date, expiry: u.expiry,
  masterLcNo: u.masterLcNo, masterLcValue: u.masterLcValue ?? null, currency: u.currency ?? null, buyer: u.buyer ?? null,
  note: u.note ?? null, settlement: u.settlement ?? null, createdBy: u.createdBy, createdAt: new Date(u.createdAt),
  updatedAt: u.updatedAt ? new Date(u.updatedAt) : null, history: u.history ?? null,
})
/** Its inputs and garments: one row each, in the order they were entered. */
export const bondUdInputRows = (u: BondUd) => u.inputs.map((l, i) => ({ udId: u.id, ord: i, itemId: l.itemId, name: l.name, hsCode: l.hsCode, uom: l.uom, qty: l.qty }))
export const bondUdGarmentRows = (u: BondUd) => u.garments.map((g, i) => ({ udId: u.id, ord: i, itemId: g.itemId, name: g.name, uom: g.uom, qty: g.qty }))

/** Every own UD in `rows` with its inputs and garments, the two line sets read in one statement each. */
export async function assembleBondUds(rows: BondUdDb[]): Promise<BondUd[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [inputs, garments] = await Promise.all([
    db.select().from(bondUdInputs).where(inArray(bondUdInputs.udId, ids)),
    db.select().from(bondUdGarments).where(inArray(bondUdGarments.udId, ids)),
  ])
  const inputsBy = new Map<string, InputShape[]>()
  for (const l of inputs) {
    const list = inputsBy.get(l.udId)
    if (list) list.push(l)
    else inputsBy.set(l.udId, [l])
  }
  const garmentsBy = new Map<string, GarmentShape[]>()
  for (const g of garments) {
    const list = garmentsBy.get(g.udId)
    if (list) list.push(g)
    else garmentsBy.set(g.udId, [g])
  }
  return rows.map((r) => toBondUd(r, inputsBy.get(r.id) ?? [], garmentsBy.get(r.id) ?? []))
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class BondUdsService {
  /** Every live own UD in insertion order — the order the mock's array had. */
  async all(): Promise<BondUd[]> { return assembleBondUds(await db.select().from(bondUds).where(sql`${bondUds.deletedAt} is null`).orderBy(asc(bondUds.ord))) }

  /**
   * One own UD by id or by number, the way the mock's routes found them — the settlement page and the drill both
   * address a UD either way.
   */
  async byIdOrNo(idOrNo: string): Promise<BondUd | undefined> {
    const key = normUd(decodeURIComponent(idOrNo))
    return (await assembleBondUds(await db.select().from(bondUds)
      .where(sql`${bondUds.deletedAt} is null and (${bondUds.id} = ${idOrNo} or ${bondUds.no} = ${key})`)))[0]
  }

  /**
   * Stores a new own UD with its inputs and garments. `make` runs the rules inside the lock — which is where
   * `newBondUdId` claims the mock's own counter, and where the UD is pushed into the in-memory copy — so two creates
   * in flight cannot take the same id or the same number.
   */
  async create(make: () => BondUdWrite): Promise<BondUd> {
    let made: BondUd | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        made = w.ud
        const [row] = await tx.insert(bondUds).values(bondUdValues(made)).returning()
        await replaceChildren(tx, made)
        return toBondUd(row, bondUdInputRows(made), bondUdGarmentRows(made))
      })
      mirror.putBondUd(saved) // what the columns actually stored (a value they rounded) is the copy the pages read
      markBondUds([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeBondUd(made.id); forgetBondUd(made.id) }
      if (uniqueViolation(e) !== null) throw new Problem(409, "That UD number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces an own UD and its two line sets — an edit, or the settlement that freezes its statement. */
  async update(u: BondUd, before: BondUd): Promise<BondUd> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(bondUds).set(bondUdValues(u)).where(eq(bondUds.id, u.id)).returning()
        if (!row) throw new Problem(404, LABEL)
        await replaceChildren(tx, u)
        return toBondUd(row, bondUdInputRows(u), bondUdGarmentRows(u))
      })
      mirror.putBondUd(saved)
      markBondUds([saved])
      return saved
    } catch (e) {
      mirror.putBondUd(before) // the rules edit in place: a failed transaction leaves the old UD behind
      markBondUds([before])
      throw e as Error
    }
  }
}

/** An edit may drop an input or add one: the rows are replaced, so a UD's lines are always its own. */
async function replaceChildren(tx: Tx, u: BondUd) {
  await tx.delete(bondUdInputs).where(eq(bondUdInputs.udId, u.id))
  await tx.delete(bondUdGarments).where(eq(bondUdGarments.udId, u.id))
  const inputs = bondUdInputRows(u)
  const garments = bondUdGarmentRows(u)
  if (inputs.length) await tx.insert(bondUdInputs).values(inputs)
  if (garments.length) await tx.insert(bondUdGarments).values(garments)
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The own UDs are rows now, but the in-memory copy stays: the bond register's lot-to-UD links, the drawback view
 * and the R6.4 bond watch-list read them. A compat handler that writes through the mock's array — a restored backup,
 * the demo runtime — is written back here. See common/writeback.ts.
 */
const bondUdWb = new WriteBack<BondUd>("bondUds", () => mirror.bondUds(), (u) => u.id)
export const markBondUds = (list: BondUd[]) => bondUdWb.mark(list)
export const forgetBondUd = (id: string) => bondUdWb.forget(id)
export const bondUdDelta = () => bondUdWb.delta()
type BondUdDelta = ReturnType<typeof bondUdDelta>
export const commitBondUdDelta = (d: BondUdDelta) => bondUdWb.commit(d)

/**
 * Applies the delta inside the persist transaction and reads the saved UDs back into memory, so a value a column
 * type rounded is not rewritten on every request.
 *
 * An own UD that left the in-memory list was dropped by a handler that still runs the mock's code (a restored older
 * backup): the row is stamped, which is what keeps its id retired — and the write-back forgets it.
 */
export async function applyBondUdDelta(tx: Tx, d: BondUdDelta) {
  for (const u of [...d.insert, ...d.update]) {
    const values = bondUdValues(u)
    const [row] = await tx.insert(bondUds).values(values).onConflictDoUpdate({ target: bondUds.id, set: values }).returning()
    await replaceChildren(tx, u)
    mirror.putBondUd(toBondUd(row, bondUdInputRows(u), bondUdGarmentRows(u)))
    markBondUds([u])
  }
  for (const id of d.missing) {
    const stored = bondUdWb.stored(id)
    if (stored) {
      await tx.update(bondUds).set({ ...bondUdValues(stored), deletedAt: new Date() }).where(eq(bondUds.id, id))
      mirror.removeBondUd(id)
      forgetBondUd(id)
      continue
    }
    console.warn(`[bondUds] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/* ── what the rules read ───────────────────────────────────────────────── */

/**
 * What the rules are handed: the imports, the exports, the coefficients, the SKUs and the permits. The in-memory
 * copy is what a write belongs to — the rules push into it, as the mock's handlers did — while a read hands the
 * rules the rows instead (see `readSource`).
 */
const writeSource = () => ({
  purchases: mirror.purchases(), sales: mirror.sales(), boms: mirror.boms(), items: mirror.items(), bondUds: mirror.bondUds(),
})
/** The same, with the own UDs read back from the table: what the register, one UD and the settlement answer. */
const readSource = async (all: BondUd[]) => ({ ...writeSource(), bondUds: all })

/* ── controller ────────────────────────────────────────────────────────── */

/**
 * The four own-UD endpoints. The behaviour is shared with the mock handlers (see the header); this class only adds
 * storage, the state guard and the audit trail. A settled UD is refused before the body is even parsed — the mock's
 * own order, which the contract suite pins down.
 */
@Controller("api/v1/vat/bond-uds")
export class BondUdsController {
  constructor(
    @Inject(BondUdsService) private readonly svc: BondUdsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: our UDs with their live settlement statements, shipment progress, state and warnings.
   *  `?state=` keeps one state's own; `?format=csv` prints one row per statement line. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const reg = bondUdRegister(await readSource(await this.svc.all()), today())
    const state = sp.get("state")
    if (state) reg.rows = reg.rows.filter((r) => r.state === state)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.bondUdCsvRows(reg) as never[], c.bondUdCsvColumns as never[]), `ud-settlement-${today()}.csv`)
      return
    }
    res.json(reg)
  }

  /** One new own UD: the bonded inputs it permits and the garments the order exports. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = bondUdInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const at = new Date().toISOString()
    const ud = await this.svc.create(() => compat().bondUdCreate(parsed.data, user, today(), writeSource(), Date.now().toString(36)))
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: ud.id, ref: ud.no, action: "created" })
    res.status(201).json(bondUdRow(ud, await readSource(await this.svc.all()), today()))
  }

  /** One own UD: statement, shipments, settlement. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const cur = await this.svc.byIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    res.json(bondUdRow(cur, await readSource(await this.svc.all()), today()))
  }

  /** Edit an unsettled UD; its number cannot change once documents quote it. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.byIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.settlement) throw new Problem(409, "A settled UD cannot be changed.")
    const parsed = bondUdInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const at = new Date().toISOString()
    const before = structuredClone(cur) // the rules edit the UD in place: what a failed write restores
    const w = compat().bondUdUpdate(cur, parsed.data, user, today(), writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.update(w.ud, before)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: w.ref, action: "edited", changes: w.changes })
    res.json(bondUdRow(saved, await readSource(await this.svc.all()), today()))
  }

  /** Records the Bond Commissionerate's settlement — every balance cleared on duty and / or carried forward.
   *  A read with a body, so it is a POST — but it records nothing new until it validates, so it answers 200 as the
   *  mock did. */
  @Post(":id/settle") @Authed("doc.approve") @HttpCode(200)
  async settle(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.byIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.settlement) throw new Problem(409, `${cur.no} was settled on ${cur.settlement.date}.`)
    const parsed = settleInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const at = new Date().toISOString()
    const before = structuredClone(cur)
    const w = compat().bondUdSettle(cur, parsed.data, user, today(), writeSource())
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.update(w.ud, before)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: w.ref, action: "approved", ...(w.note ? { note: w.note } : {}) })
    res.json(bondUdRow(saved, await readSource(await this.svc.all()), today()))
  }
}
