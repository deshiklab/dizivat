/**
 * R5.6 — accounting on its own tables: the money accounts (bank, mobile wallet, cash box), the customer receipts and
 * the supplier payments with the invoices they settle, and the configuration that closes the books. A receipt is what
 * turns an invoice into money: its allocations are rows of `money_allocations`, and approving one writes the invoice's
 * `paid` and `due` — columns of `sales` and `purchases` — in the same transaction, so the invoice registers and the
 * accounts can never disagree. Cancelling gives it back.
 *
 * As with every family before it, the rules are the mock's own (`src/app/api/v1/_r4.ts`, reused through the compat
 * bundle): what a body may contain — the party, an account whose kind matches the method, the cheque block a cheque
 * needs, allocations that are open, not repeated and not more than the invoice has left — the closed-books check, the
 * number a new document takes, the books-must-be-open approve and cancel rules, the register's spec, its `?invoice=`
 * filter and its CSV columns, a party's statement and its ageing, and the configuration's own rules cannot drift.
 * What changed is underneath:
 *   - both money kinds live in `money_docs` (`kind` tells them apart, as it does for the transfers, the damage
 *     entries and the notes), and their allocations in `money_allocations`, so what a party has paid is a `SUM`;
 *   - a document's number is unique in the database as well, so two requests cannot share one;
 *   - a deleted draft keeps its row with `deleted_at`: the mock removed it from its array for good, but its id
 *     counter had moved on, so the stamped row is what stops a later document taking the same id;
 *   - an approval writes the invoices it settles in the same transaction as the document, and a rolled-back
 *     transaction puts their counters back;
 *   - every write goes through the state guard, and the in-memory copies stay in step: the VAT returns, the VDS
 *     register, the compliance centre and a party's credit still read them, and `settlementsOf` — the rule that
 *     refuses to cancel an invoice something has settled — reads the same objects.
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type {
  AccountingConfig, Allocation, MoneyAccount, MoneyAccountRow, MoneyDoc, MoneyKind, Party, PartyStatement, Purchase, Sale,
} from "@/lib/types"
import type { AccountingSource } from "@/app/api/v1/_r4"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { accountingConfig, moneyAccounts, moneyAllocations, moneyDocs } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"
import { applyPurchaseSettlement, revertPurchaseSettlement } from "./purchases"
import { applySaleSettlement, revertSaleSettlement } from "./sales"

type AccountDb = typeof moneyAccounts.$inferSelect
type MoneyDb = typeof moneyDocs.$inferSelect
type AllocationDb = typeof moneyAllocations.$inferSelect
const today = () => new Date().toISOString().slice(0, 10)
const ACCOUNT_LABEL = "Account"
/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/* ── mappers ───────────────────────────────────────────────────────────── */

/** Child row → one invoice a receipt or payment settles. */
const toAllocation = (r: AllocationDb): Allocation => ({
  docId: r.invoiceId, docNo: r.invoiceNo, docDate: r.invoiceDate, docTotal: r.invoiceTotal, amount: r.amount,
})

/** Header row + its allocations → contract shape. A NULL column is an absent optional field. */
export function toMoneyDoc(r: MoneyDb, allocations: Allocation[]): MoneyDoc {
  const m: MoneyDoc = {
    id: r.id, no: r.no, kind: r.kind, date: r.date, partyId: r.partyId, partyName: r.partyName, partyBin: r.partyBin,
    method: r.method, accountId: r.accountId, accountName: r.accountName,
    amount: r.amount, charge: r.charge, allocations, allocated: r.allocated, unallocated: r.unallocated,
    process: r.process, issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.chequeNo != null) m.chequeNo = r.chequeNo
  if (r.chequeDate != null) m.chequeDate = r.chequeDate
  if (r.chequeBank != null) m.chequeBank = r.chequeBank
  if (r.reference != null) m.reference = r.reference
  if (r.note != null) m.note = r.note
  if (r.updatedAt) m.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) m.cancelReason = r.cancelReason
  return m
}

/** Contract shape → header row values (`ord` and `deletedAt` are the table's own). */
export const moneyDocValues = (m: MoneyDoc) => ({
  id: m.id, no: m.no, kind: m.kind, date: m.date, partyId: m.partyId, partyName: m.partyName, partyBin: m.partyBin,
  method: m.method, accountId: m.accountId, accountName: m.accountName,
  chequeNo: m.chequeNo ?? null, chequeDate: m.chequeDate ?? null, chequeBank: m.chequeBank ?? null,
  reference: m.reference ?? null, amount: m.amount, charge: m.charge,
  allocated: m.allocated, unallocated: m.unallocated, note: m.note ?? null, process: m.process, issuedBy: m.issuedBy,
  createdAt: new Date(m.createdAt), updatedAt: m.updatedAt ? new Date(m.updatedAt) : null,
  cancelReason: m.cancelReason ?? null, history: m.history ?? null,
})

/** The invoices it settles as child rows, in the order they are printed (a zero allocation is dropped upstream). */
export const moneyAllocationValues = (m: MoneyDoc) => m.allocations.map((a, i) => ({
  docId: m.id, ord: i + 1, invoiceId: a.docId, invoiceNo: a.docNo, invoiceDate: a.docDate,
  invoiceTotal: a.docTotal, amount: a.amount,
}))

/** Contract shape → account row values (`ord` is the table's own). */
export const moneyAccountValues = (a: MoneyAccount) => ({
  id: a.id, kind: a.kind, provider: a.provider, accountNo: a.accountNo, owner: a.owner,
  branch: a.branch ?? null, address: a.address ?? null, bankType: a.bankType ?? null,
  walletType: a.walletType ?? null, authorised: a.authorised ?? null,
  serviceCharge: a.serviceCharge, openingBalance: a.openingBalance, openingDate: a.openingDate, active: a.active,
  createdAt: new Date(a.createdAt), updatedAt: a.updatedAt ? new Date(a.updatedAt) : null, history: a.history ?? null,
})

/** Account row → contract shape. A NULL column is an absent optional field. */
export function toMoneyAccount(r: AccountDb): MoneyAccount {
  const a: MoneyAccount = {
    id: r.id, kind: r.kind, provider: r.provider, accountNo: r.accountNo, owner: r.owner,
    serviceCharge: r.serviceCharge, openingBalance: r.openingBalance, openingDate: r.openingDate, active: r.active,
    createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.branch != null) a.branch = r.branch
  if (r.address != null) a.address = r.address
  if (r.bankType != null) a.bankType = r.bankType
  if (r.walletType != null) a.walletType = r.walletType
  if (r.authorised != null) a.authorised = r.authorised
  if (r.updatedAt) a.updatedAt = r.updatedAt.toISOString()
  return a
}

/** The configuration row → contract shape: `updatedAt` and `updatedBy` only once it has been updated. */
export function toAccountingConfig(r: typeof accountingConfig.$inferSelect): AccountingConfig {
  const c: AccountingConfig = { allowAdvance: r.allowAdvance, autoAllocate: r.autoAllocate }
  if (r.closedUpTo != null) c.closedUpTo = r.closedUpTo
  if (r.updatedAt) c.updatedAt = r.updatedAt.toISOString()
  if (r.updatedBy != null) c.updatedBy = r.updatedBy
  return c
}

export const accountingConfigValues = (c: AccountingConfig) => ({
  id: 1, closedUpTo: c.closedUpTo ?? null, allowAdvance: c.allowAdvance, autoAllocate: c.autoAllocate,
  updatedAt: c.updatedAt ? new Date(c.updatedAt) : null, updatedBy: c.updatedBy ?? null,
})

/* ── the source every rule reads ───────────────────────────────────────── */

/**
 * What the accounting rules read, straight out of the tables: the parties from `parties`, the invoices from `sales`
 * and `purchases`, and the rest from their own accounting tables. Live rows only — a trashed or deleted document
 * settles nothing.
 */
export async function accountingSource(): Promise<AccountingSource> {
  return {
    customers: mirror.parties("customer"), vendors: mirror.parties("vendor"),
    sales: mirror.sales(), purchases: mirror.purchases(),
    moneyAccounts: mirror.moneyAccounts(), moneyDocs: mirror.moneyDocs(),
    treasury: mirror.treasury(), vds: mirror.vds(),
    accountingConfig: mirror.accountingConfig(),
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The accounts and the money documents are rows now, but the in-memory copies stay: `settlementsOf` (which refuses to
 * cancel an invoice something has settled), the VAT returns, the VDS register, the compliance centre and a party's
 * credit all read them. A compat handler that writes through the mock's array — a restored backup, the demo runtime —
 * is written back here. See common/writeback.ts.
 */
const accountWb = new WriteBack<MoneyAccount>("money_accounts", () => mirror.moneyAccounts(), (a) => a.id)
export type MoneyAccountDelta = Delta<MoneyAccount>
export const markMoneyAccounts = (list: MoneyAccount[]) => accountWb.mark(list)
export const forgetMoneyAccount = (id: string) => accountWb.forget(id)
export const moneyAccountDelta = () => accountWb.delta()
export const commitMoneyAccountDelta = (d: MoneyAccountDelta) => accountWb.commit(d)

const moneyWb = new WriteBack<MoneyDoc>("money_docs", () => mirror.moneyDocs(), (m) => m.id)
export type MoneyDocDelta = Delta<MoneyDoc>
export const markMoneyDocs = (list: MoneyDoc[]) => moneyWb.mark(list)
export const forgetMoneyDoc = (id: string) => moneyWb.forget(id)
export const moneyDocDelta = () => moneyWb.delta()
export const commitMoneyDocDelta = (d: MoneyDocDelta) => moneyWb.commit(d)

/** The configuration is one row, so its write-back is a collection of one. */
const configWb = new WriteBack<AccountingConfig>("accounting_config", () => [mirror.accountingConfig()], () => "main")
export type AccountingConfigDelta = Delta<AccountingConfig>
export const markAccountingConfig = () => configWb.mark([mirror.accountingConfig()])
export const accountingConfigDelta = () => configWb.delta()
export const commitAccountingConfigDelta = (d: AccountingConfigDelta) => configWb.commit(d)

/**
 * Applies the three deltas inside the persist transaction and reads the saved rows back into memory, so a value a
 * column type rounded (money is numeric(18,2)) is not rewritten on every request.
 *
 * A document that left the in-memory list was deleted by a handler that still runs the mock's code: the row is
 * stamped exactly as the native delete stamps it — which is what keeps its id and its number retired — and the
 * write-back forgets it.
 */
export async function applyAccountingDeltas(tx: Tx, d: {
  accounts: MoneyAccountDelta; docs: MoneyDocDelta; config: AccountingConfigDelta
}) {
  for (const a of [...d.accounts.insert, ...d.accounts.update]) {
    const [row] = await tx.insert(moneyAccounts).values(moneyAccountValues(a))
      .onConflictDoUpdate({ target: moneyAccounts.id, set: moneyAccountValues(a) }).returning()
    mirror.putMoneyAccount(toMoneyAccount(row))
  }
  for (const id of d.accounts.missing) console.warn(`[money-accounts] ${id} vanished from the in-memory state`)
  for (const m of [...d.docs.insert, ...d.docs.update]) {
    const [row] = await tx.insert(moneyDocs).values(moneyDocValues(m))
      .onConflictDoUpdate({ target: moneyDocs.id, set: moneyDocValues(m) }).returning()
    mirror.putMoneyDoc(await replaceAllocations(tx, m, row))
  }
  for (const id of d.docs.missing) {
    const stored = moneyWb.stored(id)
    if (stored) {
      await tx.update(moneyDocs).set({ ...moneyDocValues(stored), deletedAt: new Date() }).where(eq(moneyDocs.id, id))
      moneyWb.forget(id)
      continue
    }
    console.warn(`[money-docs] ${id} vanished from the in-memory state and has no stored row`)
  }
  for (const c of [...d.config.insert, ...d.config.update]) {
    const values = accountingConfigValues(c)
    const [row] = await tx.insert(accountingConfig).values(values)
      .onConflictDoUpdate({ target: accountingConfig.id, set: values }).returning()
    mirror.putAccountingConfig(toAccountingConfig(row))
  }
}

/** Replaces a document's allocations with the ones it carries now, and reads both back. */
async function replaceAllocations(tx: Tx, m: MoneyDoc, row: MoneyDb): Promise<MoneyDoc> {
  await tx.delete(moneyAllocations).where(eq(moneyAllocations.docId, m.id))
  const values = moneyAllocationValues(m)
  const allocations = values.length ? (await tx.insert(moneyAllocations).values(values).returning()).map(toAllocation) : []
  return toMoneyDoc(row, allocations)
}

/** Header rows + their allocations → money documents, in the rows' order (the service and boot share it). */
export async function assembleMoneyDocs(rows: MoneyDb[]): Promise<MoneyDoc[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const allocationRows = await db.select().from(moneyAllocations).where(inArray(moneyAllocations.docId, ids))
    .orderBy(asc(moneyAllocations.docId), asc(moneyAllocations.ord))
  const byDoc = new Map<string, Allocation[]>()
  for (const r of allocationRows) {
    const a = byDoc.get(r.docId) ?? []
    a.push(toAllocation(r))
    byDoc.set(r.docId, a)
  }
  return rows.map((r) => toMoneyDoc(r, byDoc.get(r.id) ?? []))
}

/* ── the invoices a settlement moves ───────────────────────────────────── */

type Settled = { id: string; paid: number; due: number }
/** The sale and purchase rows a settled list touches, split the way the two tables need them. */
const splitSettled = (moved: (Sale | Purchase)[]) => ({
  sales: moved.filter((d): d is Sale => "customerId" in d).map((d) => ({ id: d.id, paid: d.paid, due: d.due })),
  purchases: moved.filter((d): d is Purchase => !("customerId" in d)).map((d) => ({ id: d.id, paid: d.paid, due: d.due })),
})

/** Writes the invoices a settlement moved, in the document's own transaction. */
async function writeSettlement(tx: Tx, moved: (Sale | Purchase)[]) {
  const { sales: s, purchases: p } = splitSettled(moved)
  await applySaleSettlement(tx, s)
  await applyPurchaseSettlement(tx, p)
}

/** A transaction that rolled back: put the invoices' counters back the way the rows have them. */
async function revertSettlement(moved: (Sale | Purchase)[]) {
  const { sales: s, purchases: p } = splitSettled(moved)
  await revertSaleSettlement(s)
  await revertPurchaseSettlement(p)
}

/* ── services ──────────────────────────────────────────────────────────── */

@Injectable()
export class MoneyAccountsService {
  /** Every account in insertion order — the order the mock's array had. */
  async all(): Promise<MoneyAccount[]> {
    return (await db.select().from(moneyAccounts).orderBy(asc(moneyAccounts.ord))).map(toMoneyAccount)
  }

  /** The register's rows: each account with the balance, the flows and the last date the mock's `accountRow` adds. */
  async rows(list?: MoneyAccount[]): Promise<MoneyAccountRow[]> {
    const c = compat()
    const src = await accountingSource()
    return (list ?? await this.all()).map((a) => c.accountRow(a, src))
  }

  find(id: string) {
    return this.first(eq(moneyAccounts.id, id))
  }

  private async first(match: SQL) {
    const [row] = await db.select().from(moneyAccounts).where(match)
    return row ? toMoneyAccount(row) : undefined
  }

  /** Stores a new account. `make` builds it once the id is known — inside the lock, so two creates cannot share one. */
  async create(make: (id: { id: string }) => MoneyAccount): Promise<MoneyAccount> {
    let made: MoneyAccount | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().accountIdentity())
        // claimed in memory first: a compat persist running mid-insert must not adopt the account twice
        mirror.putMoneyAccount(made)
        const [row] = await tx.insert(moneyAccounts).values(moneyAccountValues(made)).returning()
        return toMoneyAccount(row)
      })
      mirror.putMoneyAccount(saved)
      markMoneyAccounts([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeMoneyAccount(made.id); forgetMoneyAccount(made.id) }
      throw e as Error
    }
  }

  async update(a: MoneyAccount): Promise<MoneyAccount> {
    const saved = await db.transaction(async (tx) => {
      await lockState(tx)
      const [row] = await tx.update(moneyAccounts).set(moneyAccountValues(a)).where(eq(moneyAccounts.id, a.id)).returning()
      if (!row) throw new Problem(404, `${ACCOUNT_LABEL} not found`)
      return toMoneyAccount(row)
    })
    mirror.putMoneyAccount(saved)
    markMoneyAccounts([saved])
    return saved
  }

  /** Delete: the mock removed it from its array for good, and nothing quotes an account id back. */
  async remove(a: MoneyAccount) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.delete(moneyAccounts).where(eq(moneyAccounts.id, a.id))
    })
    mirror.removeMoneyAccount(a.id)
    forgetMoneyAccount(a.id)
  }
}

@Injectable()
export class MoneyDocsService {
  /** Every live document of one kind in insertion order — the order the mock's array had. */
  async all(kind: MoneyKind): Promise<MoneyDoc[]> {
    return assembleMoneyDocs(await db.select().from(moneyDocs)
      .where(sql`${moneyDocs.kind} = ${kind} and ${moneyDocs.deletedAt} is null`).orderBy(asc(moneyDocs.ord)))
  }

  /** One document by id or by number: the register, the audit trail and a party's statement link both. */
  find(idOrNo: string) {
    return this.first(sql`(${moneyDocs.id} = ${idOrNo} or ${moneyDocs.no} = ${idOrNo}) and ${moneyDocs.deletedAt} is null`)
  }

  /** One live document by id only — what a delete matches on. */
  byId(id: string) {
    return this.first(sql`${moneyDocs.id} = ${id} and ${moneyDocs.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(moneyDocs).where(match)
    return rows.length ? (await assembleMoneyDocs(rows))[0] : undefined
  }

  /**
   * Stores a new document with its allocations, and the invoices it settles when it is approved at once. `make`
   * builds it inside the lock, so two creates in flight cannot share a number, and returns the invoices the
   * settlement moved so they are written with it.
   */
  async create(kind: MoneyKind, date: string,
               make: (ident: { id: string; no: string }) => { doc: MoneyDoc; moved: (Sale | Purchase)[] }): Promise<MoneyDoc> {
    let made: MoneyDoc | undefined
    let moved: (Sale | Purchase)[] = []
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const built = make(compat().moneyIdentity(kind, date))
        made = built.doc
        moved = built.moved
        mirror.putMoneyDoc(made)
        const [row] = await tx.insert(moneyDocs).values(moneyDocValues(made)).returning()
        await writeSettlement(tx, moved)
        return replaceAllocations(tx, made, row)
      })
      mirror.putMoneyDoc(saved)
      markMoneyDocs([saved])
      return saved
    } catch (e) {
      if (made) { mirror.removeMoneyDoc(made.id); forgetMoneyDoc(made.id) }
      await revertSettlement(moved)
      MoneyDocsService.noConflict(e)
    }
  }

  /** Replaces a document and its allocations — an edit, a transition, or a settlement being applied or reversed. */
  async update(m: MoneyDoc, moved: (Sale | Purchase)[] = []): Promise<MoneyDoc> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(moneyDocs).set(moneyDocValues(m)).where(eq(moneyDocs.id, m.id)).returning()
        if (!row) throw new Problem(404, `${LABEL[m.kind]} not found`)
        await writeSettlement(tx, moved)
        return replaceAllocations(tx, m, row)
      })
      mirror.putMoneyDoc(saved)
      markMoneyDocs([saved])
      return saved
    } catch (e) {
      await revertSettlement(moved)
      throw e as Error
    }
  }

  /**
   * Delete a draft: the row is stamped and leaves the register. There is no undo for a money document, but the row
   * stays — the mock's id counter moved on when it was removed, so the row is what keeps a later document from
   * taking the same id.
   */
  async remove(m: MoneyDoc, at: string) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(moneyDocs).set({ ...moneyDocValues(m), deletedAt: new Date(at) }).where(eq(moneyDocs.id, m.id))
    })
    mirror.removeMoneyDoc(m.id)
    forgetMoneyDoc(m.id)
  }

  /** A duplicate number the application check missed (two requests at once) is a 409, not a 500. */
  private static noConflict(e: unknown): never {
    if (uniqueViolation(e) !== null) throw new Problem(409, "That number was just taken — please try again.")
    throw e as Error
  }
}

const LABEL: Record<MoneyKind, string> = { receipt: "Receipt", payment: "Payment" }

@Injectable()
export class AccountingConfigService {
  /** The one row. Boot writes it, so a missing row is the default (the books open, advances allowed). */
  async get(): Promise<AccountingConfig> {
    const [row] = await db.select().from(accountingConfig).where(eq(accountingConfig.id, 1))
    return row ? toAccountingConfig(row) : compat().DEFAULT_ACCOUNTING_CONFIG
  }

  async put(c: AccountingConfig): Promise<AccountingConfig> {
    const values = accountingConfigValues(c)
    const saved = await db.transaction(async (tx) => {
      await lockState(tx)
      const [row] = await tx.insert(accountingConfig).values(values)
        .onConflictDoUpdate({ target: accountingConfig.id, set: values }).returning()
      return toAccountingConfig(row)
    })
    mirror.putAccountingConfig(saved)
    markAccountingConfig()
    return saved
  }
}

/* ── controller: the money accounts ────────────────────────────────────── */

@Controller("api/v1/accounting/accounts")
export class MoneyAccountsController {
  constructor(
    @Inject(MoneyAccountsService) private readonly svc: MoneyAccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<MoneyAccountRow> with facets (kind / status) and the balances, or the accounts CSV. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "provider.asc")
    const r = runQuery(await this.svc.rows(), sp, c.accountSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.ACCOUNT_CSV_COLUMNS), c.ACCOUNT_CSV_NAME(today()))
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json(page)
  }

  @Post() @Authed("master.edit")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const built = c.parseAccount(jsonBody(req))
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const at = new Date().toISOString()
    const account = await this.svc.create((ident) => {
      const a: MoneyAccount = { ...built.fields, ...ident, createdAt: at, history: [] }
      c.claimAccountId()
      c.stampAccountHistory(a, user.name, "created", undefined, at)
      return a
    })
    await this.audit.record({
      at, actor: user, entity: "account", entityId: account.id, ref: c.accountRef(account), action: "created",
    })
    res.status(201).json(c.accountRow(account, await accountingSource()))
  }

  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const a = await this.svc.find(id)
    if (!a) throw new Problem(404, `${ACCOUNT_LABEL} not found`)
    res.json(c.accountRow(a, await accountingSource()))
  }

  @Put(":id") @Authed("master.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${ACCOUNT_LABEL} not found`)
    const built = c.parseAccount(jsonBody(req), cur)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const before = structuredClone(cur)
    const next: MoneyAccount = { ...cur, ...built.fields }
    // the mock's own PUT: an account carries no history entry for an update — only the audit event records it
    const at = new Date().toISOString()
    next.updatedAt = at
    const changes = c.diff(before, next, c.ACCOUNT_DIFF_FIELDS)
    const saved = await this.svc.update(next)
    const action = before.active !== saved.active ? (saved.active ? "activated" : "deactivated") : "updated"
    await this.audit.record({
      at, actor: req.dz!.user, entity: "account", entityId: saved.id, ref: c.accountRef(saved), action, changes,
    })
    res.json(c.accountRow(saved, await accountingSource()))
  }

  @Delete(":id") @Authed("master.edit")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, `${ACCOUNT_LABEL} not found`)
    const rule = c.accountDeleteRule(cur, await accountingSource())
    if (rule) throw new Problem(rule.status, rule.title, rule.errors)
    await this.svc.remove(cur)
    await this.audit.record({ actor: req.dz!.user, entity: "account", entityId: cur.id, ref: c.accountRef(cur), action: "deleted" })
    res.json({ ok: true })
  }
}

/* ── controller: the receipts and the payments ──────────────────────────── */

/**
 * The six endpoints of one money kind, generated twice — once for the receipts under `accounting/receipts` and once
 * for the payments under `accounting/payments`. The behaviour is shared with the mock handlers (see the header);
 * these only add storage, the state guard and the audit trail.
 */
function moneyController(kind: MoneyKind) {
  const label = LABEL[kind]
  const partyLabel = kind === "receipt" ? "customer" : "supplier"

  @Controller(`api/v1/accounting/${kind === "receipt" ? "receipts" : "payments"}`)
  class MoneyController {
    constructor(
      @Inject(MoneyDocsService) private readonly svc: MoneyDocsService,
      @Inject(AuditService) private readonly audit: AuditService,
    ) {}

    /** The register: Page<MoneyDoc> with facets (process / method / party / account), or one CSV row per document. `?invoice=` keeps the ones that settle an invoice. */
    @Get() @Authed()
    async list(@Req() req: Request, @Res() res: Response) {
      const c = compat()
      const sp = searchParams(req)
      if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
      const r = runQuery(c.moneyInvoiceFilter(kind, sp, await this.svc.all(kind)), sp, c.moneySpec)
      if (sp.get("format") === "csv") {
        sendCsv(res, toCSV(r.all, c.moneyCsvColumns(kind)), c.moneyCsvName(kind, today()))
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { all, ...page } = r
      res.json({ ...page, facetLabels: c.moneyFacetLabels(kind, await accountingSource()) })
    }

    /** Create a draft, or create and approve it in one step — which settles the invoices it allocates. */
    @Post() @Authed("doc.create")
    async create(@Req() req: AuthedRequest, @Res() res: Response) {
      const c = compat()
      const src = await accountingSource()
      const built = c.buildMoney(kind)(jsonBody(req), undefined, src)
      if ("status" in built) throw new Problem(built.status, built.title, built.errors)
      const user = req.dz!.user
      const approving = built.process === "Approved"
      if (approving) deny(user, "doc.approve")
      const at = new Date().toISOString()
      const doc = await this.svc.create(kind, built.date, (ident) => {
        const m: MoneyDoc = { ...built.fields, ...ident, process: "Created", createdAt: at, history: [] }
        // before the document exists: one that cannot be created must not consume an id
        c.claimMoneyId(kind)
        c.stampMoneyHistory(m, user.name, "created", undefined, at)
        if (!approving) return { doc: m, moved: [] }
        const rule = c.moneyApproveRule(m, src)
        if (rule) throw new Problem(rule.status, rule.title, rule.errors)
        m.process = "Approved"
        c.stampMoneyHistory(m, user.name, "approved", undefined, at)
        return { doc: m, moved: c.settle(m, 1, src) }
      })
      await this.audit.record({ at, actor: user, entity: kind, entityId: doc.id, ref: doc.no, action: "created" })
      const approved = doc.history?.find((h) => h.action === "approved")
      if (approved) await this.audit.record({ at: approved.at, actor: user, entity: kind, entityId: doc.id, ref: doc.no, action: "approved" })
      res.status(201).json(doc)
    }

    @Get(":id") @Authed()
    async one(@Param("id") id: string, @Res() res: Response) {
      const d = await this.svc.find(id)
      if (!d) throw new Problem(404, `${label} not found`)
      res.json(d)
    }

    /** Edit a draft (full replacement): the allocations it may settle are worked out again. */
    @Put(":id") @Authed("doc.edit")
    async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
      const c = compat()
      const cur = await this.svc.find(id)
      if (!cur) throw new Problem(404, `${label} not found`)
      if (cur.process !== "Created") throw new Problem(409, `Only drafts can be edited — ${cur.no} is ${cur.process}.`)
      const src = await accountingSource()
      const built = c.buildMoney(kind)(jsonBody(req), cur, src)
      if ("status" in built) throw new Problem(built.status, built.title, built.errors)
      const user = req.dz!.user
      const approving = built.process === "Approved"
      if (approving) deny(user, "doc.approve")
      const before = structuredClone(cur)
      const next: MoneyDoc = { ...cur, ...built.fields }
      const at = new Date().toISOString()
      c.stampMoneyHistory(next, user.name, "edited", undefined, at)
      const changes = c.diff(before, next, c.MONEY_DIFF_FIELDS)
      let approvedAt: string | undefined
      let moved: (Sale | Purchase)[] = []
      if (approving) {
        const rule = c.moneyApproveRule(next, src)
        if (rule) throw new Problem(rule.status, rule.title, rule.errors)
        next.process = "Approved"
        approvedAt = c.stampMoneyHistory(next, user.name, "approved")
        moved = c.settle(next, 1, src)
      }
      const saved = await this.svc.update(next, moved)
      await this.audit.record({ at, actor: user, entity: kind, entityId: saved.id, ref: saved.no, action: "edited", changes })
      if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: kind, entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
    }

    /** State transitions: approve (which settles the invoices it allocates), or cancel (which gives it back). */
    @Patch(":id") @Authed()
    async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
      const c = compat()
      const cur = await this.svc.find(id)
      if (!cur) throw new Problem(404, `${label} not found`)
      const body = jsonBody(req) as { process?: string; reason?: string }
      const user = req.dz!.user
      const src = await accountingSource()
      if (body.process === "Approved") {
        deny(user, "doc.approve")
        if (cur.process !== "Created") throw new Problem(409, `Cannot approve — ${cur.no} is ${cur.process}.`)
        const rule = c.moneyApproveRule(cur, src)
        if (rule) throw new Problem(rule.status, rule.title, rule.errors)
        const at = new Date().toISOString()
        const next = structuredClone(cur)
        next.process = "Approved"
        c.stampMoneyHistory(next, user.name, "approved", undefined, at)
        const saved = await this.svc.update(next, c.settle(next, 1, src))
        await this.audit.record({ at, actor: user, entity: kind, entityId: saved.id, ref: saved.no, action: "approved" })
        res.json(saved)
        return
      }
      if (body.process === "Cancelled") {
        deny(user, "doc.cancel")
        if (cur.process === "Cancelled") throw new Problem(409, `${cur.no} is already cancelled.`)
        const parsed = c.cancelInput.safeParse({ reason: body.reason ?? "" })
        if (!parsed.success) throw new Problem(422, "Validation failed", c.zodErrors(parsed.error))
        const rule = c.moneyCancelRule(cur, src)
        if (rule) throw new Problem(rule.status, rule.title, rule.errors)
        const at = new Date().toISOString()
        const next = structuredClone(cur)
        const reversed = next.process === "Approved" ? c.settle(next, -1, src) : []
        next.process = "Cancelled"
        next.cancelReason = parsed.data.reason
        c.stampMoneyHistory(next, user.name, "cancelled", parsed.data.reason, at)
        const saved = await this.svc.update(next, reversed)
        await this.audit.record({ at, actor: user, entity: kind, entityId: saved.id, ref: saved.no, action: "cancelled", note: parsed.data.reason })
        res.json(saved)
        return
      }
      throw new Problem(400, "process must be Approved or Cancelled")
    }

    /** Delete a draft: the row is stamped, so its id and its number stay retired. There is no undo. */
    @Delete(":id") @Authed("doc.delete")
    async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
      const c = compat()
      const cur = await this.svc.byId(id)
      if (!cur) throw new Problem(404, `${label} not found`)
      if (cur.process !== "Created") throw new Problem(409, `Only drafts can be deleted — cancel ${cur.no} instead.`)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      c.stampMoneyHistory(next, req.dz!.user.name, "deleted", undefined, at)
      await this.svc.remove(next, at)
      await this.audit.record({ at, actor: req.dz!.user, entity: kind, entityId: cur.id, ref: cur.no, action: "deleted" })
      res.json({ ok: true })
    }
  }
  // the party a receipt is taken from, or a payment made to — named once, for the messages above
  void partyLabel
  return MoneyController
}

export const ReceiptsController = moneyController("receipt")
export const PaymentsController = moneyController("payment")

/* ── controller: the open invoices, the statement and the configuration ─── */

/** `accounting/open-invoices` — the invoices of one party that can still take a receipt or a payment. */
@Controller("api/v1/accounting/open-invoices")
export class OpenInvoicesController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const r = c.openInvoiceParams(sp, await accountingSource())
    if ("status" in r) throw new Problem(r.status, r.title, r.errors)
    res.json(c.openInvoices(r.kind, r.party.id, await accountingSource()))
  }
}

/** `accounting/statement` — one party's ledger over a range, with the ageing of what is still open. */
@Controller("api/v1/accounting/statement")
export class StatementController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const src = await accountingSource()
    const r = c.statementParams(sp, src)
    if ("status" in r) throw new Problem(r.status, r.title, r.errors)
    const s: PartyStatement = c.statement(r.kind, r.party, r.from, r.to, src)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(s.rows, c.statementCsvColumns(r.kind)), c.statementCsvName(r.party, r.from, r.to))
      return
    }
    res.json(s)
  }
}

/** `accounting/config` — the one row that closes the books and permits advances. */
@Controller("api/v1/accounting/config")
export class AccountingConfigController {
  constructor(
    @Inject(AccountingConfigService) private readonly svc: AccountingConfigService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get() @Authed()
  async get(@Res() res: Response) { res.json(await this.svc.get()) }

  @Put() @Authed("settings.manage")
  async put(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const src = await accountingSource()
    const built = c.buildAccountingConfig(jsonBody(req), src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const before = { ...mirror.accountingConfig() }
    const at = new Date().toISOString()
    const saved = await this.svc.put({ ...built.fields, updatedAt: at, updatedBy: user.name })
    await this.audit.record({
      at, actor: user, entity: "accountingConfig", ref: "Accounting config", action: "updated",
      changes: c.accountingConfigDiff(before, saved),
    })
    res.json(saved)
  }
}
