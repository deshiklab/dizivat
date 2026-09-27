import { passwordChange } from "@/lib/schemas"
import { issueSession, meFor, sessionOf } from "@/lib/auth/session-user"
import { SESSION_TTL_SHORT } from "@/lib/auth/session"
import { recordAudit } from "@/lib/mock/audit"
import { passwordOf, userStore } from "@/lib/mock/users"
import { delay } from "@/lib/mock/query"
import { problem, withAuth, zodProblem } from "../../_lib"

/** Change own password. Other sessions are signed out; this one gets a fresh cookie. */
export const PUT = withAuth(null, async (req, _ctx, user) => {
  const parsed = passwordChange.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  await delay(300)
  const { current, next } = parsed.data
  if (current !== passwordOf(user.id)) return problem(422, "Validation failed", { current: ["pwWrong"] })
  if (next.toLowerCase().includes(user.username)) return problem(422, "Validation failed", { next: ["pwUsername"] })
  userStore.passwords[user.id] = next
  userStore.revokedBefore[user.id] = Math.floor(Date.now() / 1000)
  user.mustChangePassword = false
  recordAudit({ actor: user, entity: "user", entityId: user.id, ref: user.username, action: "passwordChanged" })
  const s = await sessionOf(req)
  const res = Response.json(meFor(user))
  await issueSession(res, req, user.id, !!s && s.exp - (s.iat ?? s.exp) > SESSION_TTL_SHORT)
  return res
})
