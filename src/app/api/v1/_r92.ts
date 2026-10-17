/**
 * R9.2 — the general ledger: the chart of accounts, the journal register, and the manual journal entries.
 *
 * The ledger is deliberately derived-posting-first: every document the earlier releases made — invoices,
 * returns, receipts, payments, transfers, TR-6s, VDS entries, adjustments, openings — already knows its
 * debits and credits (see `lib/gl.ts`), so the register is assembled from them at read time and nothing is
 * double-entered. The only journal entries that are documents are the ones no other document carries (the
 * rent prepaid, the electricity accrued) — those are the JE- series, with the same draft → approve → cancel
 * lifecycle every other document has. A derived entry can never be edited from the journal; the drill goes
 * to the document that made it.
 *
 * Shared with the NestJS build the way `_r91` is: the mock handlers and the API's native module both call
 * these builders, so the two runtimes cannot drift.
 */
import { closed, lifecycle, nextNo } from "./_r4"
import { invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { journalInput } from "@/lib/schemas"
import { csvResponse, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { TODAY } from "@/lib/company"
import { round2 } from "@/lib/vat"
import { chartOf, journalOf, ledgerOf, type GlSource } from "@/lib/gl"
import type { JournalRow, ManualJournalEntry } from "@/lib/types"

/** The mock's GL source is the whole world; the native module reads the same fields from its tables. */
export const glSource = (): GlSource => db

/* ── the chart of accounts ─────────────────────────────────────────────── */

export const CHART_CSV_COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Account" },
  { key: "group", label: "Group" },
  { key: "kind", label: "Type" },
  { key: "opening", label: "Opening" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "balance", label: "Balance" },
  { key: "entries", label: "Entries" },
  { key: "active", label: "Active" },
]

/** The chart — every row the template or the seed knows plus the auto rows for unmapped money accounts, each with its derived movement. */
export const chartListRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const rows = chartOf(glSource())
  if (sp.get("format") === "csv") return csvResponse(toCSV(rows, CHART_CSV_COLUMNS), `chart-of-accounts-${TODAY}.csv`)
  return json(rows)
})

/* ── the journal register (derived + manual, a read model) ─────────────── */

export const JOURNAL_DIFF_FIELDS = ["date", "memo", "lines"] as const

export const JOURNAL_CSV_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "no", label: "Entry" },
  { key: "memo", label: "Memo" },
  { key: "sourceKind", label: "Source" },
  { key: "sourceNo", label: "Source no." },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "lineCount", label: "Lines" },
]

export const SOURCE_KIND_LABELS: Record<string, string> = {
  sale: "Sales invoice", purchase: "Purchase", creditNote: "Credit note", debitNote: "Debit note",
  receipt: "Receipt", payment: "Payment", transfer: "Transfer", treasury: "TR-6 challan",
  vdsPurchase: "VDS purchase (6.3)", vdsSales: "VDS sales (6.6)", adjustment: "VAT adjustment",
  opening: "Opening entry", openingBalance: "Opening balance", manual: "Manual entry",
}

/** The register rows: every posting (derived and manual) as one row per entry, with the accounts it touches. */
export function journalRows(src: GlSource): JournalRow[] {
  return journalOf(src).map((e) => {
    const debit = round2(e.lines.reduce((s, l) => s + l.debit, 0))
    return {
      id: e.id, no: e.no, date: e.date, memo: e.memo,
      sourceKind: e.source.kind, sourceNo: e.source.no, sourceId: e.source.id,
      debit, credit: debit, lineCount: e.lines.length,
      accounts: [...new Set(e.lines.map((l) => l.account))],
      process: e.process, issuedBy: e.issuedBy,
    }
  })
}

export const journalSpec: QuerySpec<JournalRow> = {
  search: (r) => `${r.no} ${r.memo} ${r.sourceNo} ${r.accounts.join(" ")}`,
  dateField: "date",
  facets: { source: (r) => r.sourceKind, process: (r) => r.process ?? "Posted" },
  totals: ["debit", "credit"],
}

/** The register — a read model over every posting. `?account={code}` narrows to one account's entries. */
export const journalListRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  let rows = journalRows(glSource())
  const account = sp.get("account")
  if (account) {
    sp.delete("account")
    rows = rows.filter((r) => r.accounts.includes(account))
  }
  const r = runQuery(rows, sp, journalSpec)
  if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, JOURNAL_CSV_COLUMNS), `journal-${TODAY}.csv`)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...pg } = r
  return json({ ...pg, facetLabels: { source: SOURCE_KIND_LABELS } })
})

/* ── the manual journal entries (the only journal documents) ───────────── */

export type JournalFields = Omit<ManualJournalEntry, "id" | "no" | "createdAt" | "history">

/** What a manual entry body may hold, checked against the chart: the accounts must exist and be open for posting. */
export function buildJournal(body: unknown, self: ManualJournalEntry | undefined, src: GlSource): RuleProblem | { process: "Created" | "Approved"; date: string; fields: JournalFields } {
  const parsed = journalInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const t = parsed.data
  const chart = new Map(chartOf(src).map((a) => [a.code, a]))
  const lines: ManualJournalEntry["lines"] = []
  for (const l of t.lines) {
    const debit = round2(l.debit ?? 0), credit = round2(l.credit ?? 0)
    if (debit === 0 && credit === 0) continue
    const acc = chart.get(l.account)
    if (!acc) return invalidRule({ lines: ["unknownAccount"] })
    if (!acc.active) return invalidRule({ lines: ["inactiveAccount"] })
    lines.push({ account: acc.code, debit, credit })
  }
  if (lines.length < 2) return invalidRule({ lines: ["minNonZeroLines"] })
  if (lines.some((l) => l.debit > 0 && l.credit > 0)) return invalidRule({ lines: ["bothSidesOneLine"] })
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0)), cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(dr - cr) > 0.005) return invalidRule({ lines: ["unbalanced"] })
  if (closed(t.date, src)) return invalidRule({ date: ["dateClosed"] })
  if (t.date > TODAY) return invalidRule({ date: ["future"] })
  if (self && self.process === "Approved" && self.date !== t.date && closed(self.date, src))
    return { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${self.no} cannot move out of a closed month.` }
  return {
    process: t.process, date: t.date,
    fields: { date: t.date, memo: t.memo, lines, source: self?.source ?? { kind: "manual", id: "", no: "" }, process: t.process, issuedBy: self?.issuedBy ?? "" },
  }
}

/** Approving: the books must not be closed for the date. */
export function journalApproveRule(d: ManualJournalEntry, src: GlSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be approved.` }
    : undefined
}

/** Cancelling: the books must not be closed for the date either. */
export function journalCancelRule(d: ManualJournalEntry, src: GlSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be cancelled.` }
    : undefined
}

/** A new entry's identity: the next id of its series and the next JE-MMYY####. */
export const journalIdentity = (date: string) => ({
  id: `je${db.seq.journal + 1}`,
  no: nextNo("JE", "journal", db.journalEntries, date),
})
export const claimJournalId = () => { db.seq.journal += 1 }

/** The manual entries' mock endpoints — the `lifecycle` factory, so a JE drafts, approves and cancels like any
 * other document. The list GET is the register itself (every posting, derived and manual — see `journalListRoute`);
 * the doc routes operate on the manual entries alone, and a derived entry's drill goes to its source document. */
export function journalRoutes() {
  const build = (body: unknown, self?: ManualJournalEntry) => {
    const r = buildJournal(body, self, db)
    return "status" in r ? { error: ruleResponse(r) } : r
  }
  const routes = lifecycle<ManualJournalEntry, JournalFields>({
    entity: "journal", label: "Journal entry", list: () => db.journalEntries, idPrefix: "je", seq: "journal", noPrefix: "JE",
    build,
    approve: (d: ManualJournalEntry) => {
      const rule = journalApproveRule(d)
      return rule ? ruleResponse(rule) : null
    },
    cancel: (d: ManualJournalEntry) => {
      const rule = journalCancelRule(d)
      return rule ? ruleResponse(rule) : null
    },
    diffFields: [...JOURNAL_DIFF_FIELDS],
    spec: { search: (e) => `${e.no} ${e.memo}`, dateField: "date" },
    csv: JOURNAL_CSV_COLUMNS as unknown as { key: string; label: string }[],
    csvName: "manual-journal",
  })
  return { ...routes, list: { GET: journalListRoute, POST: routes.list.POST } }
}

/* ── the account ledger ────────────────────────────────────────────────── */

/** One account's ledger — `?account={code}` (required), `?from` / `?to` (default: every posting to today). */
export const ledgerRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const code = sp.get("account")
  if (!code) return problem(422, "Validation failed", { account: ["required"] })
  const src = glSource()
  const from = sp.get("from") || "1970-01-01"
  const to = sp.get("to") || TODAY
  const led = ledgerOf(src, code, from, to)
  if (!led) return problem(404, `No account ${code} in the chart`)
  return json(led)
})
