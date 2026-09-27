"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { CheckCheck, Download, Eye, Link2, MoreHorizontal, Pencil, Plus, Printer, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { SavedViews } from "@/components/data-table/saved-views"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, ProcessBadge } from "@/components/common/status-badge"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { useDocActions } from "@/features/docs/use-doc-actions"
import { Link, useRouter } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import type { Sale } from "@/lib/types"

const FACETS = ["customer", "process", "mode", "method", "payment"] as const

export function SalesList() {
  const t = useTranslations("sales")
  const tc = useTranslations("common")
  const tp = useTranslations("process")
  const tm = useTranslations("mode")
  const tpm = useTranslations("method")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const can = useCan()
  const actions = useDocActions("sale")
  const { state, set, params, clearAll, activeCount } = useListState(FACETS)
  const q = useQuery({ queryKey: ["sales", params], queryFn: () => api.sales.list(params), placeholderData: keepPreviousData })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] }) }
  const approve = useMutation({
    mutationFn: (ids: string[]) => api.sales.bulkApprove(ids),
    onSuccess: (r) => {
      invalidate()
      toast.success(t("approvedN", { count: r.done.length }), { description: r.skipped.length ? t("skippedN", { count: r.skipped.length }) : undefined })
    },
    onError: (e) => toast.error(e.message),
  })
  const copyLink = (s: Sale) => { navigator.clipboard?.writeText(`${window.location.origin}/${locale}/sales/${s.id}`); toast.success(tt("linkCopied")) }

  const columns = React.useMemo<ColumnDef<Sale, unknown>[]>(() => [
    { id: "issueDate", accessorKey: "issueDate", meta: { label: t("col.issueDate") }, header: t("col.issueDate"), cell: ({ row }) => fmtDate(row.original.issueDate, locale) },
    {
      id: "invoiceNo", accessorKey: "invoiceNo", meta: { label: t("col.invoiceNo"), hideable: false }, header: t("col.invoiceNo"),
      cell: ({ row }) => <Link href={`/sales/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.invoiceNo}</Link>,
    },
    { id: "challanNo", accessorKey: "challanNo", meta: { label: t("col.challanNo") }, header: t("col.challanNo"), cell: ({ row }) => <span className="tabular">{fmtNum(Number(row.original.challanNo), locale)}</span> },
    {
      id: "customerName", accessorKey: "customerName", meta: { label: t("col.customer"), className: "max-w-72" }, header: t("col.customer"),
      cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.customerName}>{row.original.customerName}</span>,
    },
    { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => <ModeBadge value={row.original.mode} /> },
    { id: "method", accessorKey: "method", meta: { label: t("col.method") }, header: t("col.method"), cell: ({ row }) => tpm(row.original.method) },
    { id: "subtotal", accessorKey: "subtotal", meta: { label: t("col.subtotal"), align: "right", total: "subtotal" }, header: t("col.subtotal"), cell: ({ row }) => <Money value={row.original.subtotal} /> },
    { id: "sd", accessorKey: "sd", meta: { label: t("col.sd"), align: "right", total: "sd" }, header: t("col.sd"), cell: ({ row }) => <Money value={row.original.sd} /> },
    { id: "vat", accessorKey: "vat", meta: { label: t("col.vat"), align: "right", total: "vat" }, header: t("col.vat"), cell: ({ row }) => <Money value={row.original.vat} /> },
    { id: "discount", accessorKey: "discount", meta: { label: t("col.discount"), align: "right", total: "discount" }, header: t("col.discount"), cell: ({ row }) => <Money value={row.original.discount} /> },
    { id: "netTotal", accessorKey: "netTotal", meta: { label: t("col.netTotal"), align: "right", total: "netTotal" }, header: t("col.netTotal"), cell: ({ row }) => <Money value={row.original.netTotal} className="font-medium" /> },
    { id: "paid", accessorKey: "paid", meta: { label: t("col.received"), align: "right", total: "paid" }, header: t("col.received"), cell: ({ row }) => <Money value={row.original.paid} /> },
    { id: "due", accessorKey: "due", meta: { label: t("col.due"), align: "right", total: "due" }, header: t("col.due"), cell: ({ row }) => <Money value={row.original.due} className={row.original.due > 0 ? "text-warning font-medium" : ""} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.process") }, header: t("col.process"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => {
        const s = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tc("actionsFor", { name: s.invoiceNo })} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => router.push(`/sales/${s.id}`)}><Eye /> {tc("view")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(`/sales/${s.id}?tab=mushak&print=1`)}><Printer /> {t("printMushak")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => copyLink(s)}><Link2 /> {tt("copyLink")}</DropdownMenuItem>
              {s.process === "Created" && can("doc.edit") && <DropdownMenuItem onClick={() => router.push(`/sales/${s.id}/edit`)}><Pencil /> {tc("edit")}</DropdownMenuItem>}
              {s.process === "Created" && can("doc.approve") && <DropdownMenuItem onClick={() => actions.approve(s)}><CheckCheck /> {t("approve")}</DropdownMenuItem>}
              {s.process === "Created" && can("doc.delete") && (<><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => actions.askDelete(s)}><Trash2 /> {tc("deleteDraft")}</DropdownMenuItem></>)}
              {s.process !== "Cancelled" && can("doc.cancel") && (<><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => actions.askCancel(s)}><XCircle /> {t("cancelInvoice")}</DropdownMenuItem></>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, tc, tpm, tt, can])

  const labels = q.data?.facetLabels?.customer ?? {}
  const facetOpts = {
    customer: Object.entries(labels).map(([value, label]) => ({ value, label })),
    process: ["Created", "Approved", "Cancelled"].map((v) => ({ value: v, label: tp(v) })),
    mode: ["Local", "Foreign"].map((v) => ({ value: v, label: tm(v) })),
    method: ["Bank", "Cash", "Cheque", "Mobile"].map((v) => ({ value: v, label: tpm(v) })),
    payment: ["paid", "partial", "unpaid"].map((v) => ({ value: v, label: t(`payment.${v}`) })),
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
        description={totals ? t("summary", { count: fmtNum(q.data!.total, locale), net: fmtCompact(totals.netTotal, locale), vat: fmtCompact(totals.vat, locale), due: fmtCompact(totals.due, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button render={<Link href="/sales/new" />}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<Sale>
        tableId="sales"
        caption={t("title")}
        columns={columns}
        data={q.data?.data}
        total={q.data?.total ?? 0}
        totals={totals}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        page={state.page}
        size={state.size}
        sort={state.sort}
        onPage={(page) => set({ page }, false)}
        onSize={(size) => set({ size })}
        onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id}
        onRowClick={(r) => router.push(`/sales/${r.id}`)}
        selectable
        defaultHidden={["sd", "discount", "method", "paid"]}
        filtered={activeCount > 0}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            <FacetFilter title={t("facet.customer")} options={facetOpts.customer} selected={state.customer} onChange={(v) => set({ customer: v })} counts={q.data?.facets.customer} />
            <FacetFilter title={t("facet.process")} options={facetOpts.process} selected={state.process} onChange={(v) => set({ process: v })} counts={q.data?.facets.process} />
            <FacetFilter title={t("facet.mode")} options={facetOpts.mode} selected={state.mode} onChange={(v) => set({ mode: v })} counts={q.data?.facets.mode} />
            <FacetFilter title={t("facet.payment")} options={facetOpts.payment} selected={state.payment} onChange={(v) => set({ payment: v })} counts={q.data?.facets.payment} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={
          <>
            <SavedViews tableId="sales" builtIn={[
              { name: t("views.pending"), query: "process=Created" },
              { name: t("views.thisPeriod"), query: "from=2026-09-01&to=2026-09-30" },
              { name: t("views.unpaid"), query: "payment=unpaid,partial&sort=due.desc" },
              { name: t("views.exports"), query: "mode=Foreign" },
            ]} />
            <Button variant="outline" size="sm" render={<a href={api.sales.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>
          </>
        }
        bulkActions={(ids, rows, clear) => (
          <>
            {can("doc.approve") && <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(ids, { onSuccess: clear })}><CheckCheck /> {t("approveN", { count: rows.filter((r) => r.process === "Created").length || ids.length })}</Button>}
            <Button size="sm" variant="outline" render={<a href={api.sales.csvUrl({ ...params, ids: ids.join(",") })} download />}><Download /> {tt("exportSelected")}</Button>
          </>
        )}
        mobileCard={(s) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/sales/${s.id}`} className="font-medium text-primary">{s.invoiceNo}</Link>
              <ProcessBadge value={s.process} />
            </div>
            <p className="truncate text-sm">{s.customerName}</p>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{fmtDate(s.issueDate, locale)} · {t("col.challanNo")} {fmtNum(Number(s.challanNo), locale)}</span>
              <Money value={s.netTotal} className="font-semibold text-foreground" />
            </div>
            {s.due > 0 && <p className="text-right text-xs text-warning">{t("col.due")}: <Money value={s.due} /></p>}
          </div>
        )}
        emptyAction={activeCount > 0 ? <Button variant="outline" size="sm" onClick={clearAll}>{tt("clearAll")}</Button> : can("doc.create") ? <Button size="sm" render={<Link href="/sales/new" />}><Plus /> {t("new")}</Button> : undefined}
      />
    </>
  )
}
