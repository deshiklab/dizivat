/**
 * R9.2 seed: the chart of accounts (the RMG template plus one GL row per money account) and two manual
 * journal entries — the kind no document carries. Like the R9.1 seed, everything is derived from the world
 * the earlier seeds built, so both runtimes seed the same rows.
 */
import type { DB } from "./db"
import { CHART_TEMPLATE } from "../gl"
import type { GlAccount, ManualJournalEntry } from "../types"

const at = (date: string, h = 4) => `${date}T${String(h).padStart(2, "0")}:1${h % 10}:00.000Z`

/**
 * The chart: the template, then the money accounts' own rows — banks under 1020, mobile wallets under 1030,
 * cash under 1010, numbered per account. The read model (`chartOf`) adds more of these automatically for a
 * money account created after the seed, so the seed only needs today's.
 */
export function seedChart(world: Pick<DB, "moneyAccounts">): GlAccount[] {
  const rows: GlAccount[] = [...CHART_TEMPLATE]
  const counters: Record<string, number> = { cash: 0, bank: 0, mobile: 0 }
  const prefix = { cash: "1010", bank: "1020", mobile: "1030" } as const
  const group = { cash: "Cash", bank: "Bank accounts", mobile: "Mobile wallets" } as const
  const name = (a: { kind: "cash" | "bank" | "mobile"; provider: string; accountNo: string }) =>
    a.kind === "bank" ? `${a.provider} · ${a.accountNo}` : a.kind === "mobile" ? `Mobile wallet · ${a.accountNo}` : `Cash in hand · ${a.accountNo}`
  for (const a of world.moneyAccounts) {
    counters[a.kind] += 1
    rows.push({ code: `${prefix[a.kind]}.${String(counters[a.kind]).padStart(2, "0")}`, name: name(a), kind: "asset",
      group: group[a.kind], moneyAccountId: a.id, active: a.active })
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

const trail = (date: string, by: string, approved: boolean) => [
  { at: at(date), by, action: "created" as const },
  ...(approved ? [{ at: at(date, 5), by, action: "approved" as const }] : []),
]

/**
 * Two manual entries a garment factory really types: the quarter's office rent paid in advance, and the
 * electricity accrual for a month the bill has not arrived for. Everything else in the demo's ledger is
 * derived from its documents.
 */
export function seedJournal(world: Pick<DB, "glAccounts" | "moneyAccounts">): ManualJournalEntry[] {
  const ok = (code: string) => world.glAccounts.some((a) => a.code === code)
  const bankGl = (id: string) => world.glAccounts.find((a) => a.moneyAccountId === id)?.code ?? "1020.01"
  const out: ManualJournalEntry[] = []
  const bank = bankGl("ac1")
  if (ok("1300") && bank) {
    const id = `je${out.length + 1}`, no = "JE-08260001"
    out.push({
      id, no, date: "2026-08-02", memo: "Office rent for August–October paid in advance (Gulshan Avenue lease).",
      source: { kind: "manual", id, no },
      lines: [{ account: "1300", debit: 450000, credit: 0 }, { account: bank, debit: 0, credit: 450000 }],
      process: "Approved", issuedBy: "Farzana Akter", createdAt: at("2026-08-02"), history: trail("2026-08-02", "Farzana Akter", true),
    })
  }
  if (ok("2200") && ok("5500")) {
    const id = `je${out.length + 1}`, no = "JE-09260001"
    out.push({
      id, no, date: "2026-09-30", memo: "September electricity accrued — the bill usually arrives mid-October.",
      source: { kind: "manual", id, no },
      lines: [{ account: "5500", debit: 78000, credit: 0 }, { account: "2200", debit: 0, credit: 78000 }],
      process: "Approved", issuedBy: "Farzana Akter", createdAt: at("2026-09-30"), history: trail("2026-09-30", "Farzana Akter", true),
    })
  }
  return out
}
