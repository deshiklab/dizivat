import { clearSession, currentUser } from "@/lib/auth/session-user"
import { recordAudit } from "@/lib/mock/audit"
import { json } from "../../_lib"

export async function POST(req: Request) {
  const user = await currentUser(req)
  if (user) recordAudit({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signedOut" })
  const res = json({ ok: true })
  clearSession(res)
  return res
}
