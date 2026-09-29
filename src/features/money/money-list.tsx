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
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { METHOD_TONE, MONEY_METHODS } from "@/lib/r4"
import type { MoneyDoc, MoneyKind } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"

const MoneySheet = dynamic(() => import("./money-sheet").then((m) => m.MoneySheet), { ssr: false })
const MoneyForm = dynamic(() => import("./money-form").then((m) => m.MoneyForm), { ssr: false })

const FACETS = ["process", "method", "party", "account"] as const
type Facet = (typeof FACETS)[number]

/** Customer receipts / supplier payments — list with ?new (&party=&invoice=), ?view=<id> (&tab=print) and ?edit=<id>. */
export function MoneyList({ kind }: { kind: MoneyKind }) {
  const t = useTranslations("money")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [party, setParty] = useQueryState("party", parseAsString)
  const [invoice, setInvoice] = useQueryState("invoice", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const res = kind === "receipt" ? api.accounting.receipts : api.accounting.payments
  const q = useQuery({ queryKey: [kind === "receipt" ? "receipts" : "payments", params], queryFn: () => res.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["r4doc", kind, editId], queryFn: () => res.get(editId!), enabled: !!editId })
  const actions = useR4Actions(kind)
  const labels = q.data?.facetLabels ?? {}
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)
  const k = (s: string) => `${kind}.${s}`

  const columns = React.useMemo<ColumnDef<MoneyDoc, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    { id: "partyName", accessorKey: "partyName", meta: { label: t(k("party")) }, header: t(k("party")),
      cell: ({ row }) => <span className="block max-w-60 truncate" title={row.original.partyName}>{row.original.partyName}</span> },
    { id: "method", accessorKey: "method", meta: { label: t("col.method") }, header: t("col.method"), cell: ({ row }) => <Pill tone={METHOD_TONE[row.original.method]}>{t(`method.${row.original.method}`)}</Pill> },
    { id: "accountName", accessorKey: "accountName", meta: { label: t("col.account") }, header: t("col.account"), cell: ({ row }) => <span className="block max-w-48 truncate text-muted-foreground" title={row.original.accountName}>{row.original.accountName}</span> },
    { id: "invoices", meta: { label: t("col.invoices"), sortable: false }, header: t("col.invoices"),
      cell: ({ row }) => {
        const a = row.original.allocations
        if (!a.length) return <Pill tone="info">{t("advance")}</Pill>
        return <span className="tabular">{a[0].docNo}{a.length > 1 && <span className="text-muted-foreground"> +{fmtNum(a.length - 1, locale)}</span>}</span>
      } },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "unallocated", accessorKey: "unallocated", meta: { label: t("col.onAccount"), align: "right", total: "unallocated" }, header: t("col.onAccount"), cell: ({ row }) => <Money value={row.original.unallocated} /> },
    { id: "charge", accessorKey: "charge", meta: { label: t("col.charge"), align: "right", total: "charge" }, header: t("col.charge"), cell: ({ row }) => <Money value={row.original.charge} /> },
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
  ], [locale, t, can, actions.busy, kind])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    method: MONEY_METHODS.map((v) => ({ value: v, label: t(`method.${v}`) })),
    party: Object.entries(labels.party ?? {}).filter(([v]) => q.data?.facets.party?.[v]).map(([value, label]) => ({ value, label })),
    account: Object.entries(labels.account ?? {}).filter(([v]) => q.data?.facets.account?.[v]).map(([value, label]) => ({ value, label })),
  }
  const facetTitle = (f: Facet) => (f === "party" ? t(k("party")) : t(`facet.${f}`))
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${facetTitle(f)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const pending = q.data?.facets.process?.Created ?? 0

  return (
    <>
      <PageHeader
        title={t(k("title"))}
        description={q.data ? t(k("summary"), { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale), advance: fmtCompact(q.data.totals.unallocated ?? 0, locale), pending: fmtNum(pending, locale) }) : t(k("subtitle"))}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link href={`/accounting/statements?kind=${kind === "receipt" ? "customer" : "vendor"}`} />}>{t("statements")}</Button>
            {can("doc.create") && <Button onClick={() => setNew(true)}><Plus /> {t(k("new"))}</Button>}
          </div>
        }
      />
      <DataTable<MoneyDoc>
        tableId={kind === "receipt" ? "receipts" : "payments"} caption={t(k("title"))} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={kind === "receipt" ? ["accountName"] : ["accountName", "charge"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={facetTitle(f)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={res.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="truncate text-sm">{d.partyName}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.date, locale)} · {t(`method.${d.method}`)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <MoneySheet kind={kind} id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }} onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} />}
      {formMounted && <MoneyForm kind={kind} open={formOpen} doc={editId ? editing.data : null} partyId={party} invoiceId={invoice}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setParty(null); setInvoice(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
