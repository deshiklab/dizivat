import { z } from "zod"
import { userStore } from "@/lib/mock/users"
import { json, withAuth, zodProblem } from "../../_lib"

const prefs = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  accent: z.enum(["blue", "emerald", "violet", "orange"]).optional(),
  density: z.enum(["compact", "cozy", "comfortable"]).optional(),
  text: z.enum(["md", "lg", "xl"]).optional(),
})

export const PUT = withAuth(null, async (req, _ctx, user) => {
  const p = prefs.safeParse(await req.json().catch(() => ({})))
  if (!p.success) return zodProblem(p.error)
  userStore.prefs[user.id] = { ...userStore.prefs[user.id], ...p.data }
  return json(userStore.prefs[user.id])
})
