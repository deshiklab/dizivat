import { userUpdate } from "@/lib/schemas"
import { accessUntilError } from "@/lib/auth/roles"
import { diff, recordAudit } from "@/lib/mock/audit"
import { findUser, initialsOf, userStore, users } from "@/lib/mock/users"
import { json, problem, withAuth, zodProblem } from "../../_lib"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>("users.manage", async (_req, { params }) => {
  const u = findUser((await params).id)
  return u ? json(u) : problem(404, "User not found")
})

/**
 * Edit profile, role and status. Guards:
 *  - you cannot change your own role or deactivate yourself (422 "self")
 *  - at least one active admin must remain (422 "lastAdmin")
 * Deactivation revokes the user's sessions immediately.
 */
export const PUT = withAuth<Ctx>("users.manage", async (req, { params }, actor) => {
  const u = findUser((await params).id)
  if (!u) return problem(404, "User not found")
  const parsed = userUpdate.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (users.some((x) => x.id !== u.id && x.email.toLowerCase() === d.email.toLowerCase())) return problem(422, "Validation failed", { email: ["duplicate"] })
  // R6.2: an officer's access date is validated when it changes (an unchanged past date can stay while deactivating)
  if (d.role === "vatOfficer" && (d.accessUntil !== u.accessUntil || u.role !== "vatOfficer")) {
    const ae = accessUntilError(d.role, d.accessUntil)
    if (ae) return problem(422, "Validation failed", { accessUntil: [ae] })
  } else if (d.role === "vatOfficer" && !d.accessUntil) return problem(422, "Validation failed", { accessUntil: ["required"] })
  const roleChanged = d.role !== u.role, statusChanged = d.active !== u.active
  if (u.id === actor.id && roleChanged) return problem(422, "Validation failed", { role: ["self"] })
  if (u.id === actor.id && !d.active) return problem(422, "Validation failed", { active: ["self"] })
  const losesAdmin = u.role === "admin" && u.active && (d.role !== "admin" || !d.active)
  if (losesAdmin && !users.some((x) => x.id !== u.id && x.role === "admin" && x.active)) {
    return problem(422, "Validation failed", { [d.active ? "role" : "active"]: ["lastAdmin"] })
  }
  const before = { ...u }
  const { accessUntil, ...rest } = d
  Object.assign(u, rest, { initials: initialsOf(d.name) })
  if (d.role === "vatOfficer") u.accessUntil = accessUntil
  else delete u.accessUntil
  if (statusChanged && !u.active) userStore.revokedBefore[u.id] = Math.floor(Date.now() / 1000)
  const action = statusChanged ? (u.active ? "activated" : "deactivated") : roleChanged ? "roleChanged" : "updated"
  recordAudit({ actor, entity: "user", entityId: u.id, ref: u.username, action,
    changes: diff(before, u, ["name", "designation", "email", "mobile", "department", "role", "active", "accessUntil"]) })
  return json(u)
})
