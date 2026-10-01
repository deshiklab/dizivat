"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useFieldArray, useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Globe2, Info, Loader2, Plus, Save, Send, Ship, Trash2, UserPlus, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/page-header"
import { Combobox } from "@/components/common/combobox"
import { Field, useUnsavedGuard } from "@/components/common/field"
import { useConfirm } from "@/components/common/confirm"
import { Money } from "@/components/common/money"
import { useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { saleInput } from "@/lib/schemas"
import { TODAY } from "@/lib/company"
import { useCan, useMe } from "@/components/auth/me-provider"
import { PartySheet } from "@/features/parties/party-sheet"
import type { ExportInfo, Party, Sale, SaleCategory } from "@/lib/types"
import { fmtNum } from "@/lib/format"
import { CUSTOMS_HOUSES } from "@/lib/r2"
import { EXPORT_COUNTRIES } from "@/lib/r3"
import { calcLine, sumLines } from "@/lib/vat"
import { EXPORT_CURRENCIES, exportCompliance, fcToBdt } from "@/lib/rmg"
import { ExportChecklist } from "@/features/vat/export-checklist"

type In = z.input<typeof saleInput>
type Out = z.output<typeof saleInput>
const emptyLine = { itemId: "", qty: undefined as unknown as number, price: undefined as unknown as number, sdRate: 0, vatRate: 15, batchId: "" }
const blankExport = (deemed: boolean, c?: Party): ExportInfo => ({ deemed, lcNo: "", lcDate: "", customsHouse: "", country: deemed ? "" : c?.country ?? "", billNo: "", billDate: "", shippingAddress: deemed ? "" : c?.address ?? "", cnfFirm: "", currency: "USD" })
/** empty number inputs stay undefined (optional FC value / rate) */
const optNum = { setValueAs: (v: unknown) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v)) }

/**
 * New invoice, or edit of a draft when `initial` is given (only drafts are editable — approved invoices are cancelled instead).
 * R3 variants: `category="service"` (service codes, SS- numbers, no stock), exports (foreign customer → LC, customs house,
 * Bill of Export; zero-rated) and deemed exports (local customer against a back-to-back LC). Shows the customer's credit
 * position and the finished-goods lots a line can ship from.
 */
export function SaleForm({ initial, category = "goods", preset }: { initial?: Sale; category?: SaleCategory; preset?: "export" } = {}) {
  const t = useTranslations("sales")
  const trm = useTranslations("rmg")
  const tf = useTranslations("form")
  const tc = useTranslations("common")
  const tpm = useTranslations("method")
  const tv = useTranslations("validation")
  const locale = useLocale()
  const router = useRouter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const me = useMe()
  const can = useCan()
  const canApprove = can("doc.approve")
  const [addingCustomer, setAddingCustomer] = React.useState(false)
  const { data: customers = [] } = useQuery({ queryKey: ["customers", "options"], queryFn: () => api.customers.options() })
  // Stock by branch: a sale can only ship what the chosen branch holds
  const { data: itemsPage } = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }) })
  const branches = itemsPage?.branches ?? []
  const mainBranch = branches.find((b) => b.category === "factory")?.id ?? branches[0]?.id ?? ""
  const products = (itemsPage?.data ?? []).filter((i) => i.group === "Finished Goods" && i.active)
  const service = (initial?.category ?? category) === "service"
  const { data: services = [] } = useQuery({ queryKey: ["saleServices"], queryFn: api.saleServices, enabled: service, staleTime: 10 * 60_000 })
  const listHref = service ? "/sales/services" : preset === "export" || initial?.export ? "/sales/exports" : "/sales"

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(saleInput),
    mode: "onTouched",
    defaultValues: initial ? {
      customerId: initial.customerId, issueDate: initial.issueDate, issueTime: initial.issueTime, deliveryAddress: initial.deliveryAddress, vehicle: initial.vehicle ?? "",
      method: initial.method === "Transaction" ? "Bank" : initial.method, discount: initial.discount, paid: initial.paid, vds: initial.vds, issuedBy: initial.issuedBy, designation: initial.designation,
      narration: initial.narration ?? "", process: "Created", branchId: initial.branchId ?? "", category: initial.category ?? "goods",
      export: initial.export ? { ...initial.export, cnfFirm: initial.export.cnfFirm ?? "" } : undefined,
      lines: initial.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate, batchId: l.batchId ?? "" })),
    } : {
      customerId: "", issueDate: TODAY, issueTime: "10:30", deliveryAddress: "", vehicle: "", method: "Bank",
      discount: 0, paid: 0, vds: false, issuedBy: me.user.name, designation: me.user.designation, narration: "", process: "Created", branchId: "",
      category, export: undefined, lines: [emptyLine],
    },
  })
  const { register, control, handleSubmit, setValue, formState: { errors, isDirty, isSubmitting }, setError, getValues } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  useUnsavedGuard(isDirty && !isSubmitting)

  const w = useWatch({ control })
  const customer = customers.find((c) => c.id === w.customerId)
  const branchId = w.branchId || mainBranch
  const avail = (p: { byBranch: Record<string, number> }) => p.byBranch[branchId] ?? 0
  const foreign = customer?.mode === "Foreign"
  const exp = w.export
  // exports and deemed exports are zero-rated
  const zero = foreign || !!exp
  const calc = (w.lines ?? []).map((l) => calcLine({ qty: Number(l?.qty) || 0, price: Number(l?.price) || 0, sdRate: service ? 0 : Number(l?.sdRate) || 0, vatRate: zero ? 0 : Number(l?.vatRate) || 0 }))
  const totals = sumLines(calc, Number(w.discount) || 0)
  const due = Math.max(0, totals.netTotal - (Number(w.paid) || 0))
  // Credit position of the customer (receivable, overdue, limit) — a soft check, the invoice can still be saved
  const credit = useQuery({ queryKey: ["customers", "credit", w.customerId], queryFn: () => api.customers.get(w.customerId!), enabled: !!w.customerId })
  const limit = credit.data?.creditLimit ?? 0
  const openDue = Math.max(0, (credit.data?.due ?? 0) - (initial?.process === "Approved" ? initial.due : 0))
  const overLimit = limit > 0 ? Math.max(0, openDue + due - limit) : 0
  const setExport = (v: ExportInfo | undefined) => setValue("export", v as never, { shouldDirty: true })
  // R6 (RMG): live NBR zero-rating checklist for the export / deemed export
  // R6.2: deemed exports must fit inside the exporter's UD (when the UD is in the register) — checked live, debounced
  const fitLines = (w.lines ?? []).filter((l) => l?.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l!.itemId!, qty: Number(l!.qty) }))
  const fitKey = JSON.stringify([w.customerId, w.issueDate, exp?.udNo, fitLines])
  const [fitArgs, setFitArgs] = React.useState(fitKey)
  React.useEffect(() => { const h = setTimeout(() => setFitArgs(fitKey), 400); return () => clearTimeout(h) }, [fitKey])
  const fit = useQuery({
    queryKey: ["uds", "fit", initial?.id ?? "new", fitArgs], enabled: !!exp?.deemed && !!exp?.udNo && !!w.customerId && fitLines.length > 0, placeholderData: keepPreviousData,
    queryFn: () => { const [customerId, issueDate, udNo, lines] = JSON.parse(fitArgs); return api.vat.uds.fit({ saleId: initial?.id, customerId, issueDate: issueDate || TODAY, udNo, lines }) },
  })
  const fitData = exp?.deemed && exp?.udNo ? fit.data : null
  const compliance = exp ? exportCompliance({ export: exp as ExportInfo, issueDate: w.issueDate || TODAY }, customer, fitData) : undefined
  const fcBdt = exp ? fcToBdt(exp as ExportInfo) : 0
  // Zero-rating follows the export flag: VAT 0 while exporting, the product's rate otherwise
  const lastZero = React.useRef(zero)
  React.useEffect(() => {
    if (lastZero.current === zero) return
    lastZero.current = zero
    getValues("lines").forEach((l, i) => {
      const rate = zero ? 0 : service ? services.find((x) => x.id === l.itemId)?.vatRate ?? 15 : products.find((p) => p.id === l.itemId)?.vatRate ?? 15
      setValue(`lines.${i}.vatRate`, rate)
    })
    if (zero) setValue("vds", false)
  }, [zero]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill delivery address when the customer *changes* (not when an existing draft loads)
  const lastCustomer = React.useRef(initial?.customerId ?? "")
  React.useEffect(() => {
    if (!customer || customer.id === lastCustomer.current) return
    lastCustomer.current = customer.id
    setValue("deliveryAddress", customer.address, { shouldDirty: true })
    if (customer.mode === "Foreign") getValues("lines").forEach((_, i) => setValue(`lines.${i}.vatRate`, 0))
    if (!service) {
      // foreign customer → export documents; a deemed export stays only for local customers
      if (customer.mode === "Foreign") setExport(blankExport(false, customer))
      else if (getValues("export") && !getValues("export")?.deemed) setExport(undefined)
    }
    // VDS pre-ticked for withholding entities (banks, listed companies …)
    setValue("vds", !!customer.vdsWithholder && customer.mode !== "Foreign" && !getValues("export"))
  }, [customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: (v: Out) => (initial ? api.sales.update(initial.id, v) : api.sales.create(v)),
    onSuccess: (s) => {
      qc.setQueryData(["sale", s.id], s)
      qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["items"] }); qc.invalidateQueries({ queryKey: ["stock"] })
      form.reset(getValues())
      toast.success(t("saved", { no: s.invoiceNo }), { description: s.process === "Approved" ? t("savedApproved") : t("savedDraft") })
      router.push(`/sales/${s.id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: "Created" | "Approved") => {
    if (process === "Approved" && !canApprove) process = "Created"
    setValue("process", process)
    return handleSubmit((v) => create.mutate({ ...v, process }), () => toast.error(t("fixErrors")))()
  }
  const onCancel = async () => {
    if (!isDirty || (await confirm({ title: tf("discardTitle"), description: tf("discardBody"), confirm: tf("discard"), cancel: tf("keepEditing"), destructive: true }))) {
      form.reset(); router.push(initial ? `/sales/${initial.id}` : listHref)
    }
  }
  const err = (path: string) => {
    const parts = path.split(".")
    let e: unknown = errors
    for (const p of parts) e = (e as Record<string, unknown>)?.[p]
    return (e as { message?: string } | undefined)?.message
  }
  const lineErrors = (Array.isArray(errors.lines) ? errors.lines : []).flatMap((le, i) =>
    le ? (["itemId", "qty", "price", "batchId"] as const).map((k) => le[k]?.message).filter((m): m is string => !!m)
      .map((m) => `${tv("lineN", { n: i + 1 })}: ${tv.has(m) ? tv(m) : m}`) : []
  )
  const methodItems = (["Bank", "Cash", "Cheque", "Mobile"] as const).map((v) => ({ value: v, label: tpm(v) }))

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(canApprove ? "Approved" : "Created") } }}>
      <PageHeader
        crumbs={initial ? [{ label: initial.invoiceNo, href: `/sales/${initial.id}` }, { label: tc("edit") }] : [{ label: service ? t("services.new") : preset === "export" ? t("exports.new") : t("new") }]}
        title={initial ? t("editTitle", { no: initial.invoiceNo }) : service ? t("services.newTitle") : preset === "export" ? t("exports.newTitle") : t("newTitle")}
        description={initial ? t("editSub") : service ? t("services.newSub") : preset === "export" ? t("exports.newSub") : t("newSub")}
        actions={<span className="rounded-md border bg-card px-2.5 py-1 text-sm text-muted-foreground">{t("invoiceNo")}: <span className="font-medium text-foreground">{initial?.invoiceNo ?? t("autoNo")}</span></span>}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_19rem] 2xl:grid-cols-[1fr_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>{t("sectionCustomer")}</CardTitle><CardDescription>{t("sectionCustomerHint")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field id="customerId" label={t("field.customer")} required error={err("customerId")} className="md:col-span-2">
                {(a) => (
                  <Controller control={control} name="customerId" render={({ field }) => (
                    <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }}
                      placeholder={t("selectCustomer")} searchPlaceholder={t("searchCustomer")} empty={tc("noResults")}
                      options={(preset === "export" ? [...customers].sort((a, b) => Number(b.mode === "Foreign") - Number(a.mode === "Foreign")) : customers).filter((c) => !service || c.mode !== "Foreign")
                        .map((c) => ({ value: c.id, label: c.name, description: `${c.mode === "Foreign" ? "Export · " : ""}BIN ${c.bin}` }))}
                      footer={can("master.edit") ? <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setAddingCustomer(true)}><UserPlus /> {t("addCustomer")}</Button> : undefined} />
                  )} />
                )}
              </Field>
              {customer && (
                <dl className="grid gap-3 rounded-md bg-muted/60 p-3 text-sm md:col-span-2 md:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">{t("field.bin")}</dt><dd className="tabular">{customer.bin}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t("field.mobile")}</dt><dd className="tabular">{customer.mobile}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{t("field.address")}</dt><dd>{customer.address}</dd></div>
                </dl>
              )}
              {customer && credit.data && (
                <div className="grid gap-2 rounded-md border p-3 text-sm md:col-span-2" data-testid="credit-card">
                  <p className="flex items-center gap-2 font-medium"><Wallet className="size-4 text-muted-foreground" aria-hidden /> {t("credit.title")}</p>
                  <dl className="grid gap-2 sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">{t("credit.receivable")}</dt><dd><Money value={credit.data.due} /></dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("credit.overdue")}</dt><dd className={(credit.data.overdue ?? 0) > 0 ? "font-medium text-warning" : ""}><Money value={credit.data.overdue ?? 0} /></dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("credit.limit")}</dt><dd>{limit > 0 ? <Money value={limit} /> : <span className="text-muted-foreground">{t("credit.noLimit")}</span>}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("credit.available")}</dt><dd>{limit > 0 ? <Money value={Math.max(0, limit - openDue)} /> : "—"}</dd></div>
                  </dl>
                  {overLimit > 0 && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {t("credit.over", { amount: fmtNum(overLimit, locale, 2) })}</p>}
                  {customer.vdsWithholder && !zero && <p className="text-xs text-muted-foreground">{t("credit.vdsWithholder")}</p>}
                </div>
              )}
              {foreign && (
                <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm text-info md:col-span-2"><Globe2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("exportNote")}</p>
              )}
              {customer && !foreign && !service && (
                <div className="flex items-start justify-between gap-3 rounded-md border p-3 md:col-span-2">
                  <div className="grid gap-0.5">
                    <Label htmlFor="deemed">{t("export.deemedToggle")}</Label>
                    <p className="text-xs text-muted-foreground">{t("export.deemedHint")}</p>
                  </div>
                  <Switch id="deemed" checked={!!exp?.deemed} onCheckedChange={(on) => setExport(on ? blankExport(true) : undefined)} />
                </div>
              )}
              <Field id="issueDate" label={t("field.issueDate")} required error={err("issueDate")}>
                {(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}
              </Field>
              <Field id="issueTime" label={t("field.issueTime")} required error={err("issueTime")}>
                {(a) => <Input type="time" {...a} {...register("issueTime")} />}
              </Field>
              <Field id="deliveryAddress" label={t("field.delivery")} error={err("deliveryAddress")} hint={t("deliveryHint")}>
                {(a) => <Textarea rows={2} {...a} {...register("deliveryAddress")} />}
              </Field>
              <Field id="vehicle" label={t("field.vehicle")} error={err("vehicle")} hint={t("vehicleHint")}>
                {(a) => <Input placeholder={t("vehiclePlaceholder")} {...a} {...register("vehicle")} />}
              </Field>
              <Field id="branchId" label={t("field.branch")} error={err("branchId")} hint={t("branchHint")}>
                {(a) => <Controller control={control} name="branchId" render={({ field }) => (
                  <Select value={field.value || mainBranch} onValueChange={(v) => field.onChange(v)} items={branches.map((b) => ({ value: b.id, label: b.name }))}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue /></SelectTrigger>
                    <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
            </CardContent>
          </Card>

          {exp && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Ship className="size-4" aria-hidden /> {exp.deemed ? t("export.deemedTitle") : t("export.title")}</CardTitle><CardDescription>{exp.deemed ? t("export.deemedSub") : t("export.sub")}</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field id="export.lcNo" label={t("export.lcNo")} required error={err("export.lcNo")}>{(a) => <Input {...a} {...register("export.lcNo")} />}</Field>
                <Field id="export.lcDate" label={t("export.lcDate")} required error={err("export.lcDate")}>{(a) => <Input type="date" max={w.issueDate || TODAY} {...a} {...register("export.lcDate")} />}</Field>
                {!exp.deemed && (<>
                  <Field id="export.customsHouse" label={t("export.customsHouse")} required error={err("export.customsHouse")}>
                    {(a) => <Controller control={control} name="export.customsHouse" render={({ field }) => (
                      <Select value={field.value ?? ""} onValueChange={(v) => { field.onChange(v); field.onBlur() }} items={CUSTOMS_HOUSES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}>
                        <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("export.pick")} /></SelectTrigger>
                        <SelectContent>{CUSTOMS_HOUSES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} · {c.name}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />}
                  </Field>
                  <Field id="export.country" label={t("export.country")} required error={err("export.country")}>
                    {(a) => <Controller control={control} name="export.country" render={({ field }) => {
                      const opts = [...new Set([...(customer?.country ? [customer.country] : []), ...EXPORT_COUNTRIES])]
                      return (
                        <Select value={field.value ?? ""} onValueChange={(v) => { field.onChange(v); field.onBlur() }} items={opts.map((c) => ({ value: c, label: c }))}>
                          <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("export.pick")} /></SelectTrigger>
                          <SelectContent>{opts.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      )
                    }} />}
                  </Field>
                  <Field id="export.billNo" label={t("export.billNo")} required error={err("export.billNo")}>{(a) => <Input {...a} {...register("export.billNo")} />}</Field>
                  <Field id="export.billDate" label={t("export.billDate")} required error={err("export.billDate")}>{(a) => <Input type="date" min={w.issueDate} {...a} {...register("export.billDate")} />}</Field>
                  <Field id="export.shippingAddress" label={t("export.shippingAddress")} required error={err("export.shippingAddress")} className="md:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("export.shippingAddress")} />}</Field>
                  <Field id="export.cnfFirm" label={t("export.cnfFirm")} error={err("export.cnfFirm")} className="md:col-span-2">{(a) => <Input {...a} {...register("export.cnfFirm")} />}</Field>
                </>)}
                {exp.deemed ? (<>
                  <Field id="export.udNo" label={trm("udNo")} error={err("export.udNo")} hint={trm("udHint")}>{(a) => <Input {...a} {...register("export.udNo")} />}</Field>
                  <Field id="export.udDate" label={trm("udDate")} error={err("export.udDate")}>{(a) => <Input type="date" max={w.issueDate || TODAY} {...a} {...register("export.udDate")} />}</Field>
                  <Field id="export.exporterBond" label={trm("exporterBond")} error={err("export.exporterBond")} hint={customer?.bondLicenseNo ? trm("bondFromCustomer", { no: customer.bondLicenseNo }) : trm("bondHint")} className="md:col-span-2">
                    {(a) => <Input placeholder={customer?.bondLicenseNo ?? ""} {...a} {...register("export.exporterBond")} />}
                  </Field>
                </>) : (
                  <Field id="export.expNo" label={trm("expNo")} error={err("export.expNo")} hint={trm("expHint")}>{(a) => <Input {...a} {...register("export.expNo")} />}</Field>
                )}
                <div className="grid gap-4 sm:grid-cols-3 md:col-span-2">
                  <Field id="export.currency" label={trm("currency")} error={err("export.currency")}>
                    {(a) => <Controller control={control} name="export.currency" render={({ field }) => (
                      <Select value={field.value ?? ""} onValueChange={(v) => { field.onChange(v); field.onBlur() }} items={EXPORT_CURRENCIES.map((c) => ({ value: c, label: c }))}>
                        <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("export.pick")} /></SelectTrigger>
                        <SelectContent>{EXPORT_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />}
                  </Field>
                  <Field id="export.fcValue" label={trm("fcValue")} error={err("export.fcValue")}>{(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="tabular" {...a} {...register("export.fcValue", optNum)} />}</Field>
                  <Field id="export.exchangeRate" label={trm("exchangeRate")} error={err("export.exchangeRate")} hint={fcBdt ? trm("fcBdt", { amount: fmtNum(fcBdt, locale, 2) }) : undefined}>{(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="tabular" {...a} {...register("export.exchangeRate", optNum)} />}</Field>
                </div>
                {compliance && <ExportChecklist c={compliance} className="md:col-span-2" fit={fitData} names={Object.fromEntries(products.map((p) => [p.id, p.name]))} />}
                {typeof err("export") === "string" && <p role="alert" className="text-sm font-medium text-destructive md:col-span-2">{tv.has(err("export")!) ? tv(err("export")!) : err("export")}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("sectionItems")}</CardTitle>
              <CardDescription>{service ? t("services.itemsHint") : t("sectionItemsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 px-0">
              {typeof errors.lines?.message === "string" && <p className="px-6 text-sm font-medium text-destructive" role="alert">{tv(errors.lines.message)}</p>}
              {lineErrors.length > 0 && (
                <ul className="mx-6 mt-2 space-y-0.5 text-sm font-medium text-destructive" role="alert">
                  {lineErrors.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] table-fixed text-sm">
                  <caption className="sr-only">{t("sectionItems")}</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="w-8 px-3 py-2 font-medium">#</th>
                      <th scope="col" className="px-2 py-2 font-medium">{service ? t("line.service") : t("line.product")} <span className="text-destructive" aria-hidden>*</span></th>
                      <th scope="col" className="w-20 px-2 py-2 text-right font-medium whitespace-nowrap">{t("line.qty")} <span className="text-destructive" aria-hidden>*</span></th>
                      <th scope="col" className="w-24 px-2 py-2 text-right font-medium whitespace-nowrap">{t("line.price")} <span className="text-destructive" aria-hidden>*</span></th>
                      <th scope="col" className="w-16 min-w-[4.5rem] px-2 py-2 text-right font-medium whitespace-nowrap">{t("line.sdPct")}</th>
                      <th scope="col" className="w-16 min-w-[4.5rem] px-2 py-2 text-right font-medium whitespace-nowrap">{t("line.vatPct")}</th>
                      <th scope="col" className="w-28 px-2 py-2 text-right font-medium">{t("line.vat")}</th>
                      <th scope="col" className="w-32 px-2 py-2 text-right font-medium">{t("line.total")}</th>
                      <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{tc("actions")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => {
                      const line = w.lines?.[i]
                      const item = service ? undefined : products.find((p) => p.id === line?.itemId)
                      const over = item && Number(line?.qty) > avail(item)
                      return (
                        <tr key={f.id} className="border-b align-top last:border-0">
                          <td className="px-3 py-2.5 text-muted-foreground tabular">{fmtNum(i + 1, locale)}</td>
                          <td className="px-2 py-1.5">
                            <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                              service ? (
                                <Combobox ariaLabel={`${t("line.service")} ${i + 1}`} value={field.value} invalid={!!err(`lines.${i}.itemId`)} placeholder={t("services.select")} searchPlaceholder={t("services.search")} empty={tc("noResults")}
                                  onChange={(v) => {
                                    field.onChange(v)
                                    const sv = services.find((x) => x.id === v)
                                    if (sv) { setValue(`lines.${i}.vatRate`, zero ? 0 : sv.vatRate); setValue(`lines.${i}.sdRate`, 0) }
                                  }}
                                  options={services.map((x) => ({ value: x.id, label: x.name, description: `${x.code} · ${t("line.vatPct")} ${fmtNum(x.vatRate, locale)} · ${x.unit}`, keywords: [x.code] }))} />
                              ) : (
                              <Combobox ariaLabel={`${t("line.product")} ${i + 1}`} value={field.value} invalid={!!err(`lines.${i}.itemId`)} placeholder={t("selectProduct")} searchPlaceholder={t("searchProduct")} empty={tc("noResults")}
                                onChange={(v) => {
                                  field.onChange(v)
                                  setValue(`lines.${i}.batchId`, "")
                                  const it = products.find((p) => p.id === v)
                                  if (it) { setValue(`lines.${i}.price`, it.salePrice, { shouldValidate: true }); setValue(`lines.${i}.vatRate`, zero ? 0 : it.vatRate); setValue(`lines.${i}.sdRate`, it.sdRate) }
                                }}
                                options={products.map((p) => ({ value: p.id, label: p.name, description: `${p.sku} · HS ${p.hsCode} · ${t("inStock")}: ${fmtNum(avail(p), locale)} ${p.unit}` }))} />
                              )
                            )} />
                            {service && line?.itemId && <p className="mt-1 text-xs text-muted-foreground tabular">{services.find((x) => x.id === line.itemId)?.code} · {t("services.noStock")}</p>}
                            {item && <p className={`mt-1 flex items-center gap-1 text-xs ${over ? "text-warning" : "text-muted-foreground"}`}>{over && <AlertTriangle className="size-3" aria-hidden />}{t("inStock")}: {fmtNum(avail(item), locale)} {item.unit}{over ? ` — ${t("overStock")}` : ""}</p>}
                            {item && <Controller control={control} name={`lines.${i}.batchId`} render={({ field }) => (
                              <LotSelect itemId={item.id} value={field.value ?? ""} onChange={field.onChange} qty={Number(line?.qty) || 0} excludeId={initial?.id} label={t("lot.for", { n: i + 1 })} invalid={!!err(`lines.${i}.batchId`)} />
                            )} />}
                          </td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.qty")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.qty`) || undefined} inputMode="decimal" type="number" step="any" min={0} className="text-right tabular" {...register(`lines.${i}.qty`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.price")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.price`) || undefined} inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" {...register(`lines.${i}.price`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.sdPct")} ${i + 1}`} type="number" step="0.01" min={0} disabled={service} className="text-right tabular" {...register(`lines.${i}.sdRate`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.vatPct")} ${i + 1}`} type="number" step="0.01" min={0} disabled={zero} className="text-right tabular" {...register(`lines.${i}.vatRate`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-2.5 text-right break-all"><Money value={calc[i]?.vat ?? 0} /></td>
                          <td className="px-2 py-2.5 text-right font-medium break-all"><Money value={calc[i]?.total ?? 0} /></td>
                          <td className="px-2 py-1.5">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeLine", { n: i + 1 })} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 /></Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-6">
                <Button type="button" variant="outline" size="sm" onClick={() => append({ ...emptyLine, vatRate: zero ? 0 : 15 })}><Plus /> {t("addLine")}</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("sectionIssuer")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field id="issuedBy" label={t("field.issuedBy")} required error={err("issuedBy")}>{(a) => <Input autoComplete="name" {...a} {...register("issuedBy")} />}</Field>
              <Field id="designation" label={t("field.designation")} required error={err("designation")}>{(a) => <Input autoComplete="organization-title" {...a} {...register("designation")} />}</Field>
              <Field id="narration" label={t("field.narration")} error={err("narration")} className="md:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("narration")} />}</Field>
            </CardContent>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-28 xl:self-start" aria-label={t("summaryTitle")}>
          <Card>
            <CardHeader><CardTitle>{t("summaryTitle")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm" aria-live="polite">
                <dt className="text-muted-foreground">{t("col.subtotal")}</dt><dd className="text-right"><Money value={totals.subtotal} /></dd>
                <dt className="text-muted-foreground">{t("col.sd")}</dt><dd className="text-right"><Money value={totals.sd} /></dd>
                <dt className="text-muted-foreground">{t("col.vat")} {zero && <span className="text-xs">({exp?.deemed ? t("export.zeroDeemed") : t("zeroRatedExport")})</span>}</dt><dd className="text-right"><Money value={totals.vat} /></dd>
                <dt className="text-muted-foreground">{t("gross")}</dt><dd className="text-right"><Money value={totals.gross} /></dd>
              </dl>
              <div className="grid grid-cols-2 gap-3">
                <Field id="discount" label={t("field.discount")} error={err("discount")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("discount", { valueAsNumber: true })} />}</Field>
                <Field id="paid" label={t("field.received")} error={err("paid")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("paid", { valueAsNumber: true })} />}</Field>
              </div>
              <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1 border-t pt-3">
                <dt className="font-semibold">{t("col.netTotal")}</dt><dd className="text-right text-xl font-semibold"><span className="text-sm text-muted-foreground">৳ </span><Money value={totals.netTotal} /></dd>
                <dt className="text-sm text-muted-foreground">{t("col.due")}</dt><dd className="text-right text-sm"><Money value={due} /></dd>
              </dl>
              {overLimit > 0 && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {t("credit.over", { amount: fmtNum(overLimit, locale, 2) })}</p>}
              <Field id="method" label={t("field.method")}>
                {(a) => (
                  <Controller control={control} name="method" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={methodItems}>
                      <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{methodItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                )}
              </Field>
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="vds">{t("field.vds")}</Label>
                  <p className="text-xs text-muted-foreground">{t("vdsHint")}</p>
                </div>
                <Controller control={control} name="vds" render={({ field }) => <Switch id="vds" checked={field.value} onCheckedChange={field.onChange} disabled={zero} />} />
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {canApprove ? t("approveHint") : t("draftOnlyHint")}</p>
              <div className="grid gap-2">
                {canApprove && (
                  <Button type="button" onClick={() => submit("Approved")} disabled={create.isPending}>
                    {create.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t("saveApprove")}
                  </Button>
                )}
                <Button type="submit" variant={canApprove ? "outline" : "default"} disabled={create.isPending}>{!canApprove && create.isPending ? <Loader2 className="animate-spin" /> : <Save />} {initial ? t("saveChanges") : t("saveDraft")}</Button>
                <Button type="button" variant="ghost" onClick={onCancel}>{tc("cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
      <PartySheet kind="customer" open={addingCustomer} onOpenChange={setAddingCustomer}
        onSaved={(c) => { qc.invalidateQueries({ queryKey: ["customers"] }); setValue("customerId", c.id, { shouldDirty: true, shouldValidate: true }) }} />
    </form>
  )
}

/** Optional finished-goods lot (production batch) for a line; FIFO when left on "any lot". The API re-checks on approval. */
function LotSelect({ itemId, value, onChange, qty, excludeId, label, invalid }: { itemId: string; value: string; onChange: (v: string) => void; qty: number; excludeId?: string; label: string; invalid?: boolean }) {
  const t = useTranslations("sales")
  const locale = useLocale()
  const { data: lots = [] } = useQuery({ queryKey: ["lots", itemId, excludeId], queryFn: () => api.production.lots(itemId, excludeId), staleTime: 30_000 })
  if (!lots.length && !value) return null
  const ANY = "_any"
  const items = [{ value: ANY, label: t("lot.any") }, ...lots.map((l) => ({ value: l.batchId, label: t("lot.option", { no: l.batchNo, qty: fmtNum(l.available, locale, 2) }) }))]
  const lot = lots.find((l) => l.batchId === value)
  return (
    <div className="mt-1.5 grid gap-1">
      <Select value={value || ANY} onValueChange={(v) => onChange(!v || v === ANY ? "" : String(v))} items={items}>
        <SelectTrigger aria-label={label} aria-invalid={invalid || undefined} className="w-full text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {lot && qty > lot.available + 1e-9 && <p className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3" aria-hidden /> {t("lot.over", { qty: fmtNum(lot.available, locale, 2) })}</p>}
    </div>
  )
}
