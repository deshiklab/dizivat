"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Banknote, Building2, Download, Pencil, Plus, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { ACCOUNT_KINDS } from "@/lib/r4"
import type { AccountKind, MoneyAccountRow } from "@/lib/types"
import { useOnceOpen } from "@/hooks/use-once-open"

const AccountForm = dynamic(() => import("./account-form").then((m) => m.AccountForm), { ssr: false })
const AccountSheet = dynamic(() => import("./account-sheet").then((m) => m.AccountSheet), { ssr: false })

const FACETS = ["kind", "status"] as const
type Facet = (typeof FACETS)[number]
const ICON: Record<AccountKind, typeof Building2> = { bank: Building2, mobile: Smartphone, cash: Banknote }

/** Company bank, mobile-wallet (MFS) and cash accounts with live balances (legacy "Accounting" menu opened bank screens only, D-10). */
export function AccountsPage() {
  const t = useTranslations("acct")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [newKind, setNewKind] = useQueryState("kind-new", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["accounts", params], queryFn: () => api.accounting.accounts.list(params), placeholderData: keepPreviousData })
  const all = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.accounting.accounts.list({ size: 100 }) })
  const editing = useQuery({ queryKey: ["account", editId], queryFn: () => api.accounting.accounts.get(editId!), enabled: !!editId })
  const formOpen = (!!isNew || (!!editId && !!editing.data)) && can("master.edit")
  const formMounted = useOnceOpen(formOpen)
  const sheetMounted = useOnceOpen(!!viewId)

  const byKind = ACCOUNT_KINDS.map((k) => {
    const rows = (all.data?.data ?? []).filter((a) => a.kind === k && a.active)
    return { kind: k, count: rows.length, balance: rows.reduce((s, a) => s + a.balance, 0) }
  })
  const columns = React.useMemo<ColumnDef<MoneyAccountRow, unknown>[]>(() => [
    { id: "provider", accessorKey: "provider", meta: { label: t("col.account"), hideable: false }, header: t("col.account"),
      cell: ({ row }) => {
        const a = row.original, I = ICON[a.kind]
        return (
          <button type="button" className="flex items-center gap-2 text-left" onClick={(e) => { e.stopPropagation(); setViewId(a.id) }}>
            <I className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="grid"><span className="font-medium text-primary hover:underline">{a.provider}</span><span className="text-xs text-muted-foreground tabular">{a.accountNo || "—"}{a.branch ? ` · ${a.branch}` : ""}</span></span>
          </button>
        )
      } },
    { id: "kind", accessorKey: "kind", meta: { label: t("col.kind") }, header: t("col.kind"), cell: ({ row }) => t(`kind.${row.original.kind}`) },
    { id: "owner", accessorKey: "owner", meta: { label: t("col.owner") }, header: t("col.owner"), cell: ({ row }) => <span className="block max-w-56 truncate" title={row.original.owner}>{row.original.owner}</span> },
    { id: "type", meta: { label: t("col.type"), sortable: false }, header: t("col.type"), cell: ({ row }) => (row.original.bankType ? t(`bankType.${row.original.bankType}`) : row.original.walletType ? t(`walletType.${row.original.walletType}`) : "—") },
    { id: "serviceCharge", accessorKey: "serviceCharge", meta: { label: t("col.charge"), align: "right" }, header: t("col.charge"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.serviceCharge, locale, 2)}%</span> },
    { id: "inflow", accessorKey: "inflow", meta: { label: t("col.inflow"), align: "right", total: "inflow" }, header: t("col.inflow"), cell: ({ row }) => <Money value={row.original.inflow} /> },
    { id: "outflow", accessorKey: "outflow", meta: { label: t("col.outflow"), align: "right", total: "outflow" }, header: t("col.outflow"), cell: ({ row }) => <Money value={row.original.outflow} /> },
    { id: "balance", accessorKey: "balance", meta: { label: t("col.balance"), align: "right", total: "balance" }, header: t("col.balance"), cell: ({ row }) => <Money value={row.original.balance} className="font-semibold" /> },
    { id: "lastDate", accessorKey: "lastDate", meta: { label: t("col.last") }, header: t("col.last"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.lastDate ? fmtDate(row.original.lastDate, locale) : "—"}</span> },
    { id: "active", accessorKey: "active", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <Pill tone={row.original.active ? "success" : "neutral"}>{t(row.original.active ? "active" : "inactive")}</Pill> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => can("master.edit") ? <Button variant="ghost" size="icon-sm" aria-label={t("editOne", { name: `${row.original.provider} ${row.original.accountNo}` })} onClick={(e) => { e.stopPropagation(); setEditId(row.original.id) }}><Pencil /></Button> : null,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    kind: ACCOUNT_KINDS.map((v) => ({ value: v, label: t(`kind.${v}`) })),
    status: ["active", "inactive"].map((v) => ({ value: v, label: t(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={can("master.edit") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {byKind.map((k) => {
          const I = ICON[k.kind]
          return (
            <Card key={k.kind} size="sm">
              <CardContent className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><I className="size-5" aria-hidden /></span>
                <div className="grid">
                  <span className="text-xs text-muted-foreground">{t(`kindTotal.${k.kind}`, { n: fmtNum(k.count, locale) })}</span>
                  <Money value={k.balance} className="text-lg font-semibold" />
                </div>
                {can("master.edit") && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setNewKind(k.kind); setNew(true) }} aria-label={t(`add.${k.kind}`)}><Plus /></Button>}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <DataTable<MoneyAccountRow>
        tableId="accounts" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["inflow", "outflow", "type"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.accounting.accounts.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(a) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.provider}</span><Pill tone={a.active ? "success" : "neutral"}>{t(a.active ? "active" : "inactive")}</Pill></div>
            <p className="text-sm text-muted-foreground tabular">{a.accountNo} · {t(`kind.${a.kind}`)}</p>
            <p className="flex justify-end text-sm"><Money value={a.balance} className="font-semibold" /></p>
          </div>
        )}
      />
      {sheetMounted && <AccountSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <AccountForm open={formOpen} account={editId ? editing.data : null} kind={(newKind as AccountKind) ?? undefined}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setNewKind(null) } }} />}
    </>
  )
}
