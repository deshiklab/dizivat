/**
 * R9.2 — the general ledger: the chart of accounts, the posting rules that derive the ledger from the
 * documents that already exist, and the per-account ledger read.
 *
 * Derived-posting-first is the whole idea: the GL is complete from day one without anyone typing double
 * entries for transactions. Every approved document the company keeps — a sale, a purchase, a credit or
 * debit note, a receipt, a payment, a transfer between own accounts, a TR-6 treasury deposit, a VDS
 * certificate, a VAT adjustment, the opening stock — has one entry derived from it by a pure function,
 * and the manual journal entries (JE-) exist only for what no document carries (prepaid rent, accruals,
 * depreciation until R9.4 writes it, a correction the books need). Nothing derived is ever stored: the
 * documents are the truth, and `journalOf` folds them the way `chequeRowsOf` folds the cheque register.
 *
 * Every entry balances by construction — the counter-line is always computed, never assumed — so the trial
 * balance (R9.3) can no more drift from the documents than the derived balances of the money accounts can.
 */
import type {
  AccountingConfig, CreditNote, DebitNote, GlAccount, GlAccountRow, GlLedger, JournalEntry, JournalLine,
  JournalSourceKind, MoneyAccount, MoneyDoc, MoneyTransfer, OpeningEntry, Party, Purchase, Sale, TreasuryDeposit,
  VatAdjustment, VdsEntry,
} from "./types"
import { round2 } from "./vat"

/** The world the ledger derives from: the accounting source plus the notes, the adjustments and the manual entries. */
export interface GlSource {
  customers: Party[]
  vendors: Party[]
  sales: Sale[]
  purchases: Purchase[]
  creditNotes: CreditNote[]
  debitNotes: DebitNote[]
  openings: OpeningEntry[]
  moneyAccounts: MoneyAccount[]
  moneyDocs: MoneyDoc[]
  moneyTransfers: MoneyTransfer[]
  treasury: TreasuryDeposit[]
  vds: VdsEntry[]
  adjustments: VatAdjustment[]
  glAccounts: GlAccount[]
  journalEntries: JournalEntry[]
  accountingConfig: AccountingConfig
}

/* ── the chart ─────────────────────────────────────────────────────────── */

/** The RMG template the chart ships with. Bank / mobile / cash rows are added per money account below. */
export const CHART_TEMPLATE: GlAccount[] = [
  { code: "1100", name: "Accounts receivable", kind: "asset", group: "Current assets", active: true },
  { code: "1150", name: "Inventory", kind: "asset", group: "Current assets", active: true },
  { code: "1160", name: "Advances to suppliers", kind: "asset", group: "Current assets", active: true },
  { code: "1200", name: "Input VAT receivable", kind: "asset", group: "Tax assets", active: true },
  { code: "1210", name: "SD paid on imports", kind: "asset", group: "Tax assets", active: true },
  { code: "1220", name: "VDS receivable from customers", kind: "asset", group: "Tax assets", active: true },
  { code: "1300", name: "Prepaid expenses", kind: "asset", group: "Current assets", active: true },
  { code: "2100", name: "Accounts payable", kind: "liability", group: "Current liabilities", active: true },
  { code: "2110", name: "VAT payable", kind: "liability", group: "Tax liabilities", active: true },
  { code: "2115", name: "VDS withheld payable", kind: "liability", group: "Tax liabilities", active: true },
  { code: "2120", name: "SD payable", kind: "liability", group: "Tax liabilities", active: true },
  { code: "2130", name: "Customer advances", kind: "liability", group: "Current liabilities", active: true },
  { code: "2140", name: "Treasury payments outside the book accounts", kind: "liability", group: "Current liabilities", active: true,
    note: "TR-6 deposits that name no company account — clear it by naming the account the challan left." },
  { code: "2200", name: "Accrued expenses", kind: "liability", group: "Current liabilities", active: true },
  { code: "3100", name: "Owner capital", kind: "equity", group: "Equity", active: true },
  { code: "3910", name: "Opening balances brought forward", kind: "equity", group: "Equity", active: true },
  { code: "4100", name: "Sales — local", kind: "revenue", group: "Revenue", active: true },
  { code: "4110", name: "Sales — export and deemed export", kind: "revenue", group: "Revenue", active: true },
  { code: "4200", name: "Sales returns", kind: "revenue", group: "Revenue", active: true },
  { code: "4300", name: "Other income", kind: "revenue", group: "Revenue", active: true },
  { code: "4910", name: "SD export refund", kind: "revenue", group: "Revenue", active: true },
  { code: "5100", name: "Cost of purchases — goods", kind: "expense", group: "Direct costs", active: true },
  { code: "5110", name: "Service purchases", kind: "expense", group: "Direct costs", active: true },
  { code: "5300", name: "Bank and MFS charges", kind: "expense", group: "Operating expenses", active: true },
  { code: "5400", name: "Rent", kind: "expense", group: "Operating expenses", active: true },
  { code: "5500", name: "Utilities", kind: "expense", group: "Operating expenses", active: true },
  { code: "5600", name: "Professional fees", kind: "expense", group: "Operating expenses", active: true },
  { code: "5900", name: "Penalties, interest and surcharges", kind: "expense", group: "Tax costs", active: true },
  { code: "5950", name: "VAT and SD adjustments", kind: "expense", group: "Tax costs", active: true },
]

const MONEY_CODE: Record<MoneyAccount["kind"], string> = { cash: "1010", bank: "1020", mobile: "1030" }
const moneyGlName = (a: MoneyAccount) => `${a.kind === "bank" ? a.provider : a.kind === "mobile" ? "Mobile wallet" : "Cash in hand"} · ${a.accountNo}`

/** One GL row for every money account that has none yet — a bank account created after the seed still needs
 * somewhere to post, so its row appears in the chart the moment the account does. */
export function autoMoneyRows(glAccounts: GlAccount[], moneyAccounts: MoneyAccount[]): GlAccount[] {
  const auto: GlAccount[] = []
  const known = new Set(glAccounts.map((a) => a.moneyAccountId).filter(Boolean))
  for (const kind of ["cash", "bank", "mobile"] as const) {
    // the first FREE number of the kind: a bank account created after the seed must not reuse a stored
    // 1020.nn — a duplicate code would fold two accounts' movements into one row and break the trial balance
    const taken = new Set(glAccounts.filter((a) => a.code.startsWith(`${MONEY_CODE[kind]}.`)).map((a) => a.code))
    let n = 1
    for (const a of moneyAccounts.filter((a) => a.kind === kind && !known.has(a.id))) {
      while (taken.has(`${MONEY_CODE[kind]}.${String(n).padStart(2, "0")}`)) n += 1
      auto.push({
        code: `${MONEY_CODE[kind]}.${String(n).padStart(2, "0")}`, name: moneyGlName(a), kind: "asset",
        group: kind === "cash" ? "Cash" : kind === "bank" ? "Bank accounts" : "Mobile wallets", moneyAccountId: a.id, active: a.active,
      })
      n += 1
    }
  }
  return auto
}

/**
 * The chart as the register serves it: the stored rows plus the auto rows for unmapped money accounts, each
 * carrying its derived movement.
 */
export function chartOf(src: GlSource): GlAccountRow[] {
  const auto = autoMoneyRows(src.glAccounts, src.moneyAccounts)
  const movements = new Map<string, { debit: number; credit: number; entries: number }>()
  for (const e of journalOf(src as GlSource)) {
    for (const l of e.lines) {
      const m = movements.get(l.account) ?? { debit: 0, credit: 0, entries: 0 }
      m.debit = round2(m.debit + l.debit); m.credit = round2(m.credit + l.credit); m.entries += 1
      movements.set(l.account, m)
    }
  }
  return [...src.glAccounts, ...auto]
    .map((a) => {
      const m = movements.get(a.code) ?? { debit: 0, credit: 0, entries: 0 }
      const sign = a.kind === "asset" || a.kind === "expense" ? 1 : -1
      return { ...a, opening: 0, debit: m.debit, credit: m.credit, balance: round2(sign * (m.debit - m.credit)), entries: m.entries }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
}

/* ── the posting rules ─────────────────────────────────────────────────── */

/** The GL account a money document / transfer side posts to: the account's own GL row. */
export const moneyGlCode = (src: Pick<GlSource, "glAccounts" | "moneyAccounts">, accountId: string): string => {
  const stored = src.glAccounts.find((a) => a.moneyAccountId === accountId)
  if (stored) return stored.code
  return autoMoneyRows(src.glAccounts, src.moneyAccounts).find((a) => a.moneyAccountId === accountId)?.code ?? "1020.01"
}

/** One entry under construction: the lines keep their order, the counter-line is computed at the end. */
class Entry {
  lines: JournalLine[] = []
  constructor(readonly source: { kind: JournalSourceKind; id: string; no: string }, readonly date: string, readonly memo: string) {}
  dr(account: string, amount: number) { if (round2(amount) > 0) this.lines.push({ account, debit: round2(amount), credit: 0 }) }
  cr(account: string, amount: number) { if (round2(amount) > 0) this.lines.push({ account, debit: 0, credit: round2(amount) }) }
  /** the lines must balance to the poisha; a rule that cannot balance posts nothing. */
  balanced(id: string): JournalEntry | null {
    const dr = round2(this.lines.reduce((s, l) => s + l.debit, 0))
    const cr = round2(this.lines.reduce((s, l) => s + l.credit, 0))
    if (dr === 0 && cr === 0) return null
    if (Math.abs(dr - cr) > 0.005) return null
    return { id, no: this.source.no, date: this.date, memo: this.memo, source: this.source, lines: this.lines }
  }
}

/** The TR-6 heads that clear a tax liability, and the liability each clears. */
const TREASURY_HEAD_ACCOUNT: Record<TreasuryDeposit["head"], string> = {
  vat: "2110", vds: "2115", sd: "2120",
  interest: "5900", penalty: "5900", excise: "5900", devSurcharge: "5900", ictSurcharge: "5900", healthSurcharge: "5900", envSurcharge: "5900",
}

/**
 * The derived journal: one balanced entry per approved document. A cancelled or draft document posts nothing,
 * a deleted one is gone from the source lists, and every entry carries its source so the register can link
 * back to the document that caused it.
 */
export function journalOf(src: GlSource): JournalEntry[] {
  const out: JournalEntry[] = []
  const mg = (accountId: string) => moneyGlCode(src, accountId)
  const push = (e: JournalEntry | null) => { if (e) out.push(e) }

  // go-live: the opening stock and each money account's opening balance come in against equity
  for (const o of src.openings.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "opening", id: o.id, no: o.no }, o.date, `Opening stock — ${o.name}`)
    e.dr("1150", o.value)
    e.dr("1200", o.vatPaid)
    e.cr("3910", round2(o.value + o.vatPaid))
    push(e.balanced(o.id))
  }
  for (const a of src.moneyAccounts.filter((x) => x.openingBalance > 0)) {
    const e = new Entry({ kind: "openingBalance", id: a.id, no: a.accountNo }, a.openingDate ?? src.accountingConfig.closedUpTo ?? "2026-07-01", `Opening balance — ${a.provider} · ${a.accountNo}`)
    e.dr(mg(a.id), a.openingBalance)
    e.cr("3910", a.openingBalance)
    push(e.balanced(a.id))
  }
  // sales: the customer owes the net total; the value is revenue (local or export), the SD and the VAT are
  // the state's — the discount given reduces the value, not the taxes
  for (const s of src.sales.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "sale", id: s.id, no: s.invoiceNo }, s.issueDate, `${s.mode === "Foreign" ? "Export" : "Local"} sale — ${s.customerName}`)
    e.dr("1100", s.netTotal)
    e.cr(s.mode === "Foreign" ? "4110" : "4100", round2(s.subtotal - s.discount))
    e.cr("2120", s.sd)
    e.cr("2110", s.vat)
    push(e.balanced(s.id))
  }
  // purchases: goods build inventory, services are their own cost; the input VAT is an asset whatever the
  // purchase, the SD paid at import likewise. Bonded imports simply carry no VAT or SD
  for (const p of src.purchases.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "purchase", id: p.id, no: p.invoiceNo }, p.issueDate, `${p.mode === "Foreign" ? "Import" : "Local"} purchase — ${p.vendorName}`)
    e.dr(p.category === "service" ? "5110" : "1150", round2(p.subtotal - p.discount))
    e.dr("1200", p.vat)
    e.dr("1210", p.sd)
    e.cr("2100", p.netTotal)
    push(e.balanced(p.id))
  }
  // a credit note hands the goods back: reverse the sale
  for (const c of src.creditNotes.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "creditNote", id: c.id, no: c.no }, c.issueDate, `Sales return — ${c.customerName}`)
    e.dr("4200", c.subtotal)
    e.dr("2120", c.sd)
    e.dr("2110", c.vat)
    e.cr("1100", c.total)
    push(e.balanced(c.id))
  }
  // a debit note sends the goods back: reverse the purchase
  for (const d of src.debitNotes.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "debitNote", id: d.id, no: d.no }, d.issueDate, `Purchase return — ${d.vendorName}`)
    e.dr("2100", d.total)
    e.cr("1150", d.subtotal)
    e.cr("1200", d.vat)
    e.cr("1210", d.sd)
    e.cr("5100", round2(d.total - d.subtotal - d.vat - d.sd)) // the import-duty part of a returned bonded input
    push(e.balanced(d.id))
  }
  // receipts: the account nets of the charge, the charge is the bank's income, the allocation splits the
  // counterparty side between what it settles and what it holds on account (an advance)
  for (const m of src.moneyDocs.filter((x) => x.process === "Approved" && x.kind === "receipt")) {
    const e = new Entry({ kind: "receipt", id: m.id, no: m.no }, m.date, `Receipt — ${m.partyName}`)
    e.dr(mg(m.accountId), round2(m.amount - m.charge))
    e.dr("5300", m.charge)
    e.cr("1100", m.allocated)
    e.cr("2130", m.unallocated)
    push(e.balanced(m.id))
  }
  // payments: the account pays the whole amount (an MFS charge is inside it — the payee nets less), the
  // counterparty side follows the allocation as recorded
  for (const m of src.moneyDocs.filter((x) => x.process === "Approved" && x.kind === "payment")) {
    const e = new Entry({ kind: "payment", id: m.id, no: m.no }, m.date, `Payment — ${m.partyName}`)
    e.dr("2100", m.allocated)
    e.dr("1160", m.unallocated)
    e.cr(mg(m.accountId), m.amount)
    push(e.balanced(m.id))
  }
  // transfers between own accounts: one account up, the other down by the amount plus the charge — the
  // charge is the bank's fee for the move, exactly what the R8.2 reconcile explains as a bank line
  for (const t of src.moneyTransfers.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "transfer", id: t.id, no: t.no }, t.date, `Transfer — ${t.fromAccount} → ${t.toAccount}`)
    e.dr(mg(t.toAccountId), t.amount)
    e.dr("5300", t.charge)
    e.cr(mg(t.fromAccountId), round2(t.amount + t.charge))
    push(e.balanced(t.id))
  }
  // TR-6: the deposit clears the liability the head names (the surcharge heads are costs), and the money
  // leaves the account the challan names — or, when none is named, sits on 2140 until someone names one
  for (const t of src.treasury.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "treasury", id: t.id, no: t.no }, t.challanDate, `TR-6 ${t.head} deposit — challan ${t.challanNo}`)
    e.dr(TREASURY_HEAD_ACCOUNT[t.head], t.amount)
    e.cr(t.accountId ? mg(t.accountId) : "2140", t.amount)
    push(e.balanced(t.id))
  }
  // VDS withheld from a supplier: the invoice owes less, the withheld VAT is owed to the treasury until the
  // TR-6 that deposits it clears 2115. From a customer: our receivable comes down by what they withheld
  for (const v of src.vds.filter((x) => x.process === "Approved")) {
    if (v.mode === "purchase") {
      const e = new Entry({ kind: "vdsPurchase", id: v.id, no: v.no }, v.certificateDate, `VDS withheld — ${v.partyName} (${v.docNo})`)
      e.dr("2100", v.settled ?? 0)
      e.dr("1160", round2(v.amount - (v.settled ?? 0)))
      e.cr("2115", v.amount)
      push(e.balanced(v.id))
    } else {
      const e = new Entry({ kind: "vdsSales", id: v.id, no: v.no }, v.certificateDate, `VDS withheld by ${v.partyName} (${v.docNo})`)
      e.dr("1220", v.amount)
      e.cr("1100", v.settled ?? 0)
      e.cr("2130", round2(v.amount - (v.settled ?? 0)))
      push(e.balanced(v.id))
    }
  }
  // manual VAT adjustments land on the payable they adjust (the SD-on-exports claim is a refund income)
  for (const a of src.adjustments.filter((x) => x.process === "Approved")) {
    const e = new Entry({ kind: "adjustment", id: a.id, no: a.no }, a.issueDate, `VAT adjustment (${a.kind}) — ${a.description}`)
    if (a.kind === "sdExport") { e.dr("2120", a.amount); e.cr("4910", a.amount) }
    else if (a.kind === "otherIncrease" || a.kind === "sdIncrease") { e.dr("5950", a.amount); e.cr(a.kind === "otherIncrease" ? "2110" : "2120", a.amount) }
    else { e.dr(a.kind === "otherDecrease" ? "2110" : "2120", a.amount); e.cr("5950", a.amount) }
    push(e.balanced(a.id))
  }
  // the manual entries: stored documents, posted when approved
  for (const j of src.journalEntries.filter((x) => x.process === "Approved")) {
    const lines = j.lines.filter((l) => l.debit > 0 || l.credit > 0)
    const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
    const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
    if (lines.length >= 2 && Math.abs(dr - cr) < 0.005)
      out.push({ ...j, source: { kind: "manual", id: j.id, no: j.no }, lines })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.source.no.localeCompare(b.source.no)))
}

/* ── the per-account ledger ────────────────────────────────────────────── */

/** One account's ledger: opening (before `from`), every movement in range with the running balance, closing. */
export function ledgerOf(src: GlSource, code: string, from: string, to: string): GlLedger | null {
  const account = chartOf(src).find((a) => a.code === code)
  if (!account) return null
  const sign = account.kind === "asset" || account.kind === "expense" ? 1 : -1
  const all = journalOf(src).filter((e) => e.lines.some((l) => l.account === code))
  const before = all.filter((e) => e.date < from)
  const opening = round2(before.reduce((s, e) => s + (e.lines.find((l) => l.account === code)?.debit ?? 0) - (e.lines.find((l) => l.account === code)?.credit ?? 0), 0))
  let run = opening
  const rows = all.filter((e) => e.date >= from && e.date <= to).flatMap((e) => {
    const l = e.lines.find((x) => x.account === code)!
    run = round2(run + l.debit - l.credit)
    return [{ date: e.date, memo: e.memo, no: e.no, sourceKind: e.source.kind, debit: l.debit, credit: l.credit, balance: round2(sign * run), entryId: e.id }]
  })
  return {
    account, from, to, opening: round2(sign * opening), rows,
    totals: { debit: round2(rows.reduce((s, r) => s + r.debit, 0)), credit: round2(rows.reduce((s, r) => s + r.credit, 0)) },
    closing: rows.at(-1)?.balance ?? round2(sign * opening),
  }
}
