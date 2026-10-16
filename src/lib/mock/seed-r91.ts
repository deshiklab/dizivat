/**
 * R9.1 seed: the demo's own-account transfers and the cheque lifecycle events. Like the R8.3 delivery log, both
 * are derived from the world the earlier seeds built — the accounts and the approved cheque money documents — so
 * both runtimes seed the same rows.
 */
import type { DB } from "./db"
import type { ChequeEvent, MoneyTransfer } from "../types"

const at = (date: string, h = 4) => `${date}T${String(h).padStart(2, "0")}:1${h % 10}:00.000Z`
const trail = (date: string, by: string, approved: boolean) => [
  { at: at(date), by, action: "created" as const },
  ...(approved ? [{ at: at(date, 5), by, action: "approved" as const }] : []),
]

/** Cash to the bank, a withdrawal back, and a draft topping up the bKash wallet — the three everyday moves. */
export function seedTransfers(world: Pick<DB, "moneyAccounts">): MoneyTransfer[] {
  const a = (id: string) => world.moneyAccounts.find((x) => x.id === id)!
  const ref = (id: string) => {
    const x = a(id)
    return `${x.provider} · ${x.accountNo}`
  }
  return [
    {
      id: "tf1", no: "TX-09260001", date: "2026-09-05",
      fromAccountId: "ac6", fromAccount: ref("ac6"), toAccountId: "ac1", toAccount: ref("ac1"),
      amount: 500_000, charge: 0, reference: "CASH-DEP-0509", note: "Daily factory cash deposited at the Konabari branch.",
      process: "Approved", issuedBy: "Farzana Akter", createdAt: at("2026-09-05"), history: trail("2026-09-05", "Farzana Akter", true),
    },
    {
      id: "tf2", no: "TX-09260002", date: "2026-09-18",
      fromAccountId: "ac2", fromAccount: ref("ac2"), toAccountId: "ac6", toAccount: ref("ac6"),
      amount: 300_000, charge: 250, reference: "WDL-1809", note: "Withdrawal for weekly wages and local conveyance.",
      process: "Approved", issuedBy: "Md. Kamal Uddin", createdAt: at("2026-09-18"), history: trail("2026-09-18", "Md. Kamal Uddin", true),
    },
    {
      id: "tf3", no: "TX-09260003", date: "2026-09-24",
      fromAccountId: "ac1", fromAccount: ref("ac1"), toAccountId: "ac4", toAccount: ref("ac4"),
      amount: 150_000, charge: 0, reference: "BKASH-TOPUP", note: "Topping up the merchant wallet for courier payments.",
      process: "Created", issuedBy: "Md. Kamal Uddin", createdAt: at("2026-09-24"), history: trail("2026-09-24", "Md. Kamal Uddin", false),
    },
  ]
}

/**
 * The lifecycle the demo's cheques have lived: the first issued voucher cheque was presented and cleared; the
 * first received customer cheque bounced (the news the register exists to carry — its receipt stays approved and
 * the correction is the accountant's); one more received cheque was presented and awaits clearing.
 */
export function seedChequeEvents(world: Pick<DB, "moneyDocs">): ChequeEvent[] {
  const issued = world.moneyDocs.filter((m) => m.process === "Approved" && m.kind === "payment" && m.method === "cheque" && m.chequeNo)
  const received = world.moneyDocs.filter((m) => m.process === "Approved" && m.kind === "receipt" && m.method === "cheque" && m.chequeNo)
  const events: ChequeEvent[] = []
  let n = 0
  // every event carries its own hour: the fold orders by `at`, so two events that share a timestamp would
  // leave the status to the database's tie-breaking — the presentation is the morning, the verdict the afternoon
  const ev = (chequeId: string, action: ChequeEvent["action"], date: string, by: string, h: number, reason?: string): ChequeEvent =>
    ({ id: `chq${++n}`, chequeId, action, date, reason, by, at: at(date, h) })
  if (issued[0]) {
    const d = issued[0].chequeDate ?? issued[0].date
    events.push(ev(issued[0].id, "presented", d, "Farzana Akter", 6))
    events.push(ev(issued[0].id, "cleared", d, "Farzana Akter", 7))
  }
  if (received[0]) {
    const d = received[0].chequeDate ?? received[0].date
    events.push(ev(received[0].id, "presented", d, "Farzana Akter", 8))
    events.push(ev(received[0].id, "bounced", d, "Farzana Akter", 9, "Refer to drawer — instructions from the drawer's bank."))
  }
  if (received[1]) {
    const d = received[1].chequeDate ?? received[1].date
    events.push(ev(received[1].id, "presented", d, "Farzana Akter", 10))
  }
  return events
}
