import "server-only"
import { cookies } from "next/headers"
import type { Me } from "./roles"
import { SESSION_COOKIE } from "./session"
import { meFor, userFromToken } from "./session-user"

/** Base URL of the NestJS API when the frontend runs against it (API_UPSTREAM), else undefined (mock). */
export const apiUpstream = () => process.env.API_UPSTREAM?.replace(/\/$/, "") || undefined

/** Current user for server components (the app layout). Route handlers use `currentUser(req)` from `./session-user`. */
export async function currentMe(): Promise<Me | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const upstream = apiUpstream()
  if (upstream) {
    // The API owns sessions (revocation, deactivation) — ask it rather than trusting the signature alone
    if (!token) return null
    const res = await fetch(`${upstream}/api/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }, cache: "no-store" })
    return res.ok ? ((await res.json()) as Me) : null
  }
  const u = await userFromToken(token)
  return u ? meFor(u) : null
}
