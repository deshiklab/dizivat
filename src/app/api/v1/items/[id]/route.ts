import { db, withStock } from "@/lib/mock/db"
import { itemInput } from "@/lib/schemas"
import { json, problem, withAuth, zodProblem } from "../../_lib"
import { diff, recordAudit } from "@/lib/mock/audit"
import { badUnit } from "@/lib/mock/units"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, { params }) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  return it ? json(withStock(it)) : problem(404, "Item not found")
})

export const PUT = withAuth<Ctx>("master.edit", async (req, { params }, user) => {
  const { id } = await params
  const it = db.items.find((i) => i.id === id)
  if (!it) return problem(404, "Item not found")
  const parsed = itemInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  if (db.items.some((i) => i.id !== id && i.sku.toLowerCase() === parsed.data.sku.toLowerCase())) return problem(422, "Validation failed", { sku: ["duplicate"] })
  const bu = badUnit(parsed.data.unit, it.unit)
  if (bu) return problem(422, "Validation failed", bu)
  const { masterItemId, ...data } = parsed.data
  const master = masterItemId ? db.masterItems.find((m) => m.id === masterItemId) : undefined
  if (masterItemId && !master) return problem(422, "Validation failed", { masterItemId: ["unknown"] })
  const before = { ...it }
  Object.assign(it, data, master ? { masterItem: master.name } : {})
  recordAudit({ actor: user, entity: "item", entityId: it.id, ref: `${it.sku} · ${it.name}`, action: "edited",
    changes: diff(before, it, ["name", "sku", "hsCode", "group", "unit", "purchasePrice", "salePrice", "vatRate", "sdRate", "reorderLevel", "active", "masterItem"]) })
  return json(withStock(it))
})
