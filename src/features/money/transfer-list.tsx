"use client"

import * as React from "react"
import dynamic from "next/dynamic"
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
import { ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import type { MoneyTransfer } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"

const TransferSheet = dynamic(() => import("./transfer-sheet").then((m) => m.TransferSheet), { ssr: false })
const TransferForm = dynamic(() => import("./transfer-form").then((m) => m.TransferForm), { ssr: false })

const FACETS = ["process", "fromAccount", "toAccount"] as const
type Facet = (typeof FACETS)[number]

/**
 * R9.1 — transfers between the company's own accounts (TX-): the cash deposited at the bank, the withdrawal for
 * wages, the wallet top-up. Balances are derived, so an approved transfer moves them on every page at once.
 */
export function TransferList() {
  const t = useTranslations("transfers")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["ownTransfers", params], queryFn: () => api.accounting.transfers.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["r4doc", "ownTransfer", editId], queryFn: () => api.accounting.transfers.get(editId!), enabled: !!editId })
  const actions = useR4Actions("ownTransfer")
  const labels = q.data?.facetLabels ?? {}
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const columns = React.useMemo<ColumnDef<MoneyTransfer, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    { id: "from", accessorKey: "fromAccount", meta: { label: t("col.from") }, header: t("col.from"), cell: ({ row }) => <span className="block max-w-48 truncate" title={row.original.fromAccount}>{row.original.fromAccount}</span> },
    { id: "to", accessorKey: "toAccount", meta: { label: t("col.to") }, header: t("col.to"),
      cell: ({ row }) => <span className="flex max-w-48 items-center gap-1 truncate" title={row.original.toAccount}><ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />{row.original.toAccount}</span> },
    { id: "reference", accessorKey: "reference", meta: { label: t("col.reference") }, header: t("col.reference"), cell: ({ row }) => <span className="block max-w-40 truncate text-muted-foreground" title={row.original.reference ?? ""}>{row.original.reference ?? "—"}</span> },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "charge", accessorKey: "charge", meta: { label: t("col.charge"), align: "right", total: "charge" }, header: t("col.charge"), cell: ({ row }) => <Money value={row.original.charge} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={t("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    fromAccount: Object.entries(labels.fromAccount ?? {}).filter(([v]) => q.data?.facets.fromAccount?.[v]).map(([value, label]) => ({ value, label })),
    toAccount: Object.entries(labels.toAccount ?? {}).filter(([v]) => q.data?.facets.toAccount?.[v]).map(([value, label]) => ({ value, label })),
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
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale), charges: fmtCompact(q.data.totals.charge ?? 0, locale), pending: fmtNum(pending, locale) }) : t("subtitle")}
        actions={can("doc.create") && <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button>}
      />
      <DataTable<MoneyTransfer>
        tableId="ownTransfers" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["reference"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.accounting.transfers.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="flex items-center gap-1 truncate text-sm">{d.fromAccount} <ArrowRight className="size-3.5 shrink-0" aria-hidden /> {d.toAccount}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.date, locale)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <TransferSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <TransferForm open={formOpen} doc={editId ? editing.data : null} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
