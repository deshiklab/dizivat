/**
 * R8.2 — bank statements: import, match, reconcile.
 *
 * A garment factory's bank statement is the ground truth its money registers are checked against: customer
 * TTs and cheques in, supplier payments and TR-6 challans out. The importer takes a statement's rows the way
 * the onboarding importers take theirs (dry-run first, all-or-nothing on apply), and each line is matched
 * against the books as they stand:
 *   - a **TR-6 deposit** — the challan number in the narration, or the exact amount on the challan's date;
 *   - a **money receipt / payment already recorded** — same account, and either the same bank reference /
 *     cheque number or the same date and the exact amount the account's ledger moves (a receipt's bank credit
 *     is its amount less the charge);
 *   - anything else stays **open**, with a suggestion when the narration carries a customer's or a vendor's
 *     name — the operator turns it into a receipt / voucher (through the ordinary creators) or marks it a
 *     bank charge, and the account's books-vs-bank difference says what is still unexplained.
 *
 * Shared with the NestJS build: the mock handlers and the API's native module both call `planStatement` /
 * `matchBankLine` / `statementView`, so the two runtimes cannot drift.
 */
import { z } from "zod"
import { buildMoney, history, nextNo, openInvoices } from "./_r4"
import { invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { delay, runQuery } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { round2 } from "@/lib/vat"
import type { AccountingSource } from "./_r4"
import type { User } from "@/lib/auth/roles"
import type { BankLineMatch, BankStatement, BankStatementLine, ImportIssue, MoneyDoc, MoneyKind } from "@/lib/types"

/* ── input ─────────────────────────────────────────────────────────────── */

const bankRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
  narration: z.string().trim().min(1, "required").max(250),
  reference: z.string().trim().max(60).optional().default(""),
  chequeNo: z.string().trim().max(30).optional().default(""),
  deposit: z.number().min(0).max(9_999_999_999).optional().default(0),
  withdrawal: z.number().min(0).max(9_999_999_999).optional().default(0),
}).superRefine((r, ctx) => {
  if (r.deposit === 0 && r.withdrawal === 0) ctx.addIssue({ code: "custom", path: ["deposit"], message: "emptyLine" })
  if (r.deposit > 0 && r.withdrawal > 0) ctx.addIssue({ code: "custom", path: ["withdrawal"], message: "bothSides" })
})

/** Import one statement: {accountId, source?, closingBalance?, dryRun, rows} — the other importers' shape. */
export const statementInput = z.object({
  accountId: z.string().min(1, "required"),
  source: z.string().trim().max(120).optional().default(""),
  closingBalance: z.number().optional(),
  dryRun: z.boolean().default(true),
  rows: z.array(z.record(z.string(), z.unknown())).min(1, "atLeastOneRow").max(2000, "tooManyRows"),
})
/** What an operator does to one line: park it as a bank charge, ignore it, or reopen it. */
export const bankLinePatch = z.object({
  status: z.enum(["open", "charge", "ignored"]),
  note: z.string().trim().max(250).optional().default(""),
})

const num = (v: unknown, d = NaN) => { const n = Number(v); return v === "" || v == null || Number.isNaN(n) ? d : n }
const str = (v: unknown) => String(v ?? "").trim()

/* ── the matcher ───────────────────────────────────────────────────────── */

/** One line against the books — the same answer at import time and in the reconcile view. */
export function matchBankLine(
  line: Pick<BankStatementLine, "date" | "narration" | "reference" | "chequeNo" | "deposit" | "withdrawal">,
  accountId: string,
  src: AccountingSource,
): BankLineMatch {
  const hay = `${line.narration} ${line.reference} ${line.chequeNo}`.toLowerCase()
  // 1. TR-6: the challan number in the narration/reference, else the exact amount on the challan's date
  for (const t of src.treasury) {
    if (t.process !== "Approved" || t.accountId !== accountId) continue
    if (t.challanNo && hay.includes(t.challanNo.toLowerCase()))
      return { status: "matched", matchKind: "treasury", matchId: t.id, matchNo: t.challanNo }
  }
  if (line.withdrawal > 0) {
    for (const t of src.treasury) {
      if (t.process !== "Approved" || t.accountId !== accountId) continue
      if (t.challanDate === line.date && Math.abs(t.amount - line.withdrawal) < 0.005)
        return { status: "matched", matchKind: "treasury", matchId: t.id, matchNo: t.challanNo }
    }
  }
  // 2. money already recorded on this account: the bank's own reference / the cheque number, else date + the ledger's exact movement
  const docs = src.moneyDocs.filter((m) => m.process === "Approved" && m.accountId === accountId)
  for (const m of docs) {
    const kind: BankLineMatch["matchKind"] = m.kind === "receipt" ? "receipt" : "payment"
    const ref = (m.reference ?? "").toLowerCase()
    if (ref && ref === (line.reference ?? "").toLowerCase())
      return { status: "matched", matchKind: kind, matchId: m.id, matchNo: m.no }
    const chq = (m.chequeNo ?? "").toLowerCase()
    if (chq && chq === (line.chequeNo ?? "").toLowerCase())
      return { status: "matched", matchKind: kind, matchId: m.id, matchNo: m.no }
  }
  for (const m of docs) {
    const kind: BankLineMatch["matchKind"] = m.kind === "receipt" ? "receipt" : "payment"
    if (m.kind === "receipt" && m.date === line.date && line.deposit > 0 && Math.abs(m.amount - m.charge - line.deposit) < 0.005)
      return { status: "matched", matchKind: kind, matchId: m.id, matchNo: m.no }
    if (m.kind === "payment" && m.date === line.date && line.withdrawal > 0 && Math.abs(m.amount - line.withdrawal) < 0.005)
      return { status: "matched", matchKind: kind, matchId: m.id, matchNo: m.no }
  }
  // 3. open — with a suggestion when the narration carries a party's whole name (longest wins)
  const named = (kind: MoneyKind) =>
    (kind === "receipt" ? src.customers : src.vendors)
      .filter((p) => p.active !== false && p.name.length >= 5 && hay.includes(p.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0]
  if (line.deposit > 0) {
    const c = named("receipt")
    if (c) {
      const open = openInvoices("receipt", c.id, src)
      return { status: "open", suggestion: { kind: "receipt", partyId: c.id, partyName: c.name, due: round2(open.reduce((s, o) => s + o.due, 0)), invoices: open.length } }
    }
  }
  if (line.withdrawal > 0) {
    const v = named("payment")
    if (v) {
      const open = openInvoices("payment", v.id, src)
      return { status: "open", suggestion: { kind: "payment", partyId: v.id, partyName: v.name, due: round2(open.reduce((s, o) => s + o.due, 0)), invoices: open.length } }
    }
  }
  return { status: "open" }
}

/* ── the import planner ────────────────────────────────────────────────── */

export interface PlannedLine extends BankStatementLine, BankLineMatch {}
export interface StatementPlanResult {
  accountId: string
  accountName: string
  source: string
  from: string
  to: string
  closingBalance?: number
  totals: { deposit: number; withdrawal: number }
  lines: PlannedLine[]
  issues: ImportIssue[]
}

/**
 * Rows → analysed lines. Like the onboarding planners this only resolves and matches; what a row must be is
 * zod's own `bankRow` above. Issues land on the sheet's own row (`{row, field, message}`, row = index + 2).
 */
export function planStatement(accountId: string, rows: Record<string, unknown>[], src: AccountingSource): RuleProblem | { account: AccountingSource["moneyAccounts"][number]; plan: StatementPlanResult } {
  const account = src.moneyAccounts.find((a) => a.id === accountId)
  if (!account) return invalidRule({ accountId: ["unknown"] })
  const issues: ImportIssue[] = []
  const lines: PlannedLine[] = []
  rows.forEach((raw, i) => {
    const row = i + 2
    const body = {
      date: str(raw.date), narration: str(raw.narration), reference: str(raw.reference), chequeNo: str(raw.chequeNo),
      deposit: num(raw.deposit, 0), withdrawal: num(raw.withdrawal, 0),
    }
    const parsed = bankRow.safeParse(body)
    if (!parsed.success) {
      for (const e of parsed.error.issues) issues.push({ row, field: String(e.path[0] ?? "_"), message: e.message })
      return
    }
    const match = matchBankLine(parsed.data, accountId, src)
    lines.push({
      id: "", statementId: "", rowNo: row - 1, date: parsed.data.date, narration: parsed.data.narration,
      reference: parsed.data.reference || undefined, chequeNo: parsed.data.chequeNo || undefined,
      deposit: round2(parsed.data.deposit), withdrawal: round2(parsed.data.withdrawal),
      status: match.status, matchKind: match.matchKind, matchId: match.matchId, matchNo: match.matchNo, suggestion: match.suggestion,
    })
  })
  const dates = lines.map((l) => l.date).sort()
  return {
    account,
    plan: {
      accountId: account.id, accountName: `${account.provider} · ${account.accountNo}`, source: "", from: dates[0] ?? "", to: dates.at(-1) ?? "",
      totals: { deposit: round2(lines.reduce((s, l) => s + l.deposit, 0)), withdrawal: round2(lines.reduce((s, l) => s + l.withdrawal, 0)) },
      lines, issues,
    },
  }
}

/** The dry-run / apply answer document — the same shape both runtimes answer with. */
export const planAnswer = (r: { account: { id: string; provider: string; accountNo: string } }, plan: StatementPlanResult, rows: number) => ({
  accountId: plan.accountId,
  accountName: plan.accountName,
  total: rows,
  valid: plan.lines.length,
  matched: plan.lines.filter((l) => l.status === "matched").length,
  open: plan.lines.filter((l) => l.status === "open").length,
  issues: plan.issues,
  lines: plan.lines,
})

/* ── the books-vs-bank answer ──────────────────────────────────────────── */

/** What the account's ledger says at a date (opening + approved movements up to and including it). */
export function booksBalanceAt(accountId: string, to: string, src: AccountingSource): number {
  const a = src.moneyAccounts.find((x) => x.id === accountId)
  if (!a) return 0
  const docs = src.moneyDocs.filter((m) => m.accountId === a.id && m.process === "Approved" && m.date <= to)
  const dep = src.treasury.filter((t) => t.accountId === a.id && t.process === "Approved" && t.challanDate <= to)
  const inflow = round2(docs.filter((m) => m.kind === "receipt").reduce((s, m) => s + m.amount - m.charge, 0))
  const outflow = round2(docs.filter((m) => m.kind === "payment").reduce((s, m) => s + m.amount, 0) + dep.reduce((s, t) => s + t.amount, 0))
  return round2(a.openingBalance + inflow - outflow)
}

/** A statement with its lines: the match each line was left with, plus what is still unexplained. */
export function statementView(s: BankStatement, lines: BankStatementLine[], src: AccountingSource) {
  const books = booksBalanceAt(s.accountId, s.to, src)
  const open = lines.filter((l) => l.status === "open")
  const unexplained = round2(open.reduce((t, l) => t + l.deposit - l.withdrawal, 0))
  const statementBalance = s.closingBalance != null ? round2(s.closingBalance) : round2(books - unexplained)
  return { statement: s, lines, books, statementBalance, difference: round2(books - statementBalance), open: open.length }
}

/* ── the mock's creators (the native module has its own writers, the same rules) ── */

/** The mock's statement importer — stores the statement and its lines, all-or-nothing. */
export function mockImportStatement(body: unknown, actor: User): RuleProblem | { plan: StatementPlanResult; created: BankStatement } {
  const parsed = statementInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const r = planStatement(parsed.data.accountId, parsed.data.rows, db)
  if ("status" in r) return r
  if (r.plan.issues.length) return invalidRule(Object.fromEntries(r.plan.issues.slice(0, 20).map((i) => [`row ${i.row}`, [i.message]])))
  const no = nextNo("BS", "statement", db.bankStatements, r.plan.to)
  const s: BankStatement = {
    id: `bs${db.seq.statement + 1}`, no, accountId: r.plan.accountId, accountName: r.plan.accountName,
    source: parsed.data.source || `statement-${r.plan.to}`, from: r.plan.from, to: r.plan.to,
    closingBalance: parsed.data.closingBalance, importedAt: new Date().toISOString(), importedBy: actor.name,
    lineCount: r.plan.lines.length, totals: r.plan.totals,
  }
  db.seq.statement += 1
  r.plan.lines.forEach((l) => {
    const line: BankStatementLine & Partial<BankLineMatch> = { ...l, id: `bl${s.id.slice(2)}-${l.rowNo}`, statementId: s.id }
    delete (line as Partial<BankLineMatch>).suggestion
    l.id = line.id
    l.statementId = s.id
    db.bankLines.push(line as BankStatementLine)
  })
  db.bankStatements.push(s)
  history("statement", { ...s, history: [] } as never, actor.name, "created")
  return { plan: r.plan, created: s }
}

/** The mock's line→money-doc creator: through the ordinary receipt / voucher builder, then linked back. */
export function mockCreateFromLine(kind: MoneyKind, statementId: string, lineId: string, body: unknown, actor: User): RuleProblem | Response | { money: MoneyDoc; line: BankStatementLine } {
  const line = db.bankLines.find((l) => l.id === lineId && l.statementId === statementId)
  if (!line) return problem(404, "Statement line not found")
  if (line.status === "matched") return problem(409, "This line is already explained by the books.")
  if (line.moneyId) return problem(409, `A ${kind} was already created from this line (${line.moneyNo}).`)
  if (line.status === "charge" || line.status === "ignored") return problem(409, `This line is parked as ${line.status === "charge" ? "a bank charge" : "ignored"} — reopen it first.`)
  const b = (body ?? {}) as Record<string, unknown>
  const method = (b.method as string) ?? (line.chequeNo ? "cheque" : "bankTransfer")
  // a bank transfer / wallet receipt needs a bank reference — the line's own, or its place on the statement
  const reference = String(b.reference ?? "") || line.reference || ((method === "bankTransfer" || method === "mobile") ? `BS line ${line.rowNo}` : "")
  const r = buildMoney(kind)({
    ...b,
    reference,
    note: b.note ?? `Bank statement ${line.statementId} line ${line.rowNo}: ${line.narration}`.slice(0, 250),
  })
  if ("status" in r) return r
  const d = {
    ...r.fields, issuedBy: actor.name,
    id: `${kind === "receipt" ? "mr" : "pv"}${db.seq[kind] + 1}`,
    no: nextNo(kind === "receipt" ? "MR" : "PV", kind, db.moneyDocs, r.date),
    process: "Created" as const, createdAt: new Date().toISOString(), history: [],
  } as unknown as MoneyDoc
  db.seq[kind] += 1
  db.moneyDocs.push(d)
  history(kind, d as never, actor.name, "created")
  line.status = "receipt"
  line.moneyId = d.id
  line.moneyNo = d.no
  line.matchKind = kind === "receipt" ? "receipt" : "payment"
  line.matchId = d.id
  line.matchNo = d.no
  return { money: d, line }
}

/* ── the mock's routes ─────────────────────────────────────────────────── */

export const statementSpec = {
  search: (s: BankStatement) => `${s.no} ${s.accountName} ${s.source} ${s.importedBy}`,
  dateField: "importedAt" as const,
  facets: { account: (s: BankStatement) => s.accountId },
  totals: [] as never[],
}

/** GET the statements register / POST an import (dry-run analyses, apply stores — all-or-nothing). */
export function statementRoutes() {
  const GET = withAuth(null, async (req: Request) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "no.desc")
    const r = runQuery(db.bankStatements, sp, statementSpec)
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  })
  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const body = await req.json().catch(() => ({}))
    const parsed = statementInput.safeParse(body)
    if (!parsed.success) return ruleResponse(invalidRule(zodErrors(parsed.error)))
    const r = planStatement(parsed.data.accountId, parsed.data.rows, db)
    if ("status" in r) return ruleResponse(r)
    if (parsed.data.dryRun) return json(planAnswer(r, { ...r.plan, source: parsed.data.source }, parsed.data.rows.length))
    const made = mockImportStatement(body, user)
    if ("status" in made) return ruleResponse(made)
    const answer = planAnswer(r, { ...made.plan, source: made.created.source }, parsed.data.rows.length)
    return json({ ...answer, id: made.created.id, no: made.created.no }, { status: 201 })
  })
  return { GET, POST }
}

/** One statement with its lines and the books-vs-bank answer. */
export const statementDocRoutes = {
  GET: withAuth<{ params: Promise<{ id: string }> }>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(80)
    const s = db.bankStatements.find((x) => x.id === id)
    if (!s) return problem(404, "Statement not found")
    // the operator may have matched a line since import — a stored line keeps its own state, but a line still
    // open gets a fresh suggestion so the reconcile view always knows whom the narration names
    const lines = db.bankLines
      .filter((l) => l.statementId === id)
      .map((l) => ({ ...l, suggestion: l.status === "open" ? matchBankLine(l, s.accountId, db).suggestion : undefined }))
    return json(statementView(s, lines, db))
  }),
}

/** Park an open line (bank charge / ignore) or reopen it. */
export const bankLineRoutes = {
  PATCH: withAuth<{ params: Promise<{ id: string; lineId: string }> }>("doc.edit", async (req, { params }) => {
    const { id, lineId } = await params
    const line = db.bankLines.find((l) => l.id === lineId && l.statementId === id)
    if (!line) return problem(404, "Statement line not found")
    const parsed = bankLinePatch.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return ruleResponse(invalidRule(zodErrors(parsed.error)))
    if (line.status === "matched") return problem(409, "This line is already explained by the books.")
    if (line.moneyId) return problem(409, `A money document was already created from this line (${line.moneyNo}) — cancel it first.`)
    line.status = parsed.data.status
    line.note = parsed.data.note || undefined
    return json(line)
  }),
}

/** Create the receipt / voucher an open line is about, linked back to it. */
export const bankLineMoneyRoutes = {
  POST: withAuth<{ params: Promise<{ id: string; lineId: string }> }>("doc.create", async (req, { params }, user) => {
    const { id, lineId } = await params
    const body = (await req.json().catch(() => ({}))) as { kind?: string; process?: string } & Record<string, unknown>
    const kind = body.kind === "payment" ? "payment" : "receipt"
    if (body.process === "Approved") return problem(422, "Create the line's receipt as a draft first, then approve it in the register.")
    const r = mockCreateFromLine(kind, id, lineId, body, user)
    if (r instanceof Response) return r
    if ("status" in r) return ruleResponse(r)
    return json(r.money, { status: 201 })
  }),
}
