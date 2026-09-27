"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Download, FileText, MoreHorizontal, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { SavedViews } from "@/components/data-table/saved-views"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, Pill } from "@/components/common/status-badge"
import { Money } from "@/components/common/money"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import type { PartyRow } from "@/lib/types"
import { PartySheet } from "./party-sheet"

const FACETS = ["mode", "status", "balance"] as const
type Kind = "customer" | "vendor"

/** Customers and vendors share one list: same columns, filters and actions; labels differ by `kind`. */
export function PartiesList({ kind }: { kind: Kind }) {
  const t = useTranslations("parties")
  const tk = useTranslations(`parties.${kind}`)
  const tc = useTranslations("common")
  const tm = useTranslations("mode")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const can = useCan()
  const canEdit = can("master.edit")
  const client = kind === "customer" ? api.customers : api.vendors
  const key = `${kind}s`
  const docsHref = (id: string) => (kind === "customer" ? `/sales?customer=${id}` : `/purchases?vendor=${id}`)

  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: [key, params], queryFn: () => client.list(params), placeholderData: keepPreviousData })
  // Deep links (?edit=id from global search) may point outside the current page → fetch the record itself
  const onPage = editId ? q.data?.data.find((p) => p.id === editId) : undefined
  const single = useQuery({ queryKey: [kind, editId], queryFn: () => client.get(editId!), enabled: !!editId && !!q.data && !onPage })
  const editing = editId ? onPage ?? single.data ?? null : null

  const refresh = () => qc.invalidateQueries({ queryKey: [key] })
  const toggle = useMutation({
    mutationFn: (p: PartyRow) => client.update(p.id, { ...p, country: p.country ?? "", email: p.email ?? "", contactPerson: p.contactPerson ?? "", active: p.active === false }),
    onSuccess: (r) => { refresh(); toast.success(r.active === false ? t("deactivated", { name: r.name }) : t("activated", { name: r.name })) },
    onError: (e) => toast.error(e.message),
  })
  const restore = useMutation({
    mutationFn: (id: string) => client.restore(id),
    onSuccess: (r) => { refresh(); toast.success(t("restored", { name: r.name })) },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (p: PartyRow) => client.remove(p.id).then(() => p),
    onSuccess: (p) => { refresh(); toast(t("deleted", { name: p.name }), { duration: 10_000, action: { label: t("undo"), onClick: () => restore.mutate(p.id) } }) },
    onError: (e, p) => {
      // 409 = has documents → deactivation is the only option (NBR requires the history to remain)
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("inUse", { name: p.name, count: p.docs }), { action: p.active !== false ? { label: t("deactivate"), onClick: () => toggle.mutate(p) } : undefined })
      } else toast.error(e.message)
    },
  })
  const askDelete = async (p: PartyRow) => {
    if (p.docs > 0) { remove.mutate(p); return } // server explains why + offers deactivate
    if (await confirm({ title: t("deleteTitle", { name: p.name }), description: t("deleteBody"), confirm: t("deleteConfirm"), cancel: tc("keep"), destructive: true })) remove.mutate(p)
  }

  const columns = React.useMemo<ColumnDef<PartyRow, unknown>[]>(() => [
    {
      id: "name", accessorKey: "name", meta: { label: t("col.name"), hideable: false, className: "max-w-80" }, header: t("col.name"),
      cell: ({ row }) => {
        const p = row.original
        return (
          <div className="grid max-w-80 min-w-0">
            <button type="button" className="truncate text-left font-medium text-primary hover:underline" title={p.name} onClick={(e) => { e.stopPropagation(); setEditId(p.id) }}>{p.name}</button>
            {(p.contactPerson || p.country) && <span className="truncate text-xs text-muted-foreground">{[p.contactPerson, p.country].filter(Boolean).join(" · ")}</span>}
          </div>
        )
      },
    },
    { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => <ModeBadge value={row.original.mode} /> },
    { id: "bin", accessorKey: "bin", meta: { label: t("col.bin") }, header: t("col.bin"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{row.original.bin || "—"}</span> },
    { id: "mobile", accessorKey: "mobile", meta: { label: t("col.mobile") }, header: t("col.mobile"), cell: ({ row }) => row.original.mobile ? <a href={`tel:${row.original.mobile.replace(/[^\d+]/g, "")}`} onClick={(e) => e.stopPropagation()} className="tabular whitespace-nowrap hover:underline">{row.original.mobile}</a> : "—" },
    { id: "address", accessorKey: "address", meta: { label: t("col.address") }, header: t("col.address"), cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.address}>{row.original.address}</span> },
    { id: "docs", accessorKey: "docs", meta: { label: tk("docs"), align: "right", total: "docs", totalFormat: "count" }, header: tk("docs"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.docs, locale)}</span> },
    { id: "turnover", accessorKey: "turnover", meta: { label: tk("turnover"), align: "right", total: "turnover" }, header: tk("turnover"), cell: ({ row }) => <Money value={row.original.turnover} /> },
    { id: "due", accessorKey: "due", meta: { label: tk("due"), align: "right", total: "due" }, header: tk("due"), cell: ({ row }) => <Money value={row.original.due} className={row.original.due > 0 ? "font-medium text-warning" : ""} /> },
    { id: "lastDate", accessorKey: "lastDate", meta: { label: tk("last") }, header: tk("last"), cell: ({ row }) => row.original.lastDate ? fmtDate(row.original.lastDate, locale) : <span className="text-muted-foreground">—</span> },
    { id: "status", accessorKey: "active", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => row.original.active === false ? <Pill>{t("inactive")}</Pill> : <Pill tone="success">{t("active")}</Pill> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => {
        const p = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tc("actionsFor", { name: p.name })} />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setEditId(p.id)}><Pencil /> {canEdit ? tc("edit") : tc("view")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(docsHref(p.id))}><FileText /> {tk("viewDocs")}</DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => toggle.mutate(p)}>{p.active === false ? <><Power /> {t("activate")}</> : <><PowerOff /> {t("deactivate")}</>}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => askDelete(p)}><Trash2 /> {tc("delete")}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, tk, tc, canEdit])

  const facetOpts = {
    mode: (kind === "customer" ? ["Local", "Foreign"] : ["Local", "Foreign", "Non-registered"]).map((v) => ({ value: v, label: tm(v.replace("-r", "R")) })),
    status: ["active", "inactive"].map((v) => ({ value: v, label: t(v) })),
    balance: ["due", "clear"].map((v) => ({ value: v, label: tk(`balance.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const totals = q.data?.totals

  return (
    <>
      <PageHeader
        title={tk("title")}
        description={q.data && totals ? tk("summary", { count: fmtNum(q.data.total, locale), turnover: fmtCompact(totals.turnover ?? 0, locale), due: fmtCompact(totals.due ?? 0, locale) }) : tk("subtitle")}
        actions={canEdit ? <Button onClick={() => setNew(true)}><Plus /> {tk("new")}</Button> : undefined}
      />
      <DataTable<PartyRow>
        tableId={key} caption={tk("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setEditId(r.id)} filtered={activeCount > 0}
        defaultHidden={["address", "lastDate"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <FacetFilter title={t("facet.mode")} options={facetOpts.mode} selected={state.mode} onChange={(v) => set({ mode: v })} counts={q.data?.facets.mode} />
            <FacetFilter title={t("facet.status")} options={facetOpts.status} selected={state.status} onChange={(v) => set({ status: v })} counts={q.data?.facets.status} />
            <FacetFilter title={t("facet.balance")} options={facetOpts.balance} selected={state.balance} onChange={(v) => set({ balance: v })} counts={q.data?.facets.balance} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={
          <>
            <SavedViews tableId={key} builtIn={[
              { name: tk("views.top"), query: "sort=turnover.desc" },
              { name: tk("views.due"), query: "balance=due&sort=due.desc" },
              { name: tk("views.foreign"), query: "mode=Foreign" },
              { name: t("views.inactive"), query: "status=inactive" },
            ]} />
            <Button variant="outline" size="sm" render={<a href={client.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>
          </>
        }
        mobileCard={(p) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.name}</span><ModeBadge value={p.mode} /></div>
            <p className="truncate text-sm text-muted-foreground">{p.bin} · {p.mobile}</p>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{tk("docs")}: {fmtNum(p.docs, locale)}</span>
              {p.due > 0 ? <span className="text-warning">{tk("due")}: <Money value={p.due} /></span> : <Money value={p.turnover} className="font-semibold text-foreground" />}
            </div>
          </div>
        )}
        emptyAction={activeCount > 0 ? <Button variant="outline" size="sm" onClick={clearAll}>{tt("clearAll")}</Button> : canEdit ? <Button size="sm" onClick={() => setNew(true)}><Plus /> {tk("new")}</Button> : undefined}
      />
      <PartySheet kind={kind} open={isNew || !!editing} party={editing} readOnly={!canEdit}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }}
        onSaved={() => qc.invalidateQueries({ queryKey: [kind] })} />
    </>
  )
}
