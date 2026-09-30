/**
 * Server-side list engine in SQL — the PostgreSQL twin of src/lib/mock/query.ts `runQuery`:
 * filter (q, from/to) → facet counts (each respecting every *other* active facet) → sort → paginate.
 * Text sorts use the ICU "natural" collation (numeric-aware, case-insensitive) = the mock's localeCompare order;
 * ties keep insertion order, as JavaScript's stable sort does.
 */
import { sql, type SQL } from "drizzle-orm"
import { db } from "../db/client"

export interface SqlListSpec {
  from: SQL
  where?: SQL[]
  /** text the `q` filter searches (case-insensitive substring) */
  search?: SQL
  /** YYYY-MM-DD column for `from` / `to` */
  dateField?: SQL
  facets?: Record<string, SQL>
  sortable: Record<string, { expr: SQL; text?: boolean }>
  /** stable tie-breaker, e.g. sql`ord` */
  order: SQL
}

export interface ListPage<R> { data: R[]; total: number; page: number; size: number; totals: Record<string, number>; facets: Record<string, Record<string, number>> }

const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const and = (parts: SQL[]) => (parts.length ? sql.join(parts.map((p) => sql`(${p})`), sql` and `) : sql`true`)

export async function sqlList<Row, R>(sp: URLSearchParams, spec: SqlListSpec, map: (r: Row) => R, opts: { all?: boolean } = {}): Promise<ListPage<R>> {
  const page = Math.max(1, Math.floor(Number(sp.get("page") ?? 1)) || 1)
  const size = Math.min(500, Math.max(1, Math.floor(Number(sp.get("size") ?? 25)) || 25))
  const q = (sp.get("q") ?? "").trim()
  const from = sp.get("from"), to = sp.get("to")

  const base: SQL[] = [...(spec.where ?? [])]
  if (q && spec.search) base.push(sql`position(lower(${q}) in lower(${spec.search})) > 0`)
  if (spec.dateField && isDay(from)) base.push(sql`${spec.dateField} >= ${from}::date`)
  if (spec.dateField && isDay(to)) base.push(sql`${spec.dateField} <= ${to}::date`)

  const active: [string, SQL, string[]][] = []
  for (const [f, expr] of Object.entries(spec.facets ?? {})) {
    const v = sp.get(f)
    const vals = v ? v.split(",").filter(Boolean) : []
    if (vals.length) active.push([f, expr, vals])
  }
  const facetCond = (except?: string) => active.filter(([f]) => f !== except).map(([, expr, vals]) => sql`${expr} in (${sql.join(vals.map((x) => sql`${x}`), sql`, `)})`)

  const [field, dir] = (sp.get("sort") ?? "").split(".")
  const s = field ? spec.sortable[field] : undefined
  const direction = dir === "asc" ? sql`asc` : sql`desc`
  const orderBy = s ? sql`${s.expr}${s.text ? sql` collate "natural"` : sql``} ${direction}, ${spec.order}` : spec.order

  const where = and([...base, ...facetCond()])
  const facetQueries = Object.entries(spec.facets ?? {}).map(async ([f, expr]) => {
    const r = await db.execute<{ k: string; n: number }>(sql`select ${expr} as k, count(*)::int as n from ${spec.from} where ${and([...base, ...facetCond(f)])} group by 1`)
    return [f, Object.fromEntries(r.rows.map((x) => [x.k, x.n]))] as const
  })
  const [count, rows, ...facets] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n from ${spec.from} where ${where}`),
    db.execute(opts.all
      ? sql`select * from ${spec.from} where ${where} order by ${orderBy}`
      : sql`select * from ${spec.from} where ${where} order by ${orderBy} limit ${size} offset ${(page - 1) * size}`),
    ...facetQueries,
  ])
  return { data: (rows.rows as Row[]).map(map), total: count.rows[0].n, page, size, totals: {}, facets: Object.fromEntries(facets) }
}
