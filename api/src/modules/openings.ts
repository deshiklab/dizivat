/**
 * R5.4 — opening stock entries on their own table: the quantities the SKUs were brought forward with at go-live,
 * their purchase value and the input-tax class that value belongs to (Mushak 6.1). They are the first of the two
 * collections the derived stock still read from memory (the other is the production batches), so once they are rows
 * the branch split and an item's ledger can be computed from the database instead of walked in memory.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r2.ts, reused through the compat
 * bundle): what a body may contain, how the quantity is rounded to the unit's own decimals, the entry's number, the
 * stock an approval adds and a cancellation needs, the register's spec and its CSV columns all come from the same
 * code the Next.js mock and the static demo run, so the responses, error codes and audit events cannot drift. What
 * changed is underneath:
 *   - an entry is a row in `opening_entries`, so the opening value and the VAT paid on it can be summed in SQL;
 *   - the bond block an R6.4 go-live entry carries (its Bill of Entry, the quantity still warehoused and the duty
 *     suspended on it) is columns of that row;
 *   - the entry number is unique in the database as well, so two requests cannot share one;
 *   - a deleted draft keeps its row with `deleted_at`: entries have no undo, and the mock removed one from its array
 *     for good — but its id counter had moved on and its number lives on in the audit trail, so the stamped row is
 *     what stops a later entry taking the same id;
 *   - the counter an approval moves (`items.opening`) is written with the entry, in the same transaction;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the branch stock, the ledger
 *     and the VAT returns still read *every* document, and the production batches are compat state until they have
 *     a table too.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type { Item, OpeningEntry } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { items, openingEntries } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"
import { markItems, revertItemCounters } from "./items"

type OpeningDb = typeof openingEntries.$inferSelect
/** What a new entry is given inside the state lock: its id and the number it occupies. */
export type OpeningIdentity = { id: string; no: string }
const today = () => new Date().toISOString().slice(0, 10)
const LABEL = "Opening entry"
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** Row → entry (the contract shape). A NULL column is an absent optional field. */
export function toOpening(r: OpeningDb): OpeningEntry {
  const o: OpeningEntry = {
    id: r.id, no: r.no, itemId: r.itemId, name: r.name, hsCode: r.hsCode, sku: r.sku, uom: r.uom,
    branchId: r.branchId, branchName: r.branchName, date: r.date, inputTax: r.inputTax,
    qty: r.qty, price: r.price, value: r.value, vatPaid: r.vatPaid, process: r.process,
    issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.note != null) o.note = r.note
  // the R6.4 bond block is all there or not at all
  if (r.bondBoeNo != null) o.bond = { boeNo: r.bondBoeNo, boeDate: r.bondBoeDate!, qty: r.bondQty!, dutyForegone: r.bondDutyForegone! }
  if (r.updatedAt) o.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) o.cancelReason = r.cancelReason
  return o
}

/** Contract shape → row values (`ord` and `deletedAt` are the table's own). */
export const openingValues = (o: OpeningEntry) => {
  const b = o.bond
  return {
    id: o.id, no: o.no, itemId: o.itemId, name: o.name, hsCode: o.hsCode, sku: o.sku, uom: o.uom,
    branchId: o.branchId, branchName: o.branchName, date: o.date, inputTax: o.inputTax,
    qty: o.qty, price: o.price, value: o.value, vatPaid: o.vatPaid, note: o.note ?? null,
    bondBoeNo: b?.boeNo ?? null, bondBoeDate: b?.boeDate ?? null, bondQty: b?.qty ?? null,
    bondDutyForegone: b?.dutyForegone ?? null,
    process: o.process, issuedBy: o.issuedBy,
    createdAt: new Date(o.createdAt), updatedAt: o.updatedAt ? new Date(o.updatedAt) : null,
    cancelReason: o.cancelReason ?? null, history: o.history ?? null,
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The entries are rows now, but the in-memory copies stay: the branch stock, an item's ledger and the VAT returns
 * derive from all of them, together with the documents that are still compat state. A compat handler that writes
 * through the mock's array — a restored backup, the demo runtime — is written back here. See common/writeback.ts.
 */
const openingWb = new WriteBack<OpeningEntry>("opening_entries", () => mirror.openings(), (o) => o.id)
export type OpeningDelta = Delta<OpeningEntry>
export const markOpenings = (list: OpeningEntry[]) => openingWb.mark(list)
export const forgetOpening = (id: string) => openingWb.forget(id)
export const openingDelta = () => openingWb.delta()
export const commitOpeningDelta = (d: OpeningDelta) => openingWb.commit(d)

/**
 * Applies a delta inside the persist transaction and reads the saved entry back into memory, so a value a column
 * type rounded (money is numeric(18,2), quantities numeric(18,3)) is not rewritten on every request.
 *
 * An entry that left the in-memory list was deleted by a handler that still runs the mock's code: entries have no
 * undo buffer, so the row is stamped exactly as the native delete stamps it — which is what keeps its id and its
 * number retired — and the write-back forgets it.
 */
export async function applyOpeningDelta(tx: Tx, d: OpeningDelta) {
  const inserted = new Set(d.insert)
  for (const o of [...d.insert, ...d.update]) {
    // an entry back in the live list is not deleted: an insert clears the stamp a compat delete may have set
    const values = inserted.has(o) ? { ...openingValues(o), deletedAt: null } : openingValues(o)
    const [row] = await tx.insert(openingEntries).values(values)
      .onConflictDoUpdate({ target: openingEntries.id, set: values }).returning()
    mirror.putOpening(toOpening(row))
  }
  for (const id of d.missing) {
    const stored = openingWb.stored(id)
    if (stored) {
      await tx.update(openingEntries).set({ ...openingValues(stored), deletedAt: new Date() }).where(eq(openingEntries.id, id))
      openingWb.forget(id)
      continue
    }
    console.warn(`[opening_entries] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/** The SKU an approval moves (`Item.opening`) — one entry, one item. */
const captureCounters = (o: OpeningEntry) => {
  const it = mirror.findItem(o.itemId)
  return it ? [it] : []
}
async function writeCounters(tx: Tx, list: Item[]) {
  for (const it of list) await tx.update(items).set({ opening: it.opening }).where(eq(items.id, it.id))
}

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class OpeningsService {
  /** Every live entry in insertion order — the order the mock's array had. */
  async all(): Promise<OpeningEntry[]> {
    return (await db.select().from(openingEntries).where(isNull(openingEntries.deletedAt)).orderBy(asc(openingEntries.ord)))
      .map(toOpening)
  }

  /** One entry by id or by number: the register, the ledger and the audit trail link both. */
  find(idOrNo: string) {
    return this.first(sql`(${openingEntries.id} = ${idOrNo} or ${openingEntries.no} = ${idOrNo}) and ${openingEntries.deletedAt} is null`)
  }

  /** One live entry by id only — what a delete matches on. */
  byId(id: string) {
    return this.first(sql`${openingEntries.id} = ${id} and ${openingEntries.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(openingEntries).where(match)
    return rows.length ? toOpening(rows[0]) : undefined
  }

  /**
   * Stores a new entry. `make` builds it once the id and the number are known — inside the lock, so two creates in
   * flight cannot share a number — and claims the id counter the mock's `db.seq` keeps. The counter an approval
   * moves is written with it.
   */
  async create(date: string, make: (ident: OpeningIdentity) => OpeningEntry): Promise<OpeningEntry> {
    let made: OpeningEntry | undefined
    let counters: Item[] = []
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().openingIdentity(date))
        // claimed in memory first: a compat persist running mid-insert must not adopt the entry twice
        mirror.putOpening(made)
        counters = captureCounters(made)
        const [row] = await tx.insert(openingEntries).values(openingValues(made)).returning()
        await writeCounters(tx, counters)
        return toOpening(row)
      })
      mirror.putOpening(saved)
      markOpenings([saved])
      markItems(counters)
      return saved
    } catch (e) {
      if (made) { mirror.removeOpening(made.id); forgetOpening(made.id) }
      await revertItemCounters(counters.map((it) => it.id))
      OpeningsService.noConflict(e)
    }
  }

  /** Replaces an entry and writes the counter in the same transaction. */
  async update(o: OpeningEntry): Promise<OpeningEntry> {
    const counters = captureCounters(o)
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(openingEntries).set(openingValues(o)).where(eq(openingEntries.id, o.id)).returning()
        if (!row) throw new Problem(404, `${LABEL} not found`)
        await writeCounters(tx, counters)
        return toOpening(row)
      })
      mirror.putOpening(saved)
      markOpenings([saved])
      markItems(counters)
      return saved
    } catch (e) {
      await revertItemCounters(counters.map((it) => it.id))
      throw e as Error
    }
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. Entries have no undo, but the row stays — the mock's
   * id counter moved on when the entry was removed, and the row is what keeps a later entry from taking its id.
   */
  async remove(o: OpeningEntry, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(openingEntries).set({ ...openingValues(o), deletedAt: new Date(at) }).where(eq(openingEntries.id, o.id))
    })
    mirror.removeOpening(o.id)
    forgetOpening(o.id)
  }

  /** A duplicate number the application check missed (two requests at once) is a 409, not a 500. */
  private static noConflict(e: unknown): never {
    if (uniqueViolation(e) !== null) throw new Problem(409, "That entry number was just taken — please try again.")
    throw e as Error
  }
}

/* ── controller ────────────────────────────────────────────────────────── */

/**
 * The six opening-stock endpoints. The behaviour is shared with the mock handlers (see the header); this class only
 * adds storage, the state guard and the audit trail.
 */
@Controller("api/v1/opening-stock")
export class OpeningsController {
  constructor(
    @Inject(OpeningsService) private readonly svc: OpeningsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<OpeningEntry> with facets and branch labels, or CSV. `?item=` keeps one SKU's entries. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(c.openingItemFilter(sp, await this.svc.all()), sp, c.openingSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.openingCsvColumns), `opening-stock-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: c.openingFacetLabels() })
  }

  /** Create a draft, or create and approve it in one step (which needs the approve permission). */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.buildOpening(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const at = new Date().toISOString()
    const entry = await this.svc.create(built.fields.date, (ident) => {
      const o: OpeningEntry = { ...built.fields, ...ident, process: "Created", issuedBy: user.name, createdAt: at, history: [] }
      c.claimOpeningId()
      c.stampOpeningHistory(o, user.name, "created", undefined, at)
      if (approving) {
        o.process = "Approved"
        c.postOpening(o, 1)
        c.stampOpeningHistory(o, user.name, "approved")
      }
      return o
    })
    await this.audit.record({ at, actor: user, entity: "opening", entityId: entry.id, ref: entry.no, action: "created" })
    const approved = entry.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: "opening", entityId: entry.id, ref: entry.no, action: "approved" })
    res.status(201).json(entry)
  }

  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const o = await this.svc.find(id)
    if (!o) throw new Problem(404, `${LABEL} not found`)
    res.json(o)
  }

  /** Edit a draft (full replacement). Optional approve-on-save. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const draft = c.openingDraftRule(cur)
    if (draft) throw new Problem(draft.status, draft.title, draft.errors)
    const built = c.buildOpening(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next: OpeningEntry = { ...cur, ...built.fields }
    const at = new Date().toISOString()
    c.stampOpeningHistory(next, user.name, "edited", undefined, at)
    const changes = c.openingDiff(before, next)
    let approvedAt: string | undefined
    if (approving) {
      approvedAt = new Date().toISOString()
      next.process = "Approved"
      c.postOpening(next, 1)
      c.stampOpeningHistory(next, user.name, "approved", undefined, approvedAt)
    }
    const saved = await this.svc.update(next)
    await this.audit.record({ at, actor: user, entity: "opening", entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: "opening", entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve (adds the quantity to the item's opening), or cancel (takes it back out). */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      const rule = c.openingApproveRule(cur)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      c.postOpening(next, 1)
      c.stampOpeningHistory(next, user.name, "approved", undefined, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "opening", entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      const r = c.openingCancelRule(cur, body.reason ?? "")
      if ("status" in r) throw new Problem(r.status, r.title, r.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      if (next.process === "Approved") c.postOpening(next, -1)
      next.process = "Cancelled"
      next.cancelReason = r.reason
      c.stampOpeningHistory(next, user.name, "cancelled", r.reason, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "opening", entityId: saved.id, ref: saved.no, action: "cancelled", note: r.reason })
      res.json(saved)
      return
    }
    throw new Problem(400, "process must be Approved or Cancelled")
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. Entries have no undo. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, `${LABEL} not found`)
    const rule = c.openingDeleteRule(cur)
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampOpeningHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: "opening", entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}
