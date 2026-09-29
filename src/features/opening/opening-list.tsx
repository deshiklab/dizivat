"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { BookOpen, CheckCheck, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus, Save, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { DateRangeFilter, FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { EmptyState } from "@/components/common/empty-state"
import { Money, Num } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtCompact, fmtDate, fmtNum } from "@/lib/format"
import { INPUT_TAX_CLASSES } from "@/lib/r2"
import { openingInput } from "@/lib/schemas"
import type { InputTaxClass, OpeningEntry } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { useR2Actions, useR2Refresh } from "@/features/r2/use-r2-actions"

const FACETS = ["process", "branch", "inputTax"] as const
type Facet = (typeof FACETS)[number]
const TAX_TONE = { standard: "info", reduced: "warning", zero: "neutral", exempt: "neutral" } as const
const bookHref = (o: Pick<OpeningEntry, "itemId" | "date">, fg: boolean) => `/vat/mushak-6-${fg ? 2 : 1}?item=${o.itemId}&from=${o.date}`

/** Opening stock entries (legacy "Opening Stock") — list with ?new, ?view=<id>, ?edit=<id>. Approved entries post Item.opening. */
export function OpeningList() {
  const t = useTranslations("opening")
  const tp = useTranslations("process")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const td = useTranslations("docs")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [viewId, setViewId] = useQueryState("view", parseAsString)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["opening", params], queryFn: () => api.opening.list(params), placeholderData: keepPreviousData })
  const editing = useQuery({ queryKey: ["opening", editId], queryFn: () => api.opening.get(editId!), enabled: !!editId })
  const stock = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }) })
  const fg = React.useCallback((id: string) => stock.data?.data.find((i) => i.id === id)?.group === "Finished Goods", [stock.data])
  const actions = useR2Actions("opening")
  const labels = q.data?.facetLabels ?? {}

  const columns = React.useMemo<ColumnDef<OpeningEntry, unknown>[]>(() => [
    { id: "no", accessorKey: "no", meta: { label: t("col.no"), hideable: false }, header: t("col.no"),
      cell: ({ row }) => <button type="button" className="font-medium text-primary hover:underline tabular" onClick={(e) => { e.stopPropagation(); setViewId(row.original.id) }}>{row.original.no}</button> },
    { id: "date", accessorKey: "date", meta: { label: t("col.date") }, header: t("col.date"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtDate(row.original.date, locale)}</span> },
    { id: "name", accessorKey: "name", meta: { label: t("col.item") }, header: t("col.item"),
      cell: ({ row }) => <span className="block max-w-72"><span className="block truncate font-medium">{row.original.name}</span><span className="block text-xs text-muted-foreground tabular">HS {row.original.hsCode} · {row.original.sku}</span></span> },
    { id: "branchName", accessorKey: "branchName", meta: { label: t("col.branch") }, header: t("col.branch") },
    { id: "inputTax", accessorKey: "inputTax", meta: { label: t("col.inputTax") }, header: t("col.inputTax"), cell: ({ row }) => <Pill tone={TAX_TONE[row.original.inputTax]}>{t(`tax.${row.original.inputTax}`)}</Pill> },
    { id: "qty", accessorKey: "qty", meta: { label: t("col.qty"), align: "right" }, header: t("col.qty"), cell: ({ row }) => <span className="whitespace-nowrap"><Num value={row.original.qty} digits={2} /> {row.original.uom}</span> },
    { id: "price", accessorKey: "price", meta: { label: t("col.price"), align: "right" }, header: t("col.price"), cell: ({ row }) => <Money value={row.original.price} /> },
    { id: "value", accessorKey: "value", meta: { label: t("col.value"), align: "right", total: "value" }, header: t("col.value"), cell: ({ row }) => <Money value={row.original.value} className="font-medium" /> },
    { id: "vatPaid", accessorKey: "vatPaid", meta: { label: t("col.vatPaid"), align: "right", total: "vatPaid" }, header: t("col.vatPaid"), cell: ({ row }) => <Money value={row.original.vatPaid} /> },
    { id: "process", accessorKey: "process", meta: { label: t("col.status") }, header: t("col.status"), cell: ({ row }) => <ProcessBadge value={row.original.process} /> },
    {
      id: "_actions", enableHiding: false, meta: { label: tc("actions"), hideable: false, sortable: false }, header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" aria-label={t("viewDoc", { no: row.original.no })} onClick={() => setViewId(row.original.id)}><Eye /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("bookFor", { item: row.original.name })} title={t("book")} render={<Link href={bookHref(row.original, fg(row.original.itemId))} />}><FileSpreadsheet /></Button>
          {row.original.process === "Created" && can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("approveDoc", { no: row.original.no })} title={td("approve")} disabled={actions.busy} onClick={() => actions.approve(row.original)}><CheckCheck /></Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t, can, actions.busy, fg])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    process: (["Created", "Approved", "Cancelled"] as const).map((v) => ({ value: v, label: tp(v) })),
    branch: Object.entries(labels.branch ?? {}).filter(([v]) => q.data?.facets.branch?.[v]).map(([value, label]) => ({ value, label })),
    inputTax: INPUT_TAX_CLASSES.map((v) => ({ value: v, label: t(`tax.${v}`) })),
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...(state.from || state.to ? [{ key: "date", label: `${state.from ? fmtDate(state.from, locale) : "…"} – ${state.to ? fmtDate(state.to, locale) : "…"}`, onRemove: () => set({ from: null, to: null }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]

  return (
    <>
      <PageHeader title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), value: fmtCompact(q.data.totals.value ?? 0, locale), pending: fmtNum(q.data.facets.process?.Created ?? 0, locale) }) : t("subtitle")}
        actions={can("doc.create") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined} />
      <DataTable<OpeningEntry>
        tableId="opening" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0} totals={q.data?.totals}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setViewId(r.id)} filtered={activeCount > 0} defaultHidden={["vatPaid"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            <DateRangeFilter from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.opening.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(o) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium tabular">{o.no}</span><ProcessBadge value={o.process} /></div>
            <p className="truncate text-sm">{o.name}</p>
            <p className="flex justify-between text-sm text-muted-foreground"><span>{fmtNum(o.qty, locale, 2)} {o.uom} · {o.branchName}</span><Money value={o.value} /></p>
          </div>
        )}
      />
      {actions.dialog}
      <OpeningSheet id={viewId} fg={fg} onOpenChange={(o) => { if (!o) setViewId(null) }} onEdit={(id) => { setViewId(null); setEditId(id) }} />
      <OpeningForm open={(isNew && can("doc.create")) || (!!editId && !!editing.data && can("doc.edit"))} doc={editId ? editing.data : null}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} onSaved={(d) => setViewId(d.id)} />
    </>
  )
}

function OpeningSheet({ id, fg, onOpenChange, onEdit }: { id: string | null; fg: (itemId: string) => boolean; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("opening")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState("details")
  React.useEffect(() => { setTab("details") }, [id])
  const { data: o, isLoading, error } = useQuery({ queryKey: ["opening", id], queryFn: () => api.opening.get(id!), enabled: !!id })
  const actions = useR2Actions("opening", { onDeleted: () => onOpenChange(false) })
  const draft = o?.process === "Created"
  const rows: [string, React.ReactNode][] = o ? [
    [t("col.item"), <span key="i">{o.name}<span className="block text-xs text-muted-foreground tabular">HS {o.hsCode} · {o.sku}</span></span>],
    [t("col.branch"), o.branchName], [t("col.date"), fmtDate(o.date, locale)],
    [t("col.inputTax"), <Pill key="t" tone={TAX_TONE[o.inputTax]}>{t(`tax.${o.inputTax}`)}</Pill>],
    [t("col.qty"), <span key="q"><Num value={o.qty} digits={2} /> {o.uom}</span>], [t("col.price"), <Money key="p" value={o.price} />],
    [t("col.value"), <Money key="v" value={o.value} className="font-semibold" />], [t("col.vatPaid"), <Money key="vp" value={o.vatPaid} />],
    [t("field.note"), o.note || "—"], [t("field.issuedBy"), o.issuedBy],
  ] : []
  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{o ? <>{o.no} <ProcessBadge value={o.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{o ? `${o.name} · ${o.branchName}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-48" /></div>
          : error || !o ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="mx-4 mt-3"><TabsTrigger value="details">{t("tabDetails")}</TabsTrigger><TabsTrigger value="history">{t("tabHistory")}</TabsTrigger></TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={o} draftNote={t("draftNote")} />
                <dl className="grid gap-3 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" render={<Link href={bookHref(o, fg(o.itemId))} />}><FileSpreadsheet /> {t("book")}</Button>
                  <Button variant="outline" size="sm" render={<Link href={`/inventory/items?ledger=${o.itemId}`} />}><BookOpen /> {t("ledger")}</Button>
                </div>
                <HistoryCard history={o.history} />
              </TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={o.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {o && draft && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(o.id)}><Pencil /> {td("edit")}</Button>}
          {o && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(o)}><Trash2 /> {td("delete")}</Button>}
          {o && o.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(o)}><XCircle /> {td("cancel")}</Button>}
          {o && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(o)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}

interface FormValues { itemId: string; branchId: string; date: string; inputTax: InputTaxClass; qty: number; price: number; vatPaid: number; note: string; process: "Created" | "Approved" }

function OpeningForm({ open, onOpenChange, doc, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; doc?: OpeningEntry | null; onSaved?: (d: OpeningEntry) => void }) {
  const t = useTranslations("opening")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR2Refresh()
  const stock = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }), enabled: open })
  const branches = stock.data?.branches ?? []
  const main = branches.find((b) => b.category === "factory")?.id ?? branches[0]?.id ?? ""
  const blank = React.useCallback((): FormValues => ({ itemId: "", branchId: main, date: TODAY, inputTax: "standard", qty: undefined as unknown as number, price: undefined as unknown as number, vatPaid: 0, note: "", process: "Created" }), [main])
  const form = useForm<FormValues>({ resolver: zodResolver(openingInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? { itemId: doc.itemId, branchId: doc.branchId, date: doc.date, inputTax: doc.inputTax, qty: doc.qty, price: doc.price, vatPaid: doc.vatPaid, note: doc.note ?? "", process: "Created" } : blank())
  }, [open, doc, reset, blank])
  const w = useWatch({ control })
  const items = (stock.data?.data ?? []).filter((i) => i.active)
  const it = items.find((i) => i.id === w.itemId)
  const value = round2((Number(w.qty) || 0) * (Number(w.price) || 0))
  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.opening.update(doc.id, v) : api.opening.create(v)),
    onSuccess: (d) => { refresh("opening", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const selectField = (name: "branchId" | "inputTax", label: string, opts: { value: string; label: string }[]) => (
    <Field id={name} label={label} required error={errors[name]?.message}>
      {(a) => <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={opts}>
          <SelectTrigger id={a.id} className="w-full" aria-invalid={a["aria-invalid"]} aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      )} />}
    </Field>
  )
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="itemId" label={t("col.item")} required error={errors.itemId?.message} className="sm:col-span-2">
              {(a) => <Controller control={control} name="itemId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value}
                  onChange={(v) => { field.onChange(v); field.onBlur(); const x = items.find((i) => i.id === v); if (x) setValue("price", x.group === "Finished Goods" ? x.costPrice : x.purchasePrice, { shouldValidate: true }) }}
                  options={items.map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${i.hsCode} · ${i.group}`, keywords: [i.sku, i.hsCode] }))}
                  placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={tc("noResults")} />
              )} />}
            </Field>
            {selectField("branchId", t("col.branch"), branches.map((b) => ({ value: b.id, label: b.name })))}
            <Field id="date" label={t("col.date")} required error={errors.date?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("date")} />}</Field>
            {selectField("inputTax", t("col.inputTax"), INPUT_TAX_CLASSES.map((v) => ({ value: v, label: t(`tax.${v}`) })))}
            <Field id="qty" label={it ? `${t("col.qty")} (${it.unit})` : t("col.qty")} required error={errors.qty?.message}>{(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register("qty", { valueAsNumber: true })} />}</Field>
            <Field id="price" label={t("col.price")} required error={errors.price?.message} hint={t("hint.price")}>{(a) => <Input type="number" step="0.01" min={0} className="tabular" {...a} {...register("price", { valueAsNumber: true })} />}</Field>
            <Field id="vatPaid" label={t("col.vatPaid")} error={errors.vatPaid?.message} hint={t("hint.vatPaid")}>{(a) => <Input type="number" step="0.01" min={0} className="tabular" {...a} {...register("vatPaid", { valueAsNumber: true })} />}</Field>
            <p className="self-end rounded-md bg-muted/60 p-3 text-sm sm:col-span-2">{t("col.value")}: <Money value={value} className="font-semibold" />{it && <span className="text-muted-foreground"> · {t("currentOpening", { qty: fmtNum(it.opening, locale, 2), unit: it.unit })}</span>}</p>
            <Field id="note" label={t("field.note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("formNote")}</p>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
