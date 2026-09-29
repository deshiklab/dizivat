"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Download, History, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { SavedViews } from "@/components/data-table/saved-views"
import { PageHeader } from "@/components/common/page-header"
import { Money, Num } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtNum } from "@/lib/format"
import type { ItemWithStock } from "@/lib/types"
import dynamic from "next/dynamic"
import { useOnceOpen } from "@/hooks/use-once-open"
import { useCan } from "@/components/auth/me-provider"
import { AlertTriangle, CircleSlash } from "lucide-react"

// The sheets (form + HS lookup, ledger + history) open on demand — keep them off the list's critical path (S4-03).
const ItemSheet = dynamic(() => import("./item-sheet").then((m) => m.ItemSheet), { ssr: false })
const LedgerSheet = dynamic(() => import("./ledger-sheet").then((m) => m.LedgerSheet), { ssr: false })

const FACETS = ["group", "unit", "stock"] as const

function StockCell({ i }: { i: ItemWithStock }) {
  const t = useTranslations("items")
  const status = i.remain <= 0 ? "out" : i.remain < i.reorderLevel ? "low" : "ok"
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {status !== "ok" && <Pill tone={status === "out" ? "danger" : "warning"} icon={status === "out" ? CircleSlash : AlertTriangle}>{t(`stock.${status}`)}</Pill>}
      <Num value={i.remain} className="font-medium" />
    </span>
  )
}

export function ItemsList() {
  const t = useTranslations("items")
  const tc = useTranslations("common")
  const tg = useTranslations("group")
  const tt = useTranslations("table")
  const locale = useLocale()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const [ledgerId, setLedgerId] = useQueryState("ledger", parseAsString)
  const can = useCan()
  const canEdit = can("master.edit")
  const q = useQuery({ queryKey: ["items", params], queryFn: () => api.items.list(params), placeholderData: keepPreviousData })
  // ?edit=id may point outside the current page (global search) → fetch the record itself
  const onPage = editId ? q.data?.data.find((i) => i.id === editId) : undefined
  const single = useQuery({ queryKey: ["item", editId], queryFn: () => api.items.get(editId!), enabled: !!editId && !!q.data && !onPage })
  const editing = editId && canEdit ? onPage ?? single.data ?? null : null
  const itemOpen = (!!isNew && canEdit) || !!editing
  const itemMounted = useOnceOpen(itemOpen)
  const ledgerMounted = useOnceOpen(!!ledgerId)
  const gl = (g: string) => tg(g.replace(/ /g, ""))

  const columns = React.useMemo<ColumnDef<ItemWithStock, unknown>[]>(() => [
    { id: "sku", accessorKey: "sku", meta: { label: t("col.sku") }, header: t("col.sku"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.sku}</span> },
    { id: "name", accessorKey: "name", meta: { label: t("col.name"), hideable: false }, header: t("col.name"), cell: ({ row }) => <button type="button" className="text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setLedgerId(row.original.id) }}>{row.original.name}</button> },
    { id: "hsCode", accessorKey: "hsCode", meta: { label: t("col.hsCode") }, header: t("col.hsCode"), cell: ({ row }) => <span className="tabular">{row.original.hsCode.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3")}</span> },
    { id: "group", accessorKey: "group", meta: { label: t("col.group") }, header: t("col.group"), cell: ({ row }) => gl(row.original.group) },
    { id: "unit", accessorKey: "unit", meta: { label: t("col.unit") }, header: t("col.unit") },
    { id: "purchasePrice", accessorKey: "purchasePrice", meta: { label: t("col.pp"), align: "right" }, header: t("col.pp"), cell: ({ row }) => <Money value={row.original.purchasePrice} /> },
    { id: "costPrice", accessorKey: "costPrice", meta: { label: t("col.cp"), align: "right" }, header: t("col.cp"), cell: ({ row }) => <Money value={row.original.costPrice} /> },
    { id: "salePrice", accessorKey: "salePrice", meta: { label: t("col.sp"), align: "right" }, header: t("col.sp"), cell: ({ row }) => <Money value={row.original.salePrice} /> },
    { id: "vatRate", accessorKey: "vatRate", meta: { label: t("col.vat"), align: "right" }, header: t("col.vat"), cell: ({ row }) => `${fmtNum(row.original.vatRate, locale)}%` },
    { id: "opening", accessorKey: "opening", meta: { label: t("col.opening"), align: "right" }, header: t("col.opening"), cell: ({ row }) => <Num value={row.original.opening} /> },
    { id: "purchased", accessorKey: "purchased", meta: { label: t("col.purchase"), align: "right" }, header: t("col.purchase"), cell: ({ row }) => <Num value={row.original.purchased} /> },
    { id: "prodReceive", accessorKey: "prodReceive", meta: { label: t("col.prodReceive"), align: "right" }, header: t("col.prodReceive"), cell: ({ row }) => <Num value={row.original.prodReceive} /> },
    { id: "prodIssue", accessorKey: "prodIssue", meta: { label: t("col.prodIssue"), align: "right" }, header: t("col.prodIssue"), cell: ({ row }) => <Num value={row.original.prodIssue} /> },
    { id: "sold", accessorKey: "sold", meta: { label: t("col.sales"), align: "right" }, header: t("col.sales"), cell: ({ row }) => <Num value={row.original.sold} /> },
    { id: "damage", accessorKey: "damage", meta: { label: t("col.damage"), align: "right" }, header: t("col.damage"), cell: ({ row }) => <Num value={row.original.damage} /> },
    { id: "remain", accessorKey: "remain", meta: { label: t("col.remain"), align: "right" }, header: t("col.remain"), cell: ({ row }) => <StockCell i={row.original} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("ledgerFor", { name: row.original.name })} title={t("ledger")} onClick={() => setLedgerId(row.original.id)}><History /></Button>
          {canEdit && <Button variant="ghost" size="icon-sm" aria-label={t("editItem", { name: row.original.name })} onClick={() => setEditId(row.original.id)}><Pencil /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, tc, tg, canEdit])

  const facetOpts = {
    group: ["Raw Material", "Consumable", "Packing Materials", "Finished Goods"].map((v) => ({ value: v, label: gl(v) })),
    unit: Object.keys(q.data?.facets.unit ?? {}).sort().map((v) => ({ value: v, label: v })),
    stock: ["ok", "low", "out"].map((v) => ({ value: v, label: t(`stock.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.stockValue ?? 0, locale), low: fmtNum((q.data.facets.stock?.low ?? 0) + (q.data.facets.stock?.out ?? 0), locale) }) : t("subtitle")}
        actions={canEdit ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<ItemWithStock>
        tableId="items" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setLedgerId(r.id)} filtered={activeCount > 0}
        defaultHidden={["costPrice", "prodReceive", "prodIssue", "damage"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <FacetFilter title={t("facet.group")} options={facetOpts.group} selected={state.group} onChange={(v) => set({ group: v })} counts={q.data?.facets.group} />
            <FacetFilter title={t("facet.unit")} options={facetOpts.unit} selected={state.unit} onChange={(v) => set({ unit: v })} counts={q.data?.facets.unit} />
            <FacetFilter title={t("facet.stock")} options={facetOpts.stock} selected={state.stock} onChange={(v) => set({ stock: v })} counts={q.data?.facets.stock} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={
          <>
            <SavedViews tableId="items" builtIn={[{ name: t("views.reorder"), query: "stock=low,out&sort=remain.asc" }, { name: t("views.raw"), query: "group=Raw Material" }, { name: t("views.fg"), query: "group=Finished Goods" }]} />
            <Button variant="outline" size="sm" render={<a href={api.items.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>
          </>
        }
        mobileCard={(i) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.name}</span><StockCell i={i} /></div>
            <p className="text-sm text-muted-foreground">{i.sku} · HS {i.hsCode} · {gl(i.group)} · {i.unit}</p>
          </div>
        )}
      />
      {ledgerMounted && <LedgerSheet id={ledgerId} onOpenChange={(o) => { if (!o) setLedgerId(null) }} onEdit={(id) => { setLedgerId(null); setEditId(id) }} />}
      {itemMounted && <ItemSheet open={itemOpen} item={editing} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} />}
    </>
  )
}
