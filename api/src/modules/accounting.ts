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
import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import type { Request, Response } from "express"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import type {
  AccountingConfig, Allocation, BankStatement, BankStatementLine, ChequeEvent, GlAccount, GlLedger, ManualJournalEntry, MoneyAccount, MoneyAccountRow, MoneyDoc, MoneyKind, MoneyTransfer, Party, PartyStatement, Purchase, Sale,
} from "@/lib/types"
import { chequeRowsOf } from "@/lib/money-ops"
import type { AccountingSource } from "@/app/api/v1/_r4"
import type { GlSource } from "@/lib/gl"
import { chartOf, journalOf, ledgerOf } from "@/lib/gl"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack, type Delta } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { accountingConfig, bankStatementLines, bankStatements, chequeEvents, glAccounts, journalEntries, moneyAccounts, moneyAllocations, moneyDocs, moneyTransfers } from "../db/schema"
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
    createdAt: r.createdAt.toISOString(),
  }
  // a seeded account has no trail yet, and the mock omits the field rather than answering an empty one
  if (r.history != null) a.history = r.history
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
    // R9.1: the transfers move the derived balances; the cheque events feed the register
    moneyTransfers: mirror.moneyTransfers(), chequeEvents: mirror.chequeEvents(),
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
export async function writeSettlement(tx: Tx, moved: (Sale | Purchase)[]) {
  const { sales: s, purchases: p } = splitSettled(moved)
  await applySaleSettlement(tx, s)
  await applyPurchaseSettlement(tx, p)
}

/** A transaction that rolled back: put the invoices' counters back the way the rows have them. */
export async function revertSettlement(moved: (Sale | Purchase)[]) {
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

/* ── R8.2: bank statements — import, match, reconcile ──────────────────── */

type StatementDb = typeof bankStatements.$inferSelect
type StatementLineDb = typeof bankStatementLines.$inferSelect

/** Header row → contract shape. */
const toBankStatement = (r: StatementDb): BankStatement => {
  const s: BankStatement = {
    id: r.id, no: r.no, accountId: r.accountId, accountName: r.accountName, source: r.source,
    from: r.from, to: r.to, importedAt: r.importedAt.toISOString(), importedBy: r.importedBy,
    lineCount: r.lineCount, totals: { deposit: r.depositTotal, withdrawal: r.withdrawalTotal },
  }
  if (r.closingBalance != null) s.closingBalance = r.closingBalance
  if (r.note != null) s.note = r.note
  return s
}
/** Contract shape → header row values (`ord` is the table's own). */
const bankStatementValues = (s: BankStatement) => ({
  id: s.id, no: s.no, accountId: s.accountId, accountName: s.accountName, source: s.source,
  from: s.from, to: s.to, closingBalance: s.closingBalance ?? null, importedAt: new Date(s.importedAt),
  importedBy: s.importedBy, lineCount: s.lineCount, depositTotal: s.totals.deposit, withdrawalTotal: s.totals.withdrawal,
  note: s.note ?? null,
})
/** Line row → contract shape. */
const toBankLine = (r: StatementLineDb): BankStatementLine => {
  const l: BankStatementLine = {
    id: r.id, statementId: r.statementId, rowNo: r.rowNo, date: r.date, narration: r.narration,
    deposit: r.deposit, withdrawal: r.withdrawal, status: r.status,
  }
  if (r.reference != null) l.reference = r.reference
  if (r.chequeNo != null) l.chequeNo = r.chequeNo
  if (r.matchKind != null) l.matchKind = r.matchKind
  if (r.matchId != null) l.matchId = r.matchId
  if (r.matchNo != null) l.matchNo = r.matchNo
  if (r.moneyId != null) l.moneyId = r.moneyId
  if (r.moneyNo != null) l.moneyNo = r.moneyNo
  if (r.note != null) l.note = r.note
  return l
}
/** Contract shape → line row values (`ord` is the line's place on the sheet). */
const bankLineValues = (l: BankStatementLine) => ({
  id: l.id, statementId: l.statementId, ord: l.rowNo, rowNo: l.rowNo, date: l.date, narration: l.narration,
  reference: l.reference ?? null, chequeNo: l.chequeNo ?? null, deposit: l.deposit, withdrawal: l.withdrawal,
  status: l.status, matchKind: l.matchKind ?? null, matchId: l.matchId ?? null, matchNo: l.matchNo ?? null,
  moneyId: l.moneyId ?? null, moneyNo: l.moneyNo ?? null, note: l.note ?? null,
})

@Injectable()
export class BankStatementsService {
  /** Every statement in insertion order, newest first on the register (the `no.desc` default sort). */
  async all(): Promise<BankStatement[]> {
    return (await db.select().from(bankStatements).orderBy(asc(bankStatements.ord))).map(toBankStatement)
  }

  async byId(id: string): Promise<BankStatement | undefined> {
    const [row] = await db.select().from(bankStatements).where(eq(bankStatements.id, id))
    return row ? toBankStatement(row) : undefined
  }

  async lines(statementId: string): Promise<BankStatementLine[]> {
    return (await db.select().from(bankStatementLines).where(eq(bankStatementLines.statementId, statementId)).orderBy(asc(bankStatementLines.ord))).map(toBankLine)
  }

  /**
   * Stores an applied import: the header and its lines in one transaction, the id and the number claimed inside
   * the lock so two imports in flight cannot share either. `make` builds them with the identity it is handed.
   */
  async create(make: (ident: { id: string; no: string }) => { statement: BankStatement; lines: BankStatementLine[] }): Promise<{ statement: BankStatement; lines: BankStatementLine[] }> {
    try {
      return await db.transaction(async (tx) => {
        await lockState(tx)
        // the id counter the mock keeps in db.seq.statement, derived from the rows themselves
        const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${bankStatements.id}, '\\D', '', 'g'), '')::bigint), 0) + 1` }).from(bankStatements)
        const built = make({ id: `bs${n}`, no: "" })
        const nos = await tx.select({ no: bankStatements.no }).from(bankStatements)
        built.statement.no = `BS-${built.statement.to.slice(5, 7)}${built.statement.to.slice(2, 4)}${String(
          nos.reduce((m, r) => r.no.startsWith(`BS-${built.statement.to.slice(5, 7)}${built.statement.to.slice(2, 4)}`) ? Math.max(m, Number(r.no.slice(9)) || 0) : m, 0) + 1,
        ).padStart(4, "0")}`
        const lines = built.lines.map((l) => ({ ...l, statementId: built.statement.id, id: `bl${built.statement.id.slice(2)}-${l.rowNo}` }))
        const [row] = await tx.insert(bankStatements).values(bankStatementValues(built.statement)).returning()
        for (let i = 0; i < lines.length; i += 500) await tx.insert(bankStatementLines).values(lines.slice(i, i + 500).map(bankLineValues))
        return { statement: toBankStatement(row), lines }
      })
    } catch (e) {
      if (uniqueViolation(e) !== null) throw new Problem(409, "That statement number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Park an open line (bank charge / ignore) or reopen it — one row, one transaction. */
  async patchLine(statementId: string, lineId: string, patch: { status: BankStatementLine["status"]; note?: string }): Promise<BankStatementLine | undefined> {
    const [row] = await db.update(bankStatementLines)
      .set({ status: patch.status, note: patch.note || null })
      .where(sql`${bankStatementLines.id} = ${lineId} and ${bankStatementLines.statementId} = ${statementId}`).returning()
    return row ? toBankLine(row) : undefined
  }

  /** Link a money document back to the line it was created from. */
  async linkLine(statementId: string, lineId: string, m: MoneyDoc): Promise<BankStatementLine | undefined> {
    const [row] = await db.update(bankStatementLines)
      .set({ status: "receipt", matchKind: m.kind, matchId: m.id, matchNo: m.no, moneyId: m.id, moneyNo: m.no })
      .where(sql`${bankStatementLines.id} = ${lineId} and ${bankStatementLines.statementId} = ${statementId}`).returning()
    return row ? toBankLine(row) : undefined
  }
}

/** `accounting/statements` — the imported statements, their lines and the books-vs-bank answer. */
@Controller("api/v1/accounting/statements")
export class BankStatementsController {
  constructor(
    @Inject(BankStatementsService) private readonly svc: BankStatementsService,
    @Inject(MoneyDocsService) private readonly money: MoneyDocsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<BankStatement> with the `?account=` facet. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "no.desc")
    // search, the importedAt range, the account facet and the no.desc default all run through the
    // mock's own query engine, so the register cannot drift between the two runtimes — not even its order
    const r = runQuery(await this.svc.all(), sp, c.statementSpec)
    const accounts = await db.select().from(moneyAccounts).orderBy(asc(moneyAccounts.ord))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: { account: Object.fromEntries(accounts.map((a) => [a.id, `${a.provider} · ${a.accountNo}`])) } })
  }

  /**
   * Import a statement. `dryRun` (the default) analyses the rows and answers with the plan; `dryRun: false`
   * stores the statement and its lines all-or-nothing. The rules — what a row may hold, what a line matches —
   * are the mock's own, served through the compat bundle.
   */
  /** `@HttpCode(200)`: a dry run is a plan, not a creation — the apply below sets its own 201. */
  @Post() @HttpCode(200) @Authed("doc.create")
  async import(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const parsed = c.statementInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", c.zodErrors(parsed.error))
    const src = await accountingSource()
    const planned = c.planStatement(parsed.data.accountId, parsed.data.rows, src)
    if ("status" in planned) throw new Problem(planned.status, planned.title, planned.errors)
    if (planned.plan.issues.length)
      throw new Problem(422, "Validation failed", Object.fromEntries(planned.plan.issues.slice(0, 20).map((i) => [`row ${i.row}`, [i.message]])))
    const answer = c.planAnswer(planned, { ...planned.plan, source: parsed.data.source }, parsed.data.rows.length)
    if (parsed.data.dryRun) { res.json(answer); return }
    const user = req.dz!.user
    const at = new Date().toISOString()
    const { statement, lines } = await this.svc.create((ident) => {
      const s: BankStatement = {
        id: ident.id, no: ident.no, accountId: planned.plan.accountId, accountName: planned.plan.accountName,
        source: parsed.data.source || `statement-${planned.plan.to}`, from: planned.plan.from, to: planned.plan.to,
        closingBalance: parsed.data.closingBalance, importedAt: at, importedBy: user.name,
        lineCount: planned.plan.lines.length, totals: planned.plan.totals,
      }
      return { statement: s, lines: planned.plan.lines.map((l) => ({ ...l, suggestion: undefined })) }
    })
    await this.audit.record({ at, actor: user, entity: "statement", entityId: statement.id, ref: statement.no, action: "created", note: `${lines.length} lines, ${answer.matched} matched` })
    res.status(201).json({ ...answer, id: statement.id, no: statement.no })
  }

  /** One statement with its lines and the books-vs-bank answer (open lines carry a fresh suggestion). */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const c = compat()
    const s = await this.svc.byId(id)
    if (!s) throw new Problem(404, "Statement not found")
    const src = await accountingSource()
    const lines = (await this.svc.lines(id)).map((l) => ({ ...l, suggestion: l.status === "open" ? c.matchBankLine(l, s.accountId, src).suggestion : undefined }))
    res.json(c.statementView(s, lines, src))
  }

  /** Park an open line as a bank charge, ignore it, or reopen it. */
  @Patch(":id/lines/:lineId") @Authed("doc.edit")
  async patchLine(@Req() req: AuthedRequest, @Param("id") id: string, @Param("lineId") lineId: string, @Res() res: Response) {
    const body = jsonBody(req) as { status?: string; note?: string }
    if (body.status !== "open" && body.status !== "charge" && body.status !== "ignored")
      throw new Problem(422, "Validation failed", { status: ["invalid"] })
    const existing = (await this.svc.lines(id)).find((l) => l.id === lineId)
    if (!existing) throw new Problem(404, "Statement line not found")
    if (existing.status === "matched") throw new Problem(409, "This line is already explained by the books.")
    if (existing.moneyId) throw new Problem(409, `A money document was already created from this line (${existing.moneyNo}) — cancel it first.`)
    const line = await this.svc.patchLine(id, lineId, { status: body.status, note: body.note })
    if (!line) throw new Problem(404, "Statement line not found")
    res.json(line)
  }

  /** Create the receipt / voucher an open line is about — through the ordinary creators, then linked back. */
  @Post(":id/lines/:lineId/receipt") @Authed("doc.create")
  async createFromLine(@Req() req: AuthedRequest, @Param("id") id: string, @Param("lineId") lineId: string, @Res() res: Response) {
    const c = compat()
    const body = jsonBody(req) as { kind?: string; process?: string } & Record<string, unknown>
    const kind: MoneyKind = body.kind === "payment" ? "payment" : "receipt"
    if (body.process === "Approved") throw new Problem(422, "Create the line's receipt as a draft first, then approve it in the register.")
    const s = await this.svc.byId(id)
    if (!s) throw new Problem(404, "Statement not found")
    const line = (await this.svc.lines(id)).find((l) => l.id === lineId)
    if (!line) throw new Problem(404, "Statement line not found")
    if (line.status === "matched") throw new Problem(409, "This line is already explained by the books.")
    if (line.moneyId) throw new Problem(409, `A ${kind} was already created from this line (${line.moneyNo}).`)
    if (line.status === "charge" || line.status === "ignored") throw new Problem(409, `This line is parked as ${line.status === "charge" ? "a bank charge" : "ignored"} — reopen it first.`)
    const src = await accountingSource()
    const method = (body.method as string) ?? (line.chequeNo ? "cheque" : "bankTransfer")
    const reference = String(body.reference ?? "") || line.reference || ((method === "bankTransfer" || method === "mobile") ? `BS line ${line.rowNo}` : "")
    const built = c.buildMoney(kind)({
      ...body, kind: undefined,
      reference,
      note: body.note ?? `Bank statement ${line.statementId} line ${line.rowNo}: ${line.narration}`.slice(0, 250),
    }, undefined, src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const at = new Date().toISOString()
    const doc = await this.money.create(kind, built.date, (ident) => {
      const m: MoneyDoc = { ...built.fields, ...ident, process: "Created", createdAt: at, history: [] } as MoneyDoc
      c.claimMoneyId(kind)
      c.stampMoneyHistory(m, user.name, "created", undefined, at)
      return { doc: m, moved: [] }
    })
    await this.audit.record({ at, actor: user, entity: kind, entityId: doc.id, ref: doc.no, action: "created", note: `from bank statement ${line.statementId} line ${line.rowNo}` })
    const linked = await this.svc.linkLine(id, lineId, doc)
    if (!linked) throw new Problem(404, "Statement line not found")
    res.status(201).json(doc)
  }
}

/* ── R9.1: the transfers between the company's own accounts ────────────── */

type TransferDb = typeof moneyTransfers.$inferSelect
type ChequeEventDb = typeof chequeEvents.$inferSelect

/** Row → contract shape. A NULL column is an absent optional field. */
export function toMoneyTransfer(r: TransferDb): MoneyTransfer {
  const t: MoneyTransfer = {
    id: r.id, no: r.no, date: r.date, fromAccountId: r.fromAccountId, fromAccount: r.fromAccount,
    toAccountId: r.toAccountId, toAccount: r.toAccount, amount: r.amount, charge: r.charge,
    process: r.process, issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.reference != null) t.reference = r.reference
  if (r.note != null) t.note = r.note
  if (r.updatedAt) t.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) t.cancelReason = r.cancelReason
  return t
}

/** Contract shape → row values (`ord` and `deletedAt` are the table's own). */
export const moneyTransferValues = (t: MoneyTransfer) => ({
  id: t.id, no: t.no, date: t.date, fromAccountId: t.fromAccountId, fromAccount: t.fromAccount,
  toAccountId: t.toAccountId, toAccount: t.toAccount, amount: t.amount, charge: t.charge,
  reference: t.reference ?? null, note: t.note ?? null, process: t.process, issuedBy: t.issuedBy,
  createdAt: new Date(t.createdAt), updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
  cancelReason: t.cancelReason ?? null, history: t.history ?? [],
})

const transferWb = new WriteBack<MoneyTransfer>("money_transfers", () => mirror.moneyTransfers(), (t) => t.id)
export type MoneyTransferDelta = Delta<MoneyTransfer>
export const markMoneyTransfers = (list: MoneyTransfer[]) => transferWb.mark(list)
export const moneyTransferDelta = () => transferWb.delta()
export const commitMoneyTransferDelta = (d: MoneyTransferDelta) => transferWb.commit(d)

/** Row → contract shape. */
export const toChequeEvent = (r: ChequeEventDb): ChequeEvent =>
  ({ id: r.id, chequeId: r.chequeId, action: r.action, date: r.date, ...(r.reason != null ? { reason: r.reason } : {}), by: r.by, at: r.at.toISOString() })

/** Contract shape → row values. */
export const chequeEventValues = (e: ChequeEvent) =>
  ({ id: e.id, chequeId: e.chequeId, action: e.action, date: e.date, reason: e.reason ?? null, by: e.by, at: new Date(e.at) })

@Injectable()
export class TransfersService {
  /** Every live transfer in insertion order — the order the mock's array had. */
  async all(): Promise<MoneyTransfer[]> {
    return (await db.select().from(moneyTransfers).where(isNull(moneyTransfers.deletedAt)).orderBy(asc(moneyTransfers.ord))).map(toMoneyTransfer)
  }

  /** One transfer by id or by number: the register, the audit trail and the account page's links all use both. */
  find(idOrNo: string) {
    return this.first(sql`(${moneyTransfers.id} = ${idOrNo} or ${moneyTransfers.no} = ${idOrNo}) and ${moneyTransfers.deletedAt} is null`)
  }

  /** One live transfer by id only — what a delete matches on. */
  byId(id: string) {
    return this.first(sql`${moneyTransfers.id} = ${id} and ${moneyTransfers.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(moneyTransfers).where(match)
    return rows.length ? toMoneyTransfer(rows[0]) : undefined
  }

  /** Stores a new transfer. `make` builds it inside the lock, so two creates in flight cannot share a number. */
  async create(date: string, make: (ident: { id: string; no: string }) => MoneyTransfer): Promise<MoneyTransfer> {
    let made: MoneyTransfer | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().transferIdentity(date))
        const [row] = await tx.insert(moneyTransfers).values(moneyTransferValues(made)).returning()
        return toMoneyTransfer(row)
      })
      mirror.putMoneyTransfer(saved)
      markMoneyTransfers([saved])
      return saved
    } catch (e) {
      if (made) mirror.removeMoneyTransfer(made.id)
      if (uniqueViolation(e) !== null) throw new Problem(409, "That number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces a transfer — an edit or a transition. */
  async update(t: MoneyTransfer): Promise<MoneyTransfer> {
    const [row] = await db.update(moneyTransfers).set(moneyTransferValues(t)).where(eq(moneyTransfers.id, t.id)).returning()
    if (!row) throw new Problem(404, "Transfer not found")
    const saved = toMoneyTransfer(row)
    mirror.putMoneyTransfer(saved)
    markMoneyTransfers([saved])
    return saved
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. There is no undo. */
  async remove(t: MoneyTransfer, at: string) {
    await db.update(moneyTransfers).set({ ...moneyTransferValues(t), deletedAt: new Date(at) }).where(eq(moneyTransfers.id, t.id))
    mirror.removeMoneyTransfer(t.id)
  }
}

@Injectable()
export class ChequeEventsService {
  /** Every lifecycle event, oldest first — the register folds them in this order. */
  async all(): Promise<ChequeEvent[]> {
    return (await db.select().from(chequeEvents).orderBy(asc(chequeEvents.at))).map(toChequeEvent)
  }

  /** Appends one event inside the caller's lock and mirrors it. The next `chq{n}` comes from the table's rows. */
  async append(tx: Tx, e: Omit<ChequeEvent, "id">): Promise<ChequeEvent> {
    const rows = await tx.select({ id: chequeEvents.id }).from(chequeEvents)
    const n = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0) + 1
    const event: ChequeEvent = { ...e, id: `chq${n}` }
    await tx.insert(chequeEvents).values(chequeEventValues(event))
    mirror.appendChequeEvent(event)
    return event
  }
}

@Controller("api/v1/accounting/transfers")
export class AccountTransfersController {
  constructor(
    @Inject(TransfersService) private readonly svc: TransfersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<MoneyTransfer> with facets (process / from / to), or one CSV row per document. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(await this.svc.all(), sp, c.transferSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.TRANSFER_CSV_COLUMNS), `account-transfers-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: c.transferFacetLabels() })
  }

  /** Create a draft, or create and approve it in one step. Approving writes nothing but the row — the balances derive. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const src = await accountingSource()
    const built = c.buildTransfer(jsonBody(req), undefined, src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const at = new Date().toISOString()
    const doc = await this.svc.create(built.date, (ident) => {
      const t: MoneyTransfer = { ...built.fields, ...ident, process: "Created", createdAt: at, history: [] }
      // before the document exists: one that cannot be created must not consume an id
      c.claimTransferId()
      c.stampLifeHistory(t, user.name, "created", undefined, at)
      if (!approving) return t
      const rule = c.transferApproveRule(t, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      t.process = "Approved"
      c.stampLifeHistory(t, user.name, "approved", undefined, at)
      return t
    })
    await this.audit.record({ at, actor: user, entity: "moneyTransfer", entityId: doc.id, ref: doc.no, action: "created" })
    const approved = doc.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: "moneyTransfer", entityId: doc.id, ref: doc.no, action: "approved" })
    res.status(201).json(doc)
  }

  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const d = await this.svc.find(id)
    if (!d) throw new Problem(404, "Transfer not found")
    res.json(d)
  }

  /** Edit a draft (full replacement): the accounts it names cannot change. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, "Transfer not found")
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be edited — ${cur.no} is ${cur.process}.`)
    const src = await accountingSource()
    const built = c.buildTransfer(jsonBody(req), cur, src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next: MoneyTransfer = { ...cur, ...built.fields }
    const at = new Date().toISOString()
    c.stampLifeHistory(next, user.name, "edited", undefined, at)
    const changes = c.diff(before, next, c.TRANSFER_DIFF_FIELDS)
    let approvedAt: string | undefined
    if (approving) {
      const rule = c.transferApproveRule(next, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      next.process = "Approved"
      approvedAt = c.stampLifeHistory(next, user.name, "approved")
    }
    const saved = await this.svc.update(next)
    await this.audit.record({ at, actor: user, entity: "moneyTransfer", entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: "moneyTransfer", entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve or cancel with a reason. The books must be open for the transfer's date either way. */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, "Transfer not found")
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    const src = await accountingSource()
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      if (cur.process !== "Created") throw new Problem(409, `Cannot approve — ${cur.no} is ${cur.process}.`)
      const rule = c.transferApproveRule(cur, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      c.stampLifeHistory(next, user.name, "approved", undefined, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "moneyTransfer", entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      if (cur.process === "Cancelled") throw new Problem(409, `${cur.no} is already cancelled.`)
      const parsed = c.cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!parsed.success) throw new Problem(422, "Validation failed", c.zodErrors(parsed.error))
      const rule = c.transferCancelRule(cur, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Cancelled"
      next.cancelReason = parsed.data.reason
      c.stampLifeHistory(next, user.name, "cancelled", parsed.data.reason, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "moneyTransfer", entityId: saved.id, ref: saved.no, action: "cancelled", note: parsed.data.reason })
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
    if (!cur) throw new Problem(404, "Transfer not found")
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be deleted — cancel ${cur.no} instead.`)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampLifeHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: "moneyTransfer", entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}

/**
 * R9.1 — the cheque register: the rows derive from the approved cheque money documents (the mock's own fold,
 * through the compat bundle) and the lifecycle events append here. The register is a read model, so this
 * controller has two endpoints: the register itself and one lifecycle action.
 */
@Controller("api/v1/accounting/cheques")
export class ChequesController {
  constructor(
    @Inject(ChequeEventsService) private readonly events: ChequeEventsService,
    @Inject(MoneyDocsService) private readonly money: MoneyDocsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<ChequeRow> with facets (kind / status / party / account), or one CSV row per cheque. `?postDated=true` narrows to the post-dated view. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const moneyDocs = [...await this.money.all("receipt"), ...await this.money.all("payment")]
    let rows = chequeRowsOf({ moneyDocs, chequeEvents: await this.events.all() }, today())
    if (sp.get("postDated") === "true") {
      sp.delete("postDated")
      rows = rows.filter((r) => r.postDated)
    }
    const r = runQuery(rows, sp, c.chequeSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.CHEQUE_CSV_COLUMNS), `cheque-register-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: {} })
  }

  /** A lifecycle action on one cheque (present / clear / bounce): one append-only event, audited. */
  @Post(":id/action") @Authed("doc.edit")
  async action(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const moneyDocs = [...await this.money.all("receipt"), ...await this.money.all("payment")]
    const row = chequeRowsOf({ moneyDocs, chequeEvents: await this.events.all() }, today()).find((r) => r.id === id || r.no === id)
    const r = c.chequeActionRule(row, jsonBody(req))
    if ("status" in r) throw new Problem(r.status, r.title, r.errors)
    const user = req.dz!.user
    const at = new Date().toISOString()
    const event = await db.transaction(async (tx) => {
      await lockState(tx)
      return this.events.append(tx, { chequeId: row!.id, action: r.action, date: r.date, reason: r.reason, by: user.name, at })
    })
    await this.audit.record({ at, actor: user, entity: "cheque", entityId: row!.id, ref: row!.no, action: r.action, note: r.reason })
    const fresh = chequeRowsOf({ moneyDocs, chequeEvents: await this.events.all() }, today()).find((x) => x.id === row!.id)
    res.status(201).json(fresh)
  }
}

/* ── R9.2: the general ledger ─────────────────────────────────────────── */

type GlAccountDb = typeof glAccounts.$inferSelect
type JournalDb = typeof journalEntries.$inferSelect

/** Row → contract shape. A NULL column is an absent optional field. */
export function toGlAccount(r: GlAccountDb): GlAccount {
  const a: GlAccount = { code: r.code, name: r.name, kind: r.kind, group: r.group, active: r.active }
  if (r.moneyAccountId != null) a.moneyAccountId = r.moneyAccountId
  if (r.note != null) a.note = r.note
  return a
}

/** Contract shape → row values. The row's id is its code — the codes are unique, and the chart's own identity. */
export const glAccountValues = (a: GlAccount) =>
  ({ id: a.code, code: a.code, name: a.name, kind: a.kind, group: a.group, moneyAccountId: a.moneyAccountId ?? null, active: a.active, note: a.note ?? null })

/** Row → contract shape: the entry with its source derived from its own identity (a manual entry is its own source). */
export function toJournalEntry(r: JournalDb): ManualJournalEntry {
  const j: ManualJournalEntry = {
    id: r.id, no: r.no, date: r.date, memo: r.memo, lines: r.lines,
    source: { kind: "manual", id: r.id, no: r.no },
    process: r.process, issuedBy: r.issuedBy, createdAt: r.createdAt.toISOString(), history: r.history ?? [],
  }
  if (r.updatedAt) j.updatedAt = r.updatedAt.toISOString()
  if (r.cancelReason != null) j.cancelReason = r.cancelReason
  return j
}

/** Contract shape → row values (`ord` and `deletedAt` are the table's own). */
export const journalEntryValues = (j: ManualJournalEntry) => ({
  id: j.id, no: j.no, date: j.date, memo: j.memo, lines: j.lines,
  process: j.process, issuedBy: j.issuedBy,
  createdAt: new Date(j.createdAt), updatedAt: j.updatedAt ? new Date(j.updatedAt) : null,
  cancelReason: j.cancelReason ?? null, history: j.history ?? [],
})

const journalWb = new WriteBack<ManualJournalEntry>("journal_entries", () => mirror.journalEntries(), (j) => j.id)
export type JournalDelta = Delta<ManualJournalEntry>
export const markJournalEntries = (list: ManualJournalEntry[]) => journalWb.mark(list)
export const journalDelta = () => journalWb.delta()
export const commitJournalDelta = (d: JournalDelta) => journalWb.commit(d)

/** What the ledger derives from, straight out of the mirrors: every collection the posting rules fold. */
export async function glSource(): Promise<GlSource> {
  return {
    customers: mirror.parties("customer"), vendors: mirror.parties("vendor"),
    sales: mirror.sales(), purchases: mirror.purchases(),
    creditNotes: mirror.creditNotes(), debitNotes: mirror.debitNotes(), openings: mirror.openings(),
    moneyAccounts: mirror.moneyAccounts(), moneyDocs: mirror.moneyDocs(),
    moneyTransfers: mirror.moneyTransfers(), treasury: mirror.treasury(), vds: mirror.vds(),
    adjustments: mirror.adjustments(), glAccounts: mirror.glAccounts(), journalEntries: mirror.journalEntries(),
    accountingConfig: mirror.accountingConfig(),
  }
}

@Injectable()
export class JournalService {
  /** Every live manual entry in insertion order — the order the mock's array had. */
  async all(): Promise<ManualJournalEntry[]> {
    return (await db.select().from(journalEntries).where(isNull(journalEntries.deletedAt)).orderBy(asc(journalEntries.ord))).map(toJournalEntry)
  }

  /** One entry by id or by number: the register's drill and the audit trail both use both. */
  find(idOrNo: string) {
    return this.first(sql`(${journalEntries.id} = ${idOrNo} or ${journalEntries.no} = ${idOrNo}) and ${journalEntries.deletedAt} is null`)
  }

  /** One live entry by id only — what a delete matches on. */
  byId(id: string) {
    return this.first(sql`${journalEntries.id} = ${id} and ${journalEntries.deletedAt} is null`)
  }

  private async first(match: SQL) {
    const rows = await db.select().from(journalEntries).where(match)
    return rows.length ? toJournalEntry(rows[0]) : undefined
  }

  /** Stores a new entry. `make` builds it inside the lock, so two creates in flight cannot share a number. */
  async create(date: string, make: (ident: { id: string; no: string }) => ManualJournalEntry): Promise<ManualJournalEntry> {
    let made: ManualJournalEntry | undefined
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        made = make(compat().journalIdentity(date))
        const [row] = await tx.insert(journalEntries).values(journalEntryValues(made)).returning()
        return toJournalEntry(row)
      })
      mirror.putJournalEntry(saved)
      markJournalEntries([saved])
      return saved
    } catch (e) {
      if (made) mirror.removeJournalEntry(made.id)
      if (uniqueViolation(e) !== null) throw new Problem(409, "That number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces an entry — an edit or a transition. */
  async update(j: ManualJournalEntry): Promise<ManualJournalEntry> {
    const [row] = await db.update(journalEntries).set(journalEntryValues(j)).where(eq(journalEntries.id, j.id)).returning()
    if (!row) throw new Problem(404, "Journal entry not found")
    const saved = toJournalEntry(row)
    mirror.putJournalEntry(saved)
    markJournalEntries([saved])
    return saved
  }

  /** Delete a draft: the row is stamped, so its id and its number stay retired. There is no undo. */
  async remove(j: ManualJournalEntry, at: string) {
    await db.update(journalEntries).set({ ...journalEntryValues(j), deletedAt: new Date(at) }).where(eq(journalEntries.id, j.id))
    mirror.removeJournalEntry(j.id)
  }
}

/** R9.2 — the chart of accounts: the template plus the money accounts' own rows, each with its derived movement. */
@Controller("api/v1/accounting/chart")
export class ChartController {
  /** The chart, or one CSV row per account. The movements are derived at read time — nothing is stored but the rows' identity. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const rows = chartOf(await glSource())
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(rows, c.CHART_CSV_COLUMNS), `chart-of-accounts-${today()}.csv`)
      return
    }
    res.json(rows)
  }
}

/**
 * R9.2 — the journal register and the manual entries. The register is a read model: every posting, derived and
 * manual, folded from the documents at read time (`journalRows`); the write side is the JE- series alone, with the
 * draft → approve → cancel lifecycle every document has. A derived entry's drill goes to its source document.
 */
@Controller("api/v1/accounting/journal")
export class JournalController {
  constructor(
    @Inject(JournalService) private readonly svc: JournalService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: Page<JournalRow> with facets (source / process), or one CSV row per entry. `?account={code}` narrows to one account's entries. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    let rows = c.journalRows(await glSource())
    const account = sp.get("account")
    if (account) {
      sp.delete("account")
      rows = rows.filter((r) => r.accounts.includes(account))
    }
    const r = runQuery(rows, sp, c.journalSpec)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.JOURNAL_CSV_COLUMNS), `journal-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, facetLabels: { source: c.SOURCE_KIND_LABELS } })
  }

  /** Create a draft, or create and approve it in one step. The lines must balance and name open chart accounts. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const src = await glSource()
    const built = c.buildJournal(jsonBody(req), undefined, src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const at = new Date().toISOString()
    const doc = await this.svc.create(built.date, (ident) => {
      const j: ManualJournalEntry = {
        ...built.fields, ...ident, source: { kind: "manual", ...ident },
        process: "Created", createdAt: at, history: [],
      }
      // before the document exists: one that cannot be created must not consume an id
      c.claimJournalId()
      c.stampLifeHistory(j, user.name, "created", undefined, at)
      if (!approving) return j
      const rule = c.journalApproveRule(j, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      j.process = "Approved"
      c.stampLifeHistory(j, user.name, "approved", undefined, at)
      return j
    })
    await this.audit.record({ at, actor: user, entity: "journal", entityId: doc.id, ref: doc.no, action: "created" })
    const approved = doc.history?.find((h) => h.action === "approved")
    if (approved) await this.audit.record({ at: approved.at, actor: user, entity: "journal", entityId: doc.id, ref: doc.no, action: "approved" })
    res.status(201).json(doc)
  }

  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const d = await this.svc.find(id)
    if (!d) throw new Problem(404, "Journal entry not found")
    res.json(d)
  }

  /** Edit a draft (full replacement). Only drafts edit; an approved entry cancels instead. */
  @Put(":id") @Authed("doc.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, "Journal entry not found")
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be edited — ${cur.no} is ${cur.process}.`)
    const src = await glSource()
    const built = c.buildJournal(jsonBody(req), cur, src)
    if ("status" in built) throw new Problem(built.status, built.title, built.errors)
    const user = req.dz!.user
    const approving = built.process === "Approved"
    if (approving) deny(user, "doc.approve")
    const before = structuredClone(cur)
    const next: ManualJournalEntry = { ...cur, ...built.fields }
    const at = new Date().toISOString()
    c.stampLifeHistory(next, user.name, "edited", undefined, at)
    const changes = c.diff(before, next, [...c.JOURNAL_DIFF_FIELDS])
    let approvedAt: string | undefined
    if (approving) {
      const rule = c.journalApproveRule(next, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      next.process = "Approved"
      approvedAt = c.stampLifeHistory(next, user.name, "approved")
    }
    const saved = await this.svc.update(next)
    await this.audit.record({ at, actor: user, entity: "journal", entityId: saved.id, ref: saved.no, action: "edited", changes })
    if (approvedAt) await this.audit.record({ at: approvedAt, actor: user, entity: "journal", entityId: saved.id, ref: saved.no, action: "approved" })
    res.json(saved)
  }

  /** State transitions: approve or cancel with a reason. The books must be open for the entry's date either way. */
  @Patch(":id") @Authed()
  async patch(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = compat()
    const cur = await this.svc.find(id)
    if (!cur) throw new Problem(404, "Journal entry not found")
    const body = jsonBody(req) as { process?: string; reason?: string }
    const user = req.dz!.user
    const src = await glSource()
    if (body.process === "Approved") {
      deny(user, "doc.approve")
      if (cur.process !== "Created") throw new Problem(409, `Cannot approve — ${cur.no} is ${cur.process}.`)
      const rule = c.journalApproveRule(cur, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Approved"
      c.stampLifeHistory(next, user.name, "approved", undefined, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "journal", entityId: saved.id, ref: saved.no, action: "approved" })
      res.json(saved)
      return
    }
    if (body.process === "Cancelled") {
      deny(user, "doc.cancel")
      if (cur.process === "Cancelled") throw new Problem(409, `${cur.no} is already cancelled.`)
      const parsed = c.cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!parsed.success) throw new Problem(422, "Validation failed", c.zodErrors(parsed.error))
      const rule = c.journalCancelRule(cur, src)
      if (rule) throw new Problem(rule.status, rule.title, rule.errors)
      const at = new Date().toISOString()
      const next = structuredClone(cur)
      next.process = "Cancelled"
      next.cancelReason = parsed.data.reason
      c.stampLifeHistory(next, user.name, "cancelled", parsed.data.reason, at)
      const saved = await this.svc.update(next)
      await this.audit.record({ at, actor: user, entity: "journal", entityId: saved.id, ref: saved.no, action: "cancelled", note: parsed.data.reason })
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
    if (!cur) throw new Problem(404, "Journal entry not found")
    if (cur.process !== "Created") throw new Problem(409, `Only drafts can be deleted — cancel ${cur.no} instead.`)
    const at = new Date().toISOString()
    const next = structuredClone(cur)
    c.stampLifeHistory(next, req.dz!.user.name, "deleted", undefined, at)
    await this.svc.remove(next, at)
    await this.audit.record({ at, actor: req.dz!.user, entity: "journal", entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true })
  }
}

/** R9.2 — one account's ledger: `?account={code}` (required) with `?from` / `?to`. */
@Controller("api/v1/accounting/ledger")
export class LedgerController {
  @Get() @Authed()
  async one(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    const code = sp.get("account")
    if (!code) throw new Problem(422, "Validation failed", { account: ["required"] })
    const led: GlLedger | null = ledgerOf(await glSource(), code, sp.get("from") || "1970-01-01", sp.get("to") || today())
    if (!led) throw new Problem(404, `No account ${code} in the chart`)
    res.json(led)
  }
}
