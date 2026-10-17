import { db } from "@/lib/mock/db"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { branchCsvColumns, stockRegister } from "../_derived"
import { json, withAuth } from "../_lib"

/**
 * Stock by branch (S4-05): every item with its quantity at each stock-holding branch,
 * valued at cost (and at sale price for finished goods). `branch=<id>` keeps items held there.
 *
 * R5.4: the rows, the facets, the per-branch valuation and the CSV columns come from `_derived` — the same code the
 * PostgreSQL API runs, over the movement documents read back from its tables instead of these in-memory copies.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const { r, branches, branchValue } = stockRegister(sp, db)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(r.all, branchCsvColumns(branches)), `stock-by-branch-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json({ ...page, branches, branchValue })
})
