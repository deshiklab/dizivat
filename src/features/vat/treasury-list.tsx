"use client"

import * as React from "react"
import dynamic from "next/dynamic"
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
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { HEAD_TONE, periodLabel, TREASURY_HEADS, TREASURY_MODES } from "@/lib/r4"
import type { TreasuryDeposit } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"

const TreasurySheet = dynamic(() => import("./treasury-sheet").then((m) => m.TreasurySheet), { ssr: false })
const TreasuryForm = dynamic(() => import("./treasury-form").then((m) => m.TreasuryForm), { ssr: false })

const FACETS = ["process", "head", "period", "mode"] as const
type Facet = (typeof FACETS)[number]

/** Treasury deposits (TR-6 challans) by economic code — they fund notes 58–64 of the Mushak 9.1 return. ?new (&period=&head=&amount=), ?view, ?edit. */
export function TreasuryList() {
  const t = useTranslations("treasury")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [prePeriod, setPrePeriod] = useQueryState("period", parseAsString)
  const [preHead, setPreHead] = useQueryState("head", parseAsString)
  const [preAmount, setPreAmount] = useQueryState("amount", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["treasury", params], queryFn: () => api.vat.treasury.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["r4doc", "treasury", editId], queryFn: () => api.vat.treasury.get(editId!), enabled: !!editId })
  const actions = useR4Actions("treasury")
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const columns = React.useMemo<ColumnDef<TreasuryDeposit, unknown>[]>(() => [
    { id: "challanNo", accessorKey: "challanNo", meta: { label: t("col.challan"), hideable: false }, header: t("col.challan"),
      cell: ({ row }) => <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}><span className="block font-medium text-primary hover:underline tabular">{row.original.challanNo}</span><span className="text-xs text-muted-foreground tabular">{row.original.no}</span></button> },
    { id: "challanDate", accessorKey: "challanDate", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.challanDate, locale)}</span> },
    { id: "head", accessorKey: "head", meta: { label: t("col.head") }, header: t("col.head"), cell: ({ row }) => <Pill tone={HEAD_TONE[row.original.head]}>{t(`head.${row.original.head}`)}</Pill> },
    { id: "code", accessorKey: "code", meta: { label: t("col.code") }, header: t("col.code"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.code}</span> },
    { id: "taxPeriod", accessorKey: "taxPeriod", meta: { label: t("col.period") }, header: t("col.period"), cell: ({ row }) => <span className="tabular">{periodLabel(row.original.taxPeriod)}</span> },
    { id: "bank", accessorKey: "bank", meta: { label: t("col.bank") }, header: t("col.bank"), cell: ({ row }) => <span className="block max-w-56 truncate" title={`${row.original.bank}, ${row.original.bankBranch}`}>{row.original.bank}<span className="block text-xs text-muted-foreground">{row.original.bankBranch}</span></span> },
    { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => t(`mode.${row.original.mode}`) },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.challanNo })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("printDoc", { no: row.original.challanNo })} onClick={() => { setViewId(row.original.id); setTab("print") }}><Printer /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.challanNo })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const periods = Object.keys(q.data?.facets.period ?? {}).sort().reverse()
  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    head: TREASURY_HEADS.map((v) => ({ value: v, label: t(`head.${v}`) })),
    period: periods.map((v) => ({ value: v, label: periodLabel(v) })),
    mode: TREASURY_MODES.map((v) => ({ value: v, label: t(`mode.${v}`) })),
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
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale), pending: fmtNum(pending, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<TreasuryDeposit>
        tableId="treasury" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["mode", "code"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.vat.treasury.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.challanNo}</span><ProcessBadge value={d.process} /></div>
            <p className="text-sm">{t(`head.${d.head}`)} · {periodLabel(d.taxPeriod)}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.challanDate, locale)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <TreasurySheet id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }} onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} />}
      {formMounted && <TreasuryForm open={formOpen} doc={editId ? editing.data : null} preset={{ period: prePeriod, head: preHead, amount: preAmount }}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setPrePeriod(null); setPreHead(null); setPreAmount(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
