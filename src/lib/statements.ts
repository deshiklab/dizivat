/**
 * R9.3 — the statements: the trial balance, the profit & loss, the balance sheet and the cash flow,
 * all folded from the journal the R9.2 posting rules derive. Nothing is stored: a statement is a date
 * range over the same read model the chart and the register serve, so it can no more disagree with the
 * books than the trial balance foot can — the balance sheet balances because every entry does.
 *
 * The fiscal year is the NBR's: July through June. The balance sheet's equity carries two computed
 * lines — the profit brought forward (every revenue and expense movement before the year opened) and the
 * profit for the period (the movement since) — because the demo books open against 3910, not a retained
 * earnings account, and by construction the two lines are exactly what the assets less the liabilities
 * less the stored equity accounts leave over.
 */
import type {
  BalanceSheetReport, BalanceSheetSection, CashFlowReport, CashFlowRow, GlAccount, JournalEntry,
  ProfitLossReport, StatementLine, TrialBalanceReport, TrialBalanceRow,
} from "./types"
import { round2 } from "./vat"
import { TODAY } from "./company"
import { chartOf, journalOf, type GlSource } from "./gl"

/** An account's debit / credit movement between two dates (inclusive). */
function movements(src: GlSource, from: string, to: string): Map<string, { debit: number; credit: number }> {
  const m = new Map<string, { debit: number; credit: number }>()
  for (const e of journalOf(src)) {
    if (e.date < from || e.date > to) continue
    for (const l of e.lines) {
      const cur = m.get(l.account) ?? { debit: 0, credit: 0 }
      m.set(l.account, { debit: round2(cur.debit + l.debit), credit: round2(cur.credit + l.credit) })
    }
  }
  return m
}

/** The trial balance: every account with a position as of a date, on the side it balances. */
export function trialBalanceOf(src: GlSource, asOf: string): TrialBalanceReport {
  const m = movements(src, "1970-01-01", asOf)
  const rows: TrialBalanceRow[] = []
  let debit = 0, credit = 0
  for (const a of chartOf(src)) {
    const mv = m.get(a.code) ?? { debit: 0, credit: 0 }
    const dr = round2(mv.debit - mv.credit)
    if (Math.abs(dr) < 0.005) continue
    if (dr > 0) { rows.push({ code: a.code, name: a.name, group: a.group, kind: a.kind, debit: dr, credit: 0 }); debit = round2(debit + dr) }
    else { rows.push({ code: a.code, name: a.name, group: a.group, kind: a.kind, debit: 0, credit: -dr }); credit = round2(credit - dr) }
  }
  return { asOf, rows, totals: { debit, credit } }
}

/** The profit & loss: revenue less the cost groups for a period, each line an account's movement in its natural sign. */
export function profitLossOf(src: GlSource, from: string, to: string): ProfitLossReport {
  const m = movements(src, from, to)
  const line = (a: GlAccount, kind: GlAccount["kind"]): StatementLine | null => {
    const mv = m.get(a.code) ?? { debit: 0, credit: 0 }
    // a revenue reads as what it earned (its credits), a cost as what it cost (its debits)
    const amount = round2(kind === "revenue" ? mv.credit - mv.debit : mv.debit - mv.credit)
    return Math.abs(amount) < 0.005 ? null : { code: a.code, name: a.name, group: a.group, amount }
  }
  const pick = (kind: GlAccount["kind"], groups: string[]) =>
    chartOf(src).filter((a) => a.kind === kind && groups.includes(a.group)).map((a) => line(a, kind)).filter((x): x is StatementLine => !!x)
  const revenue = pick("revenue", ["Revenue"])
  const direct = pick("expense", ["Direct costs"])
  const operating = pick("expense", ["Operating expenses"])
  const taxCosts = pick("expense", ["Tax costs"])
  const sum = (rows: StatementLine[]) => round2(rows.reduce((s, l) => s + l.amount, 0))
  const revenueTotal = sum(revenue), directTotal = sum(direct), operatingTotal = sum(operating), taxTotal = sum(taxCosts)
  return {
    from, to, revenue, direct, operating, taxCosts,
    revenueTotal, directTotal, operatingTotal, taxTotal,
    grossProfit: round2(revenueTotal - directTotal),
    netProfit: round2(revenueTotal - directTotal - operatingTotal - taxTotal),
  }
}

/** The NBR fiscal year (July–June) a date sits in — the profit & loss and the equity's period line run on it. */
export const fiscalYearStart = (d: string) => {
  const y = Number(d.slice(0, 4)), mo = Number(d.slice(5, 7))
  return mo >= 7 ? `${y}-07-01` : `${y - 1}-07-01`
}

/** The balance sheet as of a date: assets on one side, liabilities and equity (with the computed profit lines) on the other. */
export function balanceSheetOf(src: GlSource, asOf: string): BalanceSheetReport {
  const m = movements(src, "1970-01-01", asOf)
  const sections = (kind: GlAccount["kind"]): BalanceSheetSection[] => {
    const byGroup = new Map<string, StatementLine[]>()
    for (const a of chartOf(src)) {
      if (a.kind !== kind) continue
      const mv = m.get(a.code) ?? { debit: 0, credit: 0 }
      const amount = round2(kind === "asset" ? mv.debit - mv.credit : mv.credit - mv.debit)
      if (Math.abs(amount) < 0.005) continue
      const rows = byGroup.get(a.group) ?? []
      rows.push({ code: a.code, name: a.name, group: a.group, amount })
      byGroup.set(a.group, rows)
    }
    return [...byGroup.entries()].map(([group, rows]) => ({ group, rows, subtotal: round2(rows.reduce((s, l) => s + l.amount, 0)) }))
  }
  const assets = sections("asset")
  const liabilities = sections("liability")
  const storedEquity = sections("equity")
  const equityAccounts = round2(storedEquity.reduce((s, x) => s + x.subtotal, 0))
  const assetsTotal = round2(assets.reduce((s, x) => s + x.subtotal, 0))
  const liabilitiesTotal = round2(liabilities.reduce((s, x) => s + x.subtotal, 0))
  // the computed equity lines: everything the revenue and expense accounts ever moved, split at the fiscal year
  const fyStart = fiscalYearStart(asOf)
  const before = movements(src, "1970-01-01", fyStart), period = movements(src, fyStart, asOf)
  let brought = 0, forPeriod = 0
  for (const a of chartOf(src)) {
    if (a.kind !== "revenue" && a.kind !== "expense") continue
    const b = before.get(a.code) ?? { debit: 0, credit: 0 }, p = period.get(a.code) ?? { debit: 0, credit: 0 }
    // the profit is what the P&L accounts leave: a revenue's credits lift it, an expense's debits draw it down
    brought = round2(brought + (b.credit - b.debit))
    forPeriod = round2(forPeriod + (p.credit - p.debit))
  }
  const equity: BalanceSheetSection[] = [
    ...storedEquity,
    { group: "Equity", rows: [
      ...(Math.abs(brought) >= 0.005 ? [{ code: "", name: "Profit brought forward", group: "Equity", amount: brought }] : []),
      ...(Math.abs(forPeriod) >= 0.005 ? [{ code: "", name: "Profit for the period", group: "Equity", amount: forPeriod }] : []),
    ].filter((r) => Math.abs(r.amount) >= 0.005), subtotal: round2(brought + forPeriod) },
  ].filter((x) => x.rows.length)
  return {
    asOf, assets, liabilities, equity,
    totals: {
      assets: assetsTotal, liabilities: liabilitiesTotal, equityAccounts,
      profitBroughtForward: brought, profitForPeriod: forPeriod,
      liabilitiesAndEquity: round2(liabilitiesTotal + equityAccounts + brought + forPeriod),
    },
  }
}

/** The cash flow: every posting that moved a money account in a period, grouped by what caused it. */
export function cashFlowOf(src: GlSource, from: string, to: string): CashFlowReport {
  const money = new Set(chartOf(src).filter((a) => a.moneyAccountId).map((a) => a.code))
  const effect = (e: JournalEntry) => round2(e.lines.filter((l) => money.has(l.account)).reduce((s, l) => s + l.debit - l.credit, 0))
  const byKind = new Map<string, number>()
  let net = 0
  for (const e of journalOf(src)) {
    if (e.date < from || e.date > to) continue
    const fx = effect(e)
    if (Math.abs(fx) < 0.005) continue
    byKind.set(e.source.kind, round2((byKind.get(e.source.kind) ?? 0) + fx))
    net = round2(net + fx)
  }
  const rows: CashFlowRow[] = [...byKind.entries()].map(([kind, amount]) => ({ kind: kind as CashFlowRow["kind"], amount }))
  const opening = round2(journalOf(src).filter((e) => e.date < from).reduce((s, e) => s + effect(e), 0))
  return { from, to, rows, opening, netMovement: net, closing: round2(opening + net) }
}

export const STATEMENT_TODAY = TODAY
