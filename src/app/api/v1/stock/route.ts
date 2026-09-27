import { db, stockBranches, stockByBranch, withStock } from "@/lib/mock/db"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import type { StockRow } from "@/lib/types"
import { json, withAuth } from "../_lib"

const status = (r: StockRow) => (r.remain <= 0 ? "out" : r.remain < r.reorderLevel ? "low" : "ok")
const spec = {
  search: (r: StockRow) => `${r.name} ${r.sku} ${r.hsCode}`,
  facets: { group: (r: StockRow) => r.group, stock: status, unit: (r: StockRow) => r.unit },
  totals: ["value", "saleValue"] as (keyof StockRow)[],
}

/**
 * Stock by branch (S4-05): every item with its quantity at each stock-holding branch,
 * valued at cost (and at sale price for finished goods). `branch=<id>` keeps items held there.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "sku.asc")
  const split = stockByBranch()
  const branches = stockBranches()
  const holdAt = sp.get("branch")
  const rows: StockRow[] = db.items.map((it) => {
    const s = withStock(it)
    const byBranch = split.get(it.id) ?? {}
    return { ...s, byBranch, value: Math.round(Math.max(0, s.remain) * it.costPrice), saleValue: Math.round(Math.max(0, s.remain) * it.salePrice) }
  }).filter((r) => !holdAt || (r.byBranch[holdAt] ?? 0) > 0)
  const r = runQuery(rows, sp, spec)
  const branchValue = Object.fromEntries(branches.map((b) => [b.id, Math.round(r.all.reduce((a, x) => a + Math.max(0, x.byBranch[b.id] ?? 0) * x.costPrice, 0))]))
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(r.all, [
      { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "group", label: "Group" }, { key: "unit", label: "Unit" },
      ...branches.map((b) => ({ key: b.id, label: b.name, get: (x: StockRow) => x.byBranch[b.id] ?? 0 })),
      { key: "remain", label: "Total" }, { key: "costPrice", label: "Unit cost" }, { key: "value", label: "Value at cost" }, { key: "reorderLevel", label: "Re-order level" },
    ]), `stock-by-branch-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json({ ...page, branches, branchValue })
})
