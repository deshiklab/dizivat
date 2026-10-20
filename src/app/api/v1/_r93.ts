/**
 * R9.3 — the statements and the close: the trial balance, the profit & loss, the balance sheet and the
 * cash flow, each a date range over the same derived journal the chart and the register serve (see
 * `lib/statements.ts` — nothing is stored), plus the close that advances the books' cut-off. The close is
 * a control action, not a document: it refuses a non-month-end, the future, a date already closed
 * through, and any draft money document, transfer, journal entry or asset dated on or before it — the
 * books cannot be closed over an open document.
 */
import { invalidRule, json, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { closeInput } from "@/lib/schemas"
import { csvResponse, toCSV } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { TODAY } from "@/lib/company"
import { balanceSheetOf, cashFlowOf, fiscalYearStart, profitLossOf, trialBalanceOf } from "@/lib/statements"
import type { GlSource } from "@/lib/gl"
import { SOURCE_KIND_LABELS } from "./_r92"

/** The mock's GL source is the whole world; the native module reads the same fields from its tables. */
export const glSource93 = (): GlSource => db

/* ── the statements (derived reads; a date range over the journal) ─────── */

export const TRIAL_BALANCE_CSV_COLUMNS = [
  { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "group", label: "Group" },
  { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" },
]

export const trialBalanceRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const r = trialBalanceOf(glSource93(), sp.get("asOf") || TODAY)
  if (sp.get("format") === "csv") return csvResponse(toCSV(r.rows, TRIAL_BALANCE_CSV_COLUMNS), `trial-balance-${r.asOf}.csv`)
  return json(r)
})

export const PROFIT_LOSS_CSV_COLUMNS = [
  { key: "section", label: "Section" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "amount", label: "Amount" },
]

const flatten = <T extends { code: string; name: string; amount: number }>(section: string, rows: T[]) =>
  rows.map((l) => ({ section, code: l.code, name: l.name, amount: l.amount }))

export const profitLossRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || fiscalYearStart(TODAY)
  const to = sp.get("to") || TODAY
  const r = profitLossOf(glSource93(), from, to)
  if (sp.get("format") === "csv")
    return csvResponse(toCSV([
      ...flatten("Revenue", r.revenue), ...flatten("Direct costs", r.direct), ...flatten("Operating expenses", r.operating), ...flatten("Tax costs", r.taxCosts),
    ], PROFIT_LOSS_CSV_COLUMNS), `profit-and-loss-${from}-to-${to}.csv`)
  return json(r)
})

export const BALANCE_SHEET_CSV_COLUMNS = [
  { key: "side", label: "Side" }, { key: "group", label: "Group" }, { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "amount", label: "Amount" },
]

export const balanceSheetRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const r = balanceSheetOf(glSource93(), sp.get("asOf") || TODAY)
  if (sp.get("format") === "csv")
    return csvResponse(toCSV([
      ...r.assets.flatMap((x) => flatten(x.group, x.rows).map((l) => ({ ...l, side: "Assets" }))),
      ...r.liabilities.flatMap((x) => flatten(x.group, x.rows).map((l) => ({ ...l, side: "Liabilities" }))),
      ...r.equity.flatMap((x) => flatten(x.group, x.rows).map((l) => ({ ...l, side: "Equity" }))),
    ], BALANCE_SHEET_CSV_COLUMNS), `balance-sheet-${r.asOf}.csv`)
  return json(r)
})

export const CASH_FLOW_CSV_COLUMNS = [
  { key: "source", label: "Source" }, { key: "amount", label: "Net movement" },
]

export const cashFlowRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || fiscalYearStart(TODAY)
  const to = sp.get("to") || TODAY
  const r = cashFlowOf(glSource93(), from, to)
  const rows = r.rows.map((x) => ({ ...x, label: SOURCE_KIND_LABELS[x.kind] ?? x.kind }))
  if (sp.get("format") === "csv")
    return csvResponse(toCSV(rows.map((x) => ({ source: x.label, amount: x.amount })), CASH_FLOW_CSV_COLUMNS), `cash-flow-${from}-to-${to}.csv`)
  return json({ ...r, rows })
})

/* ── the close of the books ────────────────────────────────────────────── */

/** What a close may do: a month-end in the past, past the current cut-off, with no open document under it. */
export function buildClose(body: unknown, src: GlSource): RuleProblem | { fields: { to: string; note?: string } } {
  const parsed = closeInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const { to, note } = parsed.data
  const [y, m] = to.split("-").map(Number)
  if (Number(to.slice(8)) !== new Date(Date.UTC(y, m, 0)).getUTCDate()) return invalidRule({ to: ["notMonthEnd"] })
  if (to > TODAY) return invalidRule({ to: ["future"] })
  const cur = src.accountingConfig.closedUpTo
  if (cur && to <= cur) return invalidRule({ to: ["alreadyClosed"] })
  const drafts = [
    ...src.moneyDocs.filter((d) => d.process === "Created" && d.date <= to).map((d) => d.no),
    ...src.moneyTransfers.filter((d) => d.process === "Created" && d.date <= to).map((d) => d.no),
    ...src.journalEntries.filter((d) => d.process === "Created" && d.date <= to).map((d) => d.no),
    ...src.assets.filter((d) => d.process === "Created" && d.date <= to).map((d) => d.no),
  ]
  if (drafts.length)
    return { status: 409, title: `Drafts dated on or before ${to} are still open (${drafts.join(", ")}) — approve or delete them before closing the books.` }
  return { fields: { to, note } }
}

/** The close itself: the cut-off moves, the audit trail records who moved it and why. */
export const closeRoute = withAuth("settings.manage", async (req, _ctx, user) => {
  const r = buildClose(await req.json().catch(() => ({})), db)
  if ("status" in r) return ruleResponse(r)
  const before = db.accountingConfig.closedUpTo
  const at = new Date().toISOString()
  db.accountingConfig = { ...db.accountingConfig, closedUpTo: r.fields.to, updatedAt: at, updatedBy: user.name }
  recordAudit({
    at, actor: user.name, entity: "accounting", ref: "Close of the books", action: "closed",
    note: `books closed up to ${r.fields.to}${before ? ` (was ${before})` : ""}${r.fields.note ? ` — ${r.fields.note}` : ""}`,
  })
  return json(db.accountingConfig, { status: 201 }) // the native answers 201 too — a POST that moved the cut-off
})
