"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Download, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Pill } from "@/components/common/status-badge"
import { api } from "@/lib/api/client"
import { fmtHs, fmtNum, fmtPct } from "@/lib/format"
import type { TariffLine } from "@/lib/types"

const FACETS = ["vat", "chapter", "sd"] as const
const RATES = ["cd", "sd", "vat", "ait", "rd", "at"] as const

/** NBR customs & VAT tariff (legacy NBR VAT › Tax Tariff) — read-only reference for item HS codes and rates. */
export function TariffPage() {
  const t = useTranslations("tariff")
  const tt = useTranslations("table")
  const locale = useLocale()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 50 })
  const q = useQuery({ queryKey: ["tariff", params], queryFn: () => api.tariff.list(params), placeholderData: keepPreviousData })
  const pct = React.useCallback((n: number) => <span className={n ? "tabular" : "tabular text-muted-foreground"}>{fmtPct(n, locale)}</span>, [locale])

  const columns = React.useMemo<ColumnDef<TariffLine, unknown>[]>(() => [
    { id: "hsCode", accessorKey: "hsCode", meta: { label: t("col.hs"), hideable: false }, header: t("col.hs"), cell: ({ row }) => <span className="tabular whitespace-nowrap font-medium">{fmtHs(row.original.hsCode)}</span> },
    { id: "description", accessorKey: "description", meta: { label: t("col.description"), hideable: false }, header: t("col.description"), cell: ({ row }) => <span className="block min-w-64 max-w-md">{row.original.description}</span> },
    ...RATES.map((k): ColumnDef<TariffLine, unknown> => ({
      id: k, accessorKey: k, meta: { label: t(`col.${k}`), align: "right" }, header: () => <abbr title={t(`full.${k}`)} className="no-underline">{t(`col.${k}`)}</abbr>,
      cell: ({ row }) => pct(row.original[k]),
    })),
    {
      id: "tti", accessorKey: "tti", meta: { label: t("col.tti"), align: "right" }, header: () => <abbr title={t("full.tti")} className="no-underline">{t("col.tti")}</abbr>,
      cell: ({ row }) => <span className="tabular font-semibold">{fmtNum(row.original.tti, locale, 2)}%</span>,
    },
  ], [t, locale, pct])

  const facetOpts = {
    vat: ["0", "5", "7.5", "10", "15"].map((v) => ({ value: v, label: `${v}%` })),
    chapter: Object.keys(q.data?.facets.chapter ?? {}).sort().map((c) => ({ value: c, label: t("chapterN", { n: c }) })),
    sd: ["yes", "no"].map((v) => ({ value: v, label: t(`sd.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]

  return (
    <>
      <PageHeader title={t("title")} description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), fy: q.data.fy }) : t("subtitle")} />
      <p className="mb-4 flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("note")}</p>
      <DataTable<TariffLine>
        tableId="tariff" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.hsCode} filtered={activeCount > 0}
        defaultHidden={["rd", "at"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <FacetFilter title={t("facet.vat")} options={facetOpts.vat} selected={state.vat} onChange={(v) => set({ vat: v })} counts={q.data?.facets.vat} />
            <FacetFilter title={t("facet.chapter")} options={facetOpts.chapter} selected={state.chapter} onChange={(v) => set({ chapter: v })} counts={q.data?.facets.chapter} />
            <FacetFilter title={t("facet.sd")} options={facetOpts.sd} selected={state.sd} onChange={(v) => set({ sd: v })} counts={q.data?.facets.sd} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.tariff.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(r) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="tabular font-medium">{fmtHs(r.hsCode)}</span><Pill tone="info">{t("col.tti")} {fmtNum(r.tti, locale, 2)}%</Pill></div>
            <p className="text-sm">{r.description}</p>
            <p className="text-xs text-muted-foreground">{RATES.map((k) => `${t(`col.${k}`)} ${fmtPct(r[k], locale)}`).join(" · ")}</p>
          </div>
        )}
        emptyAction={activeCount > 0 ? <Button variant="outline" size="sm" onClick={clearAll}>{tt("clearAll")}</Button> : undefined}
      />
    </>
  )
}
