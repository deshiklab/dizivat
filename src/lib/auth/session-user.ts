/**
 * Session → user, for the mock API route handlers. Pure Web-standard (Request/Response), so the same code runs in
 * Next route handlers and, for the static GitHub Pages demo, in the browser. Server components use `./server`.
 */
import { companySummary } from "../mock/company"
import { findUser, userStore } from "../mock/users"
import { ROLE_PERMS, type Me, type User } from "./roles"
import { SESSION_COOKIE, SESSION_TTL_LONG, SESSION_TTL_SHORT, signSession, verifySession, type SessionPayload } from "./session"
import { readCookie, setCookie, type CookieOptions } from "./cookies"

/** Null when the account was deactivated or the token predates a password reset — sessions die immediately. */
export async function userFromToken(token: string | undefined | null): Promise<User | null> {
  const s = await verifySession(token)
  if (!s) return null
  const u = findUser(s.uid)
  if (!u || !u.active) return null
  const revoked = userStore.revokedBefore[u.id]
  if (revoked && (s.iat ?? 0) < revoked) return null
  return u
}

export const currentUser = (req: Request) => userFromToken(readCookie(req, SESSION_COOKIE))
export const sessionOf = (req: Request): Promise<SessionPayload | null> => verifySession(readCookie(req, SESSION_COOKIE))

export const meFor = (user: User): Me => ({
  user, permissions: ROLE_PERMS[user.role], preferences: userStore.prefs[user.id] ?? {}, company: companySummary(),
})

/** Sets a fresh session cookie on `res`. */
export async function issueSession(res: Response, req: Request, uid: string, remember?: boolean) {
  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT
  const now = Math.floor(Date.now() / 1000)
  const token = await signSession({ uid, exp: now + ttl, iat: now })
  setCookie(res, SESSION_COOKIE, token, { httpOnly: true, path: "/", maxAge: ttl, ...cookieMode(req) })
}

/**
 * Over HTTPS the demo is often embedded in another site's iframe (hosted previews), where a SameSite=Lax cookie is
 * never sent — sign-in would loop back to the login page. There the session cookie is SameSite=None + Secure +
 * Partitioned (CHIPS: stored per embedding site). Plain-http localhost keeps SameSite=Lax. The Symfony backend
 * will set its own cookie policy; this only concerns the mock.
 */
function cookieMode(req: Request): Pick<CookieOptions, "sameSite" | "secure" | "partitioned"> {
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"
  return https ? { sameSite: "none", secure: true, partitioned: true } : { sameSite: "lax" }
}

/** Clears both variants (a partitioned cookie can only be removed by a partitioned Set-Cookie). */
export const clearSession = (res: Response) => {
  setCookie(res, SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 })
  setCookie(res, SESSION_COOKIE, "", { httpOnly: true, sameSite: "none", secure: true, partitioned: true, path: "/", maxAge: 0 })
}
