/**
 * R5.6 — the NBR VAT documents that are not invoices: the treasury deposits (TR-6), the VDS certificates
 * (Mushak 6.6) and the manual VAT adjustments (the Mushak 9.1 notes 27 / 32 / 38 / 39 / 40, including R6.3's SD on
 * the inputs of exported goods).
 *
 * As with every family before them, the rules are the mock's own (src/app/api/v1/_r4.ts, reused through the compat
 * bundle): what a body may contain, the economic code a head takes, the challan that must not be used twice, the
 * invoice a certificate may be written against and how much VAT it still has to withhold, the treasury challan a
 * purchase certificate quotes, the six-month window an SD-on-exports claim has to land in, the period lock, the
 * balance a deposit needs, the VDS entries that keep a challan from being cancelled, the registers' specs, filters,
 * facet labels and CSV columns — all come from the same code the Next.js mock and the static demo run, so the
 * responses, error codes and audit events cannot drift. What changed is underneath:
 *   - a deposit is a row in `treasury_deposits`, a certificate in `vds_entries`, an adjustment in `vat_adjustments`,
 *     so what has been paid to the treasury, withheld at source and adjusted in a period can be summed in SQL;
 *   - each number (TC-, VDS-, VA-MMYY####) is unique in the database as well, so two requests cannot share one;
 *   - a deleted draft keeps its row with `deleted_at`: the mock removed it from its array and its id counter moved
 *     on, so the row is what stops a later document taking the same id (there is no undo for any of them);
 *   - an approved certificate settles part of what its invoice still has due, and `paid` and `due` are columns of
 *     `sales` and `purchases`, so the invoice is written in the same transaction — exactly as a receipt's is;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the Mushak 9.1 return, the
 *     compliance centre, a payment's statement and the SD register still read *every* document, and most of them are
 *     still compat state, so the mirror this module writes is what keeps the two copies one.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, sql, type SQL } from "drizzle-orm"
import type { PgColumn, PgTable } from "drizzle-orm/pg-core"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import type {
  AuditEntity, HistoryEntry, Process, Purchase, Sale, TreasuryDeposit, VatAdjustment, VatReturn, VatSettings, VdsEntry,
} from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { treasuryDeposits, vatAdjustments, vdsEntries } from "../db/schema"
import { compat, G, mirror } from "../state"
import { accountingSource, revertSettlement, writeSettlement } from "./accounting"
import { AuditService } from "./audit"

/** The three families share one state machine, one service and one controller base; this is what differs. */
type VatDocKind = "treasury" | "vds" | "adjustment"
type VatDoc = TreasuryDeposit | VdsEntry | VatAdjustment
type TreasuryDb = typeof treasuryDeposits.$inferSelect
type VdsDb = typeof vdsEntries.$inferSelect
type AdjustmentDb = typeof vatAdjustments.$inferSelect
/** What the rules read: the accounting's own source plus the three collections the VAT rules add to it. */
export type VatSource = Awaited<ReturnType<typeof accountingSource>> & {
  adjustments: VatAdjustment[]
  returns: VatReturn[]
  vatSettings: VatSettings
}
/** A rule's refusal: status, title and (for a 422) the field errors — the shape `RuleProblem` has in the mock. */
type Refusal = { status: number; title: string; errors?: Record<string, string[]> }
/** What a body becomes: the stored fields without the identity, the process and the timestamps. */
type Fields<T> = Omit<T, "id" | "no" | "process" | "createdAt" | "history">
type Built<T> = { process: Process; date: string; fields: Fields<T> }
const today = () => new Date().toISOString().slice(0, 10)
const LABEL: Record<VatDocKind, string> = { treasury: "Treasury deposit", vds: "VDS entry", adjustment: "VAT adjustment" }
const ENTITY: Record<VatDocKind, AuditEntity> = { treasury: "treasury", vds: "vds", adjustment: "adjustment" }
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

export function toTreasury(r: TreasuryDb): TreasuryDeposit {
  const t: TreasuryDeposit = {
    id: r.id, no: r.no, head: r.head, code: r.code, taxPeriod: r.taxPeriod, challanNo: r.challanNo, challanDate: r.challanDate,
    mode: r.mode, bank: r.bank, bankBranch: r.bankBranch, district: r.district, amount: r.amount,
    depositor: r.depositor, address: r.address, description: r.description, process: r.process,
    createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.bankAddress != null) t.bankAddress = r.bankAddress
  if (r.accountId != null) t.accountId = r.accountId
  if (r.designation != null) t.designation = r.designation
  if (r.updatedAt) t.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) t.cancelReason = r.cancelReason
  return t
}
export const treasuryValues = (t: TreasuryDeposit) => ({
  id: t.id, no: t.no, head: t.head, code: t.code, taxPeriod: t.taxPeriod, challanNo: t.challanNo, challanDate: t.challanDate,
  mode: t.mode, bank: t.bank, bankBranch: t.bankBranch, district: t.district, bankAddress: t.bankAddress ?? null,
  accountId: t.accountId ?? null, amount: t.amount, depositor: t.depositor, designation: t.designation ?? null,
  address: t.address, description: t.description, process: t.process,
  createdAt: new Date(t.createdAt), updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
  cancelReason: t.cancelReason ?? null, history: t.history ?? null,
})

export function toVds(r: VdsDb): VdsEntry {
  const v: VdsEntry = {
    id: r.id, no: r.no, mode: r.mode, docId: r.docId, docNo: r.docNo, challanNo: r.challanNo, docDate: r.docDate,
    partyId: r.partyId, partyName: r.partyName, partyBin: r.partyBin, partyAddress: r.partyAddress,
    docValue: r.docValue, docVat: r.docVat, amount: r.amount, certificateDate: r.certificateDate, taxPeriod: r.taxPeriod,
    process: r.process, issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.certificateNo != null) v.certificateNo = r.certificateNo
  if (r.treasuryId != null) v.treasuryId = r.treasuryId
  if (r.treasuryChallan != null) v.treasuryChallan = r.treasuryChallan
  if (r.remark != null) v.remark = r.remark
  if (r.settled != null) v.settled = r.settled
  if (r.updatedAt) v.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) v.cancelReason = r.cancelReason
  return v
}
export const vdsValues = (v: VdsEntry) => ({
  id: v.id, no: v.no, mode: v.mode, docId: v.docId, docNo: v.docNo, challanNo: v.challanNo, docDate: v.docDate,
  partyId: v.partyId, partyName: v.partyName, partyBin: v.partyBin, partyAddress: v.partyAddress,
  docValue: v.docValue, docVat: v.docVat, amount: v.amount, certificateNo: v.certificateNo ?? null,
  certificateDate: v.certificateDate, taxPeriod: v.taxPeriod, treasuryId: v.treasuryId ?? null,
  treasuryChallan: v.treasuryChallan ?? null, remark: v.remark ?? null, settled: v.settled ?? null,
  process: v.process, issuedBy: v.issuedBy,
  createdAt: new Date(v.createdAt), updatedAt: v.updatedAt ? new Date(v.updatedAt) : null,
  cancelReason: v.cancelReason ?? null, history: v.history ?? null,
})

export function toAdjustment(r: AdjustmentDb): VatAdjustment {
  const a: VatAdjustment = {
    id: r.id, no: r.no, kind: r.kind, note: r.note as VatAdjustment["note"], issueDate: r.issueDate, taxPeriod: r.taxPeriod,
    amount: r.amount, description: r.description, process: r.process, issuedBy: r.issuedBy,
    createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.reference != null) a.reference = r.reference
  if (r.sdExport != null) a.sdExport = r.sdExport
  if (r.updatedAt) a.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) a.cancelReason = r.cancelReason
  return a
}
export const adjustmentValues = (a: VatAdjustment) => ({
  id: a.id, no: a.no, kind: a.kind, note: a.note, issueDate: a.issueDate, taxPeriod: a.taxPeriod, amount: a.amount,
  description: a.description, reference: a.reference ?? null, sdExport: a.sdExport ?? null,
  process: a.process, issuedBy: a.issuedBy,
  createdAt: new Date(a.createdAt), updatedAt: a.updatedAt ? new Date(a.updatedAt) : null,
  cancelReason: a.cancelReason ?? null, history: a.history ?? null,
})

/* ── the source the rules read ─────────────────────────────────────────── */

/**
 * What the VAT rules are handed: everything the accounting rules already read, plus the three documents and the two
 * collections the period lock and an SD-on-exports claim look at — the submitted returns and the VAT settings, which
 * are still compat state.
 */
export async function vatSource(): Promise<VatSource> {
  const world = G.__dzDb as unknown as { returns?: VatReturn[]; vatSettings?: VatSettings }
  return {
    ...(await accountingSource()),
    adjustments: mirror.adjustments(),
    returns: world.returns ?? [],
    vatSettings: world.vatSettings as VatSettings,
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The deposits, the certificates and the adjustments are rows now, but the in-memory copies stay: the Mushak 9.1
 * return, the compliance centre, a payment's statement and the SD register all read them. A compat handler that
 * writes through the mock's array — a restored backup, the demo runtime — is written back here. See
 * common/writeback.ts.
 */
const treasuryWb = new WriteBack<TreasuryDeposit>("treasury_deposits", () => mirror.treasury(), (t) => t.id)
const vdsWb = new WriteBack<VdsEntry>("vds_entries", () => mirror.vds(), (v) => v.id)
const adjustmentWb = new WriteBack<VatAdjustment>("vat_adjustments", () => mirror.adjustments(), (a) => a.id)
export type VatDocDelta = { treasury: Delta<TreasuryDeposit>; vds: Delta<VdsEntry>; adjustment: Delta<VatAdjustment> }
export const markTreasury = (list: TreasuryDeposit[]) => treasuryWb.mark(list)
export const markVds = (list: VdsEntry[]) => vdsWb.mark(list)
export const markAdjustments = (list: VatAdjustment[]) => adjustmentWb.mark(list)
export const forgetTreasury = (id: string) => treasuryWb.forget(id)
export const forgetVds = (id: string) => vdsWb.forget(id)
export const forgetAdjustment = (id: string) => adjustmentWb.forget(id)
export const vatDocDelta = (): VatDocDelta => ({ treasury: treasuryWb.delta(), vds: vdsWb.delta(), adjustment: adjustmentWb.delta() })
export const commitVatDocDelta = (d: VatDocDelta) => {
  treasuryWb.commit(d.treasury); vdsWb.commit(d.vds); adjustmentWb.commit(d.adjustment)
}

/**
 * Applies the three deltas inside the persist transaction and reads the saved documents back into memory, so a value
 * a column type rounded (money is numeric(18,2)) is not rewritten on every request.
 *
 * A document that left the in-memory list was deleted by a handler that still runs the mock's code: the row is
 * stamped — which is what keeps its id and its number retired — and the write-back forgets it.
 */
export async function applyVatDocDeltas(tx: Tx, d: VatDocDelta) {
  const groups: [VatDocKind, { insert: VatDoc[]; update: VatDoc[]; missing: string[] }][] = [
    ["treasury", d.treasury], ["vds", d.vds], ["adjustment", d.adjustment],
  ]
  for (const [kind, delta] of groups) {
    const c = CONFIG[kind]
    for (const doc of [...delta.insert, ...delta.update]) {
      const values = c.values(doc)
      const [row] = await tx.insert(c.table).values(values as never)
        .onConflictDoUpdate({ target: c.idCol, set: values as never }).returning()
      c.put(c.toDoc(row as never))
    }
    for (const id of delta.missing) {
      const stored = c.stored(id)
      if (stored) {
        await tx.update(c.table).set({ ...c.values(stored), deletedAt: new Date() } as never).where(eq(c.idCol, id))
        c.forget(id)
        continue
      }
      console.warn(`[${c.name}] ${id} vanished from the in-memory state and has no stored row`)
    }
  }
}

/* ── one service for the three families ────────────────────────────────── */

interface VatDocConfig<T extends VatDoc> {
  name: string
  table: PgTable
  idCol: PgColumn
  noCol: PgColumn
  ordCol: PgColumn
  deletedAtCol: PgColumn
  values: (d: T) => Record<string, unknown>
  toDoc: (r: never) => T
  identity: (date: string) => { id: string; no: string }
  put: (d: T) => T
  remove: (id: string) => T | undefined
  mark: (list: T[]) => void
  forget: (id: string) => void
  stored: (id: string) => T | undefined
}

/** What a new document is given inside the state lock: its id and the number it occupies. */
export type VatDocIdentity = { id: string; no: string }

abstract class VatDocServiceBase<T extends VatDoc> {
  protected constructor(protected readonly c: VatDocConfig<T>) {}

  /** Every live document in insertion order — the order the mock's array had. */
  async all(): Promise<T[]> {
    const rows = await db.select().from(this.c.table)
      .where(sql`${this.c.deletedAtCol} is null`).orderBy(asc(this.c.ordCol))
    return (rows as never[]).map((r) => this.c.toDoc(r))
  }

  /** One document by id or by number: the registers and the audit trail link both. */
  async find(idOrNo: string): Promise<T | undefined> {
    return this.first(sql`(${this.c.idCol} = ${idOrNo} or ${this.c.noCol} = ${idOrNo}) and ${this.c.deletedAtCol} is null`)
  }

  /** One live document by id only — what a delete matches on. */
  async byId(id: string): Promise<T | undefined> {
    return this.first(sql`${this.c.idCol} = ${id} and ${this.c.deletedAtCol} is null`)
  }

  private async first(match: SQL): Promise<T | undefined> {
    const rows = await db.select().from(this.c.table).where(match)
    return rows.length ? this.c.toDoc(rows[0] as never) : undefined
  }

  /**
   * Stores a new document. `make` builds it once the id and the number are known — inside the lock, so two creates
   * in flight cannot share a number — and the invoices an approval settles are written in the same transaction.
   */
  async create(date: string, make: (ident: VatDocIdentity) => { doc: T; moved: (Sale | Purchase)[] }): Promise<T> {
    let made: T | undefined
    let moved: (Sale | Purchase)[] = []
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const built = make(this.c.identity(date))
        made = built.doc; moved = built.moved
        this.c.put(made) // in memory first: a compat persist running mid-insert must not adopt the document twice
        const [row] = await tx.insert(this.c.table).values(this.c.values(made) as never).returning()
        await writeSettlement(tx, moved)
        return this.c.toDoc(row as never)
      })
      this.c.put(saved)
      this.c.mark([saved])
      return saved
    } catch (e) {
      if (made) { this.c.remove(made.id); this.c.forget(made.id) }
      await revertSettlement(moved)
      if (uniqueViolation(e) !== null) throw new Problem(409, "That number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces a document, and writes the invoices it settles in the same transaction. */
  async update(d: T, moved: (Sale | Purchase)[] = []): Promise<T> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(this.c.table).set(this.c.values(d) as never).where(eq(this.c.idCol, d.id)).returning()
        if (!row) throw new Problem(404, `${LABEL[this.kind]} not found`)
        await writeSettlement(tx, moved)
        return this.c.toDoc(row as never)
      })
      this.c.put(saved)
      this.c.mark([saved])
      return saved
    } catch (e) {
      await revertSettlement(moved)
      throw e as Error
    }
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. None of the three has an undo, but the row stays —
   * the mock's id counter moved on when the document was removed, and the row is what keeps the id retired.
   */
  async remove(d: T, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(this.c.table).set({ ...this.c.values(d), deletedAt: new Date(at) } as never).where(eq(this.c.idCol, d.id))
    })
    this.c.remove(d.id)
    this.c.forget(d.id)
  }

  protected abstract readonly kind: VatDocKind
}

const CONFIG = {
  treasury: {
    name: "treasury-deposits",
    table: treasuryDeposits, idCol: treasuryDeposits.id, noCol: treasuryDeposits.no, ordCol: treasuryDeposits.ord,
    deletedAtCol: treasuryDeposits.deletedAt,
    values: treasuryValues as (d: VatDoc) => Record<string, unknown>, toDoc: toTreasury as (r: never) => VatDoc,
    identity: (date: string) => compat().treasuryIdentity(date),
    put: (d: VatDoc) => mirror.putTreasuryDoc(d as TreasuryDeposit),
    remove: (id: string) => mirror.removeTreasury(id), mark: (list: VatDoc[]) => markTreasury(list as TreasuryDeposit[]),
    forget: forgetTreasury, stored: (id: string) => treasuryWb.stored(id),
  },
  vds: {
    name: "vds-entries",
    table: vdsEntries, idCol: vdsEntries.id, noCol: vdsEntries.no, ordCol: vdsEntries.ord, deletedAtCol: vdsEntries.deletedAt,
    values: vdsValues as (d: VatDoc) => Record<string, unknown>, toDoc: toVds as (r: never) => VatDoc,
    identity: (date: string) => compat().vdsIdentity(date),
    put: (d: VatDoc) => mirror.putVdsDoc(d as VdsEntry),
    remove: (id: string) => mirror.removeVds(id), mark: (list: VatDoc[]) => markVds(list as VdsEntry[]),
    forget: forgetVds, stored: (id: string) => vdsWb.stored(id),
  },
  adjustment: {
    name: "vat-adjustments",
    table: vatAdjustments, idCol: vatAdjustments.id, noCol: vatAdjustments.no, ordCol: vatAdjustments.ord,
    deletedAtCol: vatAdjustments.deletedAt,
    values: adjustmentValues as (d: VatDoc) => Record<string, unknown>, toDoc: toAdjustment as (r: never) => VatDoc,
    identity: (date: string) => compat().adjustmentIdentity(date),
    put: (d: VatDoc) => mirror.putAdjustment(d as VatAdjustment),
    remove: (id: string) => mirror.removeAdjustment(id), mark: (list: VatDoc[]) => markAdjustments(list as VatAdjustment[]),
    forget: forgetAdjustment, stored: (id: string) => adjustmentWb.stored(id),
  },
} satisfies Record<VatDocKind, VatDocConfig<VatDoc>>

@Injectable()
export class TreasuryService extends VatDocServiceBase<TreasuryDeposit> {
  constructor() { super(CONFIG.treasury as unknown as VatDocConfig<TreasuryDeposit>) }
  protected readonly kind = "treasury" as const
}
@Injectable()
export class VdsService extends VatDocServiceBase<VdsEntry> {
  constructor() { super(CONFIG.vds as unknown as VatDocConfig<VdsEntry>) }
  protected readonly kind = "vds" as const
}
@Injectable()
export class AdjustmentsService extends VatDocServiceBase<VatAdjustment> {
  constructor() { super(CONFIG.adjustment as unknown as VatDocConfig<VatAdjustment>) }
  protected readonly kind = "adjustment" as const
}

/* ── controller ────────────────────────────────────────────────────────── */

/**
 * The six endpoints of one family — the register, a create that may approve straight away, one document, an edit of a
 * draft, the approve / cancel transition and a draft's delete. The behaviour is the mock's own (see the header); this
 * base only adds storage, the state guard and the audit trail. Nest does not pick up decorated methods from a base
 * class, so each concrete controller declares its own routes and delegates here.
 */
abstract class VatDocControllerBase<T extends VatDoc> {
  protected constructor(@Inject(AuditService) protected readonly audit: AuditService) {}

  protected abstract readonly kind: VatDocKind
  protected abstract readonly svc: VatDocServiceBase<T>
  /** What a body may hold, and the fields it becomes. */
  protected abstract build(body: unknown, self: T | undefined, src: VatSource): Refusal | Built<T>
  protected abstract claim(): void
  protected abstract stamp(d: T, by: string, action: HistoryEntry["action"], note?: string, at?: string): string
  protected abstract approveRule(d: T, src: VatSource): Refusal | undefined
  protected abstract cancelRule(d: T, src: VatSource): Refusal | undefined
  protected abstract lockRule(d: T, src: VatSource): Refusal | undefined
  /** Apply (+1) or reverse (−1) what an approval settles, handing back the invoices it moved. */
  protected settle(_d: T, _sign: 1 | -1, _src: VatSource): (Sale | Purchase)[] { return [] }
  protected abstract readonly spec: QuerySpec<T>
  protected abstract readonly csvColumns: { key: string; label: string }[]
  protected abstract readonly csvName: string
  protected abstract readonly diffFields: string[]
  protected filter(rows: T[], _sp: URLSearchParams): T[] { return rows }
  protected facetLabels(): Record<string, Record<string, string>> | undefined { return undefined }

  private raise(p: Refusal): never {
    throw new Problem(p.status, p.title, p.errors)
  }

  /** The register: Page<T> with facets and facet labels, or the CSV. */
  protected async list(req: Request, res: Response) {
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(this.filter(await this.svc.all(), sp), sp, this.spec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, this.csvColumns as never[]), `${this.csvName}-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: this.facetLabels() ?? {} })
  }

  /** Create a draft, or create and approve it in one step (which needs the approve permission). */
  protected async create(req: AuthedRequest, res: Response) {
    const src = await vatSource()
    const built = this.build(jsonBody(req), undefined, src)
    if ("status" in built) this.raise(built)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const at = new Date().toISOString()
    const doc = await this.svc.create(built.date, (ident) => {
      const d = { ...built.fields, ...ident, process: "Created" as const, createdAt: at, history: [] } as unknown as T
      this.claim()
      if ("issuedBy" in d) (d as { issuedBy: string }).issuedBy = user.name
      this.stamp(d, user.name, "created", undefined, at)
      if (approving) {
        const rule = this.approveRule(d, src)
        if (rule) this.raise(rule)
        d.process = "Approved"
        this.stamp(d, user.name, "approved", undefined, at)
      }
      return { doc: d, moved: approving ? this.settle(d, 1, src) : [] }
    })
    await this.audit.record({ at, actor: user, entity: ENTITY[this.kind], entityId: doc.id, ref: doc.no, action: "created" })
    const approved = doc.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: ENTITY[this.kind], entityId: doc.id, ref: doc.no, action: "approved" })
    res.status(201).json(doc)
  }

  protected async one(id: string, res: Response) {
    const d = await this.svc.find(id)
    if (!d) throw new Problem(404, `${LABEL[this.kind]} not found`)
    res.json(d)
  }

  /** Edit a draft (full replacement). Optional approve-on-save. */
  protected async update(id: string, req: AuthedRequest, res: Response) {
    const src = await vatSource()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL[this.kind]} not found`)
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be edited — ${cur.no} is ${cur.process}.`)
    const built = this.build(jsonBody(req), cur, src)
    if ("status" in built) this.raise(built)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next = { ...cur, ...built.fields } as T
    if (approving) {
      const rule = this.approveRule(next, src)
      if (rule) this.raise(rule)
    }
    const at = new Date().toISOString()
    this.stamp(next, user.name, "edited", undefined, at)
    const changes = compat().diff(before, next, this.diffFields)
    let approvedAt: string | undefined
    if (approving) {
      approvedAt = new Date().toISOString()
      next.process = "Approved"
      this.stamp(next, user.name, "approved", undefined, approvedAt)
    }
    const saved = await this.svc.update(next, approving ? this.settle(next, 1, src) : [])
    await this.audit.record({ at, actor: user, entity: ENTITY[this.kind], entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: ENTITY[this.kind], entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve (settles what it withholds), or cancel with a mandatory reason (gives it back). */
  protected async patch(id: string, req: AuthedRequest, res: Response) {
    const src = await vatSource()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${LABEL[this.kind]} not found`)
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      if (cur.process !== "Created") throw new Problem(409, `Cannot approve — ${cur.no} is ${cur.process}.`)
      const lock = this.lockRule(cur, src)
      if (lock) this.raise(lock)
      const rule = this.approveRule(cur, src)
      if (rule) this.raise(rule)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      this.stamp(next, user.name, "approved", undefined, at)
      const saved = await this.svc.update(next, this.settle(next, 1, src))
      await this.audit.record({ at, actor: user, entity: ENTITY[this.kind], entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      if (cur.process === "Cancelled") throw new Problem(409, `${cur.no} is already cancelled.`)
      const parsed = compat().cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as never))
      if (cur.process === "Approved") {
        const lock = this.lockRule(cur, src)
        if (lock) this.raise(lock)
        const rule = this.cancelRule(cur, src)
        if (rule) this.raise(rule)
      }
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      const moved = next.process === "Approved" ? this.settle(next, -1, src) : []
      next.process = "Cancelled"
      next.cancelReason = parsed.data.reason
      this.stamp(next, user.name, "cancelled", parsed.data.reason, at)
      const saved = await this.svc.update(next, moved)
      await this.audit.record({ at, actor: user, entity: ENTITY[this.kind], entityId: saved.id, ref: saved.no, action: "cancelled", note: parsed.data.reason })
      res.json(saved)
      return
    }
    throw new Problem(400, "process must be Approved or Cancelled")
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. None of the three has an undo. */
  protected async remove(id: string, req: AuthedRequest, res: Response) {
    const cur = await this.svc.byId(id)
    if (!cur) throw new Problem(404, `${LABEL[this.kind]} not found`)
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be deleted — cancel ${cur.no} instead.`)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    this.stamp(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: ENTITY[this.kind], entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}

/* ── the three registers ───────────────────────────────────────────────── */

@Controller("api/v1/vat/treasury")
export class TreasuryController extends VatDocControllerBase<TreasuryDeposit> {
  constructor(
    @Inject(TreasuryService) private readonly treasury: TreasuryService,
    @Inject(AuditService) audit: AuditService,
  ) { super(audit) }
  protected readonly kind = "treasury" as const
  protected get svc() { return this.treasury }

  protected build(body: unknown, self: TreasuryDeposit | undefined, src: VatSource) { return compat().treasuryBuild(body, self, src) }
  protected claim() { compat().claimTreasuryId() }
  protected stamp(d: TreasuryDeposit, by: string, action: HistoryEntry["action"], note?: string, at?: string) {
    return compat().stampTreasuryHistory(d, by, action, note, at)
  }
  protected approveRule(d: TreasuryDeposit, src: VatSource) { return compat().treasuryApproveRule(d, src) }
  protected cancelRule(d: TreasuryDeposit, src: VatSource) { return compat().treasuryCancelRule(d, src) }
  protected lockRule(d: TreasuryDeposit, src: VatSource) { return compat().treasuryLockRule(d, src) }
  protected get spec() { return compat().treasurySpec as QuerySpec<TreasuryDeposit> }
  protected get csvColumns() { return compat().TREASURY_CSV_COLUMNS }
  protected get csvName() { return "treasury-deposits" }
  protected get diffFields() { return compat().TREASURY_DIFF_FIELDS }

  @Get() @Authed()
  list(@Req() req: Request, @Res() res: Response) { return super.list(req, res) }
  @Post() @Authed("doc.create")
  create(@Req() req: AuthedRequest, @Res() res: Response) { return super.create(req, res) }
  @Get(":id") @Authed()
  one(@Param("id") id: string, @Res() res: Response) { return super.one(id, res) }
  @Put(":id") @Authed("doc.edit")
  update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.update(id, req, res) }
  @Patch(":id") @Authed()
  patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.patch(id, req, res) }
  @Delete(":id") @Authed("doc.delete")
  remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.remove(id, req, res) }
}

/** R5.6: the invoices a certificate can still be written against (`vat/vds/eligible`) — a read, straight from the rules. */
@Controller("api/v1/vat/vds/eligible")
export class VdsEligibleController {
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    const mode = sp.get("mode") === "sales" ? "sales" : "purchase"
    res.json(compat().vdsEligible(mode, sp.get("exclude") ?? undefined, await vatSource()))
  }
}

@Controller("api/v1/vat/vds")
export class VdsController extends VatDocControllerBase<VdsEntry> {
  constructor(
    @Inject(VdsService) private readonly vds: VdsService,
    @Inject(AuditService) audit: AuditService,
  ) { super(audit) }
  protected readonly kind = "vds" as const
  protected get svc() { return this.vds }

  protected build(body: unknown, self: VdsEntry | undefined, src: VatSource) { return compat().vdsBuild(body, self, src) }
  protected claim() { compat().claimVdsId() }
  protected stamp(d: VdsEntry, by: string, action: HistoryEntry["action"], note?: string, at?: string) {
    return compat().stampVdsHistory(d, by, action, note, at)
  }
  protected approveRule(d: VdsEntry, src: VatSource) { return compat().vdsApproveRule(d, src) }
  protected cancelRule() { return undefined }
  protected lockRule(d: VdsEntry, src: VatSource) { return compat().vdsLockRule(d, src) }
  protected settle(d: VdsEntry, sign: 1 | -1, src: VatSource) { return compat().vdsSettle(d, sign, src) }
  protected get spec() { return compat().vdsSpec as QuerySpec<VdsEntry> }
  protected get csvColumns() { return compat().VDS_CSV_COLUMNS }
  protected get csvName() { return "vds" }
  protected get diffFields() { return compat().VDS_DIFF_FIELDS }
  protected facetLabels() { return compat().vdsFacetLabels() }

  @Get() @Authed()
  list(@Req() req: Request, @Res() res: Response) { return super.list(req, res) }
  @Post() @Authed("doc.create")
  create(@Req() req: AuthedRequest, @Res() res: Response) { return super.create(req, res) }
  @Get(":id") @Authed()
  one(@Param("id") id: string, @Res() res: Response) { return super.one(id, res) }
  @Put(":id") @Authed("doc.edit")
  update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.update(id, req, res) }
  @Patch(":id") @Authed()
  patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.patch(id, req, res) }
  @Delete(":id") @Authed("doc.delete")
  remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.remove(id, req, res) }
}

@Controller("api/v1/vat/adjustments")
export class AdjustmentsController extends VatDocControllerBase<VatAdjustment> {
  constructor(
    @Inject(AdjustmentsService) private readonly adjustments: AdjustmentsService,
    @Inject(AuditService) audit: AuditService,
  ) { super(audit) }
  protected readonly kind = "adjustment" as const
  protected get svc() { return this.adjustments }

  protected build(body: unknown, self: VatAdjustment | undefined, src: VatSource) { return compat().adjustmentBuild(body, self, src) }
  protected claim() { compat().claimAdjustmentId() }
  protected stamp(d: VatAdjustment, by: string, action: HistoryEntry["action"], note?: string, at?: string) {
    return compat().stampAdjustmentHistory(d, by, action, note, at)
  }
  protected approveRule(d: VatAdjustment, src: VatSource) { return compat().adjustmentApproveRule(d, src) }
  protected cancelRule() { return undefined }
  protected lockRule(d: VatAdjustment, src: VatSource) { return compat().adjustmentLockRule(d, src) }
  protected get spec() { return compat().adjustmentSpec as QuerySpec<VatAdjustment> }
  protected get csvColumns() { return compat().ADJUSTMENT_CSV_COLUMNS }
  protected get csvName() { return "vat-adjustments" }
  protected get diffFields() { return compat().ADJUSTMENT_DIFF_FIELDS }

  @Get() @Authed()
  list(@Req() req: Request, @Res() res: Response) { return super.list(req, res) }
  @Post() @Authed("doc.create")
  create(@Req() req: AuthedRequest, @Res() res: Response) { return super.create(req, res) }
  @Get(":id") @Authed()
  one(@Param("id") id: string, @Res() res: Response) { return super.one(id, res) }
  @Put(":id") @Authed("doc.edit")
  update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.update(id, req, res) }
  @Patch(":id") @Authed()
  patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.patch(id, req, res) }
  @Delete(":id") @Authed("doc.delete")
  remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) { return super.remove(id, req, res) }
}
