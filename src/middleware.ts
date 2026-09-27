import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from "next-intl/middleware"
import { routing } from "./i18n/routing"
import { SESSION_COOKIE, verifySession } from "./lib/auth/session"

const intl = createMiddleware(routing)
const LOCALE_PATH = new RegExp(`^/(${routing.locales.join("|")})(/.*)?$`)

/** Locale routing + session gate. API routes enforce auth themselves (401 problem+json). */
export default async function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(LOCALE_PATH)
  if (m) {
    const [, locale, rest = "/"] = m
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)
    const isLogin = rest === "/login"
    if (!session && !isLogin) {
      const url = new URL(`/${locale}/login`, req.url)
      const next = rest + req.nextUrl.search
      if (next !== "/") url.searchParams.set("next", next)
      return NextResponse.redirect(url)
    }
    if (session && isLogin) {
      const next = req.nextUrl.searchParams.get("next")
      const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
      return NextResponse.redirect(new URL(`/${locale}${safe === "/" ? "" : safe}`, req.url))
    }
  }
  return intl(req)
}

export const config = {
  // Everything except API routes, Next internals and static files
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
}
