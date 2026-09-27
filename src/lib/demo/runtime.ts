/**
 * Static GitHub Pages demo: runs the mock API route handlers (src/app/api/v1) inside the browser.
 * Loaded lazily by ./boot on the first /api/v1 request, so it is never part of the normal server build's pages.
 */
import { persistState, restoreState } from "./state"

type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response> | Response
type RouteModule = Partial<Record<string, Handler>>
interface Route { pattern: RegExp; names: string[]; statics: number; load: () => Promise<RouteModule> }

restoreState()

const ctx = require.context("../../app/api/v1", true, /\/route\.ts$/, "lazy")

const routes: Route[] = ctx.keys()
  .filter((k) => k.startsWith("./"))
  .map((k) => {
    const segs = k.slice(2, -"/route.ts".length).split("/").filter(Boolean)
    const names: string[] = []
    const src = segs.map((s) => {
      const m = /^\[(\.\.\.)?(.+)\]$/.exec(s)
      if (!m) return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      names.push(m[2])
      return m[1] ? "(.+)" : "([^/]+)"
    }).join("/")
    return { pattern: new RegExp(`^/${src}/?$`), names, statics: segs.filter((s) => !s.startsWith("[")).length, load: () => ctx(k) as Promise<RouteModule> }
  })
  // Static segments win over dynamic ones (e.g. /sales/bulk before /sales/[id])
  .sort((a, b) => b.statics - a.statics || a.names.length - b.names.length)

const problem = (status: number, title: string) =>
  Response.json({ type: "about:blank", title, status }, { status, headers: { "content-type": "application/problem+json" } })

/** `path` is relative to /api/v1, e.g. "/sales/s12/approve". */
export async function handle(path: string, req: Request): Promise<Response> {
  for (const r of routes) {
    const m = r.pattern.exec(path)
    if (!m) continue
    const params: Record<string, string> = {}
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]) })
    const mod = await r.load()
    const fn = mod[req.method.toUpperCase()]
    if (typeof fn !== "function") return problem(405, `Method ${req.method} not allowed`)
    try {
      const res = await fn(req, { params: Promise.resolve(params) })
      if (req.method !== "GET" && req.method !== "HEAD") persistState()
      return res
    } catch (e) {
      console.error("[demo api]", e)
      return problem(500, e instanceof Error ? e.message : "Internal error")
    }
  }
  return problem(404, "Not found")
}
