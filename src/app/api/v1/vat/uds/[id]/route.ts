import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { udInput } from "@/lib/schemas"
import { json, problem, withAuth, zodProblem } from "../../../_lib"
import { udAnswer, udRemove, udUpdate } from "../../../_r62"

type Ctx = { params: Promise<{ id: string }> }
const find = async (p: Ctx["params"]) => { const { id } = await p; return db.uds.find((u) => u.id === id) }

/** One UD / UP with its usage per line (every deemed-export invoice that drew on it). */
export const GET = withAuth<Ctx>(null, async (_req, { params }) => {
  const u = await find(params)
  return u ? json(udAnswer(u, TODAY)) : problem(404, "UD not found")
})

/**
 * Edit (amendment) — the exporter's customer cannot change once the UD is used on an invoice, and a line cannot drop
 * below what was already supplied. The rules are `_r62.ts`'s, shared with the PostgreSQL build.
 */
export const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const u = await find(params)
  if (!u) return problem(404, "UD not found")
  const parsed = udInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = udUpdate(u, parsed.data, user, TODAY)
  if ("status" in w) return problem(w.status, w.title, w.errors)
  recordAudit({ actor: user, entity: "ud", entityId: w.ud.id, ref: w.ref, action: "edited", changes: w.changes, note: w.note })
  return json(w.row)
})

/** Only a UD that no invoice refers to can be deleted (otherwise close it). */
export const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const u = await find(params)
  if (!u) return problem(404, "UD not found")
  const w = udRemove(u)
  if ("status" in w) return problem(w.status, w.title, w.errors)
  recordAudit({ actor: user, entity: "ud", entityId: w.ud.id, ref: w.ref, action: "deleted" })
  return json({ ok: true })
})
