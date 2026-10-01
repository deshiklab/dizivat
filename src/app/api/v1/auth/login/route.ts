import { z } from "zod"
import { issueSession, meFor } from "@/lib/auth/session-user"
import { passwordOf, userStore, users } from "@/lib/mock/users"
import { recordAudit } from "@/lib/mock/audit"
import { delay } from "@/lib/mock/query"
import { accessExpired } from "@/lib/auth/roles"
import { json, problem } from "../../_lib"

const body = z.object({ username: z.string().trim().min(1, "required"), password: z.string().min(1, "required"), remember: z.boolean().optional() })
const MAX_FAILURES = 5
const LOCK_MS = 60_000

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    const errors: Record<string, string[]> = {}
    for (const i of parsed.error.issues) (errors[i.path.join(".")] ??= []).push(i.message)
    return problem(422, "Validation failed", errors)
  }
  const { username, password, remember } = parsed.data
  const key = username.toLowerCase()
  await delay(350) // constant-ish time; slows guessing
  const f = userStore.failures[key]
  if (f && f.until > Date.now()) return problem(429, "locked", { _: [String(Math.ceil((f.until - Date.now()) / 1000))] })

  const user = users.find((u) => u.username === key)
  if (!user || password !== passwordOf(user.id)) {
    const n = (f && f.until <= Date.now() && f.n >= MAX_FAILURES ? 0 : f?.n ?? 0) + 1
    userStore.failures[key] = { n, until: n >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 }
    // Only known accounts are logged — logging arbitrary usernames would let anyone fill the audit trail
    if (user) recordAudit({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signInFailed", note: n >= MAX_FAILURES ? "Wrong password — locked for 60 s" : "Wrong password" })
    return problem(401, "invalid", { _: [String(Math.max(0, MAX_FAILURES - n))] })
  }
  delete userStore.failures[key]
  // Checked after the password so a disabled account is not revealed to someone guessing
  if (!user.active) return problem(403, "disabled")
  // R6.2: a VAT officer's access period has ended
  if (accessExpired(user)) {
    recordAudit({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signInFailed", note: `Access period ended ${user.accessUntil ?? ""}`.trim() })
    return problem(403, "expired")
  }
  user.lastSignInAt = new Date().toISOString()
  recordAudit({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signedIn" })
  const res = json(meFor(user))
  await issueSession(res, req, user.id, remember)
  return res
}
