"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { parseAsString, useQueryState } from "nuqs"
import { Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Field } from "@/components/common/field"
import { Pill } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { HistorySection } from "@/features/audit/record-history"
import { api, ApiError } from "@/lib/api/client"
import { fmtNum } from "@/lib/format"
import { unitInput } from "@/lib/schemas"
import type { UnitRow } from "@/lib/types"

const FACETS = ["status"] as const
type In = z.input<typeof unitInput>
type Out = z.output<typeof unitInput>
const blank: In = { code: "", name: "", decimals: 2, active: true }

/** Units-of-measure master (S4-04): the list items and documents pick their unit from. */
export function UnitsList() {
  const t = useTranslations("units")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const canEdit = can("master.edit")
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["units", params], queryFn: () => api.units.list(params), placeholderData: keepPreviousData })
  const editing = editId ? q.data?.data.find((u) => u.id === editId) ?? null : null
  const remove = useMutation({
    mutationFn: (u: UnitRow) => api.units.remove(u.id).then(() => u),
    onSuccess: (u) => { qc.invalidateQueries({ queryKey: ["units"] }); toast.success(t("deleted", { code: u.code })) },
    onError: (e) => toast.error(e.message),
  })
  const askDelete = React.useCallback(async (u: UnitRow) => {
    if (await confirm({ title: t("deleteTitle", { code: u.code }), description: t("deleteBody"), confirm: t("delete"), cancel: tc("cancel"), destructive: true })) remove.mutate(u)
  }, [confirm, remove, t, tc])

  const columns = React.useMemo<ColumnDef<UnitRow, unknown>[]>(() => [
    { id: "code", accessorKey: "code", meta: { label: t("col.code"), hideable: false }, header: t("col.code"),
      cell: ({ row }) => canEdit
        ? <button type="button" className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setEditId(row.original.id) }}>{row.original.code}</button>
        : <span className="font-medium">{row.original.code}</span> },
    { id: "name", accessorKey: "name", meta: { label: t("col.name") }, header: t("col.name") },
    { id: "decimals", accessorKey: "decimals", meta: { label: t("col.decimals"), align: "right" }, header: t("col.decimals"), cell: ({ row }) => <span className="tabular">{fmtNum(row.original.decimals, locale)}</span> },
    { id: "inUse", accessorKey: "inUse", meta: { label: t("col.inUse"), align: "right" }, header: t("col.inUse"),
      cell: ({ row }) => row.original.inUse
        ? <Link href={`/inventory/items?unit=${encodeURIComponent(row.original.code)}`} className="tabular text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{t("items", { n: row.original.inUse })}</Link>
        : <span className="text-muted-foreground">—</span> },
    { id: "active", accessorKey: "active", meta: { label: t("col.status") }, header: t("col.status"),
      cell: ({ row }) => <Pill tone={row.original.active ? "success" : "neutral"}>{row.original.active ? t("active") : t("inactive")}</Pill> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => canEdit ? (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("editUnit", { code: row.original.code })} onClick={() => setEditId(row.original.id)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("deleteUnit", { code: row.original.code })} disabled={row.original.inUse > 0 || remove.isPending}
            title={row.original.inUse ? t("inUseNoDelete") : undefined} onClick={() => askDelete(row.original)}><Trash2 /></Button>
        </span>
      ) : null,
    },
  ], [t, tc, locale, canEdit, setEditId, askDelete, remove.isPending])

  const opts = { status: ["active", "inactive"].map((v) => ({ value: v, label: t(v) })) }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...state.status.map((v) => ({ key: `s-${v}`, label: `${t("col.status")}: ${t(v)}`, onRemove: () => set({ status: state.status.filter((x) => x !== v) }) })),
  ]
  return (
    <>
      <PageHeader title={t("title")} description={q.data ? t("summary", { count: fmtNum(q.data.total, locale) }) : t("subtitle")}
        actions={canEdit ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined} />
      <DataTable<UnitRow>
        tableId="units" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={canEdit ? (r) => setEditId(r.id) : undefined} filtered={activeCount > 0}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <FacetFilter title={t("col.status")} options={opts.status} selected={state.status} onChange={(v) => set({ status: v })} counts={q.data?.facets.status} />
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        mobileCard={(u) => (
          <div className="flex items-center justify-between gap-2">
            <span><span className="font-medium">{u.code}</span> <span className="text-muted-foreground">· {u.name}</span></span>
            <Pill tone={u.active ? "success" : "neutral"}>{u.active ? t("active") : t("inactive")}</Pill>
          </div>
        )}
      />
      <UnitSheet open={canEdit && (isNew || !!editing)} unit={editing} onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} />
    </>
  )
}

function UnitSheet({ open, unit, onOpenChange }: { open: boolean; unit: UnitRow | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("units")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(unitInput), defaultValues: blank, mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  React.useEffect(() => { if (open) reset(unit ? { code: unit.code, name: unit.name, decimals: unit.decimals, active: unit.active } : blank) }, [open, unit, reset])
  const locked = !!unit && unit.inUse > 0
  const save = useMutation({
    mutationFn: (v: Out) => (unit ? api.units.update(unit.id, v) : api.units.create(v)),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["units"] }); qc.invalidateQueries({ queryKey: ["audit"] })
      toast.success(unit ? t("updated", { code: u.code }) : t("created", { code: u.code }))
      onOpenChange(false)
    },
    onError: (e) => { if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] })); else toast.error(e.message) },
  })
  const decimals = [0, 1, 2, 3]
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{unit ? t("editTitle") : t("newTitle")}</SheetTitle>
            <SheetDescription>{unit ? `${unit.code} · ${unit.name}` : t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="code" label={t("field.code")} required error={errors.code?.message} hint={locked ? undefined : t("hint.code")}>
              {(a) => <Input autoFocus={!unit} readOnly={locked} maxLength={12} {...a} {...register("code")} />}
            </Field>
            <Field id="decimals" label={t("field.decimals")} required error={errors.decimals?.message} hint={t("hint.decimals")}>
              {(a) => <Controller control={control} name="decimals" render={({ field }) => (
                <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))} items={decimals.map((d) => ({ value: String(d), label: t("dp", { n: d }) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{decimals.map((d) => <SelectItem key={d} value={String(d)}>{t("dp", { n: d })}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            {locked && <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("codeLocked", { n: unit.inUse })}</p>}
            <Field id="name" label={t("field.name")} required error={errors.name?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("name")} />}</Field>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
              <div className="grid gap-0.5">
                <Label htmlFor="active">{t("field.active")}</Label>
                <p className="text-xs text-muted-foreground">{t("hint.active")}</p>
              </div>
              <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
            {unit && <HistorySection entityId={unit.id} className="sm:col-span-2" />}
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {tc("save")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
