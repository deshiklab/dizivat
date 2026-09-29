/**
 * Stateless signed session token (HMAC-SHA256), verifiable in both the Edge middleware and Node route handlers.
 * Stand-in for the Symfony session cookie that the reverse proxy will pass through in R1.
 */
export const SESSION_COOKIE = "dizivat_session"
export const SESSION_TTL_SHORT = 60 * 60 * 12 // 12 h
export const SESSION_TTL_LONG = 60 * 60 * 24 * 7 // 7 days ("keep me signed in")

/** iat = issued-at (s); sessions issued before a password reset/deactivation are rejected. */
export interface SessionPayload { uid: string; exp: number; iat?: number }

const enc = new TextEncoder()
const secret = () => process.env.SESSION_SECRET ?? "dizivat-dev-secret-change-in-production"

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function key() {
  return crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

export async function signSession(payload: SessionPayload) {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign("HMAC", await key(), enc.encode(body))
  return `${body}.${b64url(sig)}`
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload
    return p.exp * 1000 > Date.now() ? p : null
  } catch {
    return null
  }
}
