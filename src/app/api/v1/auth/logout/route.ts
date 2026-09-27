import { currentUser } from "@/lib/auth/server"
import { SESSION_COOKIE } from "@/lib/auth/session"
import { recordAudit } from "@/lib/mock/audit"
import { json } from "../../_lib"

export async function POST() {
  const user = await currentUser()
  if (user) recordAudit({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signedOut" })
  const res = json({ ok: true })
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 })
  return res
}
