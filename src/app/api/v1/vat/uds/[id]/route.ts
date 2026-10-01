import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { udRow } from "@/lib/rmg"
import { udInput } from "@/lib/schemas"
import { json, problem, withAuth, zodProblem } from "../../../_lib"
import { udCheck, udInUse } from "../../../_r62"

type Ctx = { params: Promise<{ id: string }> }
const find = async (p: Ctx["params"]) => { const { id } = await p; return db.uds.find((u) => u.id === id) }

/** One UD / UP with its usage per line (every deemed-export invoice that drew on it). */
export const GET = withAuth<Ctx>(null, async (_req, { params }) => {
  const u = await find(params)
  return u ? json(udRow(u, db.sales, TODAY)) : problem(404, "UD not found")
})

/**
 * Edit (amendment) — the exporter's customer cannot change once the UD is used on an invoice, and a line cannot drop
 * below what was already supplied.
 */
export const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const u = await find(params)
  if (!u) return problem(404, "UD not found")
  const parsed = udInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const c = udCheck(d, u.id)
  if (c.errors) return problem(422, "Validation failed", c.errors)
  const row = udRow(u, db.sales, TODAY)
  const used = row.lines.some((l) => l.used > 0) || udInUse(u.no, u.customerId)
  if (used && (d.customerId !== u.customerId || d.no.trim().toUpperCase() !== u.no)) return problem(422, "Validation failed", { [d.customerId !== u.customerId ? "customerId" : "no"]: ["udInUse"] })
  const errors: Record<string, string[]> = {}
  row.lines.forEach((l) => {
    const i = d.lines.findIndex((x) => x.itemId === l.itemId)
    if (l.used > 0 && (i < 0 || d.lines[i].qty < l.used)) errors[i < 0 ? "lines" : `lines.${i}.qty`] = ["belowUsed"]
  })
  if (Object.keys(errors).length) return problem(422, "Validation failed", errors)
  const before = { ...u, lines: JSON.stringify(u.lines.map((l) => [l.itemId, l.qty])) }
  const at = new Date().toISOString()
  Object.assign(u, {
    no: d.no.trim().toUpperCase(), kind: d.kind, date: d.date, expiry: d.expiry, customerId: c.customer!.id, customerName: c.customer!.name, customerBin: c.customer!.bin,
    masterLcNo: d.masterLcNo, buyer: d.buyer || undefined, lines: c.lines!, status: d.status, note: d.note || undefined, updatedAt: at,
  })
  const after = { ...u, lines: JSON.stringify(u.lines.map((l) => [l.itemId, l.qty])) }
  const changes = diff(before, after, ["no", "kind", "date", "expiry", "masterLcNo", "buyer", "status", "lines", "note"])
  ;(u.history ??= []).push({ at, by: user.name, action: "edited", note: changes.map((x) => x.field).join(", ") || undefined })
  recordAudit({ actor: user, entity: "ud", entityId: u.id, ref: `${u.no} · ${u.customerName}`, action: "edited", changes })
  return json(udRow(u, db.sales, TODAY))
})

/** Only a UD that no invoice refers to can be deleted (otherwise close it). */
export const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const u = await find(params)
  if (!u) return problem(404, "UD not found")
  if (udInUse(u.no, u.customerId)) return problem(409, "udInUse")
  db.uds.splice(db.uds.indexOf(u), 1)
  recordAudit({ actor: user, entity: "ud", entityId: u.id, ref: `${u.no} · ${u.customerName}`, action: "deleted" })
  return json({ ok: true })
})
