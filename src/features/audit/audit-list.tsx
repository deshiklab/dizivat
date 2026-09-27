"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { SavedViews } from "@/components/data-table/saved-views"
import { PageHeader } from "@/components/common/page-header"
import { Pill } from "@/components/common/status-badge"
import { RequirePerm } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format"
import type { AuditEvent } from "@/lib/types"
import { ACTION_ICON, ACTION_TONE, AUDIT_ACTIONS, AUDIT_ENTITIES } from "./audit-meta"
import { AuditSheet } from "./audit-sheet"

const FACETS = ["entity", "action", "actor"] as const

export function AuditPage() {
  return <RequirePerm perm="audit.view" back="/"><AuditInner /></RequirePerm>
}

/** Global, append-only audit trail: every approval, edit, cancellation, master-data change and sign-in. */
function AuditInner() {
  const t = useTranslations("audit")
  const tt = useTranslations("table")
  const locale = useLocale()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 50 })
  const [entityId, setEntityId] = useQueryState("entityId", parseAsString)
  const [openId, setOpenId] = useQueryState("event", parseAsString)
  const p = { ...params, entityId: entityId ?? undefined }
  const q = useQuery({ queryKey: ["audit", p], queryFn: () => api.audit.list(p), placeholderData: keepPreviousData })
  const open = openId ? q.data?.data.find((e) => e.id === openId) ?? null : null

  const columns = React.useMemo<ColumnDef<AuditEvent, unknown>[]>(() => [
    { id: "at", accessorKey: "at", meta: { label: t("col.at"), hideable: false }, header: t("col.at"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDateTime(row.original.at, locale)}</span> },
    { id: "actor", accessorKey: "actor", meta: { label: t("col.actor") }, header: t("col.actor"), cell: ({ row }) => <span className="whitespace-nowrap">{row.original.actor}</span> },
    {
      id: "action", accessorKey: "action", meta: { label: t("col.action") }, header: t("col.action"),
      cell: ({ row }) => <Pill tone={ACTION_TONE[row.original.action] ?? "neutral"} icon={ACTION_ICON[row.original.action]}>{t(`action.${row.original.action}`)}</Pill>,
    },
    { id: "entity", accessorKey: "entity", meta: { label: t("col.entity") }, header: t("col.entity"), cell: ({ row }) => t(`entity.${row.original.entity}`) },
    {
      id: "ref", accessorKey: "ref", meta: { label: t("col.ref"), hideable: false }, header: t("col.ref"),
      cell: ({ row }) => (
        <button type="button" className="max-w-72 truncate text-left font-medium text-primary hover:underline" title={row.original.ref} onClick={(e) => { e.stopPropagation(); setOpenId(row.original.id) }}>{row.original.ref}</button>
      ),
    },
    {
      id: "details", meta: { label: t("col.details"), sortable: false }, header: t("col.details"),
      cell: ({ row }) => {
        const e = row.original
        const text = e.changes?.length ? t("changedFields", { count: e.changes.length, fields: e.changes.map((c) => (t.has(`fields.${c.field}`) ? t(`fields.${c.field}`) : c.field)).slice(0, 3).join(", ") }) : e.note ?? ""
        return <span className="block max-w-80 truncate text-muted-foreground" title={text}>{text || "—"}</span>
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, locale])

  const facetOpts = {
    entity: AUDIT_ENTITIES.map((v) => ({ value: v, label: t(`entity.${v}`) })),
    action: AUDIT_ACTIONS.map((v) => ({ value: v, label: t(`action.${v}`) })),
    actor: Object.keys(q.data?.facets.actor ?? {}).sort().map((v) => ({ value: v, label: v })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(entityId ? [{ key: "entityId", label: t("oneRecord", { ref: q.data?.data[0]?.ref ?? entityId }), onRemove: () => setEntityId(null) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${fmtDate(state.from, locale)} – ${fmtDate(state.to ?? state.from, locale)}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  const clear = () => { clearAll(); setEntityId(null) }

  return (
    <>
      <PageHeader title={t("title")} description={q.data ? t("summary", { count: fmtNum(q.data.total, locale) }) : t("subtitle")} />
      <DataTable<AuditEvent>
        tableId="audit" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} filtered={activeCount > 0 || !!entityId}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            <FacetFilter title={t("facet.entity")} options={facetOpts.entity} selected={state.entity} onChange={(v) => set({ entity: v })} counts={q.data?.facets.entity} />
            <FacetFilter title={t("facet.action")} options={facetOpts.action} selected={state.action} onChange={(v) => set({ action: v })} counts={q.data?.facets.action} />
            <FacetFilter title={t("facet.actor")} options={facetOpts.actor} selected={state.actor} onChange={(v) => set({ actor: v })} counts={q.data?.facets.actor} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clear} />}
        toolbarEnd={
          <>
            <SavedViews tableId="audit" builtIn={[
              { name: t("views.today"), query: `from=${TODAY}&to=${TODAY}` },
              { name: t("views.approvals"), query: "action=approved,cancelled" },
              { name: t("views.masters"), query: "entity=customer,vendor,item,company" },
              { name: t("views.security"), query: "entity=session,user" },
              { name: t("views.failed"), query: "action=signInFailed" },
            ]} />
            <Button variant="outline" size="sm" render={<a href={api.audit.csvUrl(p)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>
          </>
        }
        mobileCard={(e) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{e.ref}</span><Pill tone={ACTION_TONE[e.action] ?? "neutral"}>{t(`action.${e.action}`)}</Pill></div>
            <p className="text-sm text-muted-foreground">{t(`entity.${e.entity}`)} · {e.actor}</p>
            <p className="tabular text-xs text-muted-foreground">{fmtDateTime(e.at, locale)}</p>
          </div>
        )}
        emptyAction={activeCount > 0 || entityId ? <Button variant="outline" size="sm" onClick={clear}>{tt("clearAll")}</Button> : undefined}
      />
      <AuditSheet event={open} onOpenChange={(o) => { if (!o) setOpenId(null) }}
        onRecordHistory={(e) => { setOpenId(null); clearAll(); setEntityId(e.entityId ?? null) }} />
    </>
  )
}
