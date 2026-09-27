import "server-only"
import { cookies } from "next/headers"
import type { NextResponse } from "next/server"
import { companySummary } from "../mock/company"
import { findUser, userStore } from "../mock/users"
import { ROLE_PERMS, type Me, type User } from "./roles"
import { SESSION_COOKIE, SESSION_TTL_LONG, SESSION_TTL_SHORT, signSession, verifySession } from "./session"

/**
 * Current user from the session cookie (server components & route handlers).
 * Null when the account was deactivated or the token predates a password reset — sessions die immediately.
 */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies()
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value)
  if (!s) return null
  const u = findUser(s.uid)
  if (!u || !u.active) return null
  const revoked = userStore.revokedBefore[u.id]
  if (revoked && (s.iat ?? 0) < revoked) return null
  return u
}

export const meFor = (user: User): Me => ({
  user, permissions: ROLE_PERMS[user.role], preferences: userStore.prefs[user.id] ?? {}, company: companySummary(),
})

export async function currentMe(): Promise<Me | null> {
  const u = await currentUser()
  return u ? meFor(u) : null
}

/** Sets a fresh session cookie on `res`. */
export async function issueSession(res: NextResponse, req: Request, uid: string, remember?: boolean) {
  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT
  const now = Math.floor(Date.now() / 1000)
  const token = await signSession({ uid, exp: now + ttl, iat: now })
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: ttl })
}
