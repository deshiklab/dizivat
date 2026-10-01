import type { ZodError } from "zod"
import { currentUser } from "@/lib/auth/session-user"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { recordAudit } from "@/lib/mock/audit"

// Web-standard Response only: the same handlers also run in the browser for the static GitHub Pages demo
export const json = (data: unknown, init?: ResponseInit) => Response.json(data, init)
/** RFC 9457 problem+json — the error shape the Symfony API will return */
export const problem = (status: number, title: string, errors?: Record<string, string[]>) =>
  Response.json({ type: "about:blank", title, status, errors }, { status, headers: { "content-type": "application/problem+json" } })
export const zodProblem = (e: ZodError) => {
  const errors: Record<string, string[]> = {}
  for (const i of e.issues) (errors[i.path.join(".") || "_"] ??= []).push(i.message)
  return problem(422, "Validation failed", errors)
}

/** 403 problem if the user lacks `perm`, else null. */
export const deny = (user: User, perm: Permission) =>
  can(ROLE_PERMS[user.role], perm) ? null : problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)

/**
 * Route-handler wrapper: 401 without a valid session, 403 without `perm`.
 * Mirrors the Symfony firewall + voters so screens handle both responses already.
 */
export function withAuth<C = unknown>(perm: Permission | null, fn: (req: Request, ctx: C, user: User) => Promise<Response> | Response) {
  return async (req: Request, ctx: C) => {
    const user = await currentUser(req)
    if (!user) return problem(401, "Your session has expired. Please sign in again.")
    if (perm) { const d = deny(user, perm); if (d) return d }
    if (user.role === "vatOfficer") logOfficerAccess(user, req)
    return fn(req, ctx, user)
  }
}

/**
 * R6.2 (GO 16/Mushak/2019 — VAT officials' access for audit): every read a VAT officer makes is written to the audit
 * trail (entity "access", action "viewed"), at most once a minute per path so paging does not flood the log.
 */
const seen = (globalThis as unknown as { __dzAccess?: Map<string, number> }).__dzAccess ??= new Map()
export function logOfficerAccess(user: User, req: Request) {
  const u = new URL(req.url)
  const path = u.pathname.replace(/^.*\/api\/v1/, "") || "/"
  const key = `${user.id}|${req.method}|${path}`, now = Date.now()
  if ((seen.get(key) ?? 0) > now - 60_000) return
  seen.set(key, now)
  recordAudit({ actor: user, entity: "access", entityId: user.id, ref: path, action: "viewed", note: [req.method !== "GET" ? req.method : "", u.search.slice(1, 200)].filter(Boolean).join(" ") || undefined })
}
