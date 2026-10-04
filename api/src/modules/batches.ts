/**
 * R5.4 — production batches on their own tables: the finished goods a factory puts into production, in-house, at a
 * contract manufacturer (the Mushak 6.4 challan) or brought forward as work in progress at go-live. A batch's lines
 * are the goods, its consumption the inputs the BOM says they take, and approving one moves both — the inputs leave
 * the store (`items.prod_issue`), the goods received come into the factory (`items.prod_receive`).
 *
 * These were the last collection the derived stock read from memory: `branchSplit()` and an item's ledger walk the
 * sales, the purchases, the transfers, the damage entries, both note families, the opening entries and the batches,
 * and every one of those is a table now — so both endpoints are served from the rows (see derived.ts).
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r3.ts and _docs.ts, reused through
 * the compat bundle): what a body may contain, how the BOM prices a line and what it consumes, the batch's number,
 * the input stock an approval needs, what a cancellation must still hold, the contractor's receipt, the register's
 * spec, filter and CSV columns all come from the same code the Next.js mock and the static demo run, so the
 * responses, error codes and audit events cannot drift. What changed is underneath:
 *   - a batch is a row in `batches`, its finished goods rows in `batch_lines` and its inputs in `batch_consumption`,
 *     so what a factory issued, received and rejected, and what it is worth, can be summed in SQL;
 *   - the contractor block (the vendor, the delivery address, the job process and the receipt) is columns of the
 *     row, which is what the subcontracting register reads;
 *   - the batch number is unique in the database as well, so two requests cannot share one;
 *   - a deleted draft keeps its row with `deleted_at`: batches have no undo, and the mock removed one from its array
 *     for good — but its id counter had moved on and its number lives on in the audit trail, so the stamped row is
 *     what stops a later batch taking the same id;
 *   - the counters an approval moves (`items.prodIssue`, `items.prodReceive`) are written with the batch, in the
 *     same transaction;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the finished-goods lots, the
 *     work orders' progress and the VAT returns still read *every* document, and the families without tables (BOMs,
 *     work orders, the production configuration) are compat state — while the branch split and an item's ledger read
 *     the rows themselves (derived.ts).
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type { Batch, BatchLine, Consumption, Item } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { batchConsumption, batchLines, batches, items } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"
import { markItems, revertItemCounters } from "./items"

type BatchDb = typeof batches.$inferSelect
type LineDb = typeof batchLines.$inferSelect
type UseDb = typeof batchConsumption.$inferSelect
/** What a new batch is given inside the state lock: its id and the number it occupies. */
export type BatchIdentity = { id: string; no: string }
const today = () => new Date().toISOString().slice(0, 10)
const LABEL = "Production batch"
const ENTITY = "batch" as const
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** Child row → finished-goods line. A NULL column is an absent optional field. */
const toBatchLine = (r: LineDb): BatchLine => {
  const l: BatchLine = {
    itemId: r.itemId, name: r.name, sku: r.sku, uom: r.uom,
    issueQty: r.issueQty, receiveQty: r.receiveQty, damageQty: r.damageQty, unitCost: r.unitCost, value: r.value,
  }
  if (r.workOrderId != null) l.workOrderId = r.workOrderId
  if (r.workOrderNo != null) l.workOrderNo = r.workOrderNo
  if (r.bomId != null) l.bomId = r.bomId
  if (r.bomVersion != null) l.bomVersion = r.bomVersion
  return l
}

const toConsumption = (r: UseDb): Consumption =>
  ({ itemId: r.itemId, name: r.name, sku: r.sku, uom: r.uom, qty: r.qty, price: r.price, value: r.value })

/** Header row + its lines + its consumption → contract shape. The contractor block is all there or not at all. */
export function toBatch(r: BatchDb, lines: BatchLine[], consumption: Consumption[]): Batch {
  const b: Batch = {
    id: r.id, no: r.no, mode: r.mode, issueDate: r.issueDate,
    issuedBy: r.issuedBy, designation: r.designation, lines, consumption,
    totalIssue: r.totalIssue, totalReceive: r.totalReceive, totalDamage: r.totalDamage,
    materialValue: r.materialValue, value: r.value, process: r.process,
    branchId: r.branchId, branchName: r.branchName, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.receiveDate != null) b.receiveDate = r.receiveDate
  if (r.vendorId != null) b.vendorId = r.vendorId
  if (r.vendorName != null) b.vendorName = r.vendorName
  if (r.vendorBin != null) b.vendorBin = r.vendorBin
  if (r.vendorAddress != null) b.vendorAddress = r.vendorAddress
  if (r.address != null) b.address = r.address
  if (r.jobProcess != null) b.jobProcess = r.jobProcess
  if (r.remark != null) b.remark = r.remark
  if (r.issueTime != null) b.issueTime = r.issueTime
  if (r.receivedAt) b.receivedAt = r.receivedAt.toISOString()
  if (r.updatedAt) b.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) b.cancelReason = r.cancelReason
  return b
}

/** Contract shape → header row values (`ord` and `deletedAt` are the table's own). */
export const batchValues = (b: Batch) => ({
  id: b.id, no: b.no, mode: b.mode, issueDate: b.issueDate, receiveDate: b.receiveDate ?? null,
  vendorId: b.vendorId ?? null, vendorName: b.vendorName ?? null, vendorBin: b.vendorBin ?? null,
  vendorAddress: b.vendorAddress ?? null, address: b.address ?? null, jobProcess: b.jobProcess ?? null,
  remark: b.remark ?? null, issuedBy: b.issuedBy, designation: b.designation, issueTime: b.issueTime ?? null,
  totalIssue: b.totalIssue, totalReceive: b.totalReceive, totalDamage: b.totalDamage,
  materialValue: b.materialValue, value: b.value, process: b.process,
  receivedAt: b.receivedAt ? new Date(b.receivedAt) : null,
  branchId: b.branchId, branchName: b.branchName,
  createdAt: new Date(b.createdAt), updatedAt: b.updatedAt ? new Date(b.updatedAt) : null,
  cancelReason: b.cancelReason ?? null, history: b.history ?? null,
})

/** The batch's finished goods as child rows, in the order they are printed. */
export const batchLineValues = (b: Batch) => b.lines.map((l, i) => ({
  batchId: b.id, ord: i + 1, itemId: l.itemId, name: l.name, sku: l.sku, uom: l.uom,
  workOrderId: l.workOrderId ?? null, workOrderNo: l.workOrderNo ?? null,
  issueQty: l.issueQty, receiveQty: l.receiveQty, damageQty: l.damageQty,
  bomId: l.bomId ?? null, bomVersion: l.bomVersion ?? null, unitCost: l.unitCost, value: l.value,
}))

/** The inputs it consumes as child rows, merged per item as the rules merged them. */
export const consumptionValues = (b: Batch) => b.consumption.map((c, i) => ({
  batchId: b.id, ord: i + 1, itemId: c.itemId, name: c.name, sku: c.sku, uom: c.uom,
  qty: c.qty, price: c.price, value: c.value,
}))

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The batches are rows now, but the in-memory copies stay: the finished-goods lots, the work orders' progress and
 * the VAT returns derive from all of them, together with the documents that are still compat state — while the branch
 * split and an item's ledger read the rows themselves (derived.ts, R5.4). A compat handler that writes through the mock's array — a restored backup, the demo runtime —
 * is written back here. See common/writeback.ts.
 */
const batchWb = new WriteBack<Batch>("batches", () => mirror.batches(), (b) => b.id)
export type BatchDelta = Delta<Batch>
export const markBatches = (list: Batch[]) => batchWb.mark(list)
export const forgetBatch = (id: string) => batchWb.forget(id)
export const batchDelta = () => batchWb.delta()
export const commitBatchDelta = (d: BatchDelta) => batchWb.commit(d)

/**
 * Applies a delta inside the persist transaction and reads the saved batch back into memory, so a value a column
 * type rounded (money is numeric(18,2), quantities numeric(18,3)) is not rewritten on every request.
 *
 * A batch that left the in-memory list was deleted by a handler that still runs the mock's code: batches have no
 * undo buffer, so the row is stamped exactly as the native delete stamps it — which is what keeps its id and its
 * number retired — and the write-back forgets it.
 */
export async function applyBatchDelta(tx: Tx, d: BatchDelta) {
  const inserted = new Set(d.insert)
  for (const b of [...d.insert, ...d.update]) {
    // a batch back in the live list is not deleted: an insert clears the stamp a compat delete may have set
    const values = inserted.has(b) ? { ...batchValues(b), deletedAt: null } : batchValues(b)
    const [row] = await tx.insert(batches).values(values)
      .onConflictDoUpdate({ target: batches.id, set: values }).returning()
    mirror.putBatch(await replaceChildren(tx, b, row))
  }
  for (const id of d.missing) {
    const stored = batchWb.stored(id)
    if (stored) {
      await tx.update(batches).set({ ...batchValues(stored), deletedAt: new Date() }).where(eq(batches.id, id))
      batchWb.forget(id)
      continue
    }
    console.warn(`[batches] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/** Replaces a batch's lines and consumption with the ones it carries now, and reads all three back. */
async function replaceChildren(tx: Tx, b: Batch, row: BatchDb): Promise<Batch> {
  await tx.delete(batchLines).where(eq(batchLines.batchId, b.id))
  await tx.delete(batchConsumption).where(eq(batchConsumption.batchId, b.id))
  const lineRows = batchLineValues(b)
  const useRows = consumptionValues(b)
  const lines = lineRows.length ? (await tx.insert(batchLines).values(lineRows).returning()).map(toBatchLine) : []
  const consumption = useRows.length ? (await tx.insert(batchConsumption).values(useRows).returning()).map(toConsumption) : []
  return toBatch(row, lines, consumption)
}

/** Header rows + their children → batches, in the rows' order (the service and boot share it). */
export async function assembleBatches(rows: BatchDb[]): Promise<Batch[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const lineRows = await db.select().from(batchLines).where(inArray(batchLines.batchId, ids))
    .orderBy(asc(batchLines.batchId), asc(batchLines.ord))
  const useRows = await db.select().from(batchConsumption).where(inArray(batchConsumption.batchId, ids))
    .orderBy(asc(batchConsumption.batchId), asc(batchConsumption.ord))
  const group = <T>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of list) { const a = m.get(key(x)) ?? []; a.push(x); m.set(key(x), a) }
    return m
  }
  const lines = group(lineRows, (r) => r.batchId), uses = group(useRows, (r) => r.batchId)
  return rows.map((r) => toBatch(r, (lines.get(r.id) ?? []).map(toBatchLine), (uses.get(r.id) ?? []).map(toConsumption)))
}

/** The SKUs an approval moves: the consumed inputs and the finished goods received. */
const captureCounters = (b: Batch) => {
  const ids = new Set([...b.consumption.map((c) => c.itemId), ...b.lines.map((l) => l.itemId)])
  return [...ids].map((id) => mirror.findItem(id)).filter((it): it is Item => !!it)
}
async function writeCounters(tx: Tx, list: Item[]) {
  for (const it of list) await tx.update(items).set({ prodIssue: it.prodIssue, prodReceive: it.prodReceive }).where(eq(items.id, it.id))
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class BatchesService {
  /** Every live batch in insertion order — the order the mock's array had. */
  async all(): Promise<Batch[]> {
    return assembleBatches(await db.select().from(batches).where(isNull(batches.deletedAt)).orderBy(asc(batches.ord)))
  }

  /** One batch by id or by number: the register, the lots and the audit trail link both. */
  find(idOrNo: string) {
    return this.first(sql`(${batches.id} = ${idOrNo} or ${batches.no} = ${idOrNo}) and ${batches.deletedAt} is null`)
  }

  /** One live batch by id only — what a delete matches on. */
  byId(id: string) {
    return this.first(sql`${batches.id} = ${id} and ${batches.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(batches).where(match)
    return rows.length ? (await assembleBatches(rows))[0] : undefined
  }

  /**
   * Stores a new batch with its lines and its consumption. `make` builds it once the id and the number are known —
   * inside the lock, so two creates in flight cannot share a number — and claims the id counter the mock's `db.seq`
   * keeps. The counters an approval moves are written with it.
   */
  async create(issueDate: string, make: (ident: BatchIdentity) => Batch): Promise<Batch> {
    let made: Batch | undefined
    let counters: Item[] = []
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().batchIdentity(issueDate))
        // claimed in memory first: a compat persist running mid-insert must not adopt the batch twice
        mirror.putBatch(made)
        counters = captureCounters(made)
        const [row] = await tx.insert(batches).values(batchValues(made)).returning()
        await writeCounters(tx, counters)
        return replaceChildren(tx, made, row)
      })
      mirror.putBatch(saved)
      markBatches([saved])
      markItems(counters)
      return saved
    } catch (e) {
      if (made) { mirror.removeBatch(made.id); forgetBatch(made.id) }
      await revertItemCounters(counters.map((it) => it.id))
      BatchesService.noConflict(e)
    }
  }

  /** Replaces a batch and its children, and writes the counters in the same transaction. */
  async update(b: Batch): Promise<Batch> {
    const counters = captureCounters(b)
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(batches).set(batchValues(b)).where(eq(batches.id, b.id)).returning()
        if (!row) throw new Problem(404, `${LABEL} not found`)
        await writeCounters(tx, counters)
        return replaceChildren(tx, b, row)
      })
      mirror.putBatch(saved)
      markBatches([saved])
      markItems(counters)
      return saved
    } catch (e) {
      await revertItemCounters(counters.map((it) => it.id))
      throw e as Error
    }
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. Batches have no undo, but the row stays — the mock's
   * id counter moved on when the batch was removed, and the row is what keeps a later batch from taking its id.
   */
  async remove(b: Batch, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(batches).set({ ...batchValues(b), deletedAt: new Date(at) }).where(eq(batches.id, b.id))
    })
    mirror.removeBatch(b.id)
    forgetBatch(b.id)
  }

  /** A duplicate number the application check missed (two requests at once) is a 409, not a 500. */
  private static noConflict(e: unknown): never {
    if (uniqueViolation(e) !== null) throw new Problem(409, "That batch number was just taken — please try again.")
    throw e as Error
  }
}

/* ── controller ────────────────────────────────────────────────────────── */

/**
 * The seven production-batch endpoints. The behaviour is shared with the mock handlers (see the header); this class
 * only adds storage, the state guard and the audit trail.
 */
@Controller("api/v1/production/batches")
export class BatchesController {
  constructor(
    @Inject(BatchesService) private readonly svc: BatchesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<Batch> with facets (process / mode / receipt), or one CSV row per line. `?workOrder=` keeps one work order's batches. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(c.batchWorkOrderFilter(sp, await this.svc.all()), sp, c.batchSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.batchCsvRows(r.all), c.batchCsvColumns), `production-batches-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json(page)
  }

  /** Create a draft, or create and approve it in one step (which needs the approve permission and the inputs on hand). */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.buildBatch(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const at = new Date().toISOString()
    const batch = await this.svc.create(built.fields.issueDate, (ident) => {
      const b: Batch = {
        ...built.fields, ...ident, process: "Created", issueTime: new Date().toTimeString().slice(0, 5),
        createdAt: at, history: [],
      }
      // before the batch exists: one that cannot be approved must not consume an id
      if (approving) {
        const short = c.batchStockRule(b)
        if (short) throw new Problem(short.status, short.title, short.errors)
      }
      c.claimBatchId()
      c.stampBatchHistory(b, user.name, "created", undefined, at)
      if (approving) {
        const rule = c.batchApproveRule(b)
        if (rule) throw new Problem(rule.status, rule.title, rule.errors)
        b.process = "Approved"
        c.postBatchIssue(b, 1)
        c.postBatchReceive(b, 1)
        c.stampBatchHistory(b, user.name, "approved")
      }
      return b
    })
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: batch.id, ref: batch.no, action: "created" })
    const approved = batch.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY, entityId: batch.id, ref: batch.no, action: "approved" })
    res.status(201).json(batch)
  }

  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const b = await this.svc.find(id)
    if (!b) throw new Problem(404, `${LABEL} not found`)
    res.json(b)
  }

  /** Edit a draft (full replacement). Optional approve-on-save. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const draft = c.batchDraftRule(cur)
    if (draft) throw new Problem(draft.status, draft.title, draft.errors)
    const built = c.buildBatch(jsonBody(req), cur)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const next: Batch = { ...cur, ...built.fields }
    if (approving) {
      const short = c.batchStockRule(next)
      if (short) throw new Problem(short.status, short.title, short.errors)
    }
    const before = structuredClone(cur)
    const at = new Date().toISOString()
    c.stampBatchHistory(next, user.name, "edited", undefined, at)
    const changes = c.batchDiff(before, next)
    let approvedAt: string | undefined
    if (approving) {
      const rule = c.batchApproveRule(next)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      approvedAt = new Date().toISOString()
      next.process = "Approved"
      c.postBatchIssue(next, 1)
      c.postBatchReceive(next, 1)
      c.stampBatchHistory(next, user.name, "approved", undefined, approvedAt)
    }
    const saved = await this.svc.update(next)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve (consumes the inputs, receives the goods), or cancel (puts both back). */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      const rule = c.batchApproveRule(cur)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      c.postBatchIssue(next, 1)
      c.postBatchReceive(next, 1)
      c.stampBatchHistory(next, user.name, "approved", undefined, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      const r = c.batchCancelRule(cur, body.reason ?? "")
      if ("status" in r) throw new Problem(r.status, r.title, r.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      if (next.process === "Approved") {
        c.postBatchReceive(next, -1)
        c.postBatchIssue(next, -1) // inputs go back to the store
      }
      next.process = "Cancelled"
      next.cancelReason = r.reason
      c.stampBatchHistory(next, user.name, "cancelled", r.reason, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "cancelled", note: r.reason })
      res.json(saved)
      return
    }
    throw new Problem(400, "process must be Approved or Cancelled")
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. Batches have no undo. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const rule = c.batchDeleteRule(cur)
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampBatchHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: ENTITY, entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }

  /** Contractual batch: the finished goods come back from the contractor, which completes the Mushak 6.4 challan. */
  @Post(":id/receive") @Authed("doc.edit")
  async receive(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const state = c.batchReceiveStateRule(cur)
    if (state) throw new Problem(state.status, state.title, state.errors)
    const built = c.buildBatchReceive(cur, jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const next = structuredClone(cur)
    c.applyBatchReceive(next, built)
    next.receivedAt = new Date().toISOString()
    c.postBatchReceive(next, 1)
    const at = new Date().toISOString()
    const changes = c.batchReceiveChanges(built)
    c.stampBatchHistory(next, req.dz!.user.name, "edited", "Finished goods received from the contractor", at)
    const saved = await this.svc.update(next)
    await this.audit.record({
      at, actor: req.dz!.user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "edited",
      note: "Finished goods received from the contractor", changes,
    })
    res.status(200).json(saved) // the mock answered 200: a receipt edits the batch, it does not create one
  }
}
