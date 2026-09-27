/**
 * Static GitHub Pages demo bootstrap (NEXT_PUBLIC_STATIC_DEMO=1). Imported first by components/providers.
 * GitHub Pages cannot run the Next.js route handlers, so `fetch("/api/v1/…")` is answered in the browser by the
 * very same handlers (./runtime) with their data kept in localStorage. CSV download links are served the same way.
 * In the normal server build STATIC_DEMO is false and this module does nothing.
 */
import { BASE_PATH, STATIC_DEMO, appUrl } from "../base-path"
import { DEMO_COOKIE_JAR } from "../auth/cookies"
import { DEMO_STATE_KEY } from "./state"

const API = /^\/api\/v1(\/.*)?$/

function apiPath(url: URL) {
  if (url.origin !== window.location.origin) return null
  let p = url.pathname
  if (BASE_PATH && p.startsWith(BASE_PATH + "/api/")) p = p.slice(BASE_PATH.length)
  const m = API.exec(p)
  return m ? (m[1] ?? "/").replace(/\/$/, "") || "/" : null
}

async function serve(path: string, req: Request) {
  const { handle } = await import("./runtime")
  return handle(path, req)
}

function install() {
  const w = window as Window & { __rbsDemo?: boolean }
  if (w.__rbsDemo) return
  w.__rbsDemo = true
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href, window.location.href)
    const path = apiPath(url)
    if (path === null) return realFetch(input, init)
    const req = input instanceof Request ? new Request(input, init) : new Request(url, init)
    return serve(path, req)
  }

  // <a href="/api/v1/…csv" download> can't reach a server either: fetch through the shim and save the blob.
  document.addEventListener("click", async (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!a || e.defaultPrevented || e.button !== 0) return
    const url = new URL(a.href, window.location.href)
    const path = apiPath(url)
    if (path === null) return
    e.preventDefault()
    const res = await serve(path, new Request(url))
    if (!res.ok) return
    const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? (path.split("/").pop() || "export") + ".csv"
    const blobUrl = URL.createObjectURL(await res.blob())
    const tmp = Object.assign(document.createElement("a"), { href: blobUrl, download: name })
    document.body.appendChild(tmp); tmp.click(); tmp.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
  }, true)
}

if (STATIC_DEMO && typeof window !== "undefined") install()

/** Wipes the demo data and session in this browser and returns to the sign-in page. */
export function resetDemo(locale: string) {
  localStorage.removeItem(DEMO_STATE_KEY)
  localStorage.removeItem(DEMO_COOKIE_JAR)
  window.location.assign(appUrl(`/${locale}/login`))
}
