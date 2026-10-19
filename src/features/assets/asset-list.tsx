"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { ProcessBadge } from "@/components/common/status-badge"
import { DataTable } from "@/components/data-table/data-table"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import type { AssetRegisterRow } from "@/lib/types"

const AssetSheet = dynamic(() => import("./asset-sheet").then((m) => m.AssetSheet), { ssr: false })
const AssetForm = dynamic(() => import("./asset-form").then((m) => m.AssetForm), { ssr: false })

const FACETS = ["status", "class"] as const
type Facet = (typeof FACETS)[number]

/**
 * R9.4 — the fixed-asset register: every asset with its class, its cost, the depreciation the posting
 * rules have derived for it and the net book value it carries today. The rows are documents (AS- series:
 * draft → approve → cancel, the same lifecycle every document has); the depreciation column is a read
 * model — the schedule and the postings fold from the rows, so the register can never disagree with the
 * books.
 */
export function AssetList() {
  const t = useTranslations("assets")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["assetRegister", params], queryFn: () => api.accounting.assets.list(params) })
  const editing = useQuery({ queryKey: ["r4doc", "asset", editId], queryFn: () => api.accounting.assets.get(editId!), enabled: !!editId })
  const actions = useR4Actions("asset")
  const labels = q.data?.facetLabels ?? {}

  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const open = (r: AssetRegisterRow) => setViewId(r.id)
  const asDoc = (r: AssetRegisterRow) => ({ id: r.id, no: r.no, process: r.process })

  const columns = React.useMemo<ColumnDef<AssetRegisterRow, unknown>[]>(() => [
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); open(row.original) }}>{row.original.no}</button> },
    { id: "name", accessorKey: "name", meta: { label: t("col.name") }, header: t("col.name"), cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.name}>{row.original.name}</span> },
    { id: "class", accessorKey: "className", meta: { label: t("col.class") }, header: t("col.class"),
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.className} <span className="tabular">({row.original.rate}%)</span></span> },
    { id: "cost", accessorKey: "cost", meta: { label: t("col.cost"), align: "right", total: "cost" }, header: t("col.cost"), cell: ({ row }) => <Money value={row.original.cost} className="tabular" /> },
    { id: "accumDep", accessorKey: "accumDep", meta: { label: t("col.accum"), align: "right", total: "accumDep" }, header: t("col.accum"), cell: ({ row }) => <Money value={row.original.accumDep} className="tabular" /> },
    { id: "nbv", accessorKey: "nbv", meta: { label: t("col.nbv"), align: "right", total: "nbv" }, header: t("col.nbv"), cell: ({ row }) => <Money value={row.original.nbv} className="font-medium tabular" /> },
    { id: "monthly", accessorKey: "monthly", meta: { label: t("col.monthly") }, header: t("col.monthly"), cell: ({ row }) => row.original.monthly ? <Money value={row.original.monthly} className="tabular" /> : <span className="text-muted-foreground">—</span> },
    { id: "status", accessorKey: "status", meta: { label: t("col.status") }, header: t("col.status"),
      cell: ({ row }) => row.original.status === "Active" || row.original.status === "Disposed" ? <ProcessBadge value={row.original.process ?? "Approved"} /> : <ProcessBadge value={row.original.process ?? "Created"} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => open(row.original)}><Eye /></Button>
          {row.original.process === "Created" && can("doc.approve") && (
            <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={t("approve")} disabled={actions.busy} onClick={() => actions.approve(asDoc(row.original))}><CheckCheck /></Button>
          )}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    status: (["Active", "Draft", "Disposed", "Cancelled"] as const).map((v) => ({ value: v, label: t(`status.${v}`) })),
    class: Object.entries(labels.class ?? {}).filter(([v]) => q.data?.facets.class?.[v]).map(([value, label]) => ({ value, label })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]

  return (
    <>
      {actions.dialog}
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), cost: fmtCompact(q.data.totals.cost ?? 0, locale), nbv: fmtCompact(q.data.totals.nbv ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<AssetRegisterRow>
        tableId="assetRegister" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={open} filtered={activeCount > 0}
        defaultHidden={["monthly"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={() => clearAll()} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.accounting.assets.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process ?? "Created"} /></div>
            <p className="truncate text-sm">{d.name}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.date, locale)}</span><Money value={d.nbv} /></p>
          </div>
        )}
      />
      {sheetMounted && <AssetSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <AssetForm open={formOpen} doc={editId ? editing.data : null} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
