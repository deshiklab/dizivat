import { db, mainBranchId, stockBranches, stockByBranch, withStock } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import type { ItemLedger, LedgerEntry } from "@/lib/types"
import { ledgerRows, sortRows } from "../../../_ledger"
import { round2 } from "@/lib/vat"
import { json, problem, withAuth } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Stock ledger (Mushak 6.1/6.2 style movement register) for one item.
 * Purchases, sales and damage entries are real approved documents; production is a monthly summary until R3.
 * `?branch=<id>` restricts it to one branch, where transfers in/out appear (company-wide they net to zero).
 */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  if (!it) return problem(404, "Item not found")
  const branch = new URL(req.url).searchParams.get("branch") || undefined
  if (branch && !stockBranches().some((b) => b.id === branch)) return problem(404, "Branch not found")
  await delay(150)
  const main = mainBranchId()
  const rows = ledgerRows(it)
  const shown = rows.filter((r) => (branch ? (r.at ?? main) === branch : !r.transfer))
  sortRows(shown)
  let bal = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const entries: LedgerEntry[] = shown.map(({ at, transfer, value, sd, vat, challan, refDate, partyAddress, partyBin, ...r }) => { bal = round2(bal + r.in - r.out); return { ...r, balance: bal } })
  const body: ItemLedger = {
    item: withStock(it),
    entries,
    totals: { in: round2(shown.reduce((a, r) => a + r.in, 0)), out: round2(shown.reduce((a, r) => a + r.out, 0)) },
    closing: bal,
    branchId: branch,
    branches: stockBranches().map((b) => ({ id: b.id, name: b.name })),
    byBranch: stockByBranch().get(it.id) ?? {},
  }
  return json(body)
})
