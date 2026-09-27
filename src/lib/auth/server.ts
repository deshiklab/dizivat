import "server-only"
import { cookies } from "next/headers"
import type { Me } from "./roles"
import { SESSION_COOKIE } from "./session"
import { meFor, userFromToken } from "./session-user"

/** Current user for server components (the app layout). Route handlers use `currentUser(req)` from `./session-user`. */
export async function currentMe(): Promise<Me | null> {
  const u = await userFromToken((await cookies()).get(SESSION_COOKIE)?.value)
  return u ? meFor(u) : null
}
