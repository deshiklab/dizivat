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
import { ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { TODAY } from "@/lib/company"
import type { WorkOrder, WorkOrderStatus } from "@/lib/types"
import { useR3Actions } from "@/features/r3/use-r3-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import { Progress, WoStatusPill, woProgress } from "./parts"

const WorkOrderSheet = dynamic(() => import("./work-order-sheet").then((m) => m.WorkOrderSheet), { ssr: false })
const WorkOrderForm = dynamic(() => import("./work-order-form").then((m) => m.WorkOrderForm), { ssr: false })

const FACETS = ["status", "process"] as const
type Facet = (typeof FACETS)[number]
const STATUSES: WorkOrderStatus[] = ["draft", "open", "partial", "completed", "cancelled"]

/** Production work orders — ?new, ?view=<id>, ?edit=<id>. */
export function WorkOrderList() {
  const t = useTranslations("workOrder")
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
  const q = useQuery({ queryKey: ["workOrders", params], queryFn: () => api.production.workOrders.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["workOrder", editId], queryFn: () => api.production.workOrders.get(editId!), enabled: !!editId })
  const actions = useR3Actions("workOrder")
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const columns = React.useMemo<ColumnDef<WorkOrder, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular whitespace-nowrap" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.issueDate") }, header: t("col.issueDate"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.issueDate, locale)}</span> },
    { id: "requisitionNo", accessorKey: "requisitionNo", meta: { label: t("col.requisition") }, header: t("col.requisition"), cell: ({ row }) => <span className="tabular">{row.original.requisitionNo || "—"}</span> },
    { id: "items", meta: { label: t("col.items"), sortable: false }, header: t("col.items"),
      cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.lines.map((l) => l.name).join(", ")}>{row.original.lines[0]?.name}{row.original.lines.length > 1 && <span className="text-muted-foreground"> +{fmtNum(row.original.lines.length - 1, locale)}</span>}</span> },
    { id: "ordered", meta: { label: t("col.ordered"), sortable: false, align: "right" }, header: t("col.ordered"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.lines.reduce((a, l) => a + l.qty, 0), locale, 2)}</span> },
    { id: "remaining", meta: { label: t("col.remaining"), sortable: false, align: "right" }, header: t("col.remaining"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.lines.reduce((a, l) => a + l.remaining, 0), locale, 2)}</span> },
    { id: "progress", meta: { label: t("col.progress"), sortable: false }, header: t("col.progress"), cell: ({ row }) => <Progress value={woProgress(row.original)} label={t("progressOf", { no: row.original.no })} /> },
    { id: "dueDate", accessorKey: "dueDate", meta: { label: t("col.dueDate") }, header: t("col.dueDate"),
      cell: ({ row }) => {
        const w = row.original
        const late = !!w.dueDate && w.dueDate < TODAY && (w.status === "open" || w.status === "partial")
        return <span className={`tabular whitespace-nowrap ${late ? "font-medium text-destructive" : ""}`}>{w.dueDate ? fmtDate(w.dueDate, locale) : "—"}{late && <span className="sr-only"> ({t("overdue")})</span>}</span>
      } },
    { id: "status", accessorKey: "status", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <WoStatusPill status={row.original.status} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.process") }, header: t("col.process"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
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
    status: STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) })),
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const s = q.data?.facets.status ?? {}

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { open: fmtNum((s.open ?? 0) + (s.partial ?? 0), locale), completed: fmtNum(s.completed ?? 0, locale), draft: fmtNum(s.draft ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<WorkOrder>
        tableId="workOrders" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["process", "ordered"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.production.workOrders.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><WoStatusPill status={d.status} /></div>
            <p className="truncate text-sm">{d.lines.map((l) => l.name).join(", ")}</p>
            <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{fmtDate(d.issueDate, locale)}</span><Progress value={woProgress(d)} label={t("progressOf", { no: d.no })} /></div>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <WorkOrderSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <WorkOrderForm open={formOpen} doc={editId ? editing.data : null} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
