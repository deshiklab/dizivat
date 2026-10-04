import { db, stockBranches } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import { itemLedger } from "../../../_derived"
import { json, problem, withAuth } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Stock ledger (Mushak 6.1/6.2 style movement register) for one item.
 * Purchases, sales and damage entries are real approved documents; production is a monthly summary until R3.
 * `?branch=<id>` restricts it to one branch, where transfers in/out appear (company-wide they net to zero).
 *
 * R5.4: the rows, their running balance and the totals come from `_derived` — the same code the PostgreSQL API runs,
 * over the movement documents read back from its tables instead of these in-memory copies.
 */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  if (!it) return problem(404, "Item not found")
  const branch = new URL(req.url).searchParams.get("branch") || undefined
  if (branch && !stockBranches().some((b) => b.id === branch)) return problem(404, "Branch not found")
  await delay(150)
  return json(itemLedger(it, branch, db))
})
