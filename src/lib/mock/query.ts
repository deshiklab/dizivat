/** Server-side list engine: filter → facet counts → sort → totals → paginate. Mirrors the planned API contract. */
export interface QuerySpec<T> {
  search?: (row: T) => string
  dateField?: keyof T
  facets?: Record<string, (row: T) => string>
  totals?: (keyof T)[]
}

export function runQuery<T extends object>(rows: T[], sp: URLSearchParams, spec: QuerySpec<T>) {
  const page = Math.max(1, Number(sp.get("page") ?? 1))
  const size = Math.min(500, Math.max(1, Number(sp.get("size") ?? 25)))
  const q = (sp.get("q") ?? "").trim().toLowerCase()
  const from = sp.get("from"), to = sp.get("to")
  const active: Record<string, string[]> = {}
  for (const f of Object.keys(spec.facets ?? {})) {
    const v = sp.get(f)
    if (v) active[f] = v.split(",").filter(Boolean)
  }

  const base = rows.filter((r) => {
    if (q && spec.search && !spec.search(r).toLowerCase().includes(q)) return false
    if (spec.dateField) {
      const d = String(r[spec.dateField])
      if (from && d < from) return false
      if (to && d > to) return false
    }
    return true
  })
  const passes = (r: T, except?: string) =>
    Object.entries(active).every(([f, vals]) => f === except || vals.includes(spec.facets![f](r)))

  // Facet counts respect every other active filter (standard faceted-search behaviour)
  const facets: Record<string, Record<string, number>> = {}
  for (const [f, get] of Object.entries(spec.facets ?? {})) {
    const counts: Record<string, number> = {}
    for (const r of base) if (passes(r, f)) counts[get(r)] = (counts[get(r)] ?? 0) + 1
    facets[f] = counts
  }

  let out = base.filter((r) => passes(r))
  const sort = sp.get("sort")
  if (sort) {
    const [field, dir] = sort.split(".") as [keyof T, string]
    const m = dir === "asc" ? 1 : -1
    out = [...out].sort((a, b) => {
      const x = a[field] as unknown, y = b[field] as unknown
      if (typeof x === "number" && typeof y === "number") return (x - y) * m
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * m
    })
  }
  const totals: Record<string, number> = {}
  for (const k of spec.totals ?? []) totals[k as string] = Math.round(out.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100

  return { all: out, data: out.slice((page - 1) * size, page * size), total: out.length, page, size, totals, facets }
}

export function toCSV<T>(rows: T[], cols: { key: string; label: string; get?: (r: T) => unknown }[]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.map((c) => esc(c.label)).join(",")
  const body = rows.map((r) => cols.map((c) => esc(c.get ? c.get(r) : (r as Record<string, unknown>)[c.key])).join(",")).join("\n")
  return "\uFEFF" + head + "\n" + body // BOM so Excel opens UTF-8 (Bangla) correctly
}

export const csvResponse = (csv: string, name: string) =>
  new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } })

export const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms))
