"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { parseAsString, useQueryState } from "nuqs"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, Loader2, Pencil, Plus, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DataTable } from "@/components/data-table/data-table"
import { parseAsFlag, useListState } from "@/components/data-table/use-list-state"
import { FacetFilter, FilterChips, SearchInput } from "@/components/data-table/filters"
import { PageHeader } from "@/components/common/page-header"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { HistorySection } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { fmtHs, fmtNum, fmtPct } from "@/lib/format"
import { MASTER_CATEGORIES, PRICE_METHODS, TAX_KEYS } from "@/lib/r2"
import { masterItemInput } from "@/lib/schemas"
import type { ItemGroup, MasterCategory, MasterItemRow, PriceMethod, TaxProfile } from "@/lib/types"
import { cn } from "@/lib/utils"

const FACETS = ["group", "status", "override"] as const
type Facet = (typeof FACETS)[number]
const GROUPS: ItemGroup[] = ["Raw Material", "Consumable", "Packing Materials", "Finished Goods"]

/** Master items (HS-level products with a tax profile). ?new, ?edit=<id>. Rates default from the tariff; overrides are flagged. */
export function MasterItemsList() {
  const t = useTranslations("master")
  const tg = useTranslations("group")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const { state, set, params, clearAll, activeCount } = useListState(FACETS, { size: 25 })
  const [isNew, setNew] = useQueryState("new", parseAsFlag)
  const [editId, setEditId] = useQueryState("edit", parseAsString)
  const q = useQuery({ queryKey: ["masterItems", params], queryFn: () => api.masterItems.list(params), placeholderData: keepPreviousData })

  const columns = React.useMemo<ColumnDef<MasterItemRow, unknown>[]>(() => [
    { id: "hsCode", accessorKey: "hsCode", meta: { label: t("col.hs") }, header: t("col.hs"), cell: ({ row }) => <span className="tabular whitespace-nowrap">{fmtHs(row.original.hsCode)}</span> },
    { id: "name", accessorKey: "name", meta: { label: t("col.name"), hideable: false }, header: t("col.name"),
      cell: ({ row }) => <button type="button" className="text-left font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setEditId(row.original.id) }}>{row.original.name}{!row.original.active && <span className="ml-2 text-xs text-muted-foreground">({t("inactive")})</span>}</button> },
    { id: "group", accessorKey: "group", meta: { label: t("col.group") }, header: t("col.group"), cell: ({ row }) => tg(row.original.group.replace(/ /g, "")) },
    { id: "category", accessorKey: "category", meta: { label: t("col.category") }, header: t("col.category"), cell: ({ row }) => t(`category.${row.original.category}`) },
    { id: "unit", accessorKey: "unit", meta: { label: t("col.unit") }, header: t("col.unit") },
    ...TAX_KEYS.map((k) => ({
      id: k, meta: { label: `${k.toUpperCase()} %`, align: "right", sortable: false }, header: `${k.toUpperCase()} %`,
      cell: ({ row }: { row: { original: MasterItemRow } }) => {
        const o = row.original.overrides.includes(k)
        return <span className={cn("tabular", o && "rounded bg-warning-soft px-1 font-semibold text-warning")} title={o ? t("overrideTitle", { tariff: fmtPct(row.original.tariff?.[k] ?? 0, locale) }) : undefined}>{fmtPct(row.original.rates[k], locale)}</span>
      },
    }) as ColumnDef<MasterItemRow, unknown>),
    { id: "overrides", meta: { label: t("col.override"), sortable: false }, header: t("col.override"),
      cell: ({ row }) => row.original.overrides.length ? <Pill tone="warning"><AlertTriangle className="size-3" aria-hidden /> {row.original.overrides.map((k) => k.toUpperCase()).join(", ")}</Pill> : <span className="text-xs text-muted-foreground">{t("asTariff")}</span> },
    { id: "items", accessorKey: "items", meta: { label: t("col.skus"), align: "right" }, header: t("col.skus"),
      cell: ({ row }) => row.original.items ? <Link href={`/inventory/items?q=${encodeURIComponent(row.original.name)}`} onClick={(e) => e.stopPropagation()} className="tabular hover:underline">{fmtNum(row.original.items, locale)}</Link> : <span className="text-muted-foreground">0</span> },
  ], [t, tg, locale, setEditId])

  const facetOpts: Record<Facet, { value: string; label: string }[]> = {
    group: GROUPS.map((g) => ({ value: g, label: tg(g.replace(/ /g, "")) })),
    status: [{ value: "active", label: t("active") }, { value: "inactive", label: t("inactive") }],
    override: [{ value: "yes", label: t("overridden") }, { value: "no", label: t("asTariff") }],
  }
  const chips = [
    ...(state.q ? [{ key: "q", label: `“${state.q}”`, onRemove: () => set({ q: "" }) }] : []),
    ...FACETS.flatMap((f) => state[f].map((v) => ({ key: `${f}-${v}`, label: `${t(`facet.${f}`)}: ${facetOpts[f].find((o) => o.value === v)?.label ?? v}`, onRemove: () => set({ [f]: state[f].filter((x) => x !== v) } as never) }))),
  ]
  return (
    <>
      <PageHeader title={t("title")}
        description={q.data ? t("summary", { count: fmtNum(q.data.total, locale), overrides: fmtNum(q.data.facets.override?.yes ?? 0, locale) }) : t("subtitle")}
        actions={can("master.edit") ? <Button onClick={() => setNew(true)}><Plus /> {t("new")}</Button> : undefined} />
      <DataTable<MasterItemRow>
        tableId="masterItems" caption={t("title")} columns={columns} data={q.data?.data} total={q.data?.total ?? 0}
        loading={q.isLoading} fetching={q.isFetching} error={q.error} onRetry={() => q.refetch()}
        page={state.page} size={state.size} sort={state.sort}
        onPage={(page) => set({ page }, false)} onSize={(size) => set({ size })} onSort={(sort) => set({ sort })}
        getRowId={(r) => r.id} onRowClick={(r) => setEditId(r.id)} filtered={activeCount > 0} defaultHidden={["category", "rd", "ait", "at"]}
        filters={
          <>
            <SearchInput value={state.q} onChange={(v) => set({ q: v })} placeholder={t("searchPlaceholder")} />
            {FACETS.map((f) => <FacetFilter key={f} title={t(`facet.${f}`)} options={facetOpts[f]} selected={state[f]} onChange={(v) => set({ [f]: v } as never)} counts={q.data?.facets[f]} />)}
          </>
        }
        chips={<FilterChips chips={chips} onClearAll={clearAll} />}
        toolbarEnd={<Button variant="outline" size="sm" render={<a href={api.masterItems.csvUrl(params)} download />}><Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span></Button>}
        mobileCard={(m) => (
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{m.name}</span>{m.overrides.length > 0 && <Pill tone="warning">{t("overridden")}</Pill>}</div>
            <p className="text-sm text-muted-foreground tabular">HS {fmtHs(m.hsCode)} · VAT {fmtPct(m.rates.vat, locale)} · {tc("view")}</p>
          </div>
        )}
      />
      <MasterWizard open={(isNew && can("master.edit")) || !!editId} id={editId} readOnly={!can("master.edit")}
        onOpenChange={(o) => { if (!o) { setNew(null); setEditId(null) } }} />
    </>
  )
}

interface FormValues {
  hsCode: string; name: string; group: ItemGroup; category: MasterCategory; unit: string; priceMethod: PriceMethod; description: string
  rates: TaxProfile; overrideReason: string; active: boolean
}
const STEP_FIELDS: (keyof FormValues | `rates.${keyof TaxProfile}`)[][] = [["hsCode"], ["name", "group", "category", "unit", "priceMethod", "description"], [...TAX_KEYS.map((k) => `rates.${k}` as const), "overrideReason", "active"]]

/** Three-step wizard (D2 §7.2): 1 HS code (tariff search, pre-fills rates) · 2 identity · 3 tax profile (overrides flagged, reason required). */
function MasterWizard({ open, id, readOnly, onOpenChange }: { open: boolean; id: string | null; readOnly: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("master")
  const tg = useTranslations("group")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const [step, setStep] = React.useState(0)
  const existing = useQuery({ queryKey: ["masterItem", id], queryFn: () => api.masterItems.get(id!), enabled: open && !!id })
  const tariff = useQuery({ queryKey: ["tariff", "all"], queryFn: () => api.tariff.list({ size: 500 }), enabled: open, staleTime: 3600_000 })
  const units = useQuery({ queryKey: ["units", "options"], queryFn: () => api.units.options(), enabled: open, staleTime: 60_000 })
  const blank: FormValues = { hsCode: "", name: "", group: "Raw Material", category: "general", unit: "Kg", priceMethod: "average", description: "", rates: { vat: 15, sd: 0, cd: 0, rd: 0, ait: 0, at: 0 }, overrideReason: "", active: true }
  const form = useForm<FormValues>({ resolver: zodResolver(masterItemInput as never) as unknown as Resolver<FormValues>, defaultValues: blank, mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, trigger, formState: { errors } } = form
  const m = existing.data
  React.useEffect(() => {
    if (!open) return
    setStep(id ? 2 : 0)
    if (!id) reset(blank)
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (open && m) reset({ hsCode: m.hsCode, name: m.name, group: m.group, category: m.category, unit: m.unit, priceMethod: m.priceMethod, description: m.description ?? "", rates: m.rates, overrideReason: m.overrideReason ?? "", active: m.active })
  }, [open, m, reset])
  const w = useWatch({ control })
  const line = tariff.data?.data.find((x) => x.hsCode === w.hsCode)
  const ref: TaxProfile | null = line ? { vat: line.vat, sd: line.sd, cd: line.cd, rd: line.rd, ait: line.ait, at: line.at } : null
  const overrides = ref ? TAX_KEYS.filter((k) => Number(w.rates?.[k]) !== ref[k]) : []
  const pickHs = (hs: string) => {
    setValue("hsCode", hs, { shouldValidate: true, shouldDirty: true })
    const l = tariff.data?.data.find((x) => x.hsCode === hs)
    if (l) { setValue("rates", { vat: l.vat, sd: l.sd, cd: l.cd, rd: l.rd, ait: l.ait, at: l.at }); if (!form.getValues("description")) setValue("description", l.description) }
  }
  const save = useMutation({
    mutationFn: (v: FormValues) => (id ? api.masterItems.update(id, v) : api.masterItems.create(v)),
    onSuccess: (r) => {
      for (const k of ["masterItems", "masterItem", "items", "audit"]) qc.invalidateQueries({ queryKey: [k] })
      toast.success(t(id ? "updated" : "created", { name: r.name })); onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) {
        Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
        const first = STEP_FIELDS.findIndex((f) => f.some((x) => Object.keys(e.errors!).includes(x)))
        if (first >= 0) setStep(first)
        return // inline errors only — a toast would cover the sheet footer
      }
      toast.error(e.message)
    },
  })
  const next = async () => { if (await trigger(STEP_FIELDS[step] as never)) setStep((s) => Math.min(2, s + 1)) }
  const steps = [t("step.hs"), t("step.identity"), t("step.tax")]
  const sel = (name: "group" | "category" | "unit" | "priceMethod", label: string, opts: { value: string; label: string }[]) => (
    <Field id={name} label={label} required error={errors[name]?.message}>
      {(a) => <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={opts} disabled={readOnly}>
          <SelectTrigger id={a.id} className="w-full" aria-invalid={a["aria-invalid"]} aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      )} />}
    </Field>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); if (step < 2) void next(); else void handleSubmit((v) => save.mutate(v))() }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{id ? (m ? m.name : t("titleOne")) : t("newTitle")}</SheetTitle>
            <SheetDescription>{id && m ? `HS ${fmtHs(m.hsCode)} · ${t("skuCount", { n: m.items })}` : t("newSub")}</SheetDescription>
            <ol className="mt-2 flex gap-1" aria-label={t("steps")}>
              {steps.map((s, i) => (
                <li key={s} className="flex-1">
                  <button type="button" onClick={() => (id || i < step ? setStep(i) : undefined)} aria-current={step === i ? "step" : undefined}
                    className={cn("flex min-h-11 w-full items-center gap-2 rounded-md border px-2 text-left text-xs", step === i ? "border-primary bg-primary/5 font-semibold text-primary" : "text-muted-foreground")}>
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-[0.6875rem]", i < step && "border-success bg-success text-white")}>{i < step ? <Check className="size-3" aria-hidden /> : fmtNum(i + 1, locale)}</span>{s}
                  </button>
                </li>
              ))}
            </ol>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            {step === 0 && (
              <>
                <Field id="hsCode" label={t("field.hs")} required error={errors.hsCode?.message} hint={t("hint.hs")} className="sm:col-span-2">
                  {(a) => <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={w.hsCode ?? ""} onChange={pickHs}
                    options={(tariff.data?.data ?? []).map((x) => ({ value: x.hsCode, label: `${fmtHs(x.hsCode)} — ${x.description}`, description: `CD ${x.cd}% · SD ${x.sd}% · VAT ${x.vat}% · TTI ${x.tti}%`, keywords: [x.hsCode, x.description] }))}
                    placeholder={t("pickHs")} searchPlaceholder={t("searchHs")} empty={tc("noResults")} />}
                </Field>
                {line && (
                  <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2" role="status">
                    <p><span className="font-medium tabular">{fmtHs(line.hsCode)}</span> — {line.description}</p>
                    <dl className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-7">
                      {[...TAX_KEYS, "tti" as const].map((k) => <div key={k}><dt className="text-muted-foreground">{k.toUpperCase()}</dt><dd className="tabular font-medium">{fmtPct(line[k], locale)}</dd></div>)}
                    </dl>
                    <p className="text-xs text-muted-foreground">{t("prefillNote")}</p>
                  </div>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <Field id="name" label={t("field.name")} required error={errors.name?.message} className="sm:col-span-2">{(a) => <Input disabled={readOnly} {...a} {...register("name")} />}</Field>
                {sel("group", t("col.group"), GROUPS.map((g) => ({ value: g, label: tg(g.replace(/ /g, "")) })))}
                {sel("category", t("col.category"), MASTER_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) })))}
                {sel("unit", t("col.unit"), (units.data ?? []).map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })))}
                {sel("priceMethod", t("field.priceMethod"), PRICE_METHODS.map((p) => ({ value: p, label: t(`priceMethod.${p}`) })))}
                <Field id="description" label={t("field.description")} error={errors.description?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} disabled={readOnly} {...a} {...register("description")} />}</Field>
              </>
            )}
            {step === 2 && (
              <>
                <p className="text-xs text-muted-foreground sm:col-span-2">{ref ? t("taxIntro") : t("noTariff")}</p>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
                  {TAX_KEYS.map((k) => {
                    const o = overrides.includes(k)
                    return (
                      <Field key={k} id={`rates.${k}`} label={`${k.toUpperCase()} %`} error={errors.rates?.[k]?.message} hint={ref ? t("tariffRate", { rate: fmtPct(ref[k], locale) }) : undefined}>
                        {(a) => <Input type="number" step="0.01" min={0} disabled={readOnly} className={cn("text-right tabular", o && "border-warning bg-warning-soft font-semibold")} {...a} {...register(`rates.${k}`, { valueAsNumber: true })} />}
                      </Field>
                    )
                  })}
                </div>
                {overrides.length > 0 && (
                  <>
                    <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning sm:col-span-2">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("overrideWarn", { fields: overrides.map((k) => k.toUpperCase()).join(", ") })}
                    </p>
                    <Field id="overrideReason" label={t("field.overrideReason")} required error={errors.overrideReason?.message} className="sm:col-span-2">
                      {(a) => <Textarea rows={2} disabled={readOnly} {...a} {...register("overrideReason")} />}
                    </Field>
                    {ref && !readOnly && <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setValue("rates", ref, { shouldDirty: true })}>{t("resetToTariff")}</Button>}
                  </>
                )}
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />} />
                  <Label htmlFor="active">{t("field.active")}</Label>
                </div>
                {m && m.skus.length > 0 && (
                  <div className="grid gap-1 text-sm sm:col-span-2">
                    <p className="text-xs font-semibold text-muted-foreground">{t("linkedSkus")}</p>
                    <ul className="grid gap-1">{m.skus.map((s) => <li key={s.id} className="flex justify-between gap-2 rounded border px-2 py-1"><span>{s.name}</span><span className="text-xs text-muted-foreground tabular">{s.sku} · VAT {fmtPct(s.vatRate, locale)}</span></li>)}</ul>
                    {m.skus.some((s) => s.vatRate !== w.rates?.vat) && <p className="text-xs text-warning">{t("skuMismatch")}</p>}
                  </div>
                )}
                {id && <HistorySection entityId={id} className="sm:col-span-2" />}
              </>
            )}
          </div>
          <SheetFooter className="flex-row flex-wrap justify-between gap-2 border-t">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft /> {t("back")}</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc(readOnly ? "close" : "cancel")}</Button>
              {step < 2 ? <Button type="submit">{t("next")} <ChevronRight /></Button>
                : !readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : id ? <Pencil /> : <Save />} {id ? t("saveChanges") : t("create")}</Button>}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
