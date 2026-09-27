import { NextResponse } from "next/server"
import type { ZodError } from "zod"
import { currentUser } from "@/lib/auth/server"
import { can, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init)
/** RFC 9457 problem+json — the error shape the Symfony API will return */
export const problem = (status: number, title: string, errors?: Record<string, string[]>) =>
  NextResponse.json({ type: "about:blank", title, status, errors }, { status, headers: { "content-type": "application/problem+json" } })
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
    const user = await currentUser()
    if (!user) return problem(401, "Your session has expired. Please sign in again.")
    if (perm) { const d = deny(user, perm); if (d) return d }
    return fn(req, ctx, user)
  }
}
