import { z } from "zod"
import { userStore } from "@/lib/mock/users"
import { json, problem, withAuth, zodProblem } from "../../_lib"

const view = z.object({ table: z.string().min(1).max(40), name: z.string().trim().min(1).max(40), query: z.string().max(2000) })
const mine = (uid: string, table: string) => ((userStore.views[uid] ??= {})[table] ??= [])

/** Saved list views per user and table — replaces the prototype's per-browser localStorage (B-10). */
export const GET = withAuth(null, (req, _ctx, user) => {
  const table = new URL(req.url).searchParams.get("table")
  if (!table) return problem(400, "table is required")
  return json(mine(user.id, table))
})

export const POST = withAuth(null, async (req, _ctx, user) => {
  const v = view.safeParse(await req.json().catch(() => ({})))
  if (!v.success) return zodProblem(v.error)
  const list = mine(user.id, v.data.table)
  const next = [...list.filter((x) => x.name !== v.data.name), { name: v.data.name, query: v.data.query }]
  if (next.length > 30) return problem(422, "Too many saved views (max 30 per list)")
  userStore.views[user.id][v.data.table] = next
  return json(next, { status: 201 })
})

export const DELETE = withAuth(null, (req, _ctx, user) => {
  const sp = new URL(req.url).searchParams
  const table = sp.get("table"), name = sp.get("name")
  if (!table || !name) return problem(400, "table and name are required")
  userStore.views[user.id][table] = mine(user.id, table).filter((x) => x.name !== name)
  return json(userStore.views[user.id][table])
})
