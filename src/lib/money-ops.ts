/**
 * R9.1 — treasury operations, as pure functions: the cheque register's derivation (the approved receipts and
 * payments paid by cheque, folded with the small append-only lifecycle event list) and the CSV columns both
 * runtimes print. Shared by the mock handlers, the NestJS module (through the compat bundle) and the page,
 * the same way `lib/schedule.ts` shares the R8.3 cadences. Everything here takes its data as a parameter.
 */
import type { ChequeAction, ChequeEvent, ChequeKind, ChequeRow, ChequeStatus, MoneyDoc, MoneyTransfer } from "./types"

/** The lifecycle a cheque walks — `outstanding` is every cheque not yet acted on. */
export const CHEQUE_ACTIONS: ChequeAction[] = ["presented", "cleared", "bounced"]

/** What each action does to the status. */
const ACTION_STATUS: Record<ChequeAction, ChequeStatus> = { presented: "presented", cleared: "cleared", bounced: "bounced" }

/** May `action` be taken on a cheque in `status`? A cleared or bounced cheque is final; clearing needs a presentation first. */
export function chequeMay(status: ChequeStatus, action: ChequeAction): boolean {
  if (status === "cleared" || status === "bounced") return false
  if (action === "cleared") return status === "presented"
  return true // present and bounce are possible while outstanding or presented
}

/** One cheque's status + dates, folded from its events (newest action wins the status; each date is its own event's). */
export function chequeFold(events: ChequeEvent[]): { status: ChequeStatus; presentedOn?: string; clearedOn?: string; bouncedOn?: string; reason?: string } {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at))
  let status: ChequeStatus = "outstanding"
  let presentedOn: string | undefined
  let clearedOn: string | undefined
  let bouncedOn: string | undefined
  let reason: string | undefined
  for (const e of ordered) {
    status = ACTION_STATUS[e.action]
    if (e.action === "presented") presentedOn = e.date
    if (e.action === "cleared") clearedOn = e.date
    if (e.action === "bounced") { bouncedOn = e.date; reason = e.reason }
  }
  return { status, presentedOn, clearedOn, bouncedOn, reason }
}

export interface ChequeSource {
  moneyDocs: MoneyDoc[]
  chequeEvents: ChequeEvent[]
}

const DAY = 864e5
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

/** The register: one row per approved receipt or payment paid by cheque — received instruments (MR-) and issued ones (PV-) alike. */
export function chequeRowsOf(src: ChequeSource, today: string): ChequeRow[] {
  const byCheque = new Map<string, ChequeEvent[]>()
  for (const e of src.chequeEvents) {
    const list = byCheque.get(e.chequeId) ?? []
    list.push(e)
    byCheque.set(e.chequeId, list)
  }
  return src.moneyDocs
    .filter((m) => m.process === "Approved" && m.method === "cheque" && m.chequeNo)
    .map((m) => {
      const events = byCheque.get(m.id) ?? []
      const f = chequeFold(events)
      return {
        id: m.id,
        kind: m.kind === "payment" ? ("issued" as const) : ("received" as const),
        no: m.chequeNo!,
        partyId: m.partyId, partyName: m.partyName,
        accountId: m.accountId, accountName: m.accountName,
        moneyNo: m.no, moneyId: m.id,
        chequeBank: m.chequeBank ?? "",
        amount: m.amount,
        chequeDate: m.chequeDate ?? m.date,
        postDated: (m.chequeDate ?? m.date) > today,
        ageDays: daysBetween(m.chequeDate ?? m.date, today),
        events,
        ...f,
      }
    })
}

/** The pill tone each status wears. */
export const CHEQUE_TONE: Record<ChequeStatus, "info" | "warning" | "success" | "danger"> = {
  outstanding: "info", presented: "warning", cleared: "success", bounced: "danger",
}

/** The pill tone the two kinds of instrument wear. */
export const CHEQUE_KIND_TONE: Record<ChequeKind, "info" | "warning" | "success" | "danger"> = {
  issued: "warning", received: "success",
}

/** What the transfers register prints, and what an edit records in the audit trail. */
export const TRANSFER_DIFF_FIELDS = ["date", "fromAccount", "toAccount", "amount", "charge", "reference", "note"]
export const TRANSFER_CSV_COLUMNS: { key: string; label: string; get?: (t: MoneyTransfer) => unknown }[] = [
  { key: "date", label: "Date" },
  { key: "no", label: "Transfer No" },
  { key: "fromAccount", label: "From account" },
  { key: "toAccount", label: "To account" },
  { key: "amount", label: "Amount" },
  { key: "charge", label: "Bank charge" },
  { key: "reference", label: "Reference" },
  { key: "note", label: "Note" },
  { key: "process", label: "Process" },
]

/** What the cheque register prints. */
export const CHEQUE_CSV_COLUMNS: { key: string; label: string; get?: (r: ChequeRow) => unknown }[] = [
  { key: "kind", label: "Kind" },
  { key: "no", label: "Cheque No" },
  { key: "moneyNo", label: "Receipt / voucher No" },
  { key: "partyName", label: "Party" , get: (r) => (r.kind === "received" ? `${r.partyName} (drawer)` : `${r.partyName} (payee)`) },
  { key: "accountName", label: "Bank account" },
  { key: "amount", label: "Amount" },
  { key: "chequeDate", label: "Cheque date" },
  { key: "postDated", label: "Post-dated", get: (r) => (r.postDated ? "Yes" : "No") },
  { key: "ageDays", label: "Age (days)" },
  { key: "status", label: "Status" },
  { key: "presentedOn", label: "Presented on" },
  { key: "clearedOn", label: "Cleared on" },
  { key: "bouncedOn", label: "Bounced on" },
  { key: "reason", label: "Reason" },
]
