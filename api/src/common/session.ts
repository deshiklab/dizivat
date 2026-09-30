/**
 * Session cookie token — the same `body.sig` HMAC-SHA256 format the Next.js middleware verifies (src/lib/auth/session.ts),
 * signed with the shared SESSION_SECRET. R5 adds `sid`: the token is only honoured while its sessions row is active.
 */
import { createHmac, timingSafeEqual } from "node:crypto"

export const SESSION_COOKIE = "dizivat_session"
export const SESSION_TTL_SHORT = 60 * 60 * 12
export const SESSION_TTL_LONG = 60 * 60 * 24 * 7
const DEV_SECRET = "dizivat-dev-secret-change-in-production"

export interface TokenPayload { uid: string; sid: string; exp: number; iat: number }

export const secret = () => process.env.SESSION_SECRET ?? DEV_SECRET
export const usingDevSecret = () => !process.env.SESSION_SECRET || process.env.SESSION_SECRET === DEV_SECRET

const mac = (body: string) => createHmac("sha256", secret()).update(body).digest()

export function signToken(p: TokenPayload) {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url")
  return `${body}.${mac(body).toString("base64url")}`
}

export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  try {
    const want = mac(body), got = Buffer.from(sig, "base64url")
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TokenPayload>
    if (typeof p.uid !== "string" || typeof p.sid !== "string" || typeof p.exp !== "number") return null
    return p.exp * 1000 > Date.now() ? (p as TokenPayload) : null
  } catch {
    return null
  }
}
