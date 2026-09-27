import { z } from "zod"
import { userStore } from "@/lib/mock/users"
import { json, withAuth, zodProblem } from "../../_lib"
import { notificationsFor } from "@/lib/mock/notifications"

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string()).min(1).max(100) })])

/** Mark notifications read: { ids: [...] } or { all: true }. The security reminder cannot be dismissed. */
export const POST = withAuth(null, async (req, _ctx, user) => {
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const current = notificationsFor(user).filter((n) => n.kind !== "security").map((n) => n.id)
  const ids = "all" in parsed.data ? current : parsed.data.ids.filter((id) => !id.startsWith("security:"))
  const prev = userStore.notifRead[user.id]?.ids ?? []
  userStore.notifRead[user.id] = { ids: [...new Set([...prev, ...ids])].slice(-500) }
  const items = notificationsFor(user)
  return json({ items, unread: items.filter((n) => !n.read).length })
})
