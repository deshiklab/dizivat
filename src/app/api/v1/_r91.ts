/**
 * R9.1 — treasury operations: transfers between the company's own accounts, and the cheque register.
 *
 * Money the company never loses still has to move: the factory's cash goes to the bank, the bank feeds the
 * bKash merchant wallet, one bank tops up another. A transfer (TX-) is that move — a plain document with the
 * same draft / approve / cancel lifecycle the money documents have, and like them it only moves balances when
 * approved (the balances themselves are derived, so the transfer writes nothing anywhere: `accountRow` reads it).
 * The charge, if the bank takes one for the move, leaves the from-account without reaching the to-account —
 * the books-vs-bank reconciliation (R8.2) explains it as a charge line like any other bank fee.
 *
 * The cheque register is a read model: every approved receipt or payment paid by cheque is an instrument the
 * company holds (received) or has written (issued), and its lifecycle — presented, cleared, bounced — is a small
 * append-only event list, so nothing about a money document changes when a cheque moves. A bounce is news (the
 * bell carries it); the correction to the books is the accountant's to make with the documents they already have.
 *
 * Shared with the NestJS build the same way `_r8` / `_r83` are: the mock handlers and the API's native module
 * both call these builders, so the two runtimes cannot drift.
 */
import { closed, lifecycle, nextNo } from "./_r4"
import { invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { chequeActionInput, moneyTransferInput } from "@/lib/schemas"
import { csvResponse, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { TODAY } from "@/lib/company"
import { round2 } from "@/lib/vat"
import { CHEQUE_CSV_COLUMNS, CHEQUE_TONE, TRANSFER_CSV_COLUMNS, chequeFold, chequeMay, chequeRowsOf } from "@/lib/money-ops"
export { CHEQUE_CSV_COLUMNS, TRANSFER_CSV_COLUMNS, TRANSFER_DIFF_FIELDS } from "@/lib/money-ops"
import type { AccountingSource } from "./_r4"
import type { ChequeAction, ChequeRow, MoneyAccount, MoneyTransfer } from "@/lib/types"

/* ── transfers between the company's own accounts ──────────────────────── */

export type TransferFields = Omit<MoneyTransfer, "id" | "no" | "process" | "createdAt" | "history">

const accountRef = (a: MoneyAccount) => `${a.provider} · ${a.accountNo}`

/** What a transfer body may hold, checked against the accounts it names. */
export function buildTransfer(body: unknown, self: MoneyTransfer | undefined, src: AccountingSource): RuleProblem | { process: "Created" | "Approved"; date: string; fields: TransferFields } {
  const parsed = moneyTransferInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const t = parsed.data
  const from = src.moneyAccounts.find((a) => a.id === t.fromAccountId && a.active)
  const to = src.moneyAccounts.find((a) => a.id === t.toAccountId && a.active)
  if (!from) return invalidRule({ fromAccountId: ["unknown"] })
  if (!to) return invalidRule({ toAccountId: ["unknown"] })
  if (from.id === to.id) return invalidRule({ toAccountId: ["sameAccount"] })
  if (closed(t.date, src)) return invalidRule({ date: ["dateClosed"] })
  if (t.date > TODAY) return invalidRule({ date: ["future"] })
  if (self && (self.fromAccountId !== t.fromAccountId || self.toAccountId !== t.toAccountId))
    return { status: 409, title: `A transfer cannot move to another pair of accounts — ${self.no} is ${accountRef(from)} → ${accountRef(to)}.` }
  return {
    process: t.process, date: t.date,
    fields: {
      date: t.date, fromAccountId: from.id, fromAccount: accountRef(from), toAccountId: to.id, toAccount: accountRef(to),
      amount: round2(t.amount), charge: round2(t.charge ?? 0), reference: t.reference || undefined, note: t.note || undefined,
      issuedBy: self?.issuedBy ?? "",
    },
  }
}

/** Approving: the books must not be closed for the date. */
export function transferApproveRule(d: MoneyTransfer, src: AccountingSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be approved.` }
    : undefined
}

/** Cancelling: the books must not be closed for the date either. */
export function transferCancelRule(d: MoneyTransfer, src: AccountingSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be cancelled.` }
    : undefined
}

/** A new transfer's identity: the next id of its series and the next TX-MMYY####. */
export const transferIdentity = (date: string) => ({
  id: `tf${db.seq.moneyTransfer + 1}`,
  no: nextNo("TX", "moneyTransfer", db.moneyTransfers, date),
})
export const claimTransferId = () => { db.seq.moneyTransfer += 1 }

export const transferSpec: QuerySpec<MoneyTransfer> = {
  search: (t) => `${t.no} ${t.fromAccount} ${t.toAccount} ${t.reference ?? ""} ${t.note ?? ""}`,
  dateField: "date",
  facets: { process: (t) => t.process, fromAccount: (t) => t.fromAccountId, toAccount: (t) => t.toAccountId },
  totals: ["amount", "charge"],
}

/** The mock's six transfer endpoints — the `lifecycle` factory the money documents use, with no approve-time side effects at all: the balances are derived. */
export function transferRoutes() {
  const build = (body: unknown, self?: MoneyTransfer) => {
    const r = buildTransfer(body, self, db)
    return "status" in r ? { error: ruleResponse(r) } : r
  }
  return lifecycle<MoneyTransfer, TransferFields>({
    entity: "moneyTransfer", label: "Transfer", list: () => db.moneyTransfers, idPrefix: "tf", seq: "moneyTransfer", noPrefix: "TX",
    build,
    approve: (d: MoneyTransfer) => {
      const rule = transferApproveRule(d)
      return rule ? ruleResponse(rule) : null
    },
    cancel: (d: MoneyTransfer) => {
      const rule = transferCancelRule(d)
      return rule ? ruleResponse(rule) : null
    },
    diffFields: ["date", "fromAccount", "toAccount", "amount", "charge", "reference", "note"],
    spec: transferSpec,
    csv: TRANSFER_CSV_COLUMNS,
    csvName: "account-transfers",
    facetLabels: transferFacetLabels,
  })
}

/* ── the cheque register ───────────────────────────────────────────────── */

export const chequeSpec: QuerySpec<ChequeRow> = {
  search: (r) => `${r.id} ${r.no} ${r.partyName} ${r.moneyNo} ${r.accountName}`,
  dateField: "chequeDate",
  facets: { kind: (r) => r.kind, status: (r) => r.status, party: (r) => r.partyId, account: (r) => r.accountId },
  totals: ["amount"],
}

/** The register's facet labels: the accounts by their `provider · accountNo`. */
export function transferFacetLabels(): Record<string, Record<string, string>> {
  return {
    fromAccount: Object.fromEntries(db.moneyAccounts.map((a) => [a.id, accountRef(a)])),
    toAccount: Object.fromEntries(db.moneyAccounts.map((a) => [a.id, accountRef(a)])),
  }
}

/** The register: the derived rows (see `lib/money-ops`), or the CSV. `?postDated=true` narrows to the post-dated view. */
export const chequesListRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  let rows = chequeRowsOf(db, TODAY)
  if (sp.get("postDated") === "true") {
    sp.delete("postDated")
    rows = rows.filter((r) => r.postDated)
  }
  const r = runQuery(rows, sp, chequeSpec)
  if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, CHEQUE_CSV_COLUMNS), `cheque-register-${TODAY}.csv`)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...pg } = r
  return json({ ...pg, facetLabels: {} })
})

/** A lifecycle action on one cheque — the one write the register knows. */
export const chequeActionRule = (row: ChequeRow | undefined, body: unknown): RuleProblem | { action: ChequeAction; date: string; reason?: string } => {
  if (!row) return { status: 404, title: "Cheque not found" }
  const parsed = chequeActionInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const a = parsed.data
  if (!chequeMay(row.status, a.action))
    return { status: 409, title: `A ${row.status} cheque cannot be ${a.action === "cleared" ? "cleared" : a.action} — ${row.no} is already ${row.status}.` }
  if (a.date < row.chequeDate) return invalidRule({ date: ["beforeChequeDate"] })
  if (a.date > TODAY) return invalidRule({ date: ["future"] })
  if (a.action === "bounced" && (a.reason ?? "").trim().length < 10) return invalidRule({ reason: ["required"] })
  return { action: a.action, date: a.date, reason: a.action === "bounced" ? a.reason : undefined }
}
