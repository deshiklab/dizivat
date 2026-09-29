import { db, withStock } from "@/lib/mock/db"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { itemInput } from "@/lib/schemas"
import type { Item, ItemWithStock } from "@/lib/types"
import { json, problem, withAuth, zodProblem } from "../_lib"
import { recordAudit } from "@/lib/mock/audit"
import { badUnit } from "@/lib/mock/units"

const spec = {
  search: (i: ItemWithStock) => `${i.name} ${i.hsCode} ${i.sku} ${i.masterItem}`,
  facets: {
    group: (i: ItemWithStock) => i.group,
    unit: (i: ItemWithStock) => i.unit,
    stock: (i: ItemWithStock) => (i.remain <= 0 ? "out" : i.remain < i.reorderLevel ? "low" : "ok"),
  },
  totals: [] as (keyof ItemWithStock)[],
}

export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "sku.asc")
  const rows = db.items.map(withStock)
  const r = runQuery(rows, sp, spec)
  // stock valuation at cost for the filtered set
  r.totals.stockValue = Math.round(r.all.reduce((a, i) => a + Math.max(0, i.remain) * i.costPrice, 0))
  if (sp.get("format") === "csv") {
    return csvResponse(
      toCSV(r.all, [
        { key: "sku", label: "SKU" }, { key: "hsCode", label: "HS Code" }, { key: "name", label: "Name" }, { key: "group", label: "Group" },
        { key: "unit", label: "Unit" }, { key: "purchasePrice", label: "PP" }, { key: "costPrice", label: "CP" }, { key: "salePrice", label: "SP" },
        { key: "vatRate", label: "VAT %" }, { key: "opening", label: "Opening" }, { key: "purchased", label: "Purchase" }, { key: "prodReceive", label: "Prod. Receive" },
        { key: "prodIssue", label: "Prod. Issue" }, { key: "sold", label: "Sales" }, { key: "damage", label: "Damage" }, { key: "remain", label: "Remain" },
      ]),
      `items-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json(page)
})

export const POST = withAuth("master.edit", async (req, _ctx, user) => {
  const parsed = itemInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (db.items.some((i) => i.sku.toLowerCase() === d.sku.toLowerCase())) return problem(422, "Validation failed", { sku: ["duplicate"] })
  const bu = badUnit(d.unit)
  if (bu) return problem(422, "Validation failed", bu)
  const { masterItemId, ...data } = d
  const master = masterItemId ? db.masterItems.find((m) => m.id === masterItemId) : undefined
  if (masterItemId && !master) return problem(422, "Validation failed", { masterItemId: ["unknown"] })
  const it: Item = {
    id: `i${db.items.length + 1}-${Date.now().toString(36)}`, ...data, masterItem: master?.name ?? d.name.split(" ")[0], brand: "Local",
    costPrice: d.purchasePrice ? Math.round(d.purchasePrice * 112) / 100 : Math.round(d.salePrice * 78) / 100,
    opening: 0, purchased: 0, prodReceive: 0, prodIssue: 0, sold: 0, damage: 0,
  }
  db.items.push(it)
  recordAudit({ actor: user, entity: "item", entityId: it.id, ref: `${it.sku} · ${it.name}`, action: "created" })
  return json(withStock(it), { status: 201 })
})
