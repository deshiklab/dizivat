"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { CheckCheck, Download, Eye, Link2, MoreHorizontal, Pencil, Plus, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useCan } from "@/components/auth/me-provider"
import { useDocActions } from "@/features/docs/use-doc-actions"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { SavedViews } from "@/components/data-table/saved-views"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, ProcessBadge } from "@/components/common/status-badge"
import { Money } from "@/components/common/money"
import { Link, useRouter } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import type { Purchase } from "@/lib/types"
import { appUrl } from "@/lib/base-path"

const FACETS = ["vendor", "process", "mode", "payment"] as const

export function PurchaseList() {
  const t = useTranslations("purchases")
  const ts = useTranslations("sales")
  const tc = useTranslations("common")
  const tp = useTranslations("process")
  const tm = useTranslations("mode")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const can = useCan()
  const actions = useDocActions("purchase")
  const { state, set, params, clearAll, activeCount } = useListState(FACETS)
  const q = useQuery({ queryKey: ["purchases", params], queryFn: () => api.purchases.list(params), placeholderData: keepPreviousData })
  const approve = useMutation({
    mutationFn: (ids: string[]) => api.purchases.bulkApprove(ids),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success(ts("approvedN", { count: r.done.length }), { description: r.skipped.length ? ts("skippedN", { count: r.skipped.length }) : undefined }) },
    onError: (e) => toast.error(e.message),
  })

  const columns = React.useMemo<ColumnDef<Purchase, unknown>[]>(() => [
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.issueDate") }, header: t("col.issueDate"), cell: ({ row }) => fmtDate(row.original.issueDate, locale) },
    { id: "invoiceNo", accessorKey: "invoiceNo", meta: { label: t("col.purchaseNo"), hideable: false }, header: t("col.purchaseNo"), cell: ({ row }) => <Link href={`/purchases/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.invoiceNo}</Link> },
    { id: "challanNo", accessorKey: "challanNo", meta: { label: t("col.challan") }, header: t("col.challan"), cell: ({ row }) => <span className="tabular">{row.original.challanNo}</span> },
    { id: "vendorName", accessorKey: "vendorName", meta: { label: t("col.vendor") }, header: t("col.vendor"), cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.vendorName}>{row.original.vendorName}</span> },
    { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => <ModeBadge value={row.original.mode} /> },
    { id: "subtotal", accessorKey: "subtotal", meta: { label: t("col.subtotal"), align: "right", total: "subtotal" }, header: t("col.subtotal"), cell: ({ row }) => <Money value={row.original.subtotal} /> },
    { id: "vat", accessorKey: "vat", meta: { label: t("col.vat"), align: "right", total: "vat" }, header: t("col.vat"), cell: ({ row }) => <Money value={row.original.vat} /> },
    { id: "tti", accessorKey: "tti", meta: { label: t("col.tti"), align: "right", total: "tti" }, header: t("col.tti"), cell: ({ row }) => <Money value={row.original.tti} /> },
    { id: "rebate", accessorKey: "rebate", meta: { label: t("col.rebate"), align: "right", total: "rebate" }, header: t("col.rebate"), cell: ({ row }) => <Money value={row.original.rebate} className="text-success" /> },
    { id: "netTotal", accessorKey: "netTotal", meta: { label: t("col.total"), align: "right", total: "netTotal" }, header: t("col.total"), cell: ({ row }) => <Money value={row.original.netTotal} className="font-medium" /> },
    { id: "paid", accessorKey: "paid", meta: { label: t("col.paid"), align: "right", total: "paid" }, header: t("col.paid"), cell: ({ row }) => <Money value={row.original.paid} /> },
    { id: "due", accessorKey: "due", meta: { label: t("col.due"), align: "right", total: "due" }, header: t("col.due"), cell: ({ row }) => <Money value={row.original.due} className={row.original.due > 0 ? "font-medium text-warning" : ""} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.process") }, header: t("col.process"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => {
        const p = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tc("actionsFor", { name: p.invoiceNo })} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => router.push(`/purchases/${p.id}`)}><Eye /> {tc("view")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard?.writeText(window.location.origin + appUrl(`/${locale}/purchases/${p.id}`)); toast.success(tt("linkCopied")) }}><Link2 /> {tt("copyLink")}</DropdownMenuItem>
              {p.process === "Created" && can("doc.edit") && <DropdownMenuItem onClick={() => router.push(`/purchases/${p.id}/edit`)}><Pencil /> {tc("edit")}</DropdownMenuItem>}
              {p.process === "Created" && can("doc.approve") && <DropdownMenuItem onClick={() => actions.approve(p)}><CheckCheck /> {ts("approve")}</DropdownMenuItem>}
              {p.process === "Created" && can("doc.delete") && (<><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => actions.askDelete(p)}><Trash2 /> {tc("deleteDraft")}</DropdownMenuItem></>)}
              {p.process !== "Cancelled" && can("doc.cancel") && (<><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => actions.askCancel(p)}><XCircle /> {t("cancelPurchase")}</DropdownMenuItem></>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, tc, tt, ts, can])

  const facetOpts = {
    vendor: Object.entries(q.data?.facetLabels?.vendor ?? {}).map(([value, label]) => ({ value, label })),
    process: ["Created", "Approved", "Cancelled"].map((v) => ({ value: v, label: tp(v) })),
    mode: ["Local", "Foreign", "Non-registered"].map((v) => ({ value: v, label: tm(v === "Non-registered" ? "NonRegistered" : v) })),
    payment: ["paid", "partial", "unpaid"].map((v) => ({ value: v, label: ts(`payment.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from ? [{ key: "date", label: `${fmtDate(state.from, locale, "dd MMM yy")} – ${fmtDate(state.to, locale, "dd MMM yy")}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const totals = q.data?.totals
  return (
    <>
      {actions.dialog}
      <PageHeader
        title={t("title")}
        description={totals ? t("summary", { count: fmtNum(q.data!.total, locale), total: fmtCompact(totals.netTotal, locale), rebate: fmtCompact(totals.rebate, locale), due: fmtCompact(totals.due, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button render={<Link href="/purchases/new" />}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<Purchase>
        tableId="purchases" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => router.push(`/purchases/${r.id}`)} selectable defaultHidden={["tti", "paid"]} filtered={activeCount > 0}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            <FacetFilter title={t("facet.vendor")} options={facetOpts.vendor} selected={state.vendor} onChange={(v) => set({ vendor: v })} counts={q.data?.facets.vendor} />
            <FacetFilter title={t("facet.mode")} options={facetOpts.mode} selected={state.mode} onChange={(v) => set({ mode: v })} counts={q.data?.facets.mode} />
            <FacetFilter title={t("facet.process")} options={facetOpts.process} selected={state.process} onChange={(v) => set({ process: v })} counts={q.data?.facets.process} />
            <FacetFilter title={t("facet.payment")} options={facetOpts.payment} selected={state.payment} onChange={(v) => set({ payment: v })} counts={q.data?.facets.payment} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={
          <>
            <SavedViews tableId="purchases" builtIn={[
              { name: t("views.imports"), query: "mode=Foreign" },
              { name: t("views.thisPeriod"), query: "from=2026-09-01&to=2026-09-30" },
              { name: t("views.payable"), query: "payment=unpaid,partial&sort=due.desc" },
            ]} />
            <Button variant="outline" size="sm" render={<a href={api.purchases.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>
          </>
        }
        bulkActions={(ids, _rows, clear) => (
          <>
            {can("doc.approve") && <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(ids, { onSuccess: clear })}><CheckCheck /> {ts("approve")}</Button>}
            <Button size="sm" variant="outline" render={<a href={api.purchases.csvUrl({ ...params, ids: ids.join(",") })} download />}><Download /> {tt("exportSelected")}</Button>
          </>
        )}
        mobileCard={(p) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><Link href={`/purchases/${p.id}`} className="font-medium text-primary">{p.invoiceNo}</Link><ProcessBadge value={p.process} /></div>
            <p className="truncate text-sm">{p.vendorName}</p>
            <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{fmtDate(p.issueDate, locale)} · {p.challanNo}</span><Money value={p.netTotal} className="font-semibold text-foreground" /></div>
          </div>
        )}
      />
    </>
  )
}
