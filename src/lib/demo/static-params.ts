/**
 * Pre-rendered paths for the static GitHub Pages demo (`output: "export"` can only serve pages built ahead of time).
 * Every function returns [] in the normal server build, where these routes stay dynamic.
 */
import { NAV } from "../nav"
import { STATIC_DEMO } from "../base-path"
import * as seed from "../mock/seed"

/** Room for documents created in the browser (ids continue the seed sequence: s223, s224 …). */
export const NEW_DOC_HEADROOM = 50

const placeholders = NAV.flatMap((g) => g.items).filter((i) => !i.ready).map((i) => i.href)
const num = (id: string) => Number(id.slice(1)) || 0

function docIds(prefix: "s" | "p", docs: { id: string }[]) {
  const seeded = docs.map((d) => d.id)
  const max = docs.reduce((m, d) => Math.max(m, num(d.id)), 0)
  const fresh = Array.from({ length: NEW_DOC_HEADROOM }, (_, i) => `${prefix}${max + i + 1}`)
  return [...seeded, ...fresh]
}

/** /sales/[id] (+ /edit) and /purchases/[id] (+ /edit): documents plus the "coming soon" siblings (/sales/services …). */
export function docParams(kind: "sales" | "purchases") {
  if (!STATIC_DEMO) return []
  const ids = kind === "sales" ? docIds("s", seed.sales) : docIds("p", seed.purchases)
  const extra = placeholders.filter((h) => h.split("/").length === 3 && h.startsWith(`/${kind}/`)).map((h) => h.split("/")[2])
  return [...ids, ...extra].map((id) => ({ id }))
}

/** [...slug]: every not-yet-built nav destination not covered by a more specific route. */
export function slugParams() {
  if (!STATIC_DEMO) return []
  return placeholders.filter((h) => !/^\/(sales|purchases)\/[^/]+$/.test(h)).map((h) => ({ slug: h.slice(1).split("/") }))
}
