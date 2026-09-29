"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { CheckCheck, Download, Eye, Plus, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import type { BomRow, BomStatus } from "@/lib/types"
import { useR3Actions } from "@/features/r3/use-r3-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import { BomStatusPill } from "./parts"

const BomSheet = dynamic(() => import("./bom-sheet").then((m) => m.BomSheet), { ssr: false })
const BomForm = dynamic(() => import("./bom-form").then((m) => m.BomForm), { ssr: false })

const FACETS = ["status", "item"] as const
type Facet = (typeof FACETS)[number]
const STATUSES: BomStatus[] = ["active", "draft", "superseded", "cancelled"]

/**
 * Bill of materials / input–output coefficient declarations (Mushak 4.3), one row per version.
 * URL state: ?new (&item=<id>), ?amend=<bomId> (new version pre-filled), ?view=<id> (&tab=compare|mushak), ?edit=<id>.
 */
export function BomList() {
  const t = useTranslations("bom")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [forItem, setForItem] = useQueryState("item", parseAsString)
  const [amendId, setAmendId] = useQueryState("amend", parseAsString)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [tab, setTab] = useQueryState("tab", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["boms", params], queryFn: () => api.production.boms.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["bom", editId], queryFn: () => api.production.boms.get(editId!), enabled: !!editId })
  const amending = useQuery({ queryKey: ["bom", amendId], queryFn: () => api.production.boms.get(amendId!), enabled: !!amendId })
  const actions = useR3Actions("bom")
  const labels = q.data?.facetLabels ?? {}
  const canEdit = can("master.edit")
  const formOpen = canEdit && ((!!isNew) || (!!editId && !!editing.data) || (!!amendId && !!amending.data))
  const sheetMounted = useOnceOpen(!!viewId)
  const formMounted = useOnceOpen(formOpen)

  const columns = React.useMemo<ColumnDef<BomRow, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular whitespace-nowrap" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "itemName", accessorKey: "itemName", meta: { label: t("col.item") }, header: t("col.item"),
      cell: ({ row }) => <span className="block max-w-64 truncate" title={row.original.itemName}>{row.original.itemName}<span className="block text-xs text-muted-foreground tabular">{row.original.sku} · HS {row.original.hsCode}</span></span> },
    { id: "version", accessorKey: "version", meta: { label: t("col.version"), align: "right" }, header: t("col.version"), cell: ({ row }) => <span className="tabular">v{fmtNum(row.original.version, locale)}</span> },
    { id: "uom", accessorKey: "uom", meta: { label: t("col.uom") }, header: t("col.uom") },
    { id: "licenseDate", accessorKey: "licenseDate", meta: { label: t("col.licenseDate") }, header: t("col.licenseDate"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{row.original.licenseDate ? fmtDate(row.original.licenseDate, locale) : "—"}</span> },
    { id: "effectiveDate", accessorKey: "effectiveDate", meta: { label: t("col.effectiveDate") }, header: t("col.effectiveDate"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.effectiveDate, locale)}</span> },
    { id: "inputs", meta: { label: t("col.inputs"), sortable: false, align: "right" }, header: t("col.inputs"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.inputs.length, locale)}</span> },
    { id: "materialValue", accessorKey: "materialValue", meta: { label: t("col.material"), align: "right" }, header: t("col.material"), cell: ({ row }) => <Money value={row.original.materialValue} /> },
    { id: "wastageValue", accessorKey: "wastageValue", meta: { label: t("col.wastage"), align: "right" }, header: t("col.wastage"), cell: ({ row }) => <Money value={row.original.wastageValue} /> },
    { id: "valueAdded", accessorKey: "valueAdded", meta: { label: t("col.valueAdded"), align: "right" }, header: t("col.valueAdded"), cell: ({ row }) => <Money value={row.original.valueAdded} /> },
    { id: "price", accessorKey: "price", meta: { label: t("col.price"), align: "right" }, header: t("col.price"), cell: ({ row }) => <Money value={row.original.price} className="font-medium" /> },
    { id: "unitCost", accessorKey: "unitCost", meta: { label: t("col.unitCost"), align: "right" }, header: t("col.unitCost"), cell: ({ row }) => <Money value={row.original.unitCost} /> },
    { id: "salePrice", accessorKey: "salePrice", meta: { label: t("col.salePrice"), align: "right" }, header: t("col.salePrice"), cell: ({ row }) => <Money value={row.original.salePrice} /> },
    { id: "status", accessorKey: "status", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <BomStatusPill status={row.original.status} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("printDoc", { no: row.original.no })} onClick={() => { setViewId(row.original.id); setTab("mushak") }}><Printer /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    status: STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) })),
    item: Object.entries(labels.item ?? {}).filter(([v]) => q.data?.facets.item?.[v]).map(([value, label]) => ({ value, label })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const f = q.data?.facets.status ?? {}

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { active: fmtNum(f.active ?? 0, locale), draft: fmtNum(f.draft ?? 0, locale), superseded: fmtNum(f.superseded ?? 0, locale) }) : t("subtitle")}
        actions={canEdit ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined}
      />
      <DataTable<BomRow>
        tableId="boms" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0}
        defaultHidden={["uom", "licenseDate", "inputs", "wastageValue", "salePrice"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((k) => <FacetFilter key={k} title={t(`facet.${k}`)} options={facetOpts[k]} selected={state[k]} onChange={(v) => set({ [k]: v } as never)} counts={q.data?.facets[k]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.production.boms.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(d) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{d.no}</span><BomStatusPill status={d.status} /></div>
            <p className="truncate text-sm">{d.itemName}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtDate(d.effectiveDate, locale)}</span><Money value={d.price} /></p>
          </div>
        )}
      />
      {actions.dialog}
      {sheetMounted && <BomSheet id={viewId} initialTab={tab ?? undefined} onOpenChange={(o) => { if (!o) { setViewId(null); setTab(null) } }}
        onEdit={(id) => { setViewId(null); setTab(null); setEditId(id) }} onAmend={(id) => { setViewId(null); setTab(null); setAmendId(id) }} />}
      {formMounted && <BomForm open={formOpen} doc={editId ? editing.data : null} base={amendId ? amending.data : null} itemId={forItem}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null); setAmendId(null); setForItem(null) } }} onSaved={(d) => setViewId(d.id)} />}
    </>
  )
}
