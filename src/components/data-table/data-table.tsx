"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState, type VisibilityState, type ColumnOrderState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, TriangleAlert, X } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIsMobile } from "@/hooks/use-mobile"
import { EmptyState } from "@/components/common/empty-state"
import { fmtMoney, fmtNum } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ColumnsMenu } from "./columns-menu"

export interface ColMeta { label: string; align?: "right" | "center"; total?: string; /** footer total format — counts must not render as money (218.00) */ totalFormat?: "money" | "count"; hideable?: boolean; className?: string; sortable?: boolean }
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData, TValue> extends ColMeta {}
}

export interface DataTableProps<T> {
  tableId: string
  caption: string
  columns: ColumnDef<T, unknown>[]
  data: T[] | undefined
  total: number
  totals?: Record<string, number>
  loading: boolean
  fetching?: boolean
  error?: Error | null
  onRetry?: () => void
  page: number
  size: number
  sort: string | null
  onPage: (p: number) => void
  onSize: (s: number) => void
  onSort: (s: string | null) => void
  getRowId: (r: T) => string
  onRowClick?: (r: T) => void
  selectable?: boolean
  bulkActions?: (ids: string[], rows: T[], clear: () => void) => React.ReactNode
  filters?: React.ReactNode
  chips?: React.ReactNode
  toolbarEnd?: React.ReactNode
  mobileCard?: (r: T) => React.ReactNode
  emptyAction?: React.ReactNode
  filtered?: boolean
  defaultHidden?: string[]
}

function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = React.useState<T>(initial)
  React.useEffect(() => { try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)) } catch {} }, [key])
  const set = React.useCallback((next: T | ((p: T) => T)) => {
    setV((prev) => { const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next; localStorage.setItem(key, JSON.stringify(val)); return val })
  }, [key])
  return [v, set] as const
}

export function DataTable<T>(p: DataTableProps<T>) {
  const t = useTranslations("table")
  const locale = useLocale()
  const isMobile = useIsMobile()
  const hiddenDefault = React.useMemo<VisibilityState>(() => Object.fromEntries((p.defaultHidden ?? []).map((k) => [k, false])), [p.defaultHidden])
  const [visibility, setVisibility] = usePersisted<VisibilityState>(`rbs-cols-${p.tableId}`, hiddenDefault)
  const [order, setOrder] = usePersisted<ColumnOrderState>(`rbs-order-${p.tableId}`, [])
  const [selection, setSelection] = React.useState<RowSelectionState>({})
  const selectedRows = React.useRef(new Map<string, T>())

  const columns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!p.selectable) return p.columns
    return [
      {
        id: "_select",
        enableHiding: false,
        meta: { label: t("select"), hideable: false },
        header: ({ table }) => (
          <Checkbox
            aria-label={t("selectPage")}
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox aria-label={t("selectRow")} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />
        ),
      },
      ...p.columns,
    ]
  }, [p.columns, p.selectable, t])

  const sortState = p.sort ? [{ id: p.sort.split(".")[0], desc: p.sort.endsWith(".desc") }] : []
  const table = useReactTable({
    data: p.data ?? [],
    columns,
    getRowId: p.getRowId,
    state: { rowSelection: selection, columnVisibility: visibility, columnOrder: order, sorting: sortState },
    onRowSelectionChange: (u) => setSelection((prev) => (typeof u === "function" ? u(prev) : u)),
    onColumnVisibilityChange: (u) => setVisibility((prev) => (typeof u === "function" ? u(prev) : u)),
    onColumnOrderChange: (u) => setOrder((prev) => (typeof u === "function" ? u(prev) : u)),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: p.total,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
  })

  // keep selected row objects across pages (selection survives paging)
  React.useEffect(() => {
    for (const r of p.data ?? []) { const id = p.getRowId(r); if (selection[id]) selectedRows.current.set(id, r) }
    for (const id of [...selectedRows.current.keys()]) if (!selection[id]) selectedRows.current.delete(id)
  }, [selection, p.data, p.getRowId]) // eslint-disable-line react-hooks/exhaustive-deps
  const selectedIds = Object.keys(selection).filter((k) => selection[k])
  const selectedList = selectedIds
    .map((id) => (p.data ?? []).find((r) => p.getRowId(r) === id) ?? selectedRows.current.get(id))
    .filter((r): r is T => r !== undefined)
  const clearSel = () => setSelection({})

  const pages = Math.max(1, Math.ceil(p.total / p.size))
  const from = p.total ? (p.page - 1) * p.size + 1 : 0
  const to = Math.min(p.total, p.page * p.size)
  const cycleSort = (id: string) => {
    const cur = p.sort?.split(".")
    if (!cur || cur[0] !== id) p.onSort(`${id}.desc`)
    else if (cur[1] === "desc") p.onSort(`${id}.asc`)
    else p.onSort(null)
  }
  const visibleCols = table.getVisibleLeafColumns()
  const hasTotals = !!p.totals && visibleCols.some((c) => c.columnDef.meta?.total)
  const rows = table.getRowModel().rows
  const interactive = (e: React.MouseEvent) => (e.target as HTMLElement).closest("a,button,input,[role=checkbox],[role=menuitem]")

  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-xs" aria-label={p.caption}>
      {(p.filters || p.toolbarEnd) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-2 md:p-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{p.filters}</div>
          <div className="flex items-center gap-2">
            {!isMobile && <ColumnsMenu table={table} onReset={() => { setVisibility(hiddenDefault); setOrder([]) }} />}
            {p.toolbarEnd}
          </div>
        </div>
      )}
      {p.chips}

      {selectedIds.length > 0 && p.bulkActions && (
        <div role="region" aria-label={t("bulkActions")} className="flex flex-wrap items-center gap-2 border-b bg-accent px-3 py-2 text-sm text-accent-foreground">
          <span className="font-medium" aria-live="polite">{t("selected", { count: fmtNum(selectedIds.length, locale) })}</span>
          <div className="flex flex-wrap items-center gap-2">{p.bulkActions(selectedIds, selectedList, clearSel)}</div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSel}><X /> {t("clearSelection")}</Button>
        </div>
      )}

      <div className="relative" aria-busy={p.loading || p.fetching}>
        {p.fetching && !p.loading && <div className="absolute inset-x-0 top-0 z-20 h-0.5 animate-pulse bg-primary" role="progressbar" aria-label={t("loading")} />}

        {p.error ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <TriangleAlert className="size-8 text-destructive" aria-hidden />
            <p className="font-medium">{t("error")}</p>
            <p className="text-sm text-muted-foreground">{p.error.message}</p>
            {p.onRetry && <Button variant="outline" size="sm" onClick={p.onRetry}><RefreshCw /> {t("retry")}</Button>}
          </div>
        ) : isMobile && p.mobileCard ? (
          <ul className="divide-y">
            {p.loading
              ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-4"><Skeleton className="h-14 w-full" /></li>)
              : rows.map((r) => (
                  <li key={r.id} className={cn("p-3", p.onRowClick && "active:bg-muted")} onClick={(e) => !interactive(e) && p.onRowClick?.(r.original)}>
                    {p.mobileCard!(r.original)}
                  </li>
                ))}
          </ul>
        ) : (
          <div className="max-h-[calc(100vh-15rem)] min-h-40 overflow-auto">
            <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{p.caption}</caption>
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const meta = h.column.columnDef.meta
                      const sortable = meta?.sortable !== false && h.column.id !== "_select" && h.column.id !== "_actions"
                      const dir = sortState[0]?.id === h.column.id ? (sortState[0].desc ? "descending" : "ascending") : undefined
                      return (
                        <th
                          key={h.id}
                          scope="col"
                          aria-sort={dir ?? (sortable ? "none" : undefined)}
                          className={cn("h-10 border-b px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-muted-foreground", meta?.align === "right" && "text-right", h.column.id === "_select" && "w-10 px-3", meta?.className)}
                        >
                          {h.isPlaceholder ? null : sortable ? (
                            <button type="button" onClick={() => cycleSort(h.column.id)} className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-background hover:text-foreground", meta?.align === "right" && "flex-row-reverse", dir && "text-foreground")}>
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {dir === "ascending" ? <ArrowUp className="size-3.5" aria-hidden /> : dir === "descending" ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />}
                            </button>
                          ) : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {p.loading
                  ? Array.from({ length: Math.min(p.size, 10) }).map((_, i) => (
                      <tr key={i} className="data-row">
                        {visibleCols.map((c) => <td key={c.id} className="border-b px-3"><Skeleton className="h-4 w-full max-w-32" /></td>)}
                      </tr>
                    ))
                  : rows.map((r) => (
                      <tr
                        key={r.id}
                        data-state={r.getIsSelected() ? "selected" : undefined}
                        className={cn("data-row group transition-colors hover:bg-muted/60 data-[state=selected]:bg-accent/70", p.onRowClick && "cursor-pointer")}
                        onClick={(e) => !interactive(e) && p.onRowClick?.(r.original)}
                      >
                        {r.getVisibleCells().map((c) => {
                          const meta = c.column.columnDef.meta
                          return (
                            <td key={c.id} className={cn("border-b px-3 align-middle whitespace-nowrap", meta?.align === "right" && "text-right tabular", meta?.className)}>
                              {flexRender(c.column.columnDef.cell, c.getContext())}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
              </tbody>
              {hasTotals && !p.loading && rows.length > 0 && (
                <tfoot className="sticky bottom-0 z-10 bg-muted/95 font-semibold backdrop-blur">
                  <tr>
                    {visibleCols.map((c, i) => {
                      const k = c.columnDef.meta?.total
                      return (
                        <td key={c.id} className={cn("h-10 border-t px-3 whitespace-nowrap", c.columnDef.meta?.align === "right" && "text-right tabular")}>
                          {k ? (c.columnDef.meta?.totalFormat === "count" ? fmtNum(p.totals![k], locale) : fmtMoney(p.totals![k], locale)) : i === (p.selectable ? 1 : 0) ? <span className="text-xs text-muted-foreground">{t("totalFiltered", { count: fmtNum(p.total, locale) })}</span> : null}
                        </td>
                      )
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {!p.loading && !p.error && rows.length === 0 && (
          <EmptyState title={p.filtered ? t("noMatches") : t("empty")} hint={p.filtered ? t("noMatchesHint") : undefined} action={p.emptyAction} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
        <p className="text-muted-foreground" aria-live="polite">
          {t("showing", { from: fmtNum(from, locale), to: fmtNum(to, locale), total: fmtNum(p.total, locale) })}
        </p>
        <div className="flex items-center gap-2">
          <label className="hidden items-center gap-2 text-muted-foreground sm:flex">
            {t("rowsPerPage")}
            <Select value={String(p.size)} onValueChange={(v) => p.onSize(Number(v))} items={["10", "25", "50", "100"].map((v) => ({ value: v, label: v }))}>
              <SelectTrigger size="sm" className="w-18" aria-label={t("rowsPerPage")}><SelectValue /></SelectTrigger>
              <SelectContent>{["10", "25", "50", "100"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <nav className="flex items-center gap-1" aria-label={t("pagination")}>
            <Button variant="outline" size="icon-sm" onClick={() => p.onPage(1)} disabled={p.page <= 1} aria-label={t("first")}><ChevronsLeft /></Button>
            <Button variant="outline" size="icon-sm" onClick={() => p.onPage(p.page - 1)} disabled={p.page <= 1} aria-label={t("previous")}><ChevronLeft /></Button>
            <span className="px-2 tabular whitespace-nowrap">{t("pageOf", { page: fmtNum(p.page, locale), pages: fmtNum(pages, locale) })}</span>
            <Button variant="outline" size="icon-sm" onClick={() => p.onPage(p.page + 1)} disabled={p.page >= pages} aria-label={t("next")}><ChevronRight /></Button>
            <Button variant="outline" size="icon-sm" onClick={() => p.onPage(pages)} disabled={p.page >= pages} aria-label={t("last")}><ChevronsRight /></Button>
          </nav>
        </div>
      </div>
    </section>
  )
}
