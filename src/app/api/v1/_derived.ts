/**
 * R5.4 — the two derived endpoints: the branch split (`/stock`) and one item's stock ledger (`/items/{id}/ledger`).
 * Neither stores anything of its own: they add up every movement document — purchases, sales, the two note kinds,
 * transfers, damage entries, opening entries and production batches — and every one of those families has a table of
 * its own now, so both runtimes can derive the same numbers from the same code. The Next.js mock passes its in-memory
 * copies as the `MovementSource`; the PostgreSQL API passes the same documents read back from its tables.
 *
 * Everything the responses are made of lives here so the two cannot drift: the register's spec (search, facets,
 * totals), the rows with their valuation at cost and at sale price, the per-branch valuation, the CSV columns (one
 * column per stock-holding branch), and the ledger's assembly — which rows a `?branch=` shows (transfers only appear
 * then, because company-wide they net to zero), the running balance, the totals and the closing quantity.
 */
import { db, branchSplit, mainBranchId, stockBranches, withStock, type MovementSource } from "@/lib/mock/db"
import { runQuery, type QuerySpec } from "@/lib/mock/query"
import type { Branch, Item, ItemLedger, LedgerEntry, StockRow } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { ledgerRows, sortRows } from "./_ledger"

/* ── /stock: every item with its quantity at each stock-holding branch ───── */

/** The row's own stock status: out, below its re-order level, or fine. */
export const stockStatus = (r: StockRow) => (r.remain <= 0 ? "out" : r.remain < r.reorderLevel ? "low" : "ok")

export const branchSpec: QuerySpec<StockRow> = {
  search: (r) => `${r.name} ${r.sku} ${r.hsCode}`,
  facets: { group: (r) => r.group, stock: stockStatus, unit: (r) => r.unit },
  totals: ["value", "saleValue"] as (keyof StockRow)[],
}

/** One row per item: the counters' `remain`, the quantity at each branch, and both valuations (never negative). */
export function branchRows(src: MovementSource): StockRow[] {
  const split = branchSplit(src)
  return src.items.map((it) => {
    const s = withStock(it)
    const byBranch = split.get(it.id) ?? {}
    return { ...s, byBranch, value: Math.round(Math.max(0, s.remain) * it.costPrice), saleValue: Math.round(Math.max(0, s.remain) * it.salePrice) }
  })
}

/** One column per stock-holding branch, then the total, the unit cost, the value and the re-order level. */
export const branchCsvColumns = (branches: Branch[]) => [
  { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "group", label: "Group" }, { key: "unit", label: "Unit" },
  ...branches.map((b) => ({ key: b.id, label: b.name, get: (x: StockRow) => x.byBranch[b.id] ?? 0 })),
  { key: "remain", label: "Total" }, { key: "costPrice", label: "Unit cost" }, { key: "value", label: "Value at cost" }, { key: "reorderLevel", label: "Re-order level" },
]

/**
 * The register: the page (`runQuery` over the rows), the stock-holding branches and the value each holds. `branch=<id>`
 * keeps the items held there, and the defaults the route relies on are applied here — `sort=sku.asc` when the caller
 * gave none — so both runtimes answer the same request the same way. `branchValue` is over every matching row, not
 * just the page, as it always was.
 */
export function stockRegister(sp: URLSearchParams, src: MovementSource = db) {
  if (!sp.get("sort")) sp.set("sort", "sku.asc")
  const branches = stockBranches()
  const holdAt = sp.get("branch")
  const rows = branchRows(src).filter((r) => !holdAt || (r.byBranch[holdAt] ?? 0) > 0)
  const r = runQuery(rows, sp, branchSpec)
  const branchValue = Object.fromEntries(branches.map((b) => [b.id, Math.round(r.all.reduce((a, x) => a + Math.max(0, x.byBranch[b.id] ?? 0) * x.costPrice, 0))]))
  return { r, branches, branchValue }
}

/* ── /items/{id}/ledger: one item's movement register ────────────────────── */

/**
 * The ledger body: the rows sorted by date and type with a running balance, the totals and the closing quantity, the
 * item with its `remain`, the stock-holding branches and the item's quantity at each. `branchId` restricts it to one
 * branch — where the transfers in and out appear, because company-wide they net to zero — and is echoed back. The
 * value, tax, challan and party details a Mushak book needs stay on the rows `ledgerRows` returns; the ledger entries
 * the API answers with do not carry them.
 */
export function itemLedger(it: Item, branchId?: string, src: MovementSource = db): ItemLedger {
  const main = mainBranchId()
  const rows = ledgerRows(it, src)
  const shown = rows.filter((r) => (branchId ? (r.at ?? main) === branchId : !r.transfer))
  sortRows(shown)
  let bal = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const entries: LedgerEntry[] = shown.map(({ at, transfer, value, sd, vat, challan, refDate, partyAddress, partyBin, ...r }) => { bal = round2(bal + r.in - r.out); return { ...r, balance: bal } })
  return {
    item: withStock(it),
    entries,
    totals: { in: round2(shown.reduce((a, r) => a + r.in, 0)), out: round2(shown.reduce((a, r) => a + r.out, 0)) },
    closing: bal,
    branchId,
    branches: stockBranches().map((b) => ({ id: b.id, name: b.name })),
    byBranch: branchSplit(src).get(it.id) ?? {},
  }
}
