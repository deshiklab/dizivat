import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { delay, runQuery } from "@/lib/mock/query"
import { unitInput } from "@/lib/schemas"
import type { Unit, UnitRow } from "@/lib/types"
import { unitRow } from "@/lib/mock/units"
import { json, problem, withAuth, zodProblem } from "../_lib"

const spec = {
  search: (u: UnitRow) => `${u.code} ${u.name}`,
  facets: { status: (u: UnitRow) => (u.active ? "active" : "inactive") },
}

/** Units of measure. `?active=1` returns only active units (pickers). */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "code.asc")
  if (!sp.get("size")) sp.set("size", "100")
  const rows = db.units.map(unitRow).filter((u) => sp.get("active") !== "1" || u.active)
  const r = runQuery(rows, sp, spec)
  await delay(120)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json(page)
})

export const POST = withAuth("master.edit", async (req, _ctx, user) => {
  const parsed = unitInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (db.units.some((u) => u.code.toLowerCase() === d.code.toLowerCase())) return problem(422, "Validation failed", { code: ["duplicate"] })
  db.seq.unit += 1
  const u: Unit = { id: `un${db.seq.unit}`, ...d, createdAt: new Date().toISOString() }
  db.units.push(u)
  recordAudit({ actor: user, entity: "unit", entityId: u.id, ref: `${u.code} · ${u.name}`, action: "created" })
  return json(unitRow(u), { status: 201 })
})
