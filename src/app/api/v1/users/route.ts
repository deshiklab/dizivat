import type { User } from "@/lib/auth/roles"
import { userInput } from "@/lib/schemas"
import { recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { initialsOf, tempPassword, userStore, users } from "@/lib/mock/users"
import { json, problem, withAuth, zodProblem } from "../_lib"

const spec = {
  search: (u: User) => `${u.name} ${u.username} ${u.email} ${u.designation} ${u.department ?? ""} ${u.mobile ?? ""}`,
  facets: { role: (u: User) => u.role, status: (u: User) => (u.active ? "active" : "inactive") },
}

/** Users (admin only). GET ?view=table → Page<User>; ?format=csv → export. */
export const GET = withAuth("users.manage", async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "name.asc")
  const r = runQuery(users, sp, spec)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(r.all, [
      { key: "name", label: "Name" }, { key: "username", label: "Username" }, { key: "role", label: "Role" },
      { key: "designation", label: "Designation" }, { key: "department", label: "Department" }, { key: "mobile", label: "Mobile" },
      { key: "email", label: "Email" }, { key: "active", label: "Status", get: (u) => (u.active ? "Active" : "Inactive") },
      { key: "lastSignInAt", label: "Last sign-in" }, { key: "createdAt", label: "Created" },
    ]), `users-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json(page)
})

/** Invite: creates the account with a one-time temporary password (returned once, never stored in clear in Symfony). */
export const POST = withAuth("users.manage", async (req, _ctx, actor) => {
  const parsed = userInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (users.some((u) => u.username === d.username)) return problem(422, "Validation failed", { username: ["duplicate"] })
  if (users.some((u) => u.email.toLowerCase() === d.email.toLowerCase())) return problem(422, "Validation failed", { email: ["duplicate"] })
  const user: User = {
    id: `u${users.length + 1}-${Date.now().toString(36)}`, ...d, initials: initialsOf(d.name),
    createdAt: new Date().toISOString(), mustChangePassword: true,
  }
  const pw = tempPassword()
  users.push(user)
  userStore.passwords[user.id] = pw
  recordAudit({ actor, entity: "user", entityId: user.id, ref: user.username, action: "invited", note: `Role: ${user.role}` })
  return json({ user, tempPassword: pw }, { status: 201 })
})
