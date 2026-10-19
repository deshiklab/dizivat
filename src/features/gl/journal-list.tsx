"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "@/i18n/navigation"
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
import { ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import type { JournalRow, JournalSourceKind } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"

const JournalSheet = dynamic(() => import("./journal-sheet").then((m) => m.JournalSheet), { ssr: false })
const JournalForm = dynamic(() => import("./journal-form").then((m) => m.JournalForm), { ssr: false })

const FACETS = ["source", "process"] as const
type Facet = (typeof FACETS)[number]

/** Where a derived entry's drill goes: the document that made it (the register row links there). */
const SOURCE_ROUTE: Record<JournalSourceKind, string | null> = {
  sale: "/sales", purchase: "/purchases",
  creditNote: "/sales/credit-notes", debitNote: "/purchases/debit-notes",
  receipt: "/accounting/receipts", payment: "/accounting/payments",
  transfer: "/accounting/transfers", treasury: "/vat/tr-6",
  vdsPurchase: "/vat/vds", vdsSales: "/vat/vds",
  adjustment: "/vat/adjustments", opening: "/purchases/opening",
  openingBalance: "/accounting/bank-accounts",
  asset: "/accounting/assets", depreciation: "/accounting/assets", revaluation: "/accounting/assets", disposal: "/accounting/assets",
  manual: null,
}

/**
 * R9.2 — the journal register: every posting the books hold, derived and manual side by side. The derived
 * rows are a read model (their document is the truth — the drill goes there); the JE- rows are documents of
 * their own with the usual draft → approve → cancel lifecycle.
 */
export function JournalList() {
  const t = useTranslations("journal")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const [account, setAccount] = useQueryState("account", parseAsString)
  const q = useQuery({ queryKey: ["journalRegister", params], queryFn: () => api.accounting.journal.list(params), placeholderData: keepPreviousData })
  const chart = useQuery({ queryKey: ["chart"], queryFn: () => api.accounting.chart.list() })
  const editing = useQuery({ queryKey: ["r4doc", "journal", editId], queryFn: () => api.accounting.journal.get(editId!), enabled: !!editId })
  const actions = useR4Actions("journal")
  const labels = q.data?.facetLabels ?? {}
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const asDoc = (r: JournalRow) => ({ id: r.id, no: r.no, process: r.process ?? "Created" })
  const open = (r: JournalRow) => {
    if (r.sourceKind === "manual") setViewId(r.id)
    else {
      const base = SOURCE_ROUTE[r.sourceKind]
      // the asset postings carry the month in their source id (fa3:2026-07) — the sheet wants the asset
      const id = r.sourceId.split(":")[0]
      if (base) router.push(`${base}?view=${encodeURIComponent(id)}`)
    }
  }

  const columns = React.useMemo<ColumnDef<JournalRow, unknown>[]>(() => [
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); open(row.original) }}>{row.original.no}</button> },
    { id: "memo", accessorKey: "memo", meta: { label: t("col.memo") }, header: t("col.memo"), cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.memo}>{row.original.memo}</span> },
    { id: "source", accessorKey: "sourceNo", meta: { label: t("col.source") }, header: t("col.source"),
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.sourceKind === "manual" ? t("sourceLabel.manual") : `${labels.source?.[row.original.sourceKind] ?? row.original.sourceKind} · ${row.original.sourceNo}`}</span> },
    { id: "accounts", accessorFn: (r) => r.accounts.join(" "), meta: { label: t("col.accounts") }, header: t("col.accounts"),
      cell: ({ row }) => <span className="block max-w-48 truncate text-muted-foreground" title={row.original.accounts.join(", ")}>{row.original.accounts.join(", ")}</span> },
    { id: "debit", accessorKey: "debit", meta: { label: t("col.debit"), align: "right", total: "debit" }, header: t("col.debit"), cell: ({ row }) => <Money value={row.original.debit} className="tabular" /> },
    { id: "credit", accessorKey: "credit", meta: { label: t("col.credit"), align: "right", total: "credit" }, header: t("col.credit"), cell: ({ row }) => <Money value={row.original.credit} className="tabular" /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"),
      cell: ({ row }) => row.original.sourceKind === "manual" ? <ProcessBadge value={row.original.process ?? "Created"} /> : <span className="text-xs text-muted-foreground">{t("posted")}</span> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => open(row.original)}><Eye /></Button>
          {row.original.sourceKind === "manual" && row.original.process === "Created" && can("doc.approve") && (
            <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={t("approve")} disabled={actions.busy} onClick={() => actions.approve(asDoc(row.original))}><CheckCheck /></Button>
          )}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy, labels])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    source: Object.entries(labels.source ?? {}).filter(([v]) => q.data?.facets.source?.[v]).map(([value, label]) => ({ value, label })),
    process: (["Posted", "Created", "Approved"] as const).map((v) => ({ value: v, label: v === "Posted" ? t("posted") : tp(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...(account && chart.data ? [{ key: "account", label: `${t("col.accounts")}: ${chart.data.find((a) => a.code === account)?.name ?? account}`, onRemove: () => setAccount(null) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const withAccount = { ...params, ...(account ? { account } : {}) }

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), debit: fmtCompact(q.data.totals.debit ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") && <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button>}
      />
      <DataTable<JournalRow>
        tableId="journalRegister" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={open} filtered={activeCount > 0 || !!account}
        defaultHidden={["accounts"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={() => { clearAll(); setAccount(null) }} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.accounting.journal.csvUrl(withAccount)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span>{d.sourceKind === "manual" ? <ProcessBadge value={d.process ?? "Created"} /> : <span className="text-xs text-muted-foreground">{t("posted")}</span>}</div>
            <p className="truncate text-sm">{d.memo}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.date, locale)}</span><Money value={d.debit} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <JournalSheet id={viewId} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />}
      {formMounted && <JournalForm open={formOpen} doc={editId ? editing.data : null} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
