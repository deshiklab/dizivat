"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { AlertTriangle, ArrowRightLeft, CircleSlash, Download, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money, Num } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtNum } from "@/lib/format"
import type { StockRow } from "@/lib/types"
import { LedgerSheet } from "@/features/items/ledger-sheet"

const FACETS = ["stock"] as const
const FG = ["Finished Goods"]
const status = (r: StockRow) => (r.remain <= 0 ? "out" : r.remain < r.reorderLevel ? "low" : "ok")

/** Finished goods by branch (S4-05): what is where, its value at cost and sale price, and what needs re-ordering. */
export function FinishedGoods() {
  const t = useTranslations("fg")
  const ti = useTranslations("items")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [ledgerId, setLedgerId] = useQueryState("ledger", parseAsString)
  const [ledgerBranch, setLedgerBranch] = useQueryState("lb", parseAsString)
  const p = { ...params, group: FG }
  const q = useQuery({ queryKey: ["stock", "fg", p], queryFn: () => api.stock.list(p), placeholderData: keepPreviousData })
  const branches = React.useMemo(() => q.data?.branches ?? [], [q.data?.branches])
  const openLedger = React.useCallback((id: string, b?: string) => { setLedgerId(id); setLedgerBranch(b ?? null) }, [setLedgerId, setLedgerBranch])

  const columns = React.useMemo<ColumnDef<StockRow, unknown>[]>(() => [
    { id: "sku", accessorKey: "sku", meta: { label: ti("col.sku") }, header: ti("col.sku"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.sku}</span> },
    { id: "name", accessorKey: "name", meta: { label: ti("col.name"), hideable: false }, header: ti("col.name"),
      cell: ({ row }) => <button type="button" className="text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); openLedger(row.original.id) }}>{row.original.name}</button> },
    { id: "unit", accessorKey: "unit", meta: { label: ti("col.unit") }, header: ti("col.unit") },
    ...branches.map((b) => ({
      id: `b:${b.id}`, meta: { label: b.name, align: "right" as const, sortable: false }, header: b.name,
      cell: ({ row }: { row: { original: StockRow } }) => {
        const v = row.original.byBranch[b.id] ?? 0
        return v ? (
          <button type="button" className="tabular hover:underline" aria-label={t("ledgerAt", { item: row.original.name, branch: b.name })}
            onClick={(e) => { e.stopPropagation(); openLedger(row.original.id, b.id) }}><Num value={v} /></button>
        ) : <span className="text-muted-foreground">—</span>
      },
    } as ColumnDef<StockRow, unknown>)),
    { id: "remain", accessorKey: "remain", meta: { label: t("col.total"), align: "right" }, header: t("col.total"),
      cell: ({ row }) => {
        const s = status(row.original)
        return <span className="inline-flex items-center justify-end gap-2">{s !== "ok" && <Pill tone={s === "out" ? "danger" : "warning"} icon={s === "out" ? CircleSlash : AlertTriangle}>{ti(`stock.${s}`)}</Pill>}<Num value={row.original.remain} className="font-medium" /></span>
      } },
    { id: "reorderLevel", accessorKey: "reorderLevel", meta: { label: t("col.reorder"), align: "right" }, header: t("col.reorder"), cell: ({ row }) => <Num value={row.original.reorderLevel} /> },
    { id: "costPrice", accessorKey: "costPrice", meta: { label: ti("col.cp"), align: "right" }, header: ti("col.cp"), cell: ({ row }) => <Money value={row.original.costPrice} /> },
    { id: "value", accessorKey: "value", meta: { label: t("col.value"), align: "right", total: "value" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.value} /> },
    { id: "saleValue", accessorKey: "saleValue", meta: { label: t("col.saleValue"), align: "right", total: "saleValue" }, header: t("col.saleValue"), cell: ({ row }) => <Money value={row.original.saleValue} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={ti("ledgerFor", { name: row.original.name })} title={ti("ledger")} onClick={() => openLedger(row.original.id)}><History /></Button>
          {can("doc.create") && <Button variant="ghost" size="icon-sm" aria-label={t("transferItem", { name: row.original.name })} title={t("transfer")} render={<Link href="/inventory/transfers?new=1" />}><ArrowRightLeft /></Button>}
        </span>
      ),
    },
  ], [branches, t, ti, tc, can, openLedger])

  const opts = { stock: ["ok", "low", "out"].map((v) => ({ value: v, label: ti(`stock.${v}`) })) }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...state.stock.map((v) => ({ key: `stock-${v}`, label: `${ti("facet.stock")}: ${ti(`stock.${v}`)}`, onRemove: () => set({ stock: state.stock.filter((x) => x !== v) }) })),
  ]
  const totalValue = q.data?.totals.value ?? 0

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(totalValue, locale), sale: fmtCompact(q.data.totals.saleValue ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button variant="outline" render={<Link href="/inventory/transfers?new=1" />}><ArrowRightLeft /> {t("newTransfer")}</Button> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("byBranch")} role="region">
        {!q.data ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20" />) : branches.map((b) => {
          const v = q.data.branchValue[b.id] ?? 0
          return (
            <Card key={b.id} size="sm">
              <CardContent className="grid gap-1">
                <p className="truncate text-xs text-muted-foreground" title={b.name}>{b.name}</p>
                <p className="text-lg font-semibold tabular">{fmtCompact(v, locale)}</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary" style={{ width: `${totalValue ? Math.round((v / totalValue) * 100) : 0}%` }} /></div>
                <p className="text-xs text-muted-foreground">{t("shareOfValue", { pct: fmtNum(totalValue ? (v / totalValue) * 100 : 0, locale, 0) })}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>
      <DataTable<StockRow>
        tableId="finished-goods" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => openLedger(r.id)} filtered={activeCount > 0}
        defaultHidden={["costPrice", "saleValue"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={ti("searchPlaceholder")} />
            <FacetFilter title={ti("facet.stock")} options={opts.stock} selected={state.stock} onChange={(v) => set({ stock: v })} counts={q.data?.facets.stock} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.stock.csvUrl(p)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(r) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.name}</span><Num value={r.remain} className="font-medium" /></div>
            <p className="text-sm text-muted-foreground">{r.sku} · {branches.map((b) => `${b.name.split(" — ")[0]}: ${fmtNum(r.byBranch[b.id] ?? 0, locale)}`).join(" · ")} {r.unit}</p>
          </div>
        )}
      />
      <LedgerSheet id={ledgerId} branch={ledgerBranch} onOpenChange={(o) => { if (!o) { setLedgerId(null); setLedgerBranch(null) } }} />
    </>
  )
}
