/**
 * Cookie I/O for the mock API handlers, using only Web-standard Request/Response.
 *
 * On the server this is the normal `Cookie` / `Set-Cookie` exchange. In the static GitHub Pages demo the same
 * handlers run inside the browser (see `lib/demo`), where those two headers are forbidden, so a small
 * localStorage jar stands in. Nothing else in the handlers knows which runtime it is in.
 */
export interface CookieOptions {
  maxAge: number; httpOnly?: boolean; sameSite?: "lax" | "strict" | "none"; secure?: boolean; path?: string
  /** CHIPS: cookie keyed to the embedding site — lets the app work inside a cross-site iframe (e.g. a hosted preview) */
  partitioned?: boolean
}

const inBrowser = typeof window !== "undefined"
export const DEMO_COOKIE_JAR = "dizivat-demo-cookies"
type Jar = Record<string, { v: string; exp: number }>

const readJar = (): Jar => {
  try { return JSON.parse(localStorage.getItem(DEMO_COOKIE_JAR) ?? "{}") as Jar } catch { return {} }
}

export function readCookie(req: Request, name: string): string | undefined {
  if (inBrowser) {
    const c = readJar()[name]
    return c && c.exp > Date.now() ? c.v : undefined
  }
  for (const part of (req.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1))
  }
  return undefined
}

export function setCookie(res: Response, name: string, value: string, o: CookieOptions) {
  if (inBrowser) {
    const jar = readJar()
    if (o.maxAge <= 0) delete jar[name]
    else jar[name] = { v: value, exp: Date.now() + o.maxAge * 1000 }
    localStorage.setItem(DEMO_COOKIE_JAR, JSON.stringify(jar))
    return
  }
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? "/"}`, `Max-Age=${o.maxAge}`, `SameSite=${o.sameSite === "strict" ? "Strict" : o.sameSite === "none" ? "None" : "Lax"}`]
  if (o.httpOnly !== false) parts.push("HttpOnly")
  if (o.secure || o.sameSite === "none") parts.push("Secure")
  if (o.partitioned) parts.push("Partitioned")
  res.headers.append("set-cookie", parts.join("; "))
}
