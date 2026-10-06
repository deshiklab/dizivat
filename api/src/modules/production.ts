/**
 * R5.5 — the Mushak 4.3 price declarations and the production configuration on their own tables. A declaration is
 * the input–output coefficient of ONE unit of a finished good: the inputs and the wastage each allows, the cost
 * heads that turn them into the declared price, and the version of the item it is filed under. What a production
 * batch consumes and what a receipt is valued at both come from the version in force, and the configuration decides
 * whether a batch follows a work order and whether it records the standard or the actual consumption — so these are
 * the rows the rest of production is priced from.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r3.ts and _docs.ts, reused through
 * the compat bundle): what a body may contain, how `calcBom` prices it, which version it becomes, what superseding
 * the version in force means, the register's spec, CSV columns and facet labels, and the configuration's own schema
 * all come from the same code the Next.js mock and the static demo run, so the responses, error codes and audit
 * events cannot drift. What changed is underneath:
 *   - a declaration is a row in `boms`, its inputs rows of `bom_inputs` and its cost heads rows of `bom_costs`, so
 *     the material value, the wastage and the value added of the version in force can be read in SQL;
 *   - the configuration is the one row of `production_config` — settings survive a restart without the JSONB
 *     document, and `buildBatch` still reads the same two fields through the mirror;
 *   - a declaration's number carries its version (`BOM-{sku}-v{n}`), so it is unique among the *live* rows only: a
 *     deleted draft's version may be filed again, while its id stays retired — which is why the row is stamped with
 *     `deleted_at` instead of being removed, exactly as a deleted batch's is;
 *   - approving a version supersedes the one in force, and those rows are written in the same transaction;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the batches that consume a
 *     declaration, the bond and the settlement registers and the VAT returns still read them from memory, so the
 *     mirror is written through on every change and a compat handler that writes through the mock's array is
 *     written back here.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type { Bom, BomCost, BomInput, ProductionConfig } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { bomCosts, bomInputs, boms, productionConfig } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type BomDb = typeof boms.$inferSelect
type InputDb = typeof bomInputs.$inferSelect
type CostDb = typeof bomCosts.$inferSelect
type ConfigDb = typeof productionConfig.$inferSelect
/** What a new declaration is given inside the state lock: the next id of the `bom` series. */
export type BomIdentity = { id: string }
const today = () => new Date().toISOString().slice(0, 10)
const LABEL = "Price declaration"
const ENTITY = "bom" as const
/** The configuration the demo data set starts with — and the shape a row has before it was ever updated. */
export const DEFAULT_CONFIG: ProductionConfig = { procedure: "directStock", consumption: "standard" }
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** Child row → one input of the coefficient, with the wastage `calcBom` worked out. */
const toBomInput = (r: InputDb): BomInput => ({
  itemId: r.itemId, name: r.name, sku: r.sku, uom: r.uom, qty: r.qty, wastagePct: r.wastagePct,
  wastageQty: r.wastageQty, grossQty: r.grossQty, price: r.price, value: r.value, wastageValue: r.wastageValue,
})

const toBomCost = (r: CostDb): BomCost => ({ head: r.head, amount: r.amount })

/** Header row + its inputs + its cost heads → contract shape. A NULL column is an absent optional field. */
export function toBom(r: BomDb, inputs: BomInput[], costs: BomCost[]): Bom {
  const b: Bom = {
    id: r.id, no: r.no, itemId: r.itemId, itemName: r.itemName, sku: r.sku, hsCode: r.hsCode, uom: r.uom,
    version: r.version, effectiveDate: r.effectiveDate, inputs, costs,
    materialValue: r.materialValue, wastageValue: r.wastageValue, valueAdded: r.valueAdded,
    price: r.price, unitCost: r.unitCost, process: r.process,
    createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.licenseDate != null) b.licenseDate = r.licenseDate
  if (r.amendmentReason != null) b.amendmentReason = r.amendmentReason
  if (r.note != null) b.note = r.note
  if (r.supersededAt) b.supersededAt = r.supersededAt.toISOString()
  if (r.updatedAt) b.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) b.cancelReason = r.cancelReason
  return b
}

/** Contract shape → header row values (`ord` and `deletedAt` are the table's own). */
export const bomValues = (b: Bom) => ({
  id: b.id, no: b.no, itemId: b.itemId, itemName: b.itemName, sku: b.sku, hsCode: b.hsCode, uom: b.uom,
  version: b.version, licenseDate: b.licenseDate ?? null, effectiveDate: b.effectiveDate,
  amendmentReason: b.amendmentReason ?? null, note: b.note ?? null,
  materialValue: b.materialValue, wastageValue: b.wastageValue, valueAdded: b.valueAdded,
  price: b.price, unitCost: b.unitCost, process: b.process,
  supersededAt: b.supersededAt ? new Date(b.supersededAt) : null,
  createdAt: new Date(b.createdAt), updatedAt: b.updatedAt ? new Date(b.updatedAt) : null,
  cancelReason: b.cancelReason ?? null, history: b.history ?? null,
})

/** The declaration's inputs as child rows, in the order they are printed. */
export const bomInputValues = (b: Bom) => b.inputs.map((x, i) => ({
  bomId: b.id, ord: i + 1, itemId: x.itemId, name: x.name, sku: x.sku, uom: x.uom,
  qty: x.qty, wastagePct: x.wastagePct, wastageQty: x.wastageQty, grossQty: x.grossQty,
  price: x.price, value: x.value, wastageValue: x.wastageValue,
}))

/** Its cost heads as child rows — only the heads the rules kept (a zero amount is dropped before pricing). */
export const bomCostValues = (b: Bom) => b.costs.map((c, i) => ({ bomId: b.id, ord: i + 1, head: c.head, amount: c.amount }))

/** The configuration row → contract shape: `updatedAt` and `updatedBy` only once it has been updated. */
export function toConfig(r: ConfigDb): ProductionConfig {
  const c: ProductionConfig = { procedure: r.procedure, consumption: r.consumption }
  if (r.updatedAt) c.updatedAt = r.updatedAt.toISOString()
  if (r.updatedBy != null) c.updatedBy = r.updatedBy
  return c
}

export const configValues = (c: ProductionConfig) => ({
  id: 1, procedure: c.procedure, consumption: c.consumption,
  updatedAt: c.updatedAt ? new Date(c.updatedAt) : null, updatedBy: c.updatedBy ?? null,
})

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The declarations are rows now, but the in-memory copies stay: a production batch prices its lines and works out
 * its consumption from the version in force, and the bond, the settlement and the VAT registers read the same
 * declarations. A compat handler that writes through the mock's array — a restored backup, the demo runtime — is
 * written back here. See common/writeback.ts.
 */
const bomWb = new WriteBack<Bom>("boms", () => mirror.boms(), (b) => b.id)
export type BomDelta = Delta<Bom>
export const markBoms = (list: Bom[]) => bomWb.mark(list)
export const forgetBom = (id: string) => bomWb.forget(id)
export const bomDelta = () => bomWb.delta()
export const commitBomDelta = (d: BomDelta) => bomWb.commit(d)

/**
 * Applies a delta inside the persist transaction and reads the saved declaration back into memory, so a value a
 * column type rounded (money is numeric(18,2), quantities numeric(18,4)) is not rewritten on every request.
 *
 * A declaration that left the in-memory list was deleted by a handler that still runs the mock's code: the row is
 * stamped exactly as the native delete stamps it — which is what keeps its id retired — and the write-back forgets
 * it, so filing that version again counts as an insert.
 */
export async function applyBomDelta(tx: Tx, d: BomDelta) {
  const inserted = new Set(d.insert)
  for (const b of [...d.insert, ...d.update]) {
    // a declaration back in the live list is not deleted: an insert clears the stamp a compat delete may have set
    const values = inserted.has(b) ? { ...bomValues(b), deletedAt: null } : bomValues(b)
    const [row] = await tx.insert(boms).values(values)
      .onConflictDoUpdate({ target: boms.id, set: values }).returning()
    mirror.putBom(await replaceChildren(tx, b, row))
  }
  for (const id of d.missing) {
    const stored = bomWb.stored(id)
    if (stored) {
      await tx.update(boms).set({ ...bomValues(stored), deletedAt: new Date() }).where(eq(boms.id, id))
      bomWb.forget(id)
      continue
    }
    console.warn(`[boms] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/** Replaces a declaration's inputs and cost heads with the ones it carries now, and reads all three back. */
async function replaceChildren(tx: Tx, b: Bom, row: BomDb): Promise<Bom> {
  await tx.delete(bomInputs).where(eq(bomInputs.bomId, b.id))
  await tx.delete(bomCosts).where(eq(bomCosts.bomId, b.id))
  const inputRows = bomInputValues(b)
  const costRows = bomCostValues(b)
  const inputs = inputRows.length ? (await tx.insert(bomInputs).values(inputRows).returning()).map(toBomInput) : []
  const costs = costRows.length ? (await tx.insert(bomCosts).values(costRows).returning()).map(toBomCost) : []
  return toBom(row, inputs, costs)
}

/** Header rows + their children → declarations, in the rows' order (the service and boot share it). */
export async function assembleBoms(rows: BomDb[]): Promise<Bom[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const inputDbRows = await db.select().from(bomInputs).where(inArray(bomInputs.bomId, ids))
    .orderBy(asc(bomInputs.bomId), asc(bomInputs.ord))
  const costDbRows = await db.select().from(bomCosts).where(inArray(bomCosts.bomId, ids))
    .orderBy(asc(bomCosts.bomId), asc(bomCosts.ord))
  const group = <T>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of list) { const a = m.get(key(x)) ?? []; a.push(x); m.set(key(x), a) }
    return m
  }
  const inputs = group(inputDbRows, (r) => r.bomId), costs = group(costDbRows, (r) => r.bomId)
  return rows.map((r) => toBom(r, (inputs.get(r.id) ?? []).map(toBomInput), (costs.get(r.id) ?? []).map(toBomCost)))
}

/**
 * The configuration is one row, so its write-back is a collection of one: a compat handler that sets it through the
 * mock's object (a restored backup, the demo runtime) is written back here.
 */
const configWb = new WriteBack<ProductionConfig>("production_config", () => [mirror.productionConfig()], () => "main")
export type ConfigDelta = Delta<ProductionConfig>
export const markConfig = (c: ProductionConfig) => configWb.mark([c])
export const configDelta = () => configWb.delta()
export const commitConfigDelta = (d: ConfigDelta) => configWb.commit(d)

/** Applies the configuration's delta: the row is replaced, never missing (there is always exactly one). */
export async function applyConfigDelta(tx: Tx, d: ConfigDelta) {
  for (const c of [...d.insert, ...d.update]) {
    const values = configValues(c)
    const [row] = await tx.insert(productionConfig).values(values)
      .onConflictDoUpdate({ target: productionConfig.id, set: values }).returning()
    mirror.putProductionConfig(toConfig(row))
  }
}

/* ── services ──────────────────────────────────────────────────────────── */

@Injectable()
export class BomsService {
  /** Every live declaration in insertion order — the order the mock's array had. */
  async all(): Promise<Bom[]> {
    return assembleBoms(await db.select().from(boms).where(isNull(boms.deletedAt)).orderBy(asc(boms.ord)))
  }

  /** One declaration by id or by number: the register, the audit trail and a batch's line link both. */
  find(idOrNo: string) {
    return this.first(sql`(${boms.id} = ${idOrNo} or ${boms.no} = ${idOrNo}) and ${boms.deletedAt} is null`)
  }

  /** One live declaration by id only — what a delete matches on (the mock's delete looked the id up, not the number). */
  byId(id: string) {
    return this.first(sql`${boms.id} = ${id} and ${boms.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(boms).where(match)
    return rows.length ? (await assembleBoms(rows))[0] : undefined
  }

  /**
   * Stores a new declaration with its inputs and its cost heads, and the versions it superseded in the same
   * transaction. `make` builds it once the id is known — inside the lock, so two creates in flight cannot share one
   * — and claims the id counter the mock's `db.seq` keeps.
   */
  async create(make: (ident: BomIdentity) => { bom: Bom; superseded: Bom[] }): Promise<Bom> {
    let made: Bom | undefined
    let superseded: Bom[] = []
    // what approving superseded, so a rolled-back transaction leaves the mirror as it was
    const prior = new Map(mirror.boms().map((b) => [b.id, b.supersededAt]))
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const built = make(compat().bomIdentity())
        made = built.bom
        superseded = built.superseded
        // claimed in memory first: a compat persist running mid-insert must not adopt the declaration twice
        mirror.putBom(made)
        const [row] = await tx.insert(boms).values(bomValues(made)).returning()
        await saveSuperseded(tx, superseded)
        return replaceChildren(tx, made, row)
      })
      mirror.putBom(saved)
      markBoms([saved, ...superseded])
      return saved
    } catch (e) {
      if (made) { mirror.removeBom(made.id); forgetBom(made.id) }
      revertSuperseded(superseded, prior)
      BomsService.noConflict(e)
    }
  }

  /** Replaces a declaration and its children, and the versions an approval superseded, in one transaction. */
  async update(b: Bom, superseded: Bom[] = []): Promise<Bom> {
    const prior = new Map(mirror.boms().map((x) => [x.id, x.supersededAt]))
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(boms).set(bomValues(b)).where(eq(boms.id, b.id)).returning()
        if (!row) throw new Problem(404, `${LABEL} not found`)
        await saveSuperseded(tx, superseded)
        return replaceChildren(tx, b, row)
      })
      mirror.putBom(saved)
      markBoms([saved, ...superseded])
      return saved
    } catch (e) {
      revertSuperseded(superseded, prior)
      throw e as Error
    }
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. There is no undo for a declaration, and its version
   * may be filed again — but the mock's id counter moved on when it was removed, so the row stays to keep a later
   * declaration from taking the same id.
   */
  async remove(b: Bom, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(boms).set({ ...bomValues(b), deletedAt: new Date(at) }).where(eq(boms.id, b.id))
    })
    mirror.removeBom(b.id)
    forgetBom(b.id)
  }

  /** A duplicate number the application check missed (two requests at once) is a 409, not a 500. */
  private static noConflict(e: unknown): never {
    if (uniqueViolation(e) !== null) throw new Problem(409, "That declaration was just filed — please try again.")
    throw e as Error
  }
}

/** The versions an approval superseded, written with it. */
async function saveSuperseded(tx: Tx, superseded: Bom[]) {
  for (const o of superseded) await tx.update(boms).set(bomValues(o)).where(eq(boms.id, o.id))
}

/** A rolled-back transaction: put the superseded stamps back the way the mirror had them. */
function revertSuperseded(superseded: Bom[], prior: Map<string, string | undefined>) {
  for (const o of superseded) {
    const live = mirror.findBom(o.id)
    if (live) live.supersededAt = prior.get(o.id)
  }
}

@Injectable()
export class ProductionConfigService {
  /** The one row. Boot writes it (a fresh database seeds it, an upgrade adopts it), so a missing row is the default. */
  async get(): Promise<ProductionConfig> {
    const [row] = await db.select().from(productionConfig).where(eq(productionConfig.id, 1))
    return row ? toConfig(row) : DEFAULT_CONFIG
  }

  /** Replaces the one row and keeps the mirror in step — `buildBatch` reads the procedure and the consumption there. */
  async put(c: ProductionConfig): Promise<ProductionConfig> {
    const values = configValues(c)
    const saved = await db.transaction(async (tx) => {
      await lockState(tx)
      const [row] = await tx.insert(productionConfig).values(values)
        .onConflictDoUpdate({ target: productionConfig.id, set: values }).returning()
      return toConfig(row)
    })
    mirror.putProductionConfig(saved)
    markConfig(saved)
    return saved
  }
}

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * The five price-declaration endpoints. The behaviour is shared with the mock handlers (see the header); this class
 * only adds storage, the state guard and the audit trail. Every answer is a `BomRow` — the declaration with its
 * lifecycle status and the item's current sale price, exactly as the register prints it.
 */
@Controller("api/v1/production/boms")
export class BomsController {
  constructor(
    @Inject(BomsService) private readonly svc: BomsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<BomRow> with facets (status / item) and the finished goods' names, or the Mushak 4.3 CSV. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "sku.asc")
    const r = runQuery((await this.svc.all()).map((b) => c.bomRow(b)), sp, c.bomSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.bomCsvColumns), c.bomCsvName(today()))
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: c.bomFacetLabels() })
  }

  /** File a draft declaration, or file and approve it in one step (which needs the approve permission). */
  @Post() @Authed("master.edit")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.buildBom(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const taken = c.bomDraftTakenRule(built.fields.itemId)
    if (taken) throw new Problem(taken.status, taken.title, taken.errors)
    const at = new Date().toISOString()
    const bom = await this.svc.create((ident) => {
      const b: Bom = { ...built.fields, ...ident, process: "Created", createdAt: at, history: [] }
      // before the declaration exists: one that cannot be filed must not consume an id
      c.claimBomId()
      c.stampBomHistory(b, user.name, "created", undefined, at)
      return { bom: b, superseded: approving ? c.approveBom(b, user.name, mirror.boms()) : [] }
    })
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: bom.id, ref: bom.no, action: "created" })
    const approved = bom.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY, entityId: bom.id, ref: bom.no, action: "approved" })
    res.status(201).json(c.bomRow(bom))
  }

  /** One declaration with every version of its item beside it, newest first. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const list = await this.svc.all()
    const b = list.find((x) => x.id === id || x.no === id)
    if (!b) throw new Problem(404, `${LABEL} not found`)
    res.json({ ...c.bomRow(b), versions: c.bomVersions(b, { items: mirror.items(), boms: list }) })
  }

  /** Edit a draft (full replacement): the version stays, the coefficients and the price are worked out again. */
  @Put(":id") @Authed("master.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const draft = c.bomDraftRule(cur)
    if (draft) throw new Problem(draft.status, draft.title, draft.errors)
    const built = c.buildBom(jsonBody(req), cur)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next: Bom = { ...cur, ...built.fields }
    const at = new Date().toISOString()
    c.stampBomHistory(next, user.name, "edited", undefined, at)
    const changes = c.bomDiff(before, next)
    const superseded = approving ? c.approveBom(next, user.name, mirror.boms()) : []
    const saved = await this.svc.update(next, superseded)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "edited", changes })
    const approved = saved.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(c.bomRow(saved))
  }

  /** State transitions: approve (which supersedes the version in force), or cancel a draft with a reason. */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      const rule = c.bomApproveRule(cur)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const next = structuredClone(cur)
      const superseded = c.approveBom(next, user.name, mirror.boms())
      const saved = await this.svc.update(next, superseded)
      const approved = saved.history?.find((h) => h.action === "approved")
      if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(c.bomRow(saved))
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      const r = c.bomCancelRule(cur, body.reason ?? "")
      if ("status" in r) throw new Problem(r.status, r.title, r.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Cancelled"
      next.cancelReason = r.reason
      c.stampBomHistory(next, user.name, "cancelled", r.reason, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "cancelled", note: r.reason })
      res.json(c.bomRow(saved))
      return
    }
    throw new Problem(400, "process must be Approved or Cancelled")
  }

  /** Delete a draft: the row is stamped, so its id stays retired while its version may be filed again. */
  @Delete(":id") @Authed("master.edit")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const rule = c.bomDeleteRule(cur)
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampBomHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: ENTITY, entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}

/**
 * The production configuration: what a batch follows and what it records. Two endpoints, one row — `buildBatch`
 * reads both fields, so this is where the settings screen decides how every later batch is priced.
 */
@Controller("api/v1/production/config")
export class ProductionConfigController {
  constructor(
    @Inject(ProductionConfigService) private readonly svc: ProductionConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get() @Authed()
  async get(@Res() res: Response) { res.json(await this.svc.get()) }

  @Put() @Authed("settings.manage")
  async put(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.buildConfig(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const before = { ...mirror.productionConfig() }
    const at = new Date().toISOString()
    const saved = await this.svc.put({ ...built.fields, updatedAt: at, updatedBy: user.name })
    await this.audit.record({
      at, actor: user, entity: "productionConfig", ref: "Production configuration", action: "updated",
      changes: c.configDiff(before, saved),
    })
    res.json(saved)
  }
}
