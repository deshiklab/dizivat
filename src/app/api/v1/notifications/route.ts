import { notificationsFor } from "@/lib/mock/notifications"
import { json, withAuth } from "../_lib"

export const GET = withAuth(null, async (_req, _ctx, user) => {
  const items = notificationsFor(user)
  return json({ items, unread: items.filter((n) => !n.read).length })
})
