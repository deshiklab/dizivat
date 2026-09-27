import { recordAudit } from "@/lib/mock/audit"
import { findUser, tempPassword, userStore } from "@/lib/mock/users"
import { json, problem, withAuth } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }

/** Admin reset: new one-time password, forced change at next sign-in, existing sessions revoked, lockout cleared. */
export const POST = withAuth<Ctx>("users.manage", async (_req, { params }, actor) => {
  const u = findUser((await params).id)
  if (!u) return problem(404, "User not found")
  if (u.id === actor.id) return problem(422, "Use “Change password” for your own account.", { _: ["self"] })
  const pw = tempPassword()
  userStore.passwords[u.id] = pw
  userStore.revokedBefore[u.id] = Math.floor(Date.now() / 1000)
  delete userStore.failures[u.username]
  u.mustChangePassword = true
  recordAudit({ actor, entity: "user", entityId: u.id, ref: u.username, action: "passwordReset" })
  return json({ tempPassword: pw })
})
