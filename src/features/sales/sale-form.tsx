"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useFieldArray, useForm, useWatch, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Globe2, Info, Loader2, Plus, Save, Send, Trash2, UserPlus } from "lucide-react"
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
import type { Sale } from "@/lib/types"
import { fmtNum } from "@/lib/format"
import { calcLine, sumLines } from "@/lib/vat"

type In = z.input<typeof saleInput>
type Out = z.output<typeof saleInput>
const emptyLine = { itemId: "", qty: undefined as unknown as number, price: undefined as unknown as number, sdRate: 0, vatRate: 15 }

/** New invoice, or edit of a draft when `initial` is given (only drafts are editable — approved invoices are cancelled instead). */
export function SaleForm({ initial }: { initial?: Sale } = {}) {
  const t = useTranslations("sales")
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
  const { data: itemsPage } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.items.list({ size: 500 }) })
  const products = (itemsPage?.data ?? []).filter((i) => i.group === "Finished Goods" && i.active)

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(saleInput),
    mode: "onTouched",
    defaultValues: initial ? {
      customerId: initial.customerId, issueDate: initial.issueDate, issueTime: initial.issueTime, deliveryAddress: initial.deliveryAddress, vehicle: initial.vehicle ?? "",
      method: initial.method === "Transaction" ? "Bank" : initial.method, discount: initial.discount, paid: initial.paid, vds: initial.vds, issuedBy: initial.issuedBy, designation: initial.designation,
      narration: initial.narration ?? "", process: "Created",
      lines: initial.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate })),
    } : {
      customerId: "", issueDate: TODAY, issueTime: "10:30", deliveryAddress: "", vehicle: "", method: "Bank",
      discount: 0, paid: 0, vds: false, issuedBy: me.user.name, designation: me.user.designation, narration: "", process: "Created",
      lines: [emptyLine],
    },
  })
  const { register, control, handleSubmit, setValue, formState: { errors, isDirty, isSubmitting }, setError, getValues } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  useUnsavedGuard(isDirty && !isSubmitting)

  const w = useWatch({ control })
  const customer = customers.find((c) => c.id === w.customerId)
  const foreign = customer?.mode === "Foreign"
  const calc = (w.lines ?? []).map((l) => calcLine({ qty: Number(l?.qty) || 0, price: Number(l?.price) || 0, sdRate: Number(l?.sdRate) || 0, vatRate: foreign ? 0 : Number(l?.vatRate) || 0 }))
  const totals = sumLines(calc, Number(w.discount) || 0)
  const due = Math.max(0, totals.netTotal - (Number(w.paid) || 0))

  // Prefill delivery address when the customer *changes* (not when an existing draft loads)
  const lastCustomer = React.useRef(initial?.customerId ?? "")
  React.useEffect(() => {
    if (!customer || customer.id === lastCustomer.current) return
    lastCustomer.current = customer.id
    setValue("deliveryAddress", customer.address, { shouldDirty: true })
    if (customer.mode === "Foreign") getValues("lines").forEach((_, i) => setValue(`lines.${i}.vatRate`, 0))
  }, [customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = useMutation({
    mutationFn: (v: Out) => (initial ? api.sales.update(initial.id, v) : api.sales.create(v)),
    onSuccess: (s) => {
      qc.setQueryData(["sale", s.id], s)
      qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["items"] })
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
      form.reset(); router.push(initial ? `/sales/${initial.id}` : "/sales")
    }
  }
  const err = (path: string) => {
    const parts = path.split(".")
    let e: unknown = errors
    for (const p of parts) e = (e as Record<string, unknown>)?.[p]
    return (e as { message?: string } | undefined)?.message
  }
  const lineErrors = (Array.isArray(errors.lines) ? errors.lines : []).flatMap((le, i) =>
    le ? (["itemId", "qty", "price"] as const).map((k) => le[k]?.message).filter((m): m is string => !!m)
      .map((m) => `${tv("lineN", { n: i + 1 })}: ${tv.has(m) ? tv(m) : m}`) : []
  )
  const methodItems = (["Bank", "Cash", "Cheque", "Mobile"] as const).map((v) => ({ value: v, label: tpm(v) }))

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(canApprove ? "Approved" : "Created") } }}>
      <PageHeader
        crumbs={initial ? [{ label: initial.invoiceNo, href: `/sales/${initial.id}` }, { label: tc("edit") }] : [{ label: t("new") }]}
        title={initial ? t("editTitle", { no: initial.invoiceNo }) : t("newTitle")}
        description={initial ? t("editSub") : t("newSub")}
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
                      options={customers.map((c) => ({ value: c.id, label: c.name, description: `${c.mode === "Foreign" ? "Export · " : ""}BIN ${c.bin}` }))}
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
              {foreign && (
                <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm text-info md:col-span-2"><Globe2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("exportNote")}</p>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("sectionItems")}</CardTitle>
              <CardDescription>{t("sectionItemsHint")}</CardDescription>
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
                      <th scope="col" className="px-2 py-2 font-medium">{t("line.product")} <span className="text-destructive" aria-hidden>*</span></th>
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
                      const item = products.find((p) => p.id === line?.itemId)
                      const over = item && Number(line?.qty) > item.remain
                      return (
                        <tr key={f.id} className="border-b align-top last:border-0">
                          <td className="px-3 py-2.5 text-muted-foreground tabular">{fmtNum(i + 1, locale)}</td>
                          <td className="px-2 py-1.5">
                            <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                              <Combobox ariaLabel={`${t("line.product")} ${i + 1}`} value={field.value} invalid={!!err(`lines.${i}.itemId`)} placeholder={t("selectProduct")} searchPlaceholder={t("searchProduct")} empty={tc("noResults")}
                                onChange={(v) => {
                                  field.onChange(v)
                                  const it = products.find((p) => p.id === v)
                                  if (it) { setValue(`lines.${i}.price`, it.salePrice, { shouldValidate: true }); setValue(`lines.${i}.vatRate`, foreign ? 0 : it.vatRate); setValue(`lines.${i}.sdRate`, it.sdRate) }
                                }}
                                options={products.map((p) => ({ value: p.id, label: p.name, description: `${p.sku} · HS ${p.hsCode} · ${t("inStock")}: ${fmtNum(p.remain, locale)} ${p.unit}` }))} />
                            )} />
                            {item && <p className={`mt-1 flex items-center gap-1 text-xs ${over ? "text-warning" : "text-muted-foreground"}`}>{over && <AlertTriangle className="size-3" aria-hidden />}{t("inStock")}: {fmtNum(item.remain, locale)} {item.unit}{over ? ` — ${t("overStock")}` : ""}</p>}
                          </td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.qty")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.qty`) || undefined} inputMode="decimal" type="number" step="any" min={0} className="text-right tabular" {...register(`lines.${i}.qty`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.price")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.price`) || undefined} inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" {...register(`lines.${i}.price`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.sdPct")} ${i + 1}`} type="number" step="0.01" min={0} className="text-right tabular" {...register(`lines.${i}.sdRate`, { valueAsNumber: true })} /></td>
                          <td className="px-2 py-1.5"><Input aria-label={`${t("line.vatPct")} ${i + 1}`} type="number" step="0.01" min={0} disabled={foreign} className="text-right tabular" {...register(`lines.${i}.vatRate`, { valueAsNumber: true })} /></td>
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
                <Button type="button" variant="outline" size="sm" onClick={() => append({ ...emptyLine, vatRate: foreign ? 0 : 15 })}><Plus /> {t("addLine")}</Button>
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
                <dt className="text-muted-foreground">{t("col.vat")} {foreign && <span className="text-xs">({t("zeroRatedExport")})</span>}</dt><dd className="text-right"><Money value={totals.vat} /></dd>
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
                <Controller control={control} name="vds" render={({ field }) => <Switch id="vds" checked={field.value} onCheckedChange={field.onChange} disabled={foreign} />} />
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
