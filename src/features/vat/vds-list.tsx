"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, FilePlus2, Plus, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { periodLabel, VDS_MODES } from "@/lib/r4"
import type { VdsEntry, VdsMode } from "@/lib/types"
import { useR4Actions } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"

const VdsSheet = dynamic(() => import("./vds-sheet").then((m) => m.VdsSheet), { ssr: false })
const VdsForm = dynamic(() => import("./vds-form").then((m) => m.VdsForm), { ssr: false })

const FACETS = ["process", "mode", "party", "period"] as const
type Facet = (typeof FACETS)[number]

/**
 * VAT deducted at source (Mushak 6.6): purchase VDS we withheld from suppliers (we issue the certificate and deposit it)
 * and sales VDS our customers withheld from us (we collect their certificates). ?new (&mode=&doc=), ?view (&tab=print), ?edit.
 */
export function VdsList() {
  const t = useTranslations("vds")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [preMode, setPreMode] = useQueryState("vdsMode", parseAsString)
  const [preDoc, setPreDoc] = useQueryState("doc", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["vds", params], queryFn: () => api.vat.vds.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["r4doc", "vds", editId], queryFn: () => api.vat.vds.get(editId!), enabled: !!editId })
  const toIssue = useQuery({ queryKey: ["vdsEligible", "purchase"], queryFn: () => api.vat.vdsEligible("purchase") })
  const awaited = useQuery({ queryKey: ["vdsEligible", "sales"], queryFn: () => api.vat.vdsEligible("sales") })
  const actions = useR4Actions("vds")
  const labels = q.data?.facetLabels ?? {}
  const formOpen = (!!isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)
  const issue = (mode: VdsMode, doc: string) => { setPreMode(mode); setPreDoc(doc); setNew(true) }

  const columns = React.useMemo<ColumnDef<VdsEntry, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}><span className="block font-medium text-primary hover:underline tabular">{row.original.no}</span>{row.original.certificateNo && <span className="text-xs text-muted-foreground tabular">{row.original.certificateNo}</span>}</button> },
    { id: "certificateDate", accessorKey: "certificateDate", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.certificateDate, locale)}</span> },
    { id: "mode", accessorKey: "mode", meta: { label: t("col.mode") }, header: t("col.mode"), cell: ({ row }) => <Pill tone={row.original.mode === "purchase" ? "warning" : "info"}>{t(`mode.${row.original.mode}`)}</Pill> },
    { id: "docNo", accessorKey: "docNo", meta: { label: t("col.invoice") }, header: t("col.invoice"),
      cell: ({ row }) => <Link href={row.original.mode === "sales" ? `/sales/${row.original.docId}` : `/purchases/${row.original.docId}`} onClick={(e) => e.stopPropagation()} className="tabular hover:underline">{row.original.docNo}</Link> },
    { id: "partyName", accessorKey: "partyName", meta: { label: t("col.party") }, header: t("col.party"), cell: ({ row }) => <span className="block max-w-56 truncate" title={row.original.partyName}>{row.original.partyName}<span className="block text-xs text-muted-foreground tabular">{row.original.partyBin}</span></span> },
    { id: "docValue", accessorKey: "docValue", meta: { label: t("col.value"), align: "right", total: "docValue" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.docValue} /> },
    { id: "docVat", accessorKey: "docVat", meta: { label: t("col.vat"), align: "right", total: "docVat" }, header: t("col.vat"), cell: ({ row }) => <Money value={row.original.docVat} /> },
    { id: "amount", accessorKey: "amount", meta: { label: t("col.amount"), align: "right", total: "amount" }, header: t("col.amount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
    { id: "taxPeriod", accessorKey: "taxPeriod", meta: { label: t("col.period") }, header: t("col.period"), cell: ({ row }) => <span className="tabular">{periodLabel(row.original.taxPeriod)}</span> },
    { id: "treasuryChallan", accessorKey: "treasuryChallan", meta: { label: t("col.challan") }, header: t("col.challan"), cell: ({ row }) => <span className="tabular text-muted-foreground">{row.original.treasuryChallan ?? (row.original.mode === "purchase" ? t("notDeposited") : "—")}</span> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("printDoc", { no: row.original.no })} onClick={() => { setViewId(row.original.id); setTab("print") }}><Printer /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    mode: VDS_MODES.map((v) => ({ value: v, label: t(`mode.${v}`) })),
    party: Object.entries(labels.party ?? {}).filter(([v]) => q.data?.facets.party?.[v]).map(([value, label]) => ({ value, label })),
    period: Object.keys(q.data?.facets.period ?? {}).sort().reverse().map((v) => ({ value: v, label: periodLabel(v) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const pendingIssue = (toIssue.data ?? []).filter((e) => e.remaining > 0.004)
  const pendingAwait = (awaited.data ?? []).filter((e) => e.remaining > 0.004)
  const mode = state.mode.length === 1 ? state.mode[0] : "all"

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.amount ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <div role="tablist" aria-label={t("col.mode")} className="mb-3 inline-flex rounded-lg border p-0.5">
        {(["all", ...VDS_MODES] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => set({ mode: m === "all" ? [] : [m] } as never)}
            className={`min-h-9 rounded-md px-3 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{t(`tab.${m}`)}</button>
        ))}
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {([["purchase", pendingIssue], ["sales", pendingAwait]] as const).map(([m, rows]) => (
          <Card key={m} size="sm">
            <CardHeader><CardTitle>{t(`pending.${m}`)}</CardTitle><CardDescription>{t(`pending.${m}Hint`, { n: fmtNum(rows.length, locale), amount: fmtCompact(rows.reduce((s, r) => s + r.remaining, 0), locale) })}</CardDescription></CardHeader>
            <CardContent>
              {!rows.length ? <p className="text-sm text-muted-foreground">{t("pending.none")}</p> : (
                <ul className="grid max-h-48 gap-1.5 overflow-y-auto text-sm" tabIndex={0} aria-label={t(`pending.${m}`)}>
                  {rows.slice(0, 12).map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="grid flex-1"><span className="truncate"><span className="font-medium tabular">{r.no}</span> · {r.partyName}</span><span className="text-xs text-muted-foreground">{fmtDate(r.date, locale)}</span></span>
                      <Money value={r.remaining} />
                      {can("doc.create") && <Button variant="ghost" size="icon-sm" aria-label={t(`pending.${m}Action`, { no: r.no })} onClick={() => issue(m, r.id)}><FilePlus2 /></Button>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <DataTable<VdsEntry>
        tableId="vds" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["docValue", "taxPeriod"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.filter((f) => f !== "mode").map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.vat.vds.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><ProcessBadge value={d.process} /></div>
            <p className="truncate text-sm">{d.partyName} · {d.docNo}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.certificateDate, locale)} · {t(`mode.${d.mode}`)}</span><Money value={d.amount} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <VdsSheet id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }} onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} />}
      {formMounted && <VdsForm open={formOpen} doc={editId ? editing.data : null} preset={{ mode: preMode === "sales" ? "sales" : preMode === "purchase" ? "purchase" : undefined, docId: preDoc }}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setPreMode(null); setPreDoc(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
