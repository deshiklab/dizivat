"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarClock, Download, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { CHEQUE_KIND_TONE } from "@/lib/money-ops"
import type { ChequeRow } from "@/lib/types"
import { useOnceOpen } from "@/hooks/use-once-open"

const ChequeSheet = dynamic(() => import("./cheque-sheet").then((m) => m.ChequeSheet), { ssr: false })

const FACETS = ["kind", "status", "account"] as const
type Facet = (typeof FACETS)[number]

/**
 * R9.1 — the cheque register: every cheque the company has received or issued (an approved money document by
 * cheque), folded with its lifecycle events. Post-dated instruments get their own view (?postDated=true).
 */
export function ChequeList() {
  const t = useTranslations("cheques")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [viewId, setViewId] = React.useState<string | null>(null)
  const [postDated, setPostDated] = React.useState(false)
  const listParams = React.useMemo(() => ({ ...params, ...(postDated ? { postDated: "true" } : {}) }), [params, postDated])
  const q = useQuery({ queryKey: ["cheques", listParams], queryFn: () => api.accounting.cheques.list(listParams), placeholderData: keepPreviousData })
  const sheetMounted = useOnceOpen(!!viewId)

  const columns = React.useMemo<ColumnDef<ChequeRow, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.chequeNo"), hideable: false }, header: t("col.chequeNo"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "kind", accessorKey: "kind", meta: { label: t("col.kind") }, header: t("col.kind"), cell: ({ row }) => <Pill tone={CHEQUE_KIND_TONE[row.original.kind]}>{t(`kind.${row.original.kind}`)}</Pill> },
    { id: "partyName", accessorKey: "partyName", meta: { label: t("col.party") }, header: t("col.party"),
      cell: ({ row }) => <span className="block max-w-48 truncate" title={row.original.partyName}>{row.original.partyName}</span> },
    { id: "bank", accessorKey: "chequeBank", meta: { label: t("col.bank") }, header: t("col.bank"), cell: ({ row }) => <span className="text-muted-foreground">{row.original.chequeBank || "—"}</span> },
    { id: "accountName", accessorKey: "accountName", meta: { label: t("col.account") }, header: t("col.account"), cell: ({ row }) => <span className="block max-w-40 truncate text-muted-foreground" title={row.original.accountName}>{row.original.accountName}</span> },
    { id: "chequeDate", accessorKey: "chequeDate", meta: { label: t("col.chequeDate") }, header: t("col.chequeDate"),
      cell: ({ row }) => <span className="whitespace-nowrap tabular">{fmtDate(row.original.chequeDate, locale)}{row.original.postDated && <CalendarClock className="ml-1.5 inline size-3.5 text-info" aria-label={t("postDated")} />}</span> },
    { id: "doc", accessorKey: "moneyNo", meta: { label: t("col.doc") }, header: t("col.doc"), cell: ({ row }) => <span className="text-muted-foreground tabular">{row.original.moneyNo}</span> },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "status", accessorKey: "status", meta: { label: t("col.status") }, header: t("col.status"),
      cell: ({ row }) => <Pill tone={row.original.status === "bounced" ? "danger" : row.original.status === "cleared" ? "success" : row.original.status === "presented" ? "warning" : "info"}>{t(`status.${row.original.status}`)}</Pill> },
    { id: "ageDays", accessorKey: "ageDays", meta: { label: t("col.age") }, header: t("col.age"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.ageDays > 0 ? fmtNum(row.original.ageDays, locale) : "—"}</span> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    kind: (["issued", "received"] as const).map((v) => ({ value: v, label: t(`kind.${v}`) })),
    status: (["outstanding", "presented", "cleared", "bounced"] as const).map((v) => ({ value: v, label: t(`status.${v}`) })),
    account: [], // the register has no facet labels — the account facet shows raw ids filtered to those present
  }
  const accountFacet = Object.entries(q.data?.facets.account ?? {}).map(([value, count]) => ({ value, label: q.data?.data.find((r) => r.accountId === value)?.accountName ?? value, count: count as number }))
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...(postDated ? [{ key: "pd", label: t("postDated"), onRemove: () => setPostDated(false) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${f === "account" ? (accountFacet.find((o) => o.value === v)?.label ?? v) : facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const outstanding = (q.data?.facets.status?.outstanding ?? 0) + (q.data?.facets.status?.presented ?? 0)
  const bounced = q.data?.facets.status?.bounced ?? 0

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale), open: fmtNum(outstanding, locale), bounced: fmtNum(bounced, locale) }) : t("subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant={postDated ? "default" : "outline"} onClick={() => setPostDated(!postDated)} aria-pressed={postDated}><CalendarClock /> {t("postDatedOnly")}</Button>
          </div>
        }
      />
      <DataTable<ChequeRow>
        tableId="cheques" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0 || postDated}
        defaultHidden={["bank", "doc"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => (
              <FacetFilter key={f} title={t(`facet.${f}`)} options={f === "account" ? accountFacet.map(({ value, label }) => ({ value, label })) : facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={f === "account" ? Object.fromEntries(accountFacet.map((a) => [a.value, a.count])) : q.data?.facets[f]} />
            ))}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={() => { clearAll(); setPostDated(false) }} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.accounting.cheques.csvUrl(listParams)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><Pill tone={d.status === "bounced" ? "danger" : d.status === "cleared" ? "success" : d.status === "presented" ? "warning" : "info"}>{t(`status.${d.status}`)}</Pill></div>
            <p className="truncate text-sm">{d.partyName}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.chequeDate, locale)} · {t(`kind.${d.kind}`)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {sheetMounted && <ChequeSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} />}
    </>
  )
}
