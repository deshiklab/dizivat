import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { unitInput } from "@/lib/schemas"
import { json, problem, withAuth, zodProblem } from "../../_lib"
import { unitRow, unitUsage } from "@/lib/mock/units"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, { params }) => {
  const { id } = await params
  const u = db.units.find((x) => x.id === id)
  return u ? json(unitRow(u)) : problem(404, "Unit not found")
})

export const PUT = withAuth<Ctx>("master.edit", async (req, { params }, user) => {
  const { id } = await params
  const u = db.units.find((x) => x.id === id)
  if (!u) return problem(404, "Unit not found")
  const parsed = unitInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.code !== u.code) {
    if (unitUsage(u.code)) return problem(422, "Validation failed", { code: ["unitInUse"] })
    if (db.units.some((x) => x.id !== id && x.code.toLowerCase() === d.code.toLowerCase())) return problem(422, "Validation failed", { code: ["duplicate"] })
  }
  const before = { ...u }
  Object.assign(u, d)
  const changes = diff(before, u, ["code", "name", "decimals", "active"])
  if (changes.length) recordAudit({ actor: user, entity: "unit", entityId: u.id, ref: `${u.code} · ${u.name}`, action: before.active !== u.active ? (u.active ? "activated" : "deactivated") : "edited", changes })
  return json(unitRow(u))
})

/** Only units no item uses can be deleted (deactivate the others). */
export const DELETE = withAuth<Ctx>("master.edit", async (_req, { params }, user) => {
  const { id } = await params
  const i = db.units.findIndex((x) => x.id === id)
  if (i < 0) return problem(404, "Unit not found")
  const n = unitUsage(db.units[i].code)
  if (n) return problem(409, `${db.units[i].code} is used by ${n} item${n === 1 ? "" : "s"} — deactivate it instead.`)
  const [u] = db.units.splice(i, 1)
  recordAudit({ actor: user, entity: "unit", entityId: u.id, ref: `${u.code} · ${u.name}`, action: "deleted" })
  return json({ ok: true })
})
