"use client"

import { createParser, parseAsArrayOf, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import type { ListParams } from "@/lib/types"

/**
 * List state lives in the URL (?page=2&sort=netTotal.desc&process=Created&from=…),
 * so every filtered view is shareable, bookmarkable and survives reload
 * (prototype: filters lost on navigation, no share feature).
 */
export function useListState<F extends string>(facets: readonly F[], defaults: { size?: number } = {}) {
  const facetParsers = Object.fromEntries(facets.map((f) => [f, parseAsArrayOf(parseAsString, ",").withDefault([])])) as Record<F, ReturnType<typeof parseAsArrayOf<string>> & { defaultValue: string[] }>
  const [state, setState] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      size: parseAsInteger.withDefault(defaults.size ?? 25),
      sort: parseAsString,
      q: parseAsString.withDefault(""),
      from: parseAsString,
      to: parseAsString,
      ...facetParsers,
    },
    { history: "replace", clearOnDefault: true }
  )
  const s = state as unknown as { page: number; size: number; sort: string | null; q: string; from: string | null; to: string | null } & Record<F, string[]>
  const set = (patch: Partial<typeof s>, resetPage = true) =>
    setState({ ...(patch as object), ...(resetPage && !("page" in patch) ? { page: 1 } : {}) } as never)
  const params: ListParams = { page: s.page, size: s.size, sort: s.sort ?? undefined, q: s.q || undefined, from: s.from ?? undefined, to: s.to ?? undefined }
  for (const f of facets) params[f] = s[f]
  const clearAll = () => set({ q: "", from: null, to: null, ...Object.fromEntries(facets.map((f) => [f, []])) } as never)
  const activeCount = (s.q ? 1 : 0) + (s.from || s.to ? 1 : 0) + facets.reduce((a, f) => a + (s[f].length ? 1 : 0), 0)
  return { state: s, set, params, clearAll, activeCount }
}

/** `?new=1` / `?new=true` flag (links from the palette, top bar and `n` hotkey use `new=1`). */
export const parseAsFlag = createParser({
  parse: (v: string) => v === "1" || v === "true",
  serialize: (v: boolean) => (v ? "1" : ""),
}).withDefault(false)
