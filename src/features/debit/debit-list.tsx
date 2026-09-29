"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, Plus, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { DEBIT_REASONS } from "@/lib/r2"
import type { DebitNote } from "@/lib/types"
import { useR2Actions } from "@/features/r2/use-r2-actions"
import { DEBIT_REASON_TONE, DebitSheet } from "./debit-sheet"
import { DebitForm } from "./debit-form"

const FACETS = ["process", "reason", "vendor", "branch"] as const
type Facet = (typeof FACETS)[number]

/** Debit notes (Mushak 6.8) — list with ?new (&purchase=<id>), ?view=<id> (&tab=mushak) and ?edit=<id>. */
export function DebitList() {
  const t = useTranslations("debit")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [forPurchase, setForPurchase] = useQueryState("purchase", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["debitNotes", params], queryFn: () => api.debitNotes.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["debit", editId], queryFn: () => api.debitNotes.get(editId!), enabled: !!editId })
  const actions = useR2Actions("debit")
  const labels = q.data?.facetLabels ?? {}

  const columns = React.useMemo<ColumnDef<DebitNote, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.issueDate, locale)}</span> },
    { id: "purchaseNo", accessorKey: "purchaseNo", meta: { label: t("col.purchase") }, header: t("col.purchase"),
      cell: ({ row }) => <Link href={`/purchases/${row.original.purchaseId}`} onClick={(e) => e.stopPropagation()} className="tabular hover:underline">{row.original.purchaseNo}</Link> },
    { id: "vendorName", accessorKey: "vendorName", meta: { label: t("col.vendor") }, header: t("col.vendor"), cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.vendorName}>{row.original.vendorName}</span> },
    { id: "reason", accessorKey: "reason", meta: { label: t("col.reason") }, header: t("col.reason"), cell: ({ row }) => <Pill tone={DEBIT_REASON_TONE[row.original.reason]}>{t(`reason.${row.original.reason}`)}</Pill> },
    { id: "items", meta: { label: t("col.items"), sortable: false }, header: t("col.items"),
      cell: ({ row }) => <span className="block max-w-60 truncate" title={row.original.lines.map((l) => l.name).join(", ")}>{row.original.lines[0]?.name}{row.original.lines.length > 1 && <span className="text-muted-foreground"> +{fmtNum(row.original.lines.length - 1, locale)}</span>}</span> },
    { id: "subtotal", accessorKey: "subtotal", meta: { label: t("col.value"), align: "right", total: "subtotal" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.subtotal} /> },
    { id: "vat", accessorKey: "vat", meta: { label: t("col.vat"), align: "right", total: "vat" }, header: t("col.vat"), cell: ({ row }) => <Money value={row.original.vat} /> },
    { id: "tti", accessorKey: "tti", meta: { label: "TTI", align: "right", total: "tti" }, header: "TTI", cell: ({ row }) => <Money value={row.original.tti} /> },
    { id: "total", accessorKey: "total", meta: { label: t("col.total"), align: "right", total: "total" }, header: t("col.total"), cell: ({ row }) => <Money value={row.original.total} className="font-medium" /> },
    { id: "rebate", accessorKey: "rebate", meta: { label: t("col.rebate"), align: "right", total: "rebate" }, header: t("col.rebate"), cell: ({ row }) => <Money value={row.original.rebate} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("printDoc", { no: row.original.no })} onClick={() => { setViewId(row.original.id); setTab("mushak") }}><Printer /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    reason: DEBIT_REASONS.map((v) => ({ value: v, label: t(`reason.${v}`) })),
    vendor: Object.entries(labels.vendor ?? {}).filter(([v]) => q.data?.facets.vendor?.[v]).map(([value, label]) => ({ value, label })),
    branch: Object.entries(labels.branch ?? {}).filter(([v]) => q.data?.facets.branch?.[v]).map(([value, label]) => ({ value, label })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const pending = q.data?.facets.process?.Created ?? 0

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.total ?? 0, locale), rebate: fmtCompact(q.data.totals.rebate ?? 0, locale), pending: fmtNum(pending, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<DebitNote>
        tableId="debitNotes" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["tti", "rebate", "items"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.debitNotes.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="truncate text-sm">{d.vendorName}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.issueDate, locale)} · {t(`reason.${d.reason}`)}</span><Money value={d.total} /></p>
          </div>
        )}
      />
      {actions.dialog}
      <DebitSheet id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }} onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} />
      <DebitForm open={(isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))} doc={editId ? editing.data : null} purchaseId={forPurchase}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setForPurchase(null) } }} onSaved={(d) => setViewId(d.id)} />
    </>
  )
}
