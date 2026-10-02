"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { ADJUSTMENT_KINDS, ADJUSTMENT_TONE, periodLabel } from "@/lib/r4"
import type { VatAdjustment } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import { SdWindowCard } from "./sd-window"
import type { SdPreset } from "./adjust-form"

const AdjustSheet = dynamic(() => import("./adjust-sheet").then((m) => m.AdjustSheet), { ssr: false })
const AdjustForm = dynamic(() => import("./adjust-form").then((m) => m.AdjustForm), { ssr: false })

const FACETS = ["process", "kind", "period"] as const
type Facet = (typeof FACETS)[number]

/** Manual VAT adjustments — increasing (note 27) / decreasing (note 32), SD (38 / 39) and SD on exported inputs (40) — for the Mushak 9.1 return. */
export function AdjustList() {
  const t = useTranslations("adjust")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const [preset, setPreset] = React.useState<SdPreset | null>(null)
  const q = useQuery({ queryKey: ["adjustments", params], queryFn: () => api.vat.adjustments.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["r4doc", "adjustment", editId], queryFn: () => api.vat.adjustments.get(editId!), enabled: !!editId })
  const actions = useR4Actions("adjustment")
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const columns = React.useMemo<ColumnDef<VatAdjustment, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.issueDate, locale)}</span> },
    { id: "kind", accessorKey: "kind", meta: { label: t("col.kind") }, header: t("col.kind"), cell: ({ row }) => <Pill tone={ADJUSTMENT_TONE[row.original.kind]}>{t(`kind.${row.original.kind}`)}</Pill> },
    { id: "note", accessorKey: "note", meta: { label: t("col.note"), align: "right" }, header: t("col.note"), cell: ({ row }) => <span className="tabular">{row.original.note}</span> },
    { id: "taxPeriod", accessorKey: "taxPeriod", meta: { label: t("col.period") }, header: t("col.period"), cell: ({ row }) => <span className="tabular">{periodLabel(row.original.taxPeriod)}</span> },
    { id: "description", accessorKey: "description", meta: { label: t("col.description"), sortable: false }, header: t("col.description"), cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.description}>{row.original.description}</span> },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    kind: ADJUSTMENT_KINDS.map((v) => ({ value: v, label: t(`kind.${v}`) })),
    period: Object.keys(q.data?.facets.period ?? {}).sort().reverse().map((v) => ({ value: v, label: periodLabel(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale), pending: fmtNum(q.data.facets.process?.Created ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <SdWindowCard onClaim={(r) => { setPreset({ purchaseId: r.purchaseId, itemId: r.itemId }); setNew(true) }} />
      <DataTable<VatAdjustment>
        tableId="adjustments" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.vat.adjustments.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="truncate text-sm">{t(`kind.${d.kind}`)} · {periodLabel(d.taxPeriod)}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.issueDate, locale)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <AdjustSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <AdjustForm open={formOpen} doc={editId ? editing.data : null} preset={isNew ? preset : null} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setPreset(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
