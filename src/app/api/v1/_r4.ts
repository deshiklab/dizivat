import { vdsCertificateDue } from "@/lib/rules"
import { amendmentRow, extensionFor, lateFilingRow } from "@/lib/return-apps"
/**
 * R4 mock API — Accounting (money accounts, receipts, payments, statements, config) and NBR VAT
 * (treasury deposits / TR-6, VDS / Mushak 6.6, VAT adjustments, Mushak 9.1 returns, compliance centre, period lock).
 */
import { TODAY } from "@/lib/company"
import { company } from "@/lib/mock/company"
import { db } from "@/lib/mock/db"
import { auditStore, diff, recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { computeReturn, EMPTY_MANUAL, lockingReturn, subForm } from "@/lib/mock/vat-return"
import { FIRST_RETURN } from "@/lib/mock/seed-r4"
import {
  ADJUSTMENT_NOTE, economicCode, M610_LIMIT, METHOD_ACCOUNT, noteDef, PERIOD_RE, periodEnd, periodLabel, periodOf, periodsBetween, prevPeriod, returnDue,
} from "@/lib/r4"
import { accountInput, accountingConfigInput, adjustmentInput, cancelInput, moneyInput, returnInput, treasuryInput, vatSettingsInput, vdsInput } from "@/lib/schemas"
import type {
  AccountingConfig, Allocation, AuditChange, AuditEntity, ChequeEvent, CreditNote, DebitNote, HistoryEntry, LateFiling, MoneyAccount, MoneyAccountRow, MoneyDoc, MoneyKind, MoneyTransfer, OpenInvoice, Party, PartyStatement, Process,
  Purchase, ReturnAmendment, ReturnComputation, ReturnView, Sale, StatementRow, SubFormRow, TaxPeriod, TreasuryDeposit, VatAdjustment, VatReturn, VatReturnRow, VatSettings,
  VdsEligible, VdsEntry,
} from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import { round2 } from "@/lib/vat"
import { sdEligible, sdExportLink } from "@/lib/sd-export"
import { deny, invalidRule, json, problem, ruleResponse, withAuth, zodErrors, zodProblem, type RuleProblem } from "./_lib"

type Ctx = { params: Promise<{ id: string }> }
/**
 * What the accounting rules read (R5.6: as data, so the API's native module answers from the rows). The Next.js
 * handlers pass their in-memory copies, the API passes what it read from the tables — the customers and vendors from
 * `parties`, the invoices from `sales` and `purchases`, and the rest from their own accounting tables.
 */
export interface AccountingSource {
  customers: Party[]; vendors: Party[]
  sales: Sale[]; purchases: Purchase[]
  moneyAccounts: MoneyAccount[]; moneyDocs: MoneyDoc[]
  treasury: TreasuryDeposit[]; vds: VdsEntry[]
  accountingConfig: AccountingConfig
  /** R9.1: transfers between the company's own accounts (approved ones move the balances), and the cheque lifecycle */
  moneyTransfers?: MoneyTransfer[]
  chequeEvents?: ChequeEvent[]
  /** R9.2/R9.4: the manual journal entries and the fixed assets — the close cannot pass over their drafts
   * (structural on purpose: both the mock's documents and the derived journal satisfy it) */
  journalEntries?: { no: string; date: string; process?: Process }[]
  assets?: { no: string; date: string; process: Process }[]
}
/** `db` is the whole world, which is what the mock handlers pass by default. */
export const accountingSource = (): AccountingSource => db
/**
 * R5.6: what the VAT rules read, as data — the treasury deposits (TR-6), the VDS entries (Mushak 6.6) and the VAT
 * adjustments (Mushak 9.1 note 27–40), on top of everything the accounting rules already asked for (the parties, the
 * invoices a certificate settles and the money account a deposit leaves from), plus the two collections the period
 * lock and a claim for SD on the inputs of exported goods look at. The Next.js handlers pass their in-memory copies;
 * the API passes what it read from the tables.
 */
export interface VatSource extends AccountingSource {
  adjustments: VatAdjustment[]
  returns: VatReturn[]
  vatSettings: VatSettings
}
export const vatSource = (): VatSource => db
/**
 * R5.6: what the Mushak 9.1 rules read, as data — everything the VAT documents already asked for (the parties, the
 * invoices, the accounts, the deposits, the certificates and the adjustments) plus the two note families a return
 * nets off and the R6.6 applications a period may carry. The Next.js handlers pass their in-memory copies; the API
 * passes what it read from the tables.
 */
export interface ReturnSource extends VatSource {
  creditNotes: CreditNote[]; debitNotes: DebitNote[]
  lateFilings: LateFiling[]; returnAmendments: ReturnAmendment[]
}
export const returnSource = (): ReturnSource => db
/** What a draft return may be given — the type, the activities, the date it will be filed on and the manual notes. */
export type ReturnFields = Pick<VatReturn, "type" | "activities" | "submissionDate" | "manual"> & { amendReason?: string }
const invalid = (errors: Record<string, string[]>) => problem(422, "Validation failed", errors)
const has = (e: Record<string, string[]>) => Object.keys(e).length > 0
const ISO = /^\d{4}-\d{2}-\d{2}$/
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
export const CURRENT = periodOf(TODAY)

/* ── Period lock (Mushak 9.1 submitted) & accounting close ─────────────── */

/** The submitted Mushak 9.1 return that locks a date's tax period, if any. */
export const periodLocked = (date: string, src: VatSource = db) => lockingReturn(src, date)
/** R5.3: the lock as data — the field error, and the 409's title — so the native modules raise the same problem. */
export const lockedFieldRule = (date: string, field: string, src: VatSource = db) => (periodLocked(date, src) ? { [field]: ["periodLocked"] } : null)
export function lockedConflictRule(date: string, no: string, src: VatSource = db) {
  const r = periodLocked(date, src)
  return r ? `Tax period ${periodLabel(r.period)} is locked — its Mushak 9.1 return was submitted on ${r.submissionDate}. ${no} cannot change; record a correction in the current period (credit/debit note or VAT adjustment).` : null
}
/** 422 field error when a date falls in a tax period whose return has been submitted. */
export function lockedField(date: string, field: string, src: VatSource = db) {
  const errors = lockedFieldRule(date, field, src)
  return errors ? invalid(errors) : null
}
/** The lock as a 409 rule problem (R5.3) — what both runtimes raise for approve / cancel in a locked period. */
export function lockedConflictProblem(date: string, no: string, src: VatSource = db): RuleProblem | null {
  const title = lockedConflictRule(date, no, src)
  return title ? { status: 409, title } : null
}
/** 409 when a document's tax period is locked (approve / cancel of an existing document). */
export function lockedConflict(date: string, no: string, src: VatSource = db) {
  const title = lockedConflictRule(date, no, src)
  return title ? problem(409, title) : null
}
export const closed = (date: string, src: AccountingSource = db) => !!src.accountingConfig.closedUpTo && date <= src.accountingConfig.closedUpTo

/** Receipts, payments and VDS that settle an invoice — it cannot be cancelled while they stand. */
export function settlementsOf(kind: "sale" | "purchase", id: string) {
  const money = db.moneyDocs.filter((m) => m.process !== "Cancelled" && m.kind === (kind === "sale" ? "receipt" : "payment") && m.allocations.some((a) => a.docId === id))
  const vds = db.vds.filter((v) => v.process !== "Cancelled" && v.mode === (kind === "sale" ? "sales" : "purchase") && v.docId === id)
  return [...money.map((m) => m.no), ...vds.map((v) => v.no)]
}

/* ── Generic document lifecycle (draft → approved → cancelled) ─────────── */

interface LifeDoc { id: string; no: string; process: Process; history?: HistoryEntry[]; updatedAt?: string; cancelReason?: string; createdAt: string }
interface Life<T extends LifeDoc, F> {
  entity: AuditEntity
  label: string
  list: () => T[]
  idPrefix: string
  seq: keyof typeof db.seq
  noPrefix: string
  /** validates a body → fields (or a problem) */
  build: (body: unknown, self?: T) => { error: Response } | { fields: F; process: "Created" | "Approved"; date: string }
  /** business checks + side effects when approving; return a problem to refuse */
  approve?: (d: T) => Response | null
  /** checks + reversal when cancelling an approved document */
  cancel?: (d: T) => Response | null
  /** lock check for approve/cancel of an existing document */
  locked?: (d: T) => Response | null
  diffFields: string[]
  spec: QuerySpec<T>
  csv: { key: string; label: string; get?: (r: T) => unknown }[]
  csvName: string
  facetLabels?: () => Record<string, Record<string, string>>
  filter?: (rows: T[], sp: URLSearchParams) => T[]
}

export function nextNo(prefix: string, entity: AuditEntity, list: { no: string }[], date: string) {
  const key = `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`
  const used = [...list.map((d) => d.no), ...auditStore.events.filter((e) => e.entity === entity).map((e) => e.ref)]
  const n = used.reduce((m, no) => (no.startsWith(key) ? Math.max(m, Number(no.slice(key.length)) || 0) : m), 0) + 1
  return `${key}${String(n).padStart(4, "0")}`
}
/**
 * The document's own trail — its history entry, stamped by whoever writes it. The mock's `history()` records the
 * audit event with it; a native module writes the row itself and keeps the same list.
 */
export const stampLifeHistory = (d: { history?: HistoryEntry[]; updatedAt?: string }, by: string,
                                 action: HistoryEntry["action"], note?: string, at: string = new Date().toISOString()) => {
  d.history = [...(d.history ?? []), { at, by, action, note }]
  d.updatedAt = at
  return at
}
export function history(entity: AuditEntity, d: LifeDoc, by: string, action: HistoryEntry["action"], note?: string, changes?: AuditChange[], ref = d.no, entityId = d.id) {
  const at = new Date().toISOString()
  d.history = [...(d.history ?? []), { at, by, action, note }]
  d.updatedAt = at
  recordAudit({ at, actor: by, entity, entityId, ref, action, note, changes })
}

export function lifecycle<T extends LifeDoc, F extends object>(c: Life<T, F>) {
  const find = (id: string) => c.list().find((x) => x.id === id || x.no === id)
  const doApprove = (d: T, user: User) => {
    const err = c.approve?.(d)
    if (err) return err
    d.process = "Approved"
    history(c.entity, d, user.name, "approved")
    return null
  }
  const listGET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(c.filter ? c.filter(c.list(), sp) : c.list(), sp, c.spec)
    if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, c.csv), `${c.csvName}-${new Date().toISOString().slice(0, 10)}.csv`)
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json({ ...page, facetLabels: c.facetLabels?.() ?? {} })
  })
  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const r = c.build(await req.json().catch(() => ({})))
    if ("error" in r) return r.error
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const d = { ...r.fields, id: `${c.idPrefix}${db.seq[c.seq] + 1}`, no: nextNo(c.noPrefix, c.entity, c.list(), r.date), process: "Created", createdAt: new Date().toISOString(), history: [] } as unknown as T
    if (r.process === "Approved") { const err = c.approve?.(d); if (err) return err }
    if ("issuedBy" in d) (d as { issuedBy: string }).issuedBy = user.name
    db.seq[c.seq] += 1
    c.list().push(d)
    history(c.entity, d, user.name, "created")
    if (r.process === "Approved") { d.process = "Approved"; history(c.entity, d, user.name, "approved") }
    return json(d, { status: 201 })
  })
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(80)
    const d = find(id)
    return d ? json(d) : problem(404, `${c.label} not found`)
  })
  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const d = find(id)
    if (!d) return problem(404, `${c.label} not found`)
    if (d.process !== "Created") return problem(409, `Only drafts can be edited — ${d.no} is ${d.process}.`)
    const r = c.build(await req.json().catch(() => ({})), d)
    if ("error" in r) return r.error
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const before = structuredClone(d)
    Object.assign(d, r.fields)
    if (r.process === "Approved") {
      const err = c.approve?.(d)
      if (err) { Object.keys(d).forEach((k) => delete (d as Record<string, unknown>)[k]); Object.assign(d, before); return err }
    }
    history(c.entity, d, user.name, "edited", undefined, diff(before, d, c.diffFields))
    if (r.process === "Approved") { d.process = "Approved"; history(c.entity, d, user.name, "approved") }
    return json(d)
  })
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const d = find(id)
    if (!d) return problem(404, `${c.label} not found`)
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      if (d.process !== "Created") return problem(409, `Cannot approve — ${d.no} is ${d.process}.`)
      const lock = c.locked?.(d); if (lock) return lock
      const err = doApprove(d, user)
      return err ?? json(d)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      if (d.process === "Cancelled") return problem(409, `${d.no} is already cancelled.`)
      const r = cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!r.success) return zodProblem(r.error)
      if (d.process === "Approved") {
        const lock = c.locked?.(d); if (lock) return lock
        const err = c.cancel?.(d); if (err) return err
      }
      d.process = "Cancelled"
      d.cancelReason = r.data.reason
      history(c.entity, d, user.name, "cancelled", r.data.reason)
      return json(d)
    }
    return problem(400, "process must be Approved or Cancelled")
  })
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const list = c.list()
    const i = list.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, `${c.label} not found`)
    if (list[i].process !== "Created") return problem(409, `Only drafts can be deleted — cancel ${list[i].no} instead.`)
    const [d] = list.splice(i, 1)
    history(c.entity, d, user.name, "deleted")
    return json({ ok: true })
  })
  return { list: { GET: listGET, POST }, doc: { GET, PUT, PATCH, DELETE } }
}

/* ── Money accounts ────────────────────────────────────────────────────── */

export function accountRow(a: MoneyAccount, src: AccountingSource = db): MoneyAccountRow {
  const docs = src.moneyDocs.filter((m) => m.accountId === a.id && m.process === "Approved")
  const dep = src.treasury.filter((t) => t.accountId === a.id && t.process === "Approved")
  // R9.1: an approved transfer lands on both sides — the full amount plus the charge leaves the from-account,
  // the bare amount reaches the to-account (the charge is the bank's fee for the move)
  const tf = (src.moneyTransfers ?? []).filter((t) => t.process === "Approved" && (t.fromAccountId === a.id || t.toAccountId === a.id))
  const inflow = round2(docs.filter((m) => m.kind === "receipt").reduce((s, m) => s + m.amount - m.charge, 0)
    + tf.filter((t) => t.toAccountId === a.id).reduce((s, t) => s + t.amount, 0))
  const outflow = round2(docs.filter((m) => m.kind === "payment").reduce((s, m) => s + m.amount, 0) + dep.reduce((s, t) => s + t.amount, 0)
    + tf.filter((t) => t.fromAccountId === a.id).reduce((s, t) => s + t.amount + t.charge, 0))
  const dates = [...docs.map((m) => m.date), ...dep.map((t) => t.challanDate), ...tf.map((t) => t.date)].sort()
  return { ...a, inflow, outflow, balance: round2(a.openingBalance + inflow - outflow), lastDate: dates.at(-1), docs: docs.length + dep.length + tf.length }
}
export const accountSpec: QuerySpec<MoneyAccountRow> = {
  search: (a) => `${a.provider} ${a.accountNo} ${a.owner} ${a.branch ?? ""} ${a.authorised ?? ""}`,
  facets: { kind: (a) => a.kind, status: (a) => (a.active ? "active" : "inactive") },
  totals: ["balance", "inflow", "outflow", "openingBalance"],
}
export type AccountFields = Omit<MoneyAccount, "id" | "createdAt" | "updatedAt" | "history">
/** What an account's register prints, and what an edit records in the audit trail. */
export const ACCOUNT_CSV_COLUMNS = [
  { key: "kind", label: "Kind" }, { key: "provider", label: "Bank / service" }, { key: "branch", label: "Branch" }, { key: "accountNo", label: "Account / wallet no" },
  { key: "owner", label: "Account owner" }, { key: "bankType", label: "Account type", get: (a: MoneyAccountRow) => a.bankType ?? a.walletType ?? "" }, { key: "serviceCharge", label: "Service charge %" },
  { key: "openingBalance", label: "Opening balance" }, { key: "inflow", label: "Received" }, { key: "outflow", label: "Paid out" }, { key: "balance", label: "Balance" },
  { key: "active", label: "Status", get: (a: MoneyAccountRow) => (a.active ? "Active" : "Inactive") },
]
export const ACCOUNT_CSV_NAME = (date = new Date().toISOString().slice(0, 10)) => `money-accounts-${date}.csv`
export const ACCOUNT_DIFF_FIELDS = ["provider", "accountNo", "owner", "branch", "bankType", "walletType", "authorised", "serviceCharge", "openingBalance", "openingDate", "active"]
/** An account as the audit trail names it. */
export const accountRef = (a: MoneyAccount) => `${a.provider} · ${a.accountNo}`

export function parseAccount(body: unknown, self?: MoneyAccount, src: AccountingSource = db): RuleProblem | { fields: AccountFields } {
  const parsed = accountInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const a = parsed.data
  if (self && self.kind !== a.kind) return { status: 409, title: "An account cannot change its kind — add a new account." }
  const dup = src.moneyAccounts.find((x) => x.id !== self?.id && x.kind === a.kind && a.accountNo && x.accountNo.replace(/\D/g, "") === a.accountNo.replace(/\D/g, "") && x.provider === a.provider)
  if (dup) return invalidRule({ accountNo: ["duplicate"] })
  if (self && !a.active && self.active) {
    const drafts = src.moneyDocs.filter((m) => m.accountId === self.id && m.process === "Created")
    if (drafts.length) return { status: 409, title: `Drafts still use this account (${drafts.map((m) => m.no).join(", ")}) — approve or delete them first.` }
  }
  const fields: AccountFields = {
    kind: a.kind, provider: a.provider, accountNo: a.accountNo, owner: a.owner, serviceCharge: a.serviceCharge, openingBalance: a.openingBalance, openingDate: a.openingDate, active: a.active,
    branch: a.kind === "bank" ? a.branch || undefined : undefined, address: a.address || undefined, bankType: a.kind === "bank" ? a.bankType : undefined,
    walletType: a.kind === "mobile" ? a.walletType : undefined, authorised: a.kind === "mobile" ? a.authorised : undefined,
  }
  return { fields }
}
/** Only an account with no transactions may be deleted — one with transactions is deactivated instead. */
export function accountDeleteRule(a: MoneyAccount, src: AccountingSource = db): RuleProblem | undefined {
  const used = src.moneyDocs.some((m) => m.accountId === a.id) || src.treasury.some((t) => t.accountId === a.id)
  return used ? { status: 409, title: `${accountRef(a)} has transactions — deactivate it instead.` } : undefined
}
/** The account's own trail — its history entry and the audit event, stamped by whoever writes it. */
export const stampAccountHistory = (a: { history?: HistoryEntry[]; updatedAt?: string }, by: string,
                                    action: HistoryEntry["action"], note?: string, at: string = new Date().toISOString()) => {
  a.history = [...(a.history ?? []), { at, by, action, note }]
  a.updatedAt = at
  return at
}
/** A new account's id: the next in the `ac` series, claimed separately so a create refused afterwards consumes nothing. */
export const accountIdentity = () => ({ id: `ac${db.seq.account + 1}` })
export const claimAccountId = () => { db.seq.account += 1 }
export const accountRoutes = {
  GET: withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "provider.asc")
    const r = runQuery(db.moneyAccounts.map((a) => accountRow(a)), sp, accountSpec)
    if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, ACCOUNT_CSV_COLUMNS), ACCOUNT_CSV_NAME())
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  }),
  POST: withAuth("master.edit", async (req, _ctx, user) => {
    const r = parseAccount(await req.json().catch(() => ({})))
    if ("status" in r) return ruleResponse(r)
    const a: MoneyAccount = { ...r.fields, ...accountIdentity(), createdAt: new Date().toISOString(), history: [] }
    claimAccountId()
    db.moneyAccounts.push(a)
    history("account", a as unknown as LifeDoc, user.name, "created", undefined, undefined, accountRef(a))
    return json(accountRow(a), { status: 201 })
  }),
}
export const accountDocRoutes = {
  GET: withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    const a = db.moneyAccounts.find((x) => x.id === id)
    return a ? json(accountRow(a)) : problem(404, "Account not found")
  }),
  PUT: withAuth<Ctx>("master.edit", async (req, { params }, user) => {
    const { id } = await params
    const a = db.moneyAccounts.find((x) => x.id === id)
    if (!a) return problem(404, "Account not found")
    const r = parseAccount(await req.json().catch(() => ({})), a)
    if ("status" in r) return ruleResponse(r)
    const before = structuredClone(a)
    Object.assign(a, r.fields)
    const changes = diff(before, a, ACCOUNT_DIFF_FIELDS)
    const action = before.active !== a.active ? (a.active ? "activated" : "deactivated") : "updated"
    const at = new Date().toISOString()
    a.updatedAt = at
    recordAudit({ at, actor: user.name, entity: "account", entityId: a.id, ref: accountRef(a), action, changes })
    return json(accountRow(a))
  }),
  DELETE: withAuth<Ctx>("master.edit", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.moneyAccounts.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Account not found")
    const a = db.moneyAccounts[i]
    const rule = accountDeleteRule(a)
    if (rule) return ruleResponse(rule)
    db.moneyAccounts.splice(i, 1)
    recordAudit({ actor: user.name, entity: "account", entityId: a.id, ref: accountRef(a), action: "deleted" })
    return json({ ok: true })
  }),
}

/* ── Receipts & payments ───────────────────────────────────────────────── */

const invoicesOf = (kind: MoneyKind, src: AccountingSource = db): (Sale | Purchase)[] => (kind === "receipt" ? src.sales : src.purchases)
export const partyOf = (kind: MoneyKind, id: string, src: AccountingSource = db): Party | undefined =>
  (kind === "receipt" ? src.customers : src.vendors).find((p) => p.id === id)
const invoiceParty = (d: Sale | Purchase) => ("customerId" in d ? d.customerId : d.vendorId)

/** Approved invoices of a party that still have something to settle, oldest first. */
export function openInvoices(kind: MoneyKind, partyId: string, src: AccountingSource = db): OpenInvoice[] {
  return invoicesOf(kind, src)
    .filter((d) => d.process === "Approved" && invoiceParty(d) === partyId && d.due > 0.004)
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.invoiceNo.localeCompare(b.invoiceNo))
    .map((d) => ({ id: d.id, no: d.invoiceNo, challanNo: d.challanNo, date: d.issueDate, total: d.netTotal, paid: d.paid, due: d.due, days: daysBetween(d.issueDate, TODAY) }))
}

/** What `buildMoney` returns: every field of the document but the identity and the lifecycle the caller adds. */
export type MoneyFields = Omit<MoneyDoc, "id" | "no" | "process" | "createdAt" | "history">

export function buildMoney(kind: MoneyKind) {
  return (body: unknown, self?: MoneyDoc, src: AccountingSource = db): RuleProblem | { process: "Created" | "Approved"; date: string; fields: MoneyFields } => {
    const parsed = moneyInput.safeParse(body)
    if (!parsed.success) return invalidRule(zodErrors(parsed.error))
    const m = parsed.data
    const party = partyOf(kind, m.partyId, src)
    if (!party || party.active === false) return invalidRule({ partyId: ["unknown"] })
    if (self && self.partyId !== m.partyId) return { status: 409, title: `A ${kind} cannot move to another party — create a new one.` }
    if (closed(m.date, src)) return invalidRule({ date: ["dateClosed"] })
    if (m.date > TODAY) return invalidRule({ date: ["future"] })
    const acct = src.moneyAccounts.find((a) => a.id === m.accountId && a.active)
    if (!acct) return invalidRule({ accountId: ["unknown"] })
    if (acct.kind !== METHOD_ACCOUNT[m.method]) return invalidRule({ accountId: ["accountMismatch"] })
    const errors: Record<string, string[]> = {}
    const open = new Map(openInvoices(kind, party.id, src).map((o) => [o.id, o]))
    const seen = new Set<string>()
    const allocations: Allocation[] = []
    m.allocations.forEach((a, i) => {
      if (!a.amount) return
      const inv = open.get(a.docId)
      if (!inv) { errors[`allocations.${i}.docId`] = ["notOpen"]; return }
      if (seen.has(a.docId)) { errors[`allocations.${i}.docId`] = ["duplicate"]; return }
      seen.add(a.docId)
      if (a.amount > inv.due + 0.004) { errors[`allocations.${i}.amount`] = ["exceedsDue"]; return }
      allocations.push({ docId: inv.id, docNo: inv.no, docDate: inv.date, docTotal: inv.total, amount: round2(a.amount) })
    })
    if (has(errors)) return invalidRule(errors)
    const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0))
    if (allocated > m.amount + 0.004) return invalidRule({ amount: ["overAllocated"] })
    if (!src.accountingConfig.allowAdvance && allocated < m.amount - 0.004) return invalidRule({ amount: ["advanceNotAllowed"] })
    return {
      process: m.process, date: m.date,
      fields: {
        kind, date: m.date, partyId: party.id, partyName: party.name, partyBin: party.bin, method: m.method, accountId: acct.id, accountName: `${acct.provider} · ${acct.accountNo}`,
        chequeNo: m.method === "cheque" ? m.chequeNo : undefined, chequeDate: m.method === "cheque" ? m.chequeDate : undefined, chequeBank: m.method === "cheque" ? m.chequeBank || undefined : undefined,
        reference: m.method === "cash" || m.method === "cheque" ? m.reference || undefined : m.reference,
        amount: round2(m.amount), charge: round2(m.charge ?? 0), allocations, allocated, unallocated: round2(m.amount - allocated), note: m.note || undefined,
        issuedBy: self?.issuedBy ?? "",
      } satisfies MoneyFields,
    }
  }
}
/**
 * Apply (+1) or reverse (−1) the allocations on the invoices, and hand back the ones it moved: their `paid` and
 * `due` are columns of `sales` and `purchases` now, so whoever writes a receipt writes those rows with it — the same
 * way a production batch writes the counters an approval moves.
 */
export function settle(d: MoneyDoc, sign: 1 | -1, src: AccountingSource = db): (Sale | Purchase)[] {
  const moved: (Sale | Purchase)[] = []
  for (const a of d.allocations) {
    const inv = invoicesOf(d.kind, src).find((x) => x.id === a.docId)
    if (!inv) continue
    inv.paid = round2(inv.paid + sign * a.amount)
    inv.due = round2(inv.netTotal - inv.paid)
    moved.push(inv)
  }
  return moved
}
/**
 * Approving: the books must not be closed for the date, and every invoice it settles has to still have that much
 * due — another receipt may have settled it in the meantime.
 */
export function moneyApproveRule(d: MoneyDoc, src: AccountingSource = db): RuleProblem | undefined {
  if (closed(d.date, src)) return { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be approved.` }
  const open = new Map(openInvoices(d.kind, d.partyId, src).map((o) => [o.id, o]))
  const errors: Record<string, string[]> = {}
  d.allocations.forEach((a, i) => { if (a.amount > (open.get(a.docId)?.due ?? 0) + 0.004) errors[`allocations.${i}.amount`] = ["exceedsDue"] })
  if (!has(errors)) return undefined
  return {
    status: 409,
    title: `An invoice was settled in the meantime — ${d.allocations.filter((_, i) => errors[`allocations.${i}.amount`]).map((a) => a.docNo).join(", ")} no longer has that much due.`,
    errors,
  }
}
/** Cancelling: the books must not be closed for the date either. */
export function moneyCancelRule(d: MoneyDoc, src: AccountingSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be cancelled.` }
    : undefined
}
/** The document's own trail — its history entry and the audit event, stamped by whoever writes it. */
export const stampMoneyHistory = stampLifeHistory
/** What an edit of a receipt or payment records in the audit trail. */
export const MONEY_DIFF_FIELDS = ["date", "method", "accountName", "chequeNo", "chequeDate", "reference", "amount", "charge", "allocated", "note"]
/** The register's CSV: one row per document, with the invoices it settles named on it. */
export const moneyCsvColumns = (kind: MoneyKind) => [
  { key: "date", label: "Date" }, { key: "no", label: kind === "receipt" ? "Receipt No" : "Voucher No" }, { key: "partyName", label: kind === "receipt" ? "Customer" : "Supplier" },
  { key: "partyBin", label: "BIN" }, { key: "method", label: "Method" }, { key: "accountName", label: "Account" }, { key: "chequeNo", label: "Cheque No" }, { key: "reference", label: "Reference" },
  { key: "amount", label: "Amount" }, { key: "charge", label: "Charge" }, { key: "allocated", label: "Allocated" }, { key: "unallocated", label: "On account" },
  { key: "invoices", label: "Invoices", get: (m: MoneyDoc) => m.allocations.map((a) => `${a.docNo}:${a.amount}`).join("; ") }, { key: "process", label: "Process" },
]
export const moneyCsvName = (kind: MoneyKind, date = new Date().toISOString().slice(0, 10)) => `${kind === "receipt" ? "receipts" : "payments"}-${date}.csv`
/** A new receipt's or payment's identity: the next id of its series and the next MR-/PV-MMYY####. */
export const moneyIdentity = (kind: MoneyKind, date: string) => ({
  id: `${kind === "receipt" ? "mr" : "pv"}${db.seq[kind] + 1}`,
  no: nextNo(kind === "receipt" ? "MR" : "PV", kind, db.moneyDocs, date),
})
export const claimMoneyId = (kind: MoneyKind) => { db.seq[kind] += 1 }
export const moneySpec: QuerySpec<MoneyDoc> = {
  search: (m) => `${m.no} ${m.partyName} ${m.partyBin} ${m.chequeNo ?? ""} ${m.reference ?? ""} ${m.allocations.map((a) => a.docNo).join(" ")}`,
  dateField: "date",
  facets: { process: (m) => m.process, method: (m) => m.method, party: (m) => m.partyId, account: (m) => m.accountId },
  totals: ["amount", "allocated", "unallocated", "charge"],
}
export function moneyRoutes(kind: MoneyKind) {
  const label = kind === "receipt" ? "Receipt" : "Payment"
  // the rules are data (above); `lifecycle` wants a Response, so a RuleProblem is turned back into one here
  const build = (body: unknown, self?: MoneyDoc) => {
    const r = buildMoney(kind)(body, self)
    return "status" in r ? { error: ruleResponse(r) } : r
  }
  return lifecycle<MoneyDoc, ReturnType<typeof build> extends infer R ? R extends { fields: infer F } ? F : never : never>({
    entity: kind, label, list: () => db.moneyDocs, idPrefix: kind === "receipt" ? "mr" : "pv", seq: kind, noPrefix: kind === "receipt" ? "MR" : "PV",
    filter: (rows, sp) => moneyInvoiceFilter(kind, sp, rows),
    build,
    approve: (d) => {
      const rule = moneyApproveRule(d)
      if (rule) return ruleResponse(rule)
      settle(d, 1)
      return null
    },
    cancel: (d) => {
      const rule = moneyCancelRule(d)
      if (rule) return ruleResponse(rule)
      settle(d, -1)
      return null
    },
    diffFields: ["date", "method", "accountName", "chequeNo", "chequeDate", "reference", "amount", "charge", "allocated", "note"],
    spec: moneySpec,
    csv: [
      { key: "date", label: "Date" }, { key: "no", label: kind === "receipt" ? "Receipt No" : "Voucher No" }, { key: "partyName", label: kind === "receipt" ? "Customer" : "Supplier" },
      { key: "partyBin", label: "BIN" }, { key: "method", label: "Method" }, { key: "accountName", label: "Account" }, { key: "chequeNo", label: "Cheque No" }, { key: "reference", label: "Reference" },
      { key: "amount", label: "Amount" }, { key: "charge", label: "Charge" }, { key: "allocated", label: "Allocated" }, { key: "unallocated", label: "On account" },
      { key: "invoices", label: "Invoices", get: (m) => m.allocations.map((a) => `${a.docNo}:${a.amount}`).join("; ") }, { key: "process", label: "Process" },
    ],
    csvName: kind === "receipt" ? "receipts" : "payments",
    facetLabels: () => moneyFacetLabels(kind),
  })
}
/** The register's facet labels: the parties a receipt or payment may be taken from and the accounts it may go into. */
export const moneyFacetLabels = (kind: MoneyKind, src: AccountingSource = db) => ({
  party: Object.fromEntries((kind === "receipt" ? src.customers : src.vendors).map((p) => [p.id, p.name])),
  account: Object.fromEntries(src.moneyAccounts.map((a) => [a.id, accountRef(a)])),
})
/** The register's `?invoice=` filter: the receipts or payments that settle one, taken out of the params before the query runs. */
export const moneyInvoiceFilter = (kind: MoneyKind, params: URLSearchParams, src: MoneyDoc[] = db.moneyDocs) => {
  const inv = params.get("invoice")
  params.delete("invoice")
  return src.filter((m) => m.kind === kind && (!inv || m.allocations.some((a) => a.docId === inv)))
}
/** What `?kind=&party=` asks for — the open invoices of one party, or a 422 naming the party. */
export function openInvoiceParams(sp: URLSearchParams, src: AccountingSource = db): RuleProblem | { kind: MoneyKind; party: Party } {
  const kind: MoneyKind = sp.get("kind") === "payment" ? "payment" : "receipt"
  const party = partyOf(kind, sp.get("party") ?? "", src)
  return party ? { kind, party } : invalidRule({ party: ["unknown"] })
}
export const openInvoicesRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const r = openInvoiceParams(sp)
  if ("status" in r) return ruleResponse(r)
  await delay(60)
  return json(openInvoices(r.kind, r.party.id))
})

/* ── Party statement ───────────────────────────────────────────────────── */

export function statement(kind: "customer" | "vendor", party: Party, from: string, to: string, src: AccountingSource = db): PartyStatement {
  const mk: MoneyKind = kind === "customer" ? "receipt" : "payment"
  const invs = invoicesOf(mk, src).filter((d) => d.process === "Approved" && invoiceParty(d) === party.id)
  const money = src.moneyDocs.filter((m) => m.kind === mk && m.process === "Approved" && m.partyId === party.id)
  const vds = src.vds.filter((v) => v.mode === (kind === "customer" ? "sales" : "purchase") && v.process === "Approved" && v.partyId === party.id && (v.settled ?? 0) > 0)
  const all: Omit<StatementRow, "balance">[] = []
  for (const d of invs) {
    all.push({ date: d.issueDate, type: "invoice", ref: d.invoiceNo, refId: d.id, note: d.challanNo, debit: d.netTotal, credit: 0 })
    const later = money.reduce((s, m) => s + m.allocations.filter((a) => a.docId === d.id).reduce((x, a) => x + a.amount, 0), 0) + vds.filter((v) => v.docId === d.id).reduce((s, v) => s + (v.settled ?? 0), 0)
    const onInvoice = round2(d.paid - later)
    if (onInvoice > 0.004) all.push({ date: d.issueDate, type: "settledOnInvoice", ref: d.invoiceNo, refId: d.id, debit: 0, credit: onInvoice })
  }
  for (const m of money) {
    if (m.allocated) all.push({ date: m.date, type: mk, ref: m.no, refId: m.id, note: m.allocations.map((a) => a.docNo).join(", "), debit: 0, credit: m.allocated })
    if (m.unallocated > 0.004) all.push({ date: m.date, type: "advance", ref: m.no, refId: m.id, note: m.note, debit: 0, credit: m.unallocated })
  }
  for (const v of vds) all.push({ date: v.certificateDate, type: "vds", ref: v.no, refId: v.id, note: v.docNo, debit: 0, credit: v.settled ?? 0 })
  const order: Record<string, number> = { invoice: 0, settledOnInvoice: 1, receipt: 2, payment: 2, vds: 3, advance: 4 }
  all.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type] || (a.ref ?? "").localeCompare(b.ref ?? ""))
  const opening = round2(all.filter((r) => r.date < from).reduce((s, r) => s + r.debit - r.credit, 0))
  let bal = opening
  const rows: StatementRow[] = [{ date: from, type: "opening", debit: 0, credit: 0, balance: opening }]
  for (const r of all.filter((x) => x.date >= from && x.date <= to)) { bal = round2(bal + r.debit - r.credit); rows.push({ ...r, balance: bal }) }
  const open = openInvoices(mk, party.id, src)
  const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  for (const o of open) {
    const k = o.days <= 30 ? "d0_30" : o.days <= 60 ? "d31_60" : o.days <= 90 ? "d61_90" : "d90"
    ageing[k] = round2(ageing[k] + o.due)
  }
  const advances = round2(money.reduce((s, m) => s + m.unallocated, 0))
  const invoiceDue = round2(invs.reduce((s, d) => s + d.due, 0))
  const fullClosing = round2(all.reduce((s, r) => s + r.debit - r.credit, 0))
  return {
    kind, party, from, to, opening, rows,
    totals: { debit: round2(rows.reduce((s, r) => s + r.debit, 0)), credit: round2(rows.reduce((s, r) => s + r.credit, 0)) },
    closing: bal, ageing, openInvoices: open, advances, invoiceDue, reconciled: Math.abs(fullClosing - (invoiceDue - advances)) < 0.01,
  }
}
/** The statement's CSV: one row per entry, running balance, and the debit/credit columns named for the party. */
export const statementCsvColumns = (kind: "customer" | "vendor") => [
  { key: "date", label: "Date" }, { key: "type", label: "Type" }, { key: "ref", label: "Reference" }, { key: "note", label: "Details" },
  { key: "debit", label: kind === "customer" ? "Invoiced" : "Billed" }, { key: "credit", label: kind === "customer" ? "Received" : "Paid" }, { key: "balance", label: "Balance" },
]
export const statementCsvName = (party: Party, from: string, to: string) =>
  `statement-${party.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${from}-${to}.csv`
/** What `?kind=&party=&from=&to=` asks for — one party's statement over a range, or a 422 naming what is missing. */
export function statementParams(sp: URLSearchParams, src: AccountingSource = db): RuleProblem | { kind: "customer" | "vendor"; party: Party; from: string; to: string } {
  const kind: "customer" | "vendor" = sp.get("kind") === "vendor" ? "vendor" : "customer"
  const party = (kind === "customer" ? src.customers : src.vendors).find((p) => p.id === sp.get("party"))
  const from = sp.get("from") || "2025-07-01", to = sp.get("to") || TODAY
  const errors: Record<string, string[]> = {}
  if (!party) errors.party = ["required"]
  if (!ISO.test(from)) errors.from = ["required"]
  if (!ISO.test(to)) errors.to = ["required"]
  if (!errors.from && !errors.to && from > to) errors.to = ["toBeforeFrom"]
  if (has(errors) || !party) return invalidRule(errors)
  return { kind, party, from, to }
}
export const statementRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const r = statementParams(sp)
  if ("status" in r) return ruleResponse(r)
  const s = statement(r.kind, r.party, r.from, r.to)
  if (sp.get("format") === "csv") return csvResponse(toCSV(s.rows, statementCsvColumns(r.kind)), statementCsvName(r.party, r.from, r.to))
  await delay(120)
  return json(s)
})

/* ── Accounting config ─────────────────────────────────────────────────── */

export const ACCOUNTING_CONFIG_DIFF_FIELDS = ["closedUpTo", "allowAdvance", "autoAllocate"]
export const accountingConfigDiff = (before: AccountingConfig, after: AccountingConfig) => diff(before, after, ACCOUNTING_CONFIG_DIFF_FIELDS)
/** What `buildAccountingConfig` returns: the three settings, before the caller adds who changed them and when. */
export type AccountingConfigFields = Omit<AccountingConfig, "updatedAt" | "updatedBy">
/**
 * Validates an accounting-configuration body (R5.6: as data, so the API's native module answers with the same
 * 422/409): the books may not be closed up to a future date, and drafts dated inside the period being closed must be
 * approved or deleted first — the books cannot be closed over an open document.
 */
export function buildAccountingConfig(body: unknown, src: AccountingSource = db): RuleProblem | { fields: AccountingConfigFields } {
  const parsed = accountingConfigInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const c = parsed.data
  if (c.closedUpTo && c.closedUpTo > TODAY) return invalidRule({ closedUpTo: ["future"] })
  if (c.closedUpTo) {
    // R9.3: the cut-off guards every book-side document now — money docs, transfers, manual entries, assets
    const drafts = [
      ...src.moneyDocs.filter((m) => m.process === "Created" && m.date <= c.closedUpTo).map((m) => m.no),
      ...(src.moneyTransfers ?? []).filter((m) => m.process === "Created" && m.date <= c.closedUpTo).map((m) => m.no),
      ...(src.journalEntries ?? []).filter((m) => m.process === "Created" && m.date <= c.closedUpTo).map((m) => m.no),
      ...(src.assets ?? []).filter((m) => m.process === "Created" && m.date <= c.closedUpTo).map((m) => m.no),
    ]
    if (drafts.length) return {
      status: 409,
      title: `Drafts dated on or before ${c.closedUpTo} are still open (${drafts.join(", ")}) — approve or delete them before closing the books.`,
    }
  }
  return { fields: { closedUpTo: c.closedUpTo || undefined, allowAdvance: c.allowAdvance, autoAllocate: c.autoAllocate } }
}
/** The configuration the demo data set starts with — and the shape a row has before it was ever updated. */
export const DEFAULT_ACCOUNTING_CONFIG: AccountingConfig = { allowAdvance: true, autoAllocate: true }
export const accountingConfigRoutes = {
  GET: withAuth(null, async () => json(db.accountingConfig)),
  PUT: withAuth("settings.manage", async (req, _ctx, user) => {
    const r = buildAccountingConfig(await req.json().catch(() => ({})))
    if ("status" in r) return ruleResponse(r)
    const before = { ...db.accountingConfig }
    const at = new Date().toISOString()
    db.accountingConfig = { ...r.fields, updatedAt: at, updatedBy: user.name }
    recordAudit({ at, actor: user.name, entity: "accountingConfig", ref: "Accounting config", action: "updated", changes: accountingConfigDiff(before, db.accountingConfig) })
    return json(db.accountingConfig)
  }),
}

/* ── Treasury deposits (TR-6) ──────────────────────────────────────────── */

/** The register: what a deposit may be searched by, the facets it is grouped by and the totals it prints. */
export const treasurySpec: QuerySpec<TreasuryDeposit> = {
  search: (t) => `${t.no} ${t.challanNo} ${t.bank} ${t.bankBranch} ${t.code} ${t.description}`,
  dateField: "challanDate",
  facets: { process: (t) => t.process, head: (t) => t.head, period: (t) => t.taxPeriod, mode: (t) => t.mode },
  totals: ["amount"],
}
export type TreasuryFields = Omit<TreasuryDeposit, "id" | "no" | "process" | "createdAt" | "history">
/** What the register prints… */
export const TREASURY_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: "challanDate", label: "Challan date" }, { key: "challanNo", label: "Treasury challan no" }, { key: "no", label: "Internal no" }, { key: "head", label: "Head" },
  { key: "code", label: "Economic code" }, { key: "taxPeriod", label: "Tax period" }, { key: "bank", label: "Bank" }, { key: "bankBranch", label: "Branch" },
  { key: "district", label: "District" }, { key: "mode", label: "Mode" }, { key: "amount", label: "Amount" }, { key: "process", label: "Process" },
]
export const treasuryCsvName = (date = new Date().toISOString().slice(0, 10)) => `treasury-deposits-${date}.csv`
/** …and what an edit of one records in the audit trail. */
export const TREASURY_DIFF_FIELDS = ["head", "taxPeriod", "challanNo", "challanDate", "mode", "bank", "bankBranch", "district", "amount", "description"]
export const treasuryDiff = (a: TreasuryDeposit, b: TreasuryDeposit) => diff(a, b, TREASURY_DIFF_FIELDS)
/** A new deposit's identity: the next id of the `tc` series and the next TC-MMYY#### (the audit trail takes part in the number). */
export const treasuryIdentity = (date: string) => ({ id: `tc${db.seq.treasury + 1}`, no: nextNo("TC", "treasury", db.treasury, date) })
export const claimTreasuryId = () => { db.seq.treasury += 1 }
/** The deposit's own trail — its history entry, stamped by whoever writes it. */
export const stampTreasuryHistory = stampLifeHistory
/**
 * What a deposit may hold: the head and the economic code it takes from the company's zone, a challan date that is
 * neither in the future nor outside the return range, a bank account the deposit can leave from, and a challan no
 * another live deposit has not used.
 */
export function treasuryBuild(body: unknown, self: TreasuryDeposit | undefined, src: VatSource = db): RuleProblem | { process: "Created" | "Approved"; date: string; fields: TreasuryFields } {
  const parsed = treasuryInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const t = parsed.data
  if (t.challanDate > TODAY) return invalidRule({ challanDate: ["future"] })
  if (t.taxPeriod > CURRENT || t.taxPeriod < FIRST_RETURN) return invalidRule({ taxPeriod: ["outOfRange"] })
  const lock = lockedFieldRule(`${t.taxPeriod}-01`, "taxPeriod", src); if (lock) return invalidRule(lock)
  if (t.accountId && !src.moneyAccounts.some((a) => a.id === t.accountId && a.kind === "bank" && a.active)) return invalidRule({ accountId: ["unknown"] })
  const dup = src.treasury.find((x) => x.id !== self?.id && x.process !== "Cancelled" && x.challanNo === t.challanNo)
  if (dup) return invalidRule({ challanNo: ["duplicate"] })
  return {
    process: t.process, date: t.challanDate,
    fields: {
      head: t.head, code: economicCode(t.head, src.vatSettings.zoneCode), taxPeriod: t.taxPeriod, challanNo: t.challanNo, challanDate: t.challanDate, mode: t.mode,
      bank: t.bank, bankBranch: t.bankBranch, district: t.district, bankAddress: t.bankAddress || undefined, accountId: t.accountId || undefined, amount: round2(t.amount),
      depositor: t.depositor, designation: t.designation || undefined, address: t.address, description: t.description,
    },
  }
}
/** Approving: the bank account it leaves from has to carry the amount. */
export function treasuryApproveRule(d: TreasuryDeposit, src: VatSource = db): RuleProblem | undefined {
  if (!d.accountId) return undefined
  const a = src.moneyAccounts.find((x) => x.id === d.accountId)
  if (a && accountRow(a, src).balance < d.amount - 0.004) return { status: 409, title: `Not enough balance in ${accountRef(a)} for this deposit.` }
  return undefined
}
/** Cancelling: no VDS entry may still be quoting the challan. */
export function treasuryCancelRule(d: TreasuryDeposit, src: VatSource = db): RuleProblem | undefined {
  const linked = src.vds.filter((v) => v.treasuryId === d.id && v.process !== "Cancelled")
  return linked.length ? { status: 409, title: `VDS entries ${linked.map((v) => v.no).join(", ")} quote this challan — unlink them first.` } : undefined
}
/** Approve and cancel both refuse to touch a deposit whose tax period has been submitted (Mushak 9.1). */
export const treasuryLockRule = (d: TreasuryDeposit, src: VatSource = db) => lockedConflictProblem(`${d.taxPeriod}-01`, d.no, src) ?? undefined
export const treasuryRoutes = lifecycle<TreasuryDeposit, TreasuryFields>({
  entity: "treasury", label: "Treasury deposit", list: () => db.treasury, idPrefix: "tc", seq: "treasury", noPrefix: "TC",
  build: (body, self) => { const r = treasuryBuild(body, self); return "status" in r ? { error: ruleResponse(r) } : r },
  locked: (d) => lockedConflict(`${d.taxPeriod}-01`, d.no),
  approve: (d) => { const r = treasuryApproveRule(d); return r ? ruleResponse(r) : null },
  cancel: (d) => { const r = treasuryCancelRule(d); return r ? ruleResponse(r) : null },
  diffFields: TREASURY_DIFF_FIELDS,
  spec: treasurySpec,
  csv: TREASURY_CSV_COLUMNS,
  csvName: "treasury-deposits",
})

/* ── VDS (Mushak 6.6) ──────────────────────────────────────────────────── */

const vdsDoc = (mode: VdsEntry["mode"], id: string, src: VatSource = db): Sale | Purchase | undefined =>
  (mode === "sales" ? src.sales : src.purchases).find((d) => d.id === id)
/** VAT subject to VDS on an invoice: sales → the invoice VAT (buyer is a withholding entity); purchases → VAT on the lines flagged VDS. */
function vdsBase(mode: VdsEntry["mode"], d: Sale | Purchase) {
  if (mode === "sales") return (d as Sale).vds ? { value: d.subtotal, vat: d.vat } : { value: 0, vat: 0 }
  const ls = d.lines.filter((l) => l.vds)
  return { value: round2(ls.reduce((s, l) => s + l.subtotal, 0)), vat: round2(ls.reduce((s, l) => s + l.vat, 0)) }
}
/** The approved invoices a certificate can be written against, and how much VAT each still has to withhold. */
export function vdsEligible(mode: VdsEntry["mode"], excludeId?: string, src: VatSource = db): VdsEligible[] {
  const docs = (mode === "sales" ? src.sales : src.purchases) as (Sale | Purchase)[]
  return docs.filter((d) => d.process === "Approved").flatMap((d) => {
    const b = vdsBase(mode, d)
    if (!b.vat) return []
    const withheld = round2(src.vds.filter((v) => v.docId === d.id && v.mode === mode && v.process !== "Cancelled" && v.id !== excludeId).reduce((s, v) => s + v.amount, 0))
    return [{ id: d.id, no: d.invoiceNo, challanNo: d.challanNo, date: d.issueDate, partyId: invoiceParty(d), partyName: "customerName" in d ? d.customerName : d.vendorName, value: b.value, vat: b.vat, withheld, remaining: round2(b.vat - withheld) }]
  }).sort((a, b) => b.date.localeCompare(a.date))
}
export const vdsSpec: QuerySpec<VdsEntry> = {
  search: (v) => `${v.no} ${v.docNo} ${v.challanNo} ${v.partyName} ${v.partyBin} ${v.certificateNo ?? ""} ${v.treasuryChallan ?? ""}`,
  dateField: "certificateDate",
  facets: { process: (v) => v.process, mode: (v) => v.mode, party: (v) => v.partyId, period: (v) => v.taxPeriod },
  totals: ["amount", "docVat", "docValue"],
}
export type VdsFields = Omit<VdsEntry, "id" | "no" | "process" | "createdAt" | "history">
/** What the register prints… */
export const VDS_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: "certificateDate", label: "Certificate date" }, { key: "no", label: "VDS No" }, { key: "mode", label: "Mode" }, { key: "certificateNo", label: "Certificate No" },
  { key: "docNo", label: "Invoice" }, { key: "challanNo", label: "Challan (6.3)" }, { key: "partyName", label: "Party" }, { key: "partyBin", label: "BIN" },
  { key: "docValue", label: "Value" }, { key: "docVat", label: "Invoice VAT" }, { key: "amount", label: "VAT deducted" }, { key: "taxPeriod", label: "Tax period" },
  { key: "treasuryChallan", label: "Treasury challan" }, { key: "process", label: "Process" },
]
export const vdsCsvName = (date = new Date().toISOString().slice(0, 10)) => `vds-${date}.csv`
/** …and what an edit of one records in the audit trail. */
export const VDS_DIFF_FIELDS = ["amount", "certificateNo", "certificateDate", "treasuryChallan", "remark"]
export const vdsDiff = (a: VdsEntry, b: VdsEntry) => diff(a, b, VDS_DIFF_FIELDS)
/** A new certificate's identity: the next id of the `vds` series and the next VDS-MMYY####. */
export const vdsIdentity = (date: string) => ({ id: `vds${db.seq.vds + 1}`, no: nextNo("VDS", "vds", db.vds, date) })
export const claimVdsId = () => { db.seq.vds += 1 }
/** The names the register's party facet prints. */
export const vdsFacetLabels = (src: VatSource = db) => ({ party: Object.fromEntries([...src.customers, ...src.vendors].map((p) => [p.id, p.name])) })
/** The certificate's own trail — its history entry, stamped by whoever writes it. */
export const stampVdsHistory = stampLifeHistory
/**
 * What a certificate may hold: an invoice that is approved and still has VAT to withhold, an amount within what is
 * left on it, a certificate date neither before the invoice nor in the future nor in a submitted period, and — on a
 * purchase — a treasury challan under the VDS head.
 */
export function vdsBuild(body: unknown, self: VdsEntry | undefined, src: VatSource = db): RuleProblem | { process: "Created" | "Approved"; date: string; fields: VdsFields } {
  const parsed = vdsInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const v = parsed.data
  if (self && (self.mode !== v.mode || self.docId !== v.docId)) return { status: 409, title: "A VDS entry cannot move to another invoice — create a new one." }
  const d = vdsDoc(v.mode, v.docId, src)
  if (!d || d.process !== "Approved") return invalidRule({ docId: ["notApproved"] })
  const el = vdsEligible(v.mode, self?.id, src).find((x) => x.id === d.id)
  if (!el) return invalidRule({ docId: ["notVds"] })
  if (v.amount > el.remaining + 0.004) return invalidRule({ amount: ["exceedsVds"] })
  if (v.certificateDate < d.issueDate) return invalidRule({ certificateDate: ["beforeInvoice"] })
  if (v.certificateDate > TODAY) return invalidRule({ certificateDate: ["future"] })
  const lock = lockedFieldRule(v.certificateDate, "certificateDate", src); if (lock) return invalidRule(lock)
  const t = v.treasuryId ? src.treasury.find((x) => x.id === v.treasuryId && x.head === "vds" && x.process !== "Cancelled") : undefined
  if (v.treasuryId && !t) return invalidRule({ treasuryId: ["unknown"] })
  if (v.mode === "sales" && t) return invalidRule({ treasuryId: ["purchaseOnly"] })
  const party = "customerId" in d ? src.customers.find((c) => c.id === d.customerId) : src.vendors.find((x) => x.id === (d as Purchase).vendorId)
  return {
    process: v.process, date: v.certificateDate,
    fields: {
      mode: v.mode, docId: d.id, docNo: d.invoiceNo, challanNo: d.challanNo, docDate: d.issueDate,
      partyId: invoiceParty(d), partyName: party?.name ?? "", partyBin: party?.bin ?? "", partyAddress: party?.address ?? "",
      docValue: el.value, docVat: el.vat, amount: round2(v.amount), certificateNo: v.certificateNo || undefined, certificateDate: v.certificateDate, taxPeriod: periodOf(v.certificateDate),
      treasuryId: t?.id, treasuryChallan: t?.challanNo, remark: v.remark || undefined, issuedBy: self?.issuedBy ?? "",
    },
  }
}
/** Approving: the invoice still has to have that much VAT left — another certificate may have taken it since. */
export function vdsApproveRule(d: VdsEntry, src: VatSource = db): RuleProblem | undefined {
  const el = vdsEligible(d.mode, d.id, src).find((x) => x.id === d.docId)
  if (!el || d.amount > el.remaining + 0.004) return { status: 409, title: `${d.docNo} has only ${el?.remaining ?? 0} VAT left to withhold.`, errors: { amount: ["exceedsVds"] } }
  return undefined
}
/**
 * Apply (+1) or reverse (−1) what a certificate settles on its invoice, and hand back the invoice it moved: `paid`
 * and `due` are columns of `sales` and `purchases`, so whoever approves a certificate writes that row with it.
 */
export function vdsSettle(d: VdsEntry, sign: 1 | -1, src: VatSource = db): (Sale | Purchase)[] {
  const inv = vdsDoc(d.mode, d.docId, src)
  if (!inv) return []
  if (sign === 1) {
    d.settled = round2(Math.min(d.amount, Math.max(0, inv.due)))
    inv.paid = round2(inv.paid + d.settled)
  } else if (d.settled) {
    inv.paid = round2(inv.paid - d.settled)
  } else return []
  inv.due = round2(inv.netTotal - inv.paid)
  if (sign === -1) d.settled = 0
  return [inv]
}
/** Approve and cancel both refuse to touch a certificate whose tax period has been submitted (Mushak 9.1). */
export const vdsLockRule = (d: VdsEntry, src: VatSource = db) => lockedConflictProblem(d.certificateDate, d.no, src) ?? undefined
export const vdsRoutes = lifecycle<VdsEntry, VdsFields>({
  entity: "vds", label: "VDS entry", list: () => db.vds, idPrefix: "vds", seq: "vds", noPrefix: "VDS",
  build: (body, self) => { const r = vdsBuild(body, self); return "status" in r ? { error: ruleResponse(r) } : r },
  locked: (d) => lockedConflict(d.certificateDate, d.no),
  approve: (d) => {
    const r = vdsApproveRule(d); if (r) return ruleResponse(r)
    vdsSettle(d, 1)
    return null
  },
  cancel: (d) => { vdsSettle(d, -1); return null },
  diffFields: VDS_DIFF_FIELDS,
  spec: vdsSpec,
  csv: VDS_CSV_COLUMNS,
  csvName: "vds",
  facetLabels: () => vdsFacetLabels(),
})

/** R6.3: SD-paid purchase lines and the six-month export window (`exclude` = the claim being edited). */
export const sdEligibleRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  await delay(60)
  return json(sdEligible({ purchases: db.purchases, sales: db.sales, adjustments: db.adjustments }, TODAY, sp.get("exclude") ?? undefined))
})
/** The invoices a VDS certificate can still be written against. */
export const vdsEligibleRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const mode = sp.get("mode") === "sales" ? "sales" : "purchase"
  await delay(60)
  return json(vdsEligible(mode, sp.get("exclude") ?? undefined))
})

/* ── VAT adjustments ───────────────────────────────────────────────────── */

export const adjustmentSpec: QuerySpec<VatAdjustment> = {
  search: (a) => `${a.no} ${a.description} ${a.reference ?? ""} ${a.sdExport ? `${a.sdExport.purchaseNo} ${a.sdExport.saleNo} ${a.sdExport.itemName}` : ""}`,
  dateField: "issueDate",
  facets: { process: (a) => a.process, kind: (a) => a.kind, period: (a) => a.taxPeriod },
  totals: ["amount"],
}
export type AdjustmentFields = Omit<VatAdjustment, "id" | "no" | "process" | "createdAt" | "history">
/** What the register prints… */
export const ADJUSTMENT_CSV_COLUMNS: { key: string; label: string }[] = [
  { key: "issueDate", label: "Date" }, { key: "no", label: "Adjustment No" }, { key: "kind", label: "Kind" }, { key: "note", label: "9.1 note" }, { key: "taxPeriod", label: "Tax period" },
  { key: "amount", label: "Amount" }, { key: "description", label: "Description" }, { key: "reference", label: "Reference" }, { key: "process", label: "Process" },
]
export const adjustmentCsvName = (date = new Date().toISOString().slice(0, 10)) => `vat-adjustments-${date}.csv`
/** …and what an edit of one records in the audit trail. */
export const ADJUSTMENT_DIFF_FIELDS = ["kind", "issueDate", "taxPeriod", "amount", "description", "reference"]
export const adjustmentDiff = (a: VatAdjustment, b: VatAdjustment) => diff(a, b, ADJUSTMENT_DIFF_FIELDS)
/** A new adjustment's identity: the next id of the `va` series and the next VA-MMYY####. */
export const adjustmentIdentity = (date: string) => ({ id: `va${db.seq.adjustment + 1}`, no: nextNo("VA", "adjustment", db.adjustments, date) })
export const claimAdjustmentId = () => { db.seq.adjustment += 1 }
/** The adjustment's own trail — its history entry, stamped by whoever writes it. */
export const stampAdjustmentHistory = stampLifeHistory
/**
 * What an adjustment may hold: a date that is not in the future, a tax period inside the return range and not yet
 * submitted, and — for a claim of SD on the inputs of exported goods — a purchase line, an export sale and a quantity
 * inside the six-month window, from which the amount is computed rather than taken.
 */
export function adjustmentBuild(body: unknown, self: VatAdjustment | undefined, src: VatSource = db): RuleProblem | { process: "Created" | "Approved"; date: string; fields: AdjustmentFields } {
  const parsed = adjustmentInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const a = parsed.data
  if (a.issueDate > TODAY) return invalidRule({ issueDate: ["future"] })
  if (a.taxPeriod > CURRENT || a.taxPeriod < FIRST_RETURN) return invalidRule({ taxPeriod: ["outOfRange"] })
  const lock = lockedFieldRule(`${a.taxPeriod}-01`, "taxPeriod", src); if (lock) return invalidRule(lock)
  // R6.3: SD on inputs of exported goods — linked, window-checked, amount computed from the purchase line
  let amount = round2(a.amount), sdExport: VatAdjustment["sdExport"]
  if (a.kind === "sdExport") {
    const r = sdExportLink(a, { purchases: src.purchases, sales: src.sales, adjustments: src.adjustments }, self?.id)
    if ("errors" in r) return invalidRule(r.errors)
    amount = r.amount; sdExport = r.link
  }
  return {
    process: a.process, date: a.issueDate,
    fields: { kind: a.kind, note: ADJUSTMENT_NOTE[a.kind], issueDate: a.issueDate, taxPeriod: a.taxPeriod, amount, description: a.description, reference: a.reference || undefined, sdExport, issuedBy: self?.issuedBy ?? "" },
  }
}
/**
 * Approving re-checks a claim for SD on the inputs of exported goods: another claim may have used the quantity since
 * the draft was saved.
 */
export function adjustmentApproveRule(d: VatAdjustment, src: VatSource = db): RuleProblem | undefined {
  if (d.kind !== "sdExport" || !d.sdExport) return undefined
  const x = d.sdExport
  const r = sdExportLink({ purchaseId: x.purchaseId, itemId: x.itemId, qty: x.qty, saleId: x.saleId, issueDate: d.issueDate, taxPeriod: d.taxPeriod }, { purchases: src.purchases, sales: src.sales, adjustments: src.adjustments }, d.id)
  return "errors" in r ? invalidRule(r.errors) : undefined
}
/** Approve and cancel both refuse to touch an adjustment whose tax period has been submitted (Mushak 9.1). */
export const adjustmentLockRule = (d: VatAdjustment, src: VatSource = db) => lockedConflictProblem(`${d.taxPeriod}-01`, d.no, src) ?? undefined
export const adjustmentRoutes = lifecycle<VatAdjustment, AdjustmentFields>({
  entity: "adjustment", label: "VAT adjustment", list: () => db.adjustments, idPrefix: "va", seq: "adjustment", noPrefix: "VA",
  build: (body, self) => { const r = adjustmentBuild(body, self); return "status" in r ? { error: ruleResponse(r) } : r },
  locked: (d) => lockedConflict(`${d.taxPeriod}-01`, d.no),
  approve: (d) => { const r = adjustmentApproveRule(d); return r ? ruleResponse(r) : null },
  diffFields: ADJUSTMENT_DIFF_FIELDS,
  spec: adjustmentSpec,
  csv: ADJUSTMENT_CSV_COLUMNS,
  csvName: "vat-adjustments",
})

/* ── Mushak 9.1 returns ────────────────────────────────────────────────── */

/**
 * R5.6: one return per tax period, so the period *is* its id — there is no number series and no `process`. A return
 * is a draft until it is submitted, and submitting one freezes the computation it was filed with (`snapshot`),
 * which is why the period lock reads these and nothing else.
 */
export const findReturn = (period: string, src: ReturnSource = db) => src.returns.find((r) => r.period === period)
/** The tax period the company's clock is in — the one a compliance answer defaults to. */
export const currentPeriod = () => CURRENT
/** The ref the audit trail records for a return — "9.1 · September 2026" — the same on either side. */
export const returnRef = (period: string): string => `9.1 · ${periodLabel(period)}`
/** The row the register prints: the totals the period computes to, its due date and whether it was filed late. */
export function returnRow(r: VatReturn, src: ReturnSource = db): VatReturnRow {
  const c = r.snapshot ?? computeReturn(src, r.period, r.manual)
  const due = returnDue(r.period, src.vatSettings)
  return { ...r, snapshot: undefined, due, netPayable: c.payableVat, deposited: c.depositedVat, closing: c.closingVat, late: !!r.submissionDate && r.submissionDate > due }
}
/** Every tax period the company files for, with the state its return is in. */
export function taxPeriods(src: ReturnSource = db): TaxPeriod[] {
  return periodsBetween(FIRST_RETURN, CURRENT).map((p) => {
    const r = findReturn(p, src)
    const due = returnDue(p, src.vatSettings)
    // R6.6: an approved / deemed Mushak 9.3 extension keeps an unfiled period "open" up to the allowed date
    const extendedTo = extensionFor(p, src.lateFilings, src.vatSettings, TODAY)
    const status = r?.status === "submitted" ? "submitted" : r ? "draft" : TODAY > (extendedTo ?? due) ? "overdue" : "open"
    return { period: p, due, status, returnId: r?.id, submittedAt: r?.submissionDate, locked: r?.status === "submitted", ...(extendedTo ? { extendedTo } : {}) }
  })
}
/** R6.6: the period's Mushak 9.3 (latest that is not refused) and 9.4 applications. */
export function applicationsOf(period: string, src: ReturnSource = db): NonNullable<ReturnView["applications"]> {
  const ret = findReturn(period, src)
  const lf = [...(src.lateFilings ?? [])].reverse().find((x) => x.period === period && x.status !== "rejected")
  const lr = lf ? lateFilingRow(lf, ret, src.vatSettings, TODAY) : undefined
  return {
    ...(lr ? { late: { id: lr.id, no: lr.no, state: lr.state, effectiveDate: lr.effectiveDate } } : {}),
    amendments: ret ? (src.returnAmendments ?? []).filter((a) => a.period === period).map((a) => { const x = amendmentRow(a, ret, src.returnAmendments, src.vatSettings, TODAY); return { id: x.id, no: x.no, state: x.state, direction: x.effect.direction } }) : [],
  }
}
/** One return with its computation: a period nothing has been filed for answers a live draft of one. */
export function returnView(period: string, src: ReturnSource = db): ReturnView | null {
  const r = findReturn(period, src)
  if (!r) {
    if (!PERIOD_RE.test(period) || period < FIRST_RETURN || period > CURRENT) return null
    const computation = computeReturn(src, period)
    return { id: period, period, type: "original", activities: true, status: "draft", manual: EMPTY_MANUAL, createdAt: "", due: returnDue(period, src.vatSettings), netPayable: computation.payableVat, deposited: computation.depositedVat, closing: computation.closingVat, late: false, computation, live: true, notStarted: true, applications: applicationsOf(period, src) }
  }
  const computation = r.snapshot ?? computeReturn(src, period, r.manual)
  return { ...returnRow(r, src), computation, live: !r.snapshot, applications: applicationsOf(period, src) }
}
/** The register: what it searches, the two facets it counts and the totals it prints. */
export const returnSpec: QuerySpec<VatReturnRow> = {
  search: (x) => `${x.period} ${periodLabel(x.period)} ${x.ackNo ?? ""}`,
  facets: { status: (x) => x.status, type: (x) => x.type },
  totals: ["netPayable", "deposited"],
}
/** …and the columns it prints (the note numbers are the Mushak 9.1's own). */
export const RETURN_CSV_COLUMNS: { key: string; label: string; get?: (x: VatReturnRow) => unknown }[] = [
  { key: "period", label: "Tax period", get: (x) => periodLabel(x.period) }, { key: "type", label: "Return type" }, { key: "status", label: "Status" },
  { key: "submissionDate", label: "Submission date" }, { key: "due", label: "Due date" }, { key: "netPayable", label: "Net payable VAT (50)" },
  { key: "deposited", label: "VAT deposited (58)" }, { key: "closing", label: "Closing balance (65)" }, { key: "ackNo", label: "Acknowledgement" },
]
export const returnCsvName = (date = new Date().toISOString().slice(0, 10)) => `vat-returns-${date}`
/** What an edit records in the audit trail. */
export const RETURN_DIFF_FIELDS = ["type", "activities", "submissionDate", "manual.interestVat", "manual.interestSd",
  "manual.penaltyLate", "manual.penaltyOther", "manual.refund", "manual.refundVat"]

/** Starting a return: a period the company files for, in order, and not started twice. */
export function returnCreateRule(period: string | undefined, src: ReturnSource = db): RuleProblem | { period: string } {
  if (!period || !PERIOD_RE.test(period)) return invalidRule({ period: ["required"] })
  if (period < FIRST_RETURN || period > CURRENT) return invalidRule({ period: ["outOfRange"] })
  if (findReturn(period, src)) return { status: 409, title: `A return for ${periodLabel(period)} already exists.` }
  const prev = prevPeriod(period)
  if (prev >= FIRST_RETURN && findReturn(prev, src)?.status !== "submitted") return { status: 409, title: `Submit the ${periodLabel(prev)} return first — returns are filed in order.` }
  return { period }
}
/** Editing a draft: the submission date has to fall after the period ends, and a refund cannot exceed the balance. */
export function returnEditRule(period: string, body: unknown, src: ReturnSource = db):
  RuleProblem | { fields: ReturnFields; changes: ReturnType<typeof diff> } {
  const r = findReturn(period, src)
  if (!r) return { status: 404, title: `No return started for ${periodLabel(period)}` }
  if (r.status !== "draft") return { status: 409, title: `The ${periodLabel(period)} return has been submitted — file an amended return in the NBR portal.` }
  const parsed = returnInput.safeParse(body)
  if (!parsed.success) return { status: 422, title: "Validation failed", errors: zodErrors(parsed.error) }
  const d = parsed.data
  if (d.submissionDate && d.submissionDate <= periodEnd(period)) return invalidRule({ submissionDate: ["beforePeriodEnd"] })
  const rp = refundProblem(period, d.manual, src); if (rp) return rp
  const before = structuredClone(r)
  const fields: ReturnFields = { type: d.type, amendReason: d.type === "amended" ? d.amendReason : undefined, activities: d.activities, submissionDate: d.submissionDate || undefined, manual: d.manual }
  return { fields, changes: diff(before, { ...r, ...fields }, RETURN_DIFF_FIELDS) }
}
/**
 * Submitting: the period has to be over, the previous return filed, the date real and not in the future, a refund
 * within the closing balance, and note 58 has to cover note 50 — the treasury deposits of the period pay what the
 * return says is due, so a shortfall is a 409 that names the amount and the economic code. What the caller has to
 * store with the submission is returned: the computation it freezes, the type (an original filed late is a "late"
 * return) and the acknowledgement number.
 */
export function returnSubmitRule(body: { action?: string }, period: string, src: ReturnSource = db):
  RuleProblem | { computation: ReturnComputation; type: VatReturn["type"]; ackNo: string } {
  const r = findReturn(period, src)
  if (!r) return { status: 404, title: `No return started for ${periodLabel(period)}` }
  if (body.action !== "submit") return { status: 400, title: "action must be submit" }
  if (r.status === "submitted") return { status: 409, title: `The ${periodLabel(period)} return was already submitted.` }
  if (TODAY <= periodEnd(period)) return { status: 409, title: `The tax period ${periodLabel(period)} ends on ${periodEnd(period)} — the return can be submitted from the next day.` }
  const prev = prevPeriod(period)
  if (prev >= FIRST_RETURN && findReturn(prev, src)?.status !== "submitted") return { status: 409, title: `Submit the ${periodLabel(prev)} return first.` }
  if (!r.submissionDate) return invalidRule({ submissionDate: ["required"] })
  if (r.submissionDate > TODAY) return invalidRule({ submissionDate: ["future"] })
  const rp = refundProblem(period, r.manual, src); if (rp) return rp
  const c = computeReturn(src, period, r.manual)
  const zone = src.vatSettings.zoneCode
  if (c.shortVat > 0 || c.shortSd > 0) {
    const parts = [c.shortVat > 0 ? `৳${c.shortVat.toLocaleString("en-IN")} VAT under ${economicCode("vat", zone)}` : "", c.shortSd > 0 ? `৳${c.shortSd.toLocaleString("en-IN")} SD under ${economicCode("sd", zone)}` : ""].filter(Boolean)
    return { status: 409, title: `Deposit ${parts.join(" and ")} (TR-6) before submitting — note 58 must cover note 50.` }
  }
  const type: VatReturn["type"] = r.type === "original" && r.submissionDate > returnDue(period, src.vatSettings) ? "late" : r.type
  const ackNo = `NBR-91-${period.replace("-", "")}-${String(900_000 + src.returns.length * 1_117).padStart(7, "0")}`
  return { computation: c, type, ackNo }
}
/** Deleting: a submitted return cannot be — an amended one has to be filed in the NBR portal instead. */
export function returnDeleteRule(period: string, src: ReturnSource = db): RuleProblem | null {
  const r = findReturn(period, src)
  if (!r) return { status: 404, title: `No return started for ${periodLabel(period)}` }
  if (r.status !== "draft") return { status: 409, title: "Submitted returns cannot be deleted." }
  return null
}
/** A refund cannot be larger than the balance the period is closing with. */
export function refundProblem(period: string, manual: VatReturn["manual"], src: ReturnSource = db): RuleProblem | null {
  if (!manual.refund) return null
  const avail = computeReturn(src, period, { ...manual, refund: false, refundVat: 0, refundSd: 0 })
  const errors: Record<string, string[]> = {}
  if (manual.refundVat > Math.max(0, avail.closingVat) + 0.004) errors["manual.refundVat"] = ["refundExceeds"]
  if (manual.refundSd > Math.max(0, avail.closingSd) + 0.004) errors["manual.refundSd"] = ["refundExceeds"]
  return has(errors) ? invalidRule(errors) : null
}

export const returnListRoutes = {
  GET: withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "period.desc")
    const r = runQuery(db.returns.map((x) => returnRow(x)), sp, returnSpec)
    if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, RETURN_CSV_COLUMNS), `${returnCsvName()}.csv`)
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json({ ...page, periods: taxPeriods() })
  }),
  POST: withAuth("doc.create", async (req, _ctx, user) => {
    const { period } = (await req.json().catch(() => ({}))) as { period?: string }
    const rule = returnCreateRule(period)
    if ("status" in rule) return ruleResponse(rule)
    const r: VatReturn = { id: rule.period, period: rule.period, type: "original", activities: true, status: "draft", manual: { ...EMPTY_MANUAL }, createdAt: new Date().toISOString(), history: [] }
    db.returns.push(r)
    history("vatReturn", r as unknown as LifeDoc, user.name, "created", undefined, undefined, returnRef(rule.period), rule.period)
    return json(returnView(rule.period), { status: 201 })
  }),
}
type PCtx = { params: Promise<{ period: string }> }
export const returnDocRoutes = {
  GET: withAuth<PCtx>(null, async (_req, { params }) => {
    const { period } = await params
    await delay(200)
    const v = returnView(period)
    return v ? json(v) : problem(404, "Tax period not found")
  }),
  PUT: withAuth<PCtx>("doc.edit", async (req, { params }, user) => {
    const { period } = await params
    const rule = returnEditRule(period, await req.json().catch(() => ({})))
    if ("status" in rule) return ruleResponse(rule)
    const r = findReturn(period)!
    Object.assign(r, rule.fields)
    history("vatReturn", r as unknown as LifeDoc, user.name, "edited", undefined, rule.changes, returnRef(period), period)
    return json(returnView(period))
  }),
  PATCH: withAuth<PCtx>("doc.approve", async (req, { params }, user) => {
    const { period } = await params
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    const rule = returnSubmitRule(body, period)
    if ("status" in rule) return ruleResponse(rule)
    const r = findReturn(period)!
    r.type = rule.type
    r.status = "submitted"
    r.snapshot = rule.computation
    r.submittedBy = user.name
    r.submittedAt = new Date().toISOString()
    r.ackNo = rule.ackNo
    history("vatReturn", r as unknown as LifeDoc, user.name, "submitted", `Acknowledgement ${r.ackNo}`, undefined, returnRef(period), period)
    return json(returnView(period))
  }),
  DELETE: withAuth<PCtx>("doc.delete", async (_req, { params }, user) => {
    const { period } = await params
    const rule = returnDeleteRule(period)
    if (rule) return ruleResponse(rule)
    const i = db.returns.findIndex((r) => r.period === period)
    const [r] = db.returns.splice(i, 1)
    history("vatReturn", r as unknown as LifeDoc, user.name, "deleted", undefined, undefined, returnRef(period), period)
    return json({ ok: true })
  }),
}
type NCtx = { params: Promise<{ period: string; note: string }> }
/** The documents behind a note (the legacy sub-form crashed with HTTP 500, D-04). */
export interface SubFormAnswer { period: string; note: number; rows: SubFormRow[]; total: { value: number; sd: number; vat: number } }
export const SUBFORM_CSV_COLUMNS = (note: number) => [
  { key: "date", label: "Date" }, { key: "ref", label: "Document" }, { key: "party", label: "Party" }, { key: "bin", label: "BIN" },
  { key: "value", label: "Value" }, { key: "sd", label: "SD" }, { key: "vat", label: note >= 58 ? "Amount" : "VAT" }, { key: "note", label: "Reference" },
]
export function subFormAnswer(period: string, note: number, src: ReturnSource = db): RuleProblem | SubFormAnswer {
  const def = noteDef(note)
  if (!def) return { status: 404 as const, title: `Note ${note} does not exist on Mushak 9.1` }
  if (!PERIOD_RE.test(period) || period < FIRST_RETURN || period > CURRENT) return { status: 404 as const, title: "Tax period not found" }
  const rows = subForm(src, period, note)
  return { period, note, rows, total: { value: round2(rows.reduce((s, r) => s + r.value, 0)), sd: round2(rows.reduce((s, r) => s + (r.sd ?? 0), 0)), vat: round2(rows.reduce((s, r) => s + r.vat, 0)) } }
}
/** GET /vat/returns/{period}/notes/{note} — the sub-form: documents behind a note. */
export const subFormRoute = withAuth<NCtx>(null, async (req, { params }) => {
  const { period, note } = await params
  const answer = subFormAnswer(period, Number(note))
  if ("status" in answer) return ruleResponse(answer)
  if (new URL(req.url).searchParams.get("format") === "csv")
    return csvResponse(toCSV(answer.rows, SUBFORM_CSV_COLUMNS(answer.note)), `mushak-9.1-${period}-note-${note}.csv`)
  await delay(80)
  return json(answer)
})

export const periodsRoute = withAuth(null, async () => json(taxPeriods()))

/** Compliance centre summary for one tax period — the return, the deposits and the VDS it still owes. */
export interface ComplianceAnswer {
  period: string; due: string; daysLeft: number; status: VatReturn["status"]; notStarted: boolean; locked: boolean
  submissionDate?: string; ackNo?: string
  computation: Pick<ReturnComputation, "outputVat" | "inputVat" | "increasing" | "decreasing" | "netVat" | "payableVat" | "payableSd" | "depositedVat" | "shortVat" | "shortSd" | "closingVat" | "openingVat" | "drafts">
  deposits: { count: number; amount: number; pending: number }
  vds: { toIssue: number; toIssueAmount: number; issueBy: string; awaited: number; awaitedAmount: number }
  periods: TaxPeriod[]
}
export function complianceAnswer(period: string, src: ReturnSource = db): RuleProblem | ComplianceAnswer {
  if (!PERIOD_RE.test(period) || period < FIRST_RETURN || period > CURRENT) return invalidRule({ period: ["outOfRange"] })
  const view = returnView(period, src)!
  const c = view.computation
  const inP = (d: string) => periodOf(d) === period
  const vdsToIssue = vdsEligible("purchase", undefined, src).filter((e) => inP(e.date) && e.remaining > 0.004)
  const vdsAwaited = vdsEligible("sales", undefined, src).filter((e) => inP(e.date) && e.remaining > 0.004 && src.customers.find((x) => x.id === e.partyId)?.vdsWithholder)
  const deposits = src.treasury.filter((t) => t.taxPeriod === period && t.process !== "Cancelled")
  return {
    period, due: returnDue(period, src.vatSettings), daysLeft: daysBetween(TODAY, returnDue(period, src.vatSettings)), status: view.status, notStarted: !findReturn(period, src), locked: view.status === "submitted",
    submissionDate: view.submissionDate, ackNo: view.ackNo,
    computation: { outputVat: c.outputVat, inputVat: c.inputVat, increasing: c.increasing, decreasing: c.decreasing, netVat: c.netVat, payableVat: c.payableVat, payableSd: c.payableSd, depositedVat: c.depositedVat, shortVat: c.shortVat, shortSd: c.shortSd, closingVat: c.closingVat, openingVat: c.openingVat, drafts: c.drafts },
    deposits: { count: deposits.length, amount: round2(deposits.filter((t) => t.process === "Approved").reduce((s, t) => s + t.amount, 0)), pending: deposits.filter((t) => t.process === "Created").length },
    vds: { toIssue: vdsToIssue.length, toIssueAmount: round2(vdsToIssue.reduce((s, e) => s + e.remaining, 0)), issueBy: vdsCertificateDue(period, src.vatSettings, view.submissionDate), awaited: vdsAwaited.length, awaitedAmount: round2(vdsAwaited.reduce((s, e) => s + e.remaining, 0)) },
    periods: taxPeriods(src),
  }
}
export const complianceRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const answer = complianceAnswer(sp.get("period") || CURRENT)
  if ("title" in answer) return ruleResponse(answer) // the answer carries a `status` of its own: the return's
  await delay(150)
  return json(answer)
})

/* ── VAT settings ──────────────────────────────────────────────────────── */

const PROFILE_FIELDS = ["segment", "exportOriented", "importerType", "filerCategory", "bondLicenseNo", "bondLicenseExpiry", "associationNo", "holidays"]

/** The one row the NBR settings are: the zone the economic codes come from and the company's own profile. */
export function vatSettingsRule(body: unknown, by: string, src: ReturnSource = db): RuleProblem | { fields: VatSettings } {
  const parsed = vatSettingsInput.safeParse(body)
  if (!parsed.success) return { status: 422, title: "Validation failed", errors: zodErrors(parsed.error) }
  return { fields: { zoneCode: parsed.data.zoneCode, profile: parsed.data.profile ?? src.vatSettings.profile, updatedAt: new Date().toISOString(), updatedBy: by } }
}
/** …and what an edit of it records in the audit trail. */
export const VAT_SETTINGS_DIFF_FIELDS = ["zoneCode", ...PROFILE_FIELDS.map((f) => `profile.${f}`)]

export const vatSettingsRoutes = {
  GET: withAuth(null, async () => json(db.vatSettings)),
  PUT: withAuth("settings.manage", async (req, _ctx, user) => {
    const rule = vatSettingsRule(await req.json().catch(() => ({})), user.name)
    if ("status" in rule) return ruleResponse(rule)
    const before = { ...db.vatSettings }
    db.vatSettings = rule.fields
    recordAudit({ actor: user.name, entity: "vatSettings", ref: "VAT settings", action: "updated", changes: diff(before, db.vatSettings, VAT_SETTINGS_DIFF_FIELDS) })
    return json(db.vatSettings)
  }),
}

/* ── Mushak 6.10 (purchases / sales above Tk 2 lakh) ───────────────────── */

export function mushak610(from: string, to: string, src: VatSource = db, head: { name: string; address: string; bin: string } = company) {
  const inR = (d: string) => d >= from && d <= to
  const row = (d: Sale | Purchase, sl: number) => {
    const sale = "customerId" in d
    const p = sale ? src.customers.find((c) => c.id === d.customerId) : src.vendors.find((v) => v.id === (d as Purchase).vendorId)
    return { sl, id: d.id, date: d.issueDate, no: d.invoiceNo, challanNo: d.challanNo, party: p?.name ?? "", address: p?.address ?? "", bin: p?.bin ?? "", value: d.subtotal, vat: d.vat, total: d.netTotal }
  }
  const pick = <T extends Sale | Purchase>(rows: T[]) => rows.filter((d) => d.process === "Approved" && inR(d.issueDate) && d.netTotal > M610_LIMIT).sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.invoiceNo.localeCompare(b.invoiceNo)).map((d, i) => row(d, i + 1))
  const purchases = pick(src.purchases), sales = pick(src.sales)
  const sum = (rows: ReturnType<typeof row>[]) => ({ value: round2(rows.reduce((s, r) => s + r.value, 0)), vat: round2(rows.reduce((s, r) => s + r.vat, 0)), total: round2(rows.reduce((s, r) => s + r.total, 0)) })
  return { from, to, limit: M610_LIMIT, company: { name: head.name, address: head.address, bin: head.bin }, purchases, sales, totals: { purchases: sum(purchases), sales: sum(sales) } }
}
