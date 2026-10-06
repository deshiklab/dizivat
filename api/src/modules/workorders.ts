/**
 * R5.5 — the production work orders on their own tables: what the floor has to produce, and what the batches that
 * draw on it have made of it. A work order's lines are the finished goods it asks for, and every line carries the
 * progress the *approved* batches have made — what was put into production, what came back, what was rejected and
 * what is still owed — which is never entered by hand: `refreshWorkOrder` (the mock's own rule) recomputes it.
 *
 * So the rows are kept honest at both ends. Whenever a batch is written — created, edited, approved, cancelled,
 * received, deleted, or written by a compat handler and reaching the table through the write-back — the work orders
 * are recomputed inside the same transaction (`refreshWorkOrderRows`), so what the floor still owes is a `SUM` over
 * `work_order_lines` and not a walk over every batch in memory; and every answer recomputes the progress from the
 * approved batches' rows before it is sent, exactly as the mock's register does, so the two runtimes cannot drift
 * even if a row were ever left behind.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r3.ts and _docs.ts, reused through
 * the compat bundle): what a body may contain — every line an active finished good with a declaration in force on
 * the issue date — the number a new work order takes (which the audit trail takes part in, so a deleted draft's
 * number is not reused), the batches that block a cancellation or a deletion, the diff an edit records, the
 * register's spec, its `?item=` filter and its CSV columns all come from the same code the Next.js mock and the
 * static demo run. What changed is underneath:
 *   - a work order is a row in `work_orders` and its goods rows of `work_order_lines`, with the progress as columns;
 *   - its number is unique in the database as well, so two requests cannot share one;
 *   - a deleted draft keeps its row with `deleted_at`: the mock removed it from its array for good, but its id
 *     counter had moved on and its number lives on in the audit trail, so the stamped row is what stops a later work
 *     order taking the same id;
 *   - every write goes through the state guard, and the in-memory copies stay in step: a batch's `buildBatch` reads
 *     the quantity a work order has left, and the register's facets and the VAT returns read the same objects.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type { WorkOrder, WorkOrderLine } from "@/lib/types"
import type { ProgressLine, WorkOrderBatch } from "@/app/api/v1/_r3"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Db, type Tx } from "../db/client"
import { batches, batchLines, workOrderLines, workOrders } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type Conn = Db | Tx
type OrderDb = typeof workOrders.$inferSelect
type OrderLineDb = typeof workOrderLines.$inferSelect
/** What a new work order is given inside the state lock: its id and the number it occupies. */
export type WorkOrderIdentity = { id: string; no: string }
const today = () => new Date().toISOString().slice(0, 10)
const LABEL = "Work order"
const ENTITY = "workOrder" as const
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** Child row → one finished good the floor owes. A NULL `issued` is the demo data set's "never refreshed yet". */
const toLine = (r: OrderLineDb): WorkOrderLine => {
  const l: WorkOrderLine = { itemId: r.itemId, name: r.name, sku: r.sku, uom: r.uom, qty: r.qty, received: r.received, damaged: r.damaged, remaining: r.remaining }
  if (r.issued != null) l.issued = r.issued
  return l
}

/** Header row + its lines → contract shape. A NULL column is an absent optional field. */
export function toWorkOrder(r: OrderDb, lines: WorkOrderLine[]): WorkOrder {
  const w: WorkOrder = {
    id: r.id, no: r.no, issueDate: r.issueDate, lines, process: r.process, status: r.status,
    issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.requisitionNo != null) w.requisitionNo = r.requisitionNo
  if (r.dueDate != null) w.dueDate = r.dueDate
  if (r.remark != null) w.remark = r.remark
  if (r.updatedAt) w.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) w.cancelReason = r.cancelReason
  return w
}

/** Contract shape → header row values (`ord` and `deletedAt` are the table's own). */
export const workOrderValues = (w: WorkOrder) => ({
  id: w.id, no: w.no, requisitionNo: w.requisitionNo ?? null, issueDate: w.issueDate, dueDate: w.dueDate ?? null,
  remark: w.remark ?? null, process: w.process, status: w.status, issuedBy: w.issuedBy,
  createdAt: new Date(w.createdAt), updatedAt: w.updatedAt ? new Date(w.updatedAt) : null,
  cancelReason: w.cancelReason ?? null, history: w.history ?? null,
})

/** The finished goods it asks for as child rows, in the order they are printed, with the progress they carry. */
export const workOrderLineValues = (w: WorkOrder) => w.lines.map((l, i) => ({
  workOrderId: w.id, ord: i + 1, itemId: l.itemId, name: l.name, sku: l.sku, uom: l.uom, qty: l.qty,
  issued: l.issued ?? null, received: l.received, damaged: l.damaged, remaining: l.remaining,
}))

/* ── the progress every answer and every row carries ───────────────────── */

/**
 * The approved batches' lines, straight out of the tables: what a work order's progress is computed from. One query,
 * however many batches there are — and inside a transaction it sees the batch that transaction just wrote.
 */
export async function progressLines(conn: Conn = db): Promise<ProgressLine[]> {
  const rows = await conn.select({
    itemId: batchLines.itemId, issueQty: batchLines.issueQty, receiveQty: batchLines.receiveQty,
    damageQty: batchLines.damageQty, workOrderId: batchLines.workOrderId,
  }).from(batchLines).innerJoin(batches, eq(batches.id, batchLines.batchId))
    .where(sql`${batches.process} = 'Approved' and ${batches.deletedAt} is null`)
  // a line that draws on no work order is simply not one anybody's progress is computed from
  return rows.map((r) => ({ itemId: r.itemId, issueQty: r.issueQty, receiveQty: r.receiveQty, damageQty: r.damageQty, workOrderId: r.workOrderId ?? undefined }))
}

/**
 * The batches that draw on one work order, as its page lists them and as the cancel and delete rules look at them —
 * the seven fields the mock's own `woBatchRow` picks, in the order the batches were created.
 */
export async function drawingBatches(w: WorkOrder): Promise<WorkOrderBatch[]> {
  const refs = await db.selectDistinct({ batchId: batchLines.batchId }).from(batchLines)
    .where(eq(batchLines.workOrderId, w.id))
  if (!refs.length) return []
  return db.select({
    id: batches.id, no: batches.no, mode: batches.mode, issueDate: batches.issueDate, process: batches.process,
    totalIssue: batches.totalIssue, totalReceive: batches.totalReceive,
  }).from(batches).where(sql`${batches.id} in ${refs.map((r) => r.batchId)} and ${batches.deletedAt} is null`)
    .orderBy(asc(batches.ord))
}

/**
 * Recomputes every live work order's progress from the approved batches and writes the rows that moved — the
 * in-memory copies with them, so a compat reader sees the same numbers. Called by whoever writes a batch, inside its
 * own transaction: a work order's progress is not a field anybody edits, so it has to follow the batches. Returns
 * the work orders it moved, which the caller marks as persisted once its transaction is in — a rolled-back
 * transaction must not leave the write-back believing rows that were never written.
 */
export async function refreshWorkOrderRows(conn: Conn = db): Promise<WorkOrder[]> {
  const c = compat()
  const [rows, lines] = [await conn.select().from(workOrders).where(isNull(workOrders.deletedAt)).orderBy(asc(workOrders.ord)),
    await progressLines(conn)]
  if (!rows.length) return []
  const orders = await assembleWorkOrders(rows, conn)
  const moved: WorkOrder[] = []
  for (const w of orders) {
    const before = JSON.stringify([w.status, w.lines.map((l) => [l.issued, l.received, l.damaged, l.remaining])])
    c.refreshWorkOrder(w, lines)
    if (before !== JSON.stringify([w.status, w.lines.map((l) => [l.issued, l.received, l.damaged, l.remaining])])) moved.push(w)
  }
  for (const w of moved) {
    await conn.update(workOrders).set({ status: w.status }).where(eq(workOrders.id, w.id))
    const values = workOrderLineValues(w)
    await conn.delete(workOrderLines).where(eq(workOrderLines.workOrderId, w.id))
    if (values.length) await conn.insert(workOrderLines).values(values)
    mirror.putWorkOrder(w)
  }
  return moved
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The work orders are rows now, but the in-memory copies stay: a batch's `buildBatch` reads the quantity a work
 * order has left, and the VAT returns and the registers that are still compat read the same objects. A compat
 * handler that writes through the mock's array — a restored backup, the demo runtime — is written back here. See
 * common/writeback.ts.
 */
const workOrderWb = new WriteBack<WorkOrder>("work_orders", () => mirror.workOrders(), (w) => w.id)
export type WorkOrderDelta = Delta<WorkOrder>
export const markWorkOrders = (list: WorkOrder[]) => workOrderWb.mark(list)
export const forgetWorkOrder = (id: string) => workOrderWb.forget(id)
export const workOrderDelta = () => workOrderWb.delta()
export const commitWorkOrderDelta = (d: WorkOrderDelta) => workOrderWb.commit(d)

/**
 * Applies a delta inside the persist transaction and reads the saved work order back into memory, so a value a
 * column type rounded (quantities are numeric(18,3)) is not rewritten on every request.
 *
 * A work order that left the in-memory list was deleted by a handler that still runs the mock's code: the row is
 * stamped exactly as the native delete stamps it — which is what keeps its id and its number retired — and the
 * write-back forgets it.
 */
export async function applyWorkOrderDelta(tx: Tx, d: WorkOrderDelta): Promise<WorkOrder[]> {
  const inserted = new Set(d.insert)
  for (const w of [...d.insert, ...d.update]) {
    // a work order back in the live list is not deleted: an insert clears the stamp a compat delete may have set
    const values = inserted.has(w) ? { ...workOrderValues(w), deletedAt: null } : workOrderValues(w)
    const [row] = await tx.insert(workOrders).values(values)
      .onConflictDoUpdate({ target: workOrders.id, set: values }).returning()
    mirror.putWorkOrder(await replaceChildren(tx, w, row))
  }
  for (const id of d.missing) {
    const stored = workOrderWb.stored(id)
    if (stored) {
      await tx.update(workOrders).set({ ...workOrderValues(stored), deletedAt: new Date() }).where(eq(workOrders.id, id))
      workOrderWb.forget(id)
      continue
    }
    console.warn(`[work-orders] ${id} vanished from the in-memory state and has no stored row`)
  }
  // a compat handler may have written a batch as well: the progress follows the batches, not the snapshot
  return refreshWorkOrderRows(tx)
}

/** Replaces a work order's lines with the ones it carries now, and reads both back. */
async function replaceChildren(tx: Tx, w: WorkOrder, row: OrderDb): Promise<WorkOrder> {
  await tx.delete(workOrderLines).where(eq(workOrderLines.workOrderId, w.id))
  const values = workOrderLineValues(w)
  const lines = values.length ? (await tx.insert(workOrderLines).values(values).returning()).map(toLine) : []
  return toWorkOrder(row, lines)
}

/** Header rows + their lines → work orders, in the rows' order (the service, the refresh and boot share it). */
export async function assembleWorkOrders(rows: OrderDb[], conn: Conn = db): Promise<WorkOrder[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const lineRows = await conn.select().from(workOrderLines).where(inArray(workOrderLines.workOrderId, ids))
    .orderBy(asc(workOrderLines.workOrderId), asc(workOrderLines.ord))
  const byOrder = new Map<string, WorkOrderLine[]>()
  for (const r of lineRows) {
    const a = byOrder.get(r.workOrderId) ?? []
    a.push(toLine(r))
    byOrder.set(r.workOrderId, a)
  }
  return rows.map((r) => toWorkOrder(r, byOrder.get(r.id) ?? []))
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class WorkOrdersService {
  /** Every live work order in insertion order — the order the mock's array had. */
  async all(): Promise<WorkOrder[]> {
    return assembleWorkOrders(await db.select().from(workOrders).where(isNull(workOrders.deletedAt)).orderBy(asc(workOrders.ord)))
  }

  /**
   * The work orders as every answer carries them: their progress recomputed from the approved batches' rows, exactly
   * as the mock's register recomputes it before it answers.
   */
  async refreshed(list?: WorkOrder[]): Promise<WorkOrder[]> {
    const c = compat()
    const lines = await progressLines()
    return (list ?? await this.all()).map((w) => c.refreshWorkOrder(w, lines))
  }

  /** One work order by id or by number: the register, the batches' lines and the audit trail link both. */
  find(idOrNo: string) {
    return this.first(sql`(${workOrders.id} = ${idOrNo} or ${workOrders.no} = ${idOrNo}) and ${workOrders.deletedAt} is null`)
  }

  /** One live work order by id only — what a delete matches on (the mock's delete looked the id up, not the number). */
  byId(id: string) {
    return this.first(sql`${workOrders.id} = ${id} and ${workOrders.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(workOrders).where(match)
    return rows.length ? (await assembleWorkOrders(rows))[0] : undefined
  }

  /**
   * Stores a new work order with its lines. `make` builds it once the id and the number are known — inside the lock,
   * so two creates in flight cannot share a number — and claims the id counter the mock's `db.seq` keeps.
   */
  async create(issueDate: string, make: (ident: WorkOrderIdentity) => WorkOrder): Promise<WorkOrder> {
    let made: WorkOrder | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().woIdentity(issueDate))
        // claimed in memory first: a compat persist running mid-insert must not adopt the work order twice
        mirror.putWorkOrder(made)
        const [row] = await tx.insert(workOrders).values(workOrderValues(made)).returning()
        return replaceChildren(tx, made, row)
      })
      mirror.putWorkOrder(saved)
      markWorkOrders([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeWorkOrder(made.id); forgetWorkOrder(made.id) }
      WorkOrdersService.noConflict(e)
    }
  }

  /** Replaces a work order and its lines — an edit, a transition, or the progress the batches moved. */
  async update(w: WorkOrder): Promise<WorkOrder> {
    const saved = await db.transaction(async (tx) => {
      await lockState(tx)
      const [row] = await tx.update(workOrders).set(workOrderValues(w)).where(eq(workOrders.id, w.id)).returning()
      if (!row) throw new Problem(404, `${LABEL} not found`)
      return replaceChildren(tx, w, row)
    })
    mirror.putWorkOrder(saved)
    markWorkOrders([saved])
    return saved
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. There is no undo for a work order, but the row stays
   * — the mock's id counter moved on when it was removed, and its number lives on in the audit trail, so the row is
   * what keeps a later work order from taking either.
   */
  async remove(w: WorkOrder, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(workOrders).set({ ...workOrderValues(w), deletedAt: new Date(at) }).where(eq(workOrders.id, w.id))
    })
    mirror.removeWorkOrder(w.id)
    forgetWorkOrder(w.id)
  }

  /** A duplicate number the application check missed (two requests at once) is a 409, not a 500. */
  private static noConflict(e: unknown): never {
    if (uniqueViolation(e) !== null) throw new Problem(409, "That work order number was just taken — please try again.")
    throw e as Error
  }
}

/* ── controller ────────────────────────────────────────────────────────── */

/**
 * The six work-order endpoints. The behaviour is shared with the mock handlers (see the header); this class only
 * adds storage, the state guard and the audit trail.
 */
@Controller("api/v1/production/work-orders")
export class WorkOrdersController {
  constructor(
    @Inject(WorkOrdersService) private readonly svc: WorkOrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<WorkOrder> with facets (process / status), newest first, or one CSV row per line. `?item=` keeps the work orders that ask for one SKU. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(c.woItemFilter(sp, await this.svc.refreshed()), sp, c.woSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(c.woCsvRows(r.all), c.woCsvColumns), c.woCsvName(today()))
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json(page)
  }

  /** Create a draft, or create and approve it in one step (which needs the approve permission). */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.buildWorkOrder(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const lines = await progressLines()
    const at = new Date().toISOString()
    const order = await this.svc.create(built.fields.issueDate, (ident) => {
      const w: WorkOrder = {
        ...built.fields, ...ident, process: "Created", status: "draft", issuedBy: user.name, createdAt: at, history: [],
      }
      // before the work order exists: one that cannot be created must not consume an id
      c.claimWorkOrderId()
      c.stampWorkOrderHistory(w, user.name, "created", undefined, at)
      if (approving) {
        w.process = "Approved"
        c.stampWorkOrderHistory(w, user.name, "approved")
      }
      return c.refreshWorkOrder(w, lines)
    })
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: order.id, ref: order.no, action: "created" })
    const approved = order.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY, entityId: order.id, ref: order.no, action: "approved" })
    res.status(201).json(order)
  }

  /** One work order with the batches that draw on it beside it. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const [w] = await this.svc.refreshed([cur])
    res.json({ ...w, batches: (await drawingBatches(w)).map(c.woBatchRow) })
  }

  /** Edit a draft (full replacement): the lines it asks for may change, its number does not. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const draft = c.woDraftRule(cur)
    if (draft) throw new Problem(draft.status, draft.title, draft.errors)
    const built = c.buildWorkOrder(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next: WorkOrder = { ...cur, ...built.fields }
    const at = new Date().toISOString()
    c.stampWorkOrderHistory(next, user.name, "edited", undefined, at)
    const changes = c.woDiff(before, next)
    let approvedAt: string | undefined
    if (approving) {
      next.process = "Approved"
      approvedAt = c.stampWorkOrderHistory(next, user.name, "approved")
    }
    const [refreshed] = await this.svc.refreshed([next])
    const saved = await this.svc.update(refreshed)
    await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve (the floor may start), or cancel — which no batch may still draw on. */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    const drawing = await drawingBatches(cur)
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      const rule = c.woApproveRule(cur)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      c.stampWorkOrderHistory(next, user.name, "approved", undefined, at)
      const [refreshed] = await this.svc.refreshed([next])
      const saved = await this.svc.update(refreshed)
      await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      const r = c.woCancelRule(cur, body.reason ?? "", drawing)
      if ("status" in r) throw new Problem(r.status, r.title, r.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Cancelled"
      next.cancelReason = r.reason
      c.stampWorkOrderHistory(next, user.name, "cancelled", r.reason, at)
      const [refreshed] = await this.svc.refreshed([next])
      const saved = await this.svc.update(refreshed)
      await this.audit.record({ at, actor: user, entity: ENTITY, entityId: saved.id, ref: saved.no, action: "cancelled", note: r.reason })
      res.json(saved)
      return
    }
    throw new Problem(400, "process must be Approved or Cancelled")
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. No batch may quote it. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const rule = c.woDeleteRule(cur, await drawingBatches(cur))
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampWorkOrderHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: ENTITY, entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}
