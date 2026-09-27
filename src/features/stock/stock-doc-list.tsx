"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowRight, CheckCheck, Download, Eye, Plus } from "lucide-react"
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
import type { DamageReason, StockDoc, StockDocKind } from "@/lib/types"
import { REASON_TONE, StockDocSheet } from "./stock-doc-sheet"
import { StockDocForm } from "./stock-doc-form"
import { stockClient, stockListKey, useStockActions } from "./use-stock-actions"

const FACETS = ["process", "fromBranch", "toBranch", "branch", "reason"] as const
type Facet = (typeof FACETS)[number]
const REASONS: DamageReason[] = ["damaged", "expired", "wastage", "lost"]

/** Stock transfers (Mushak 6.5) or damage entries — the shared list, with ?new, ?view=<id> and ?edit=<id> sheets. */
export function StockDocList({ kind }: { kind: StockDocKind }) {
  const t = useTranslations("stock")
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
  const client = kind === "transfer" ? api.transfers : api.damage
  const q = useQuery({ queryKey: [stockListKey(kind), params], queryFn: () => (client.list as (p: typeof params) => Promise<Awaited<ReturnType<typeof api.transfers.list>>>)(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: [kind, editId], queryFn: () => stockClient(kind).get(editId!), enabled: !!editId })
  const actions = useStockActions(kind)
  const labels = q.data?.facetLabels ?? {}
  const facets: Facet[] = kind === "transfer" ? ["process", "fromBranch", "toBranch"] : ["process", "branch", "reason"]

  const columns = React.useMemo<ColumnDef<StockDoc, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    ...(kind === "transfer" ? [{
      id: "route", meta: { label: t("col.route"), sortable: false }, header: t("col.route"),
      cell: ({ row }) => { const d = row.original as Extract<StockDoc, { kind: "transfer" }>; return <span className="inline-flex flex-wrap items-center gap-1">{d.fromBranch} <ArrowRight className="size-3.5 text-muted-foreground" aria-label={t("to")} /> {d.toBranch}</span> },
    } as ColumnDef<StockDoc, unknown>] : [
      { id: "branch", accessorKey: "branch", meta: { label: t("col.branch") }, header: t("col.branch") } as ColumnDef<StockDoc, unknown>,
      { id: "reason", accessorKey: "reason", meta: { label: t("col.reason") }, header: t("col.reason"),
        cell: ({ row }) => { const d = row.original as Extract<StockDoc, { kind: "damage" }>; return <Pill tone={REASON_TONE[d.reason]}>{t(`reason.${d.reason}`)}</Pill> } } as ColumnDef<StockDoc, unknown>,
    ]),
    { id: "items", meta: { label: t("col.items"), sortable: false }, header: t("col.items"),
      cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.lines.map((l) => l.name).join(", ")}>{row.original.lines[0]?.name}{row.original.lines.length > 1 && <span className="text-muted-foreground"> {t("more", { n: fmtNum(row.original.lines.length - 1, locale) })}</span>}</span> },
    { id: "totalValue", accessorKey: "totalValue", meta: { label: t("col.value"), align: "right", total: "totalValue" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.totalValue} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    { id: "issuedBy", accessorKey: "issuedBy", meta: { label: t("col.by") }, header: t("col.by") },
    { id: "note", accessorKey: "note", meta: { label: t("col.note"), sortable: false }, header: t("col.note"), cell: ({ row }) => <span className="block max-w-64 truncate text-muted-foreground" title={row.original.note}>{row.original.note}</span> },
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
  ], [locale, t, kind, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    fromBranch: Object.entries(labels.fromBranch ?? {}).map(([value, label]) => ({ value, label })),
    toBranch: Object.entries(labels.toBranch ?? {}).map(([value, label]) => ({ value, label })),
    branch: Object.entries(labels.branch ?? {}).map(([value, label]) => ({ value, label })),
    reason: REASONS.map((v) => ({ value: v, label: t(`reason.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...facets.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const pending = q.data?.facets.process?.Created ?? 0

  return (
    <>
      <PageHeader
        title={t(`${kind}.title`)}
        description={q.data ? t(`${kind}.summary`, { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.totalValue ?? 0, locale), pending: fmtNum(pending, locale) }) : t(`${kind}.subtitle`)}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t(`${kind}.new`)}</Button> : undefined}
      />
      <DataTable<StockDoc>
        tableId={stockListKey(kind)} caption={t(`${kind}.title`)} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["issuedBy", "note"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t(`${kind}.searchPlaceholder`)} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {facets.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={client.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="text-sm">{d.kind === "transfer" ? `${d.fromBranch} → ${d.toBranch}` : `${d.branch} · ${t(`reason.${d.reason}`)}`}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.date, locale)} · {t("itemsCount", { n: d.lines.length })}</span><Money value={d.totalValue} /></p>
          </div>
        )}
      />
      {actions.dialog}
      <StockDocSheet kind={kind} id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />
      <StockDocForm kind={kind} open={(isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))} doc={editId ? editing.data : null}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />
    </>
  )
}
