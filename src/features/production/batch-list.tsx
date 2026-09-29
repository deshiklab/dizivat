"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, PackageCheck, Plus } from "lucide-react"
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
import type { Batch } from "@/lib/types"
import { useR3Actions } from "@/features/r3/use-r3-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import { ModePill } from "./parts"

const BatchSheet = dynamic(() => import("./batch-sheet").then((m) => m.BatchSheet), { ssr: false })
const BatchForm = dynamic(() => import("./batch-form").then((m) => m.BatchForm), { ssr: false })

export type BatchVariant = "batches" | "opening"
const FACETS = ["process", "mode", "receipt"] as const
type Facet = (typeof FACETS)[number]

/**
 * Production batches (in-house and contractual) or production opening entries.
 * URL state: ?new (&workOrder=<id>), ?view=<id> (&tab=mushak), ?edit=<id>.
 */
export function BatchList({ variant = "batches" }: { variant?: BatchVariant }) {
  const t = useTranslations("batch")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const opening = variant === "opening"
  const facets = (opening ? ["process"] : FACETS) as readonly Facet[]
  const { state, set, params: raw, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const modes = raw.mode as string[] | undefined
  const params = { ...raw, mode: opening ? ["opening"] : modes?.length ? modes : ["inHouse", "contractual"] }
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [forWo, setForWo] = useQueryState("workOrder", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["batches", params], queryFn: () => api.production.batches.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["batch", editId], queryFn: () => api.production.batches.get(editId!), enabled: !!editId })
  const actions = useR3Actions("batch")
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)
  const ns = opening ? "opening" : "list"

  const columns = React.useMemo<ColumnDef<Batch, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular whitespace-nowrap" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.issueDate") }, header: t("col.issueDate"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.issueDate, locale)}</span> },
    ...(!opening ? [
      { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => <ModePill mode={row.original.mode} /> },
      { id: "vendorName", accessorKey: "vendorName", meta: { label: t("col.contractor") }, header: t("col.contractor"), cell: ({ row }) => <span className="block max-w-52 truncate" title={row.original.vendorName}>{row.original.vendorName ?? "—"}</span> },
    ] as ColumnDef<Batch, unknown>[] : []),
    { id: "items", meta: { label: t("col.items"), sortable: false }, header: t("col.items"),
      cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.lines.map((l) => l.name).join(", ")}>{row.original.lines[0]?.name}{row.original.lines.length > 1 && <span className="text-muted-foreground"> +{fmtNum(row.original.lines.length - 1, locale)}</span>}</span> },
    ...(!opening ? [{ id: "workOrder", meta: { label: t("col.workOrder"), sortable: false }, header: t("col.workOrder"),
      cell: ({ row }) => <span className="tabular">{[...new Set(row.original.lines.map((l) => l.workOrderNo).filter(Boolean))].join(", ") || "—"}</span> }] as ColumnDef<Batch, unknown>[] : []),
    { id: "totalIssue", accessorKey: "totalIssue", meta: { label: t("col.issue"), align: "right", total: "totalIssue" }, header: t("col.issue"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.totalIssue, locale, 2)}</span> },
    { id: "totalReceive", accessorKey: "totalReceive", meta: { label: t("col.receive"), align: "right", total: "totalReceive" }, header: t("col.receive"),
      cell: ({ row }) => row.original.mode === "contractual" && !row.original.receivedAt && row.original.process === "Approved"
        ? <Pill tone="warning">{t("awaiting")}</Pill> : <span className="tabular">{fmtNum(row.original.totalReceive, locale, 2)}</span> },
    { id: "totalDamage", accessorKey: "totalDamage", meta: { label: t("col.damage"), align: "right", total: "totalDamage" }, header: t("col.damage"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.totalDamage, locale, 2)}</span> },
    { id: "materialValue", accessorKey: "materialValue", meta: { label: t("col.material"), align: "right", total: "materialValue" }, header: t("col.material"), cell: ({ row }) => <Money value={row.original.materialValue} /> },
    { id: "value", accessorKey: "value", meta: { label: t("col.value"), align: "right", total: "value" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.value} className="font-medium" /> },
    { id: "issuedBy", accessorKey: "issuedBy", meta: { label: t("col.createdBy") }, header: t("col.createdBy") },
    { id: "process", accessorKey: "process", meta: { label: t("col.process") }, header: t("col.process"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          {row.original.mode === "contractual" && row.original.process === "Approved" && !row.original.receivedAt && can("doc.edit") &&
            <Button variant="ghost" size="icon-sm" aria-label={t("receiveDoc", { no: row.original.no })} title={t("receive")} onClick={() => { setViewId(row.original.id); setTab("receive") }}><PackageCheck /></Button>}
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy, opening])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    mode: (["inHouse", "contractual"] as const).map((v) => ({ value: v, label: t(`mode.${v}`) })),
    receipt: (["awaiting", "done"] as const).map((v) => ({ value: v, label: t(`receipt.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...facets.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const awaiting = q.data?.facets.receipt?.awaiting ?? 0

  return (
    <>
      <PageHeader
        title={t(`${ns}.title`)}
        description={q.data ? t(`${ns}.summary`, { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.value ?? 0, locale), pending: fmtNum(q.data.facets.process?.Created ?? 0, locale), awaiting: fmtNum(awaiting, locale) }) : t(`${ns}.subtitle`)}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t(`${ns}.new`)}</Button> : undefined}
      />
      <DataTable<Batch>
        tableId={opening ? "productionOpening" : "batches"} caption={t(`${ns}.title`)} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={opening ? ["totalIssue", "materialValue", "issuedBy"] : ["materialValue", "issuedBy", "totalDamage"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {facets.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.production.batches.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="truncate text-sm">{d.lines.map((l) => l.name).join(", ")}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.issueDate, locale)} · {t(`mode.${d.mode}`)}</span><Money value={d.value} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <BatchSheet id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }} onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} />}
      {formMounted && <BatchForm open={formOpen} variant={variant} doc={editId ? editing.data : null} workOrderId={forWo}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setForWo(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
