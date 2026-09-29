"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, Plus, Save, Send, Ship, Trash2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/page-header"
import { Combobox } from "@/components/common/combobox"
import { Field, useUnsavedGuard } from "@/components/common/field"
import { useConfirm } from "@/components/common/confirm"
import { Money } from "@/components/common/money"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { purchaseInput } from "@/lib/schemas"
import { TODAY } from "@/lib/company"
import { useCan, useMe } from "@/components/auth/me-provider"
import { PartySheet } from "@/features/parties/party-sheet"
import type { Purchase } from "@/lib/types"
import { fmtNum } from "@/lib/format"
import { calcLine, round2, sumLines } from "@/lib/vat"

type In = z.input<typeof purchaseInput>
type Out = z.output<typeof purchaseInput>
const emptyLine = { itemId: "", qty: undefined as unknown as number, price: undefined as unknown as number, sdRate: 0, vatRate: 15, rebateable: true, vds: false }

/**
 * New purchase, or edit of a draft when `initial` is given. One template, two variants (R2):
 * goods (stock items, receives into a branch) and service (NBR service codes, no stock movement).
 * Imports have their own duty grid — see ImportForm.
 */
export function PurchaseForm({ initial, category: cat }: { initial?: Purchase; category?: "goods" | "service" } = {}) {
  const category = initial?.category ?? cat ?? "goods"
  const svc = category === "service"
  const listHref = svc ? "/purchases/services" : "/purchases"
  const t = useTranslations("purchases")
  const ts = useTranslations("sales")
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
  const [addingVendor, setAddingVendor] = React.useState(false)
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", "options"], queryFn: () => api.vendors.options() })
  const { data: itemsPage } = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }) })
  const branches = itemsPage?.branches ?? []
  const mainBranch = branches.find((b) => b.category === "factory")?.id ?? branches[0]?.id ?? ""
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => api.services(), enabled: svc, staleTime: 3600_000 })
  const goods = (itemsPage?.data ?? []).filter((i) => i.group !== "Finished Goods" && i.active)
  const buyables: { id: string; name: string; purchasePrice?: number; vatRate: number; vds?: boolean; description: string }[] = svc
    ? services.map((s) => ({ id: s.id, name: s.name, vatRate: s.vatRate, vds: s.vds, description: `${s.code} · ${t("perUnit", { unit: s.unit })}${s.vds ? " · VDS" : ""}` }))
    : goods.map((b) => ({ id: b.id, name: b.name, purchasePrice: b.purchasePrice, vatRate: b.vatRate, description: `${b.sku} · HS ${b.hsCode} · ${b.group}` }))
  const localVendors = vendors.filter((v) => v.mode !== "Foreign")

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(purchaseInput),
    mode: "onTouched",
    defaultValues: initial ? {
      vendorId: initial.vendorId, issueDate: initial.issueDate, challanNo: initial.challanNo, challanDate: initial.challanDate, method: initial.method === "Transaction" ? "Bank" : initial.method,
      discount: initial.discount, paid: initial.paid, issuedBy: initial.issuedBy, designation: initial.designation, narration: initial.narration ?? "", process: "Created", branchId: initial.branchId ?? "", category,
      lines: initial.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate, rebateable: l.rebateable ?? true, vds: l.vds ?? false })),
    } : {
      vendorId: "", issueDate: TODAY, challanNo: "", challanDate: TODAY, method: "Bank", discount: 0, paid: 0,
      issuedBy: me.user.name, designation: me.user.designation, narration: "", process: "Created", branchId: "", lines: [emptyLine], category,
    },
  })
  const { register, control, handleSubmit, setValue, getValues, setError, formState: { errors, isDirty, isSubmitting } } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  useUnsavedGuard(isDirty && !isSubmitting)
  const w = useWatch({ control })
  const vendor = vendors.find((v) => v.id === w.vendorId)
  const nonReg = vendor?.mode === "Non-registered"
  React.useEffect(() => {
    if (nonReg) getValues("lines").forEach((_, i) => { setValue(`lines.${i}.vatRate`, 0); setValue(`lines.${i}.rebateable`, false) })
  }, [nonReg]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = (w.lines ?? []).map((l) => calcLine({ qty: Number(l?.qty) || 0, price: Number(l?.price) || 0, sdRate: Number(l?.sdRate) || 0, vatRate: nonReg ? 0 : Number(l?.vatRate) || 0 }))
  const totals = sumLines(calc, Number(w.discount) || 0)
  const rebate = round2(calc.reduce((a, c, i) => a + (w.lines?.[i]?.rebateable && !nonReg ? c.vat : 0), 0))
  const payable = Math.max(0, totals.netTotal - (Number(w.paid) || 0))

  const create = useMutation({
    mutationFn: (v: Out) => (initial ? api.purchases.update(initial.id, v) : api.purchases.create(v)),
    onSuccess: (p) => {
      qc.setQueryData(["purchase", p.id], p)
      qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["items"] }); qc.invalidateQueries({ queryKey: ["stock"] })
      form.reset(getValues())
      toast.success(t("saved", { no: p.invoiceNo }))
      router.push(`/purchases/${p.id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: "Created" | "Approved") => handleSubmit((v) => create.mutate({ ...v, process: canApprove ? process : "Created" }), () => toast.error(ts("fixErrors")))()
  const onCancel = async () => {
    if (!isDirty || (await confirm({ title: tf("discardTitle"), description: tf("discardBody"), confirm: tf("discard"), cancel: tf("keepEditing"), destructive: true }))) { form.reset(); router.push(initial ? `/purchases/${initial.id}` : listHref) }
  }
  const err = (path: string) => {
    let e: unknown = errors
    for (const p of path.split(".")) e = (e as Record<string, unknown>)?.[p]
    return (e as { message?: string } | undefined)?.message
  }
  const methodItems = (["Bank", "Cash", "Cheque", "Mobile"] as const).map((v) => ({ value: v, label: tpm(v) }))

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); submit("Created") }}>
      <PageHeader crumbs={[...(svc ? [{ label: t("servicesTitle"), href: listHref }] : []), ...(initial ? [{ label: initial.invoiceNo, href: `/purchases/${initial.id}` }, { label: tc("edit") }] : [{ label: t(svc ? "newService" : "new") }])]}
        title={initial ? t("editTitle", { no: initial.invoiceNo }) : t(svc ? "newServiceTitle" : "newTitle")} description={initial ? ts("editSub") : t(svc ? "newServiceSub" : "newSub")}
        actions={<span className="rounded-md border bg-card px-2.5 py-1 text-sm text-muted-foreground">{t("purchaseNo")}: <span className="font-medium text-foreground">{initial?.invoiceNo ?? ts("autoNo")}</span></span>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_19rem] 2xl:grid-cols-[1fr_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>{t("sectionVendor")}</CardTitle><CardDescription>{t("sectionVendorHint")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field id="vendorId" label={t("field.vendor")} required error={err("vendorId")} className="md:col-span-2">
                {(a) => (
                  <Controller control={control} name="vendorId" render={({ field }) => (
                    <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }}
                      placeholder={t("selectVendor")} searchPlaceholder={t("searchVendor")} empty={tc("noResults")}
                      options={localVendors.map((v) => ({ value: v.id, label: v.name, description: `${v.mode === "Non-registered" ? t("nonRegistered") : "BIN"} ${v.bin}` }))}
                      footer={can("master.edit") ? <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setAddingVendor(true)}><UserPlus /> {t("addVendor")}</Button> : undefined} />
                  )} />
                )}
              </Field>
              {vendor && (
                <dl className="grid gap-3 rounded-md bg-muted/60 p-3 text-sm md:col-span-2 md:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">{t("field.bin")}</dt><dd className="tabular">{vendor.bin}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{ts("field.mobile")}</dt><dd className="tabular">{vendor.mobile}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{ts("field.address")}</dt><dd>{vendor.address}</dd></div>
                </dl>
              )}
              {nonReg && <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning md:col-span-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("nonRegNote")}</p>}
              {svc
                ? <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground md:col-span-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("serviceNote")}</p>
                : !initial && <p className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground md:col-span-2"><Ship className="size-4 shrink-0" aria-hidden /> {t("importNote")} <Link href="/purchases/new?type=import" className="font-medium text-primary hover:underline">{t("newImport")}</Link></p>}
              <Field id="challanNo" label={t("field.challanNo")} required error={err("challanNo")} hint={t("challanHint")}>{(a) => <Input {...a} {...register("challanNo")} />}</Field>
              <Field id="challanDate" label={t("field.challanDate")} required error={err("challanDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("challanDate")} />}</Field>
              <Field id="issueDate" label={t("field.receiveDate")} required error={err("issueDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}</Field>
              {!svc && <Field id="branchId" label={t("field.branch")} error={err("branchId")} hint={t("branchHint")}>
                {(a) => <Controller control={control} name="branchId" render={({ field }) => (
                  <Select value={field.value || mainBranch} onValueChange={(v) => field.onChange(v)} items={branches.map((b) => ({ value: b.id, label: b.name }))}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue /></SelectTrigger>
                    <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>}
              <Field id="method" label={ts("field.method")}>
                {(a) => (
                  <Controller control={control} name="method" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={methodItems}>
                      <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{methodItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                )}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{ts("sectionItems")}</CardTitle><CardDescription>{t("sectionItemsHint")}</CardDescription></CardHeader>
            <CardContent className="grid gap-3 px-0">
              {typeof errors.lines?.message === "string" && <p className="px-6 text-sm font-medium text-destructive" role="alert">{tv(errors.lines.message)}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] table-fixed text-sm">
                  <caption className="sr-only">{ts("sectionItems")}</caption>
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-8 px-3 py-2 font-medium">#</th>
                    <th scope="col" className="px-2 py-2 font-medium">{t(svc ? "line.service" : "line.item")} <span className="text-destructive" aria-hidden>*</span></th>
                    <th scope="col" className="w-24 px-2 py-2 text-right font-medium">{ts("line.qty")}</th>
                    <th scope="col" className="w-28 px-2 py-2 text-right font-medium whitespace-nowrap">{t("line.unitPrice")}</th>
                    <th scope="col" className="w-18 px-2 py-2 text-right font-medium">{ts("line.vatPct")}</th>
                    <th scope="col" className="w-28 px-2 py-2 text-right font-medium">{ts("line.vat")}</th>
                    <th scope="col" className="w-20 px-2 py-2 text-center font-medium">{t("line.rebate")}</th>
                    <th scope="col" className="w-16 px-2 py-2 text-center font-medium">VDS</th>
                    <th scope="col" className="w-32 px-2 py-2 text-right font-medium">{ts("line.total")}</th>
                    <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">{tc("actions")}</span></th>
                  </tr></thead>
                  <tbody>
                    {fields.map((f, i) => (
                      <tr key={f.id} className="border-b align-top last:border-0">
                        <td className="px-3 py-2.5 text-muted-foreground tabular">{fmtNum(i + 1, locale)}</td>
                        <td className="px-2 py-1.5">
                          <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                            <Combobox ariaLabel={`${t(svc ? "line.service" : "line.item")} ${i + 1}`} value={field.value} invalid={!!err(`lines.${i}.itemId`)} placeholder={t(svc ? "selectService" : "selectItem")} searchPlaceholder={svc ? t("searchService") : ts("searchProduct")} empty={tc("noResults")}
                              onChange={(v) => { field.onChange(v); const it = buyables.find((b) => b.id === v); if (it) { if (it.purchasePrice !== undefined) setValue(`lines.${i}.price`, it.purchasePrice, { shouldValidate: true }); if (!nonReg) setValue(`lines.${i}.vatRate`, it.vatRate); if (it.vds !== undefined) setValue(`lines.${i}.vds`, it.vds) } }}
                              options={buyables.map((b) => ({ value: b.id, label: b.name, description: b.description }))} />
                          )} />
                        </td>
                        <td className="px-2 py-1.5"><Input aria-label={`${ts("line.qty")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.qty`) || undefined} type="number" step="any" min={0} className="text-right tabular" {...register(`lines.${i}.qty`, { valueAsNumber: true })} /></td>
                        <td className="px-2 py-1.5"><Input aria-label={`${t("line.unitPrice")} ${i + 1}`} aria-invalid={!!err(`lines.${i}.price`) || undefined} type="number" step="0.01" min={0} className="text-right tabular" {...register(`lines.${i}.price`, { valueAsNumber: true })} /></td>
                        <td className="px-2 py-1.5"><Input aria-label={`${ts("line.vatPct")} ${i + 1}`} type="number" step="0.01" min={0} disabled={nonReg} className="text-right tabular" {...register(`lines.${i}.vatRate`, { valueAsNumber: true })} /></td>
                        <td className="px-2 py-2.5 text-right"><Money value={calc[i]?.vat ?? 0} /></td>
                        <td className="px-2 py-2 text-center"><Controller control={control} name={`lines.${i}.rebateable`} render={({ field }) => <Switch aria-label={`${t("line.rebate")} ${i + 1}`} checked={!!field.value} onCheckedChange={field.onChange} disabled={nonReg} />} /></td>
                        <td className="px-2 py-2.5 text-center"><Controller control={control} name={`lines.${i}.vds`} render={({ field }) => <Checkbox aria-label={`VDS ${i + 1}`} checked={!!field.value} onCheckedChange={(v) => field.onChange(!!v)} className="mx-auto" />} /></td>
                        <td className="px-2 py-2.5 text-right font-medium"><Money value={calc[i]?.total ?? 0} /></td>
                        <td className="px-2 py-1.5"><Button type="button" variant="ghost" size="icon-sm" aria-label={ts("removeLine", { n: i + 1 })} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-6"><Button type="button" variant="outline" size="sm" onClick={() => append({ ...emptyLine, vatRate: nonReg ? 0 : 15, rebateable: !nonReg })}><Plus /> {ts("addLine")}</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{ts("sectionIssuer")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field id="issuedBy" label={ts("field.issuedBy")} required error={err("issuedBy")}>{(a) => <Input {...a} {...register("issuedBy")} />}</Field>
              <Field id="designation" label={ts("field.designation")} required error={err("designation")}>{(a) => <Input {...a} {...register("designation")} />}</Field>
              <Field id="narration" label={ts("field.narration")} className="md:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("narration")} />}</Field>
            </CardContent>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-28 xl:self-start" aria-label={ts("summaryTitle")}>
          <Card>
            <CardHeader><CardTitle>{ts("summaryTitle")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm" aria-live="polite">
                <dt className="text-muted-foreground">{t("col.subtotal")}</dt><dd className="text-right"><Money value={totals.subtotal} /></dd>
                <dt className="text-muted-foreground">{t("col.vat")}</dt><dd className="text-right"><Money value={totals.vat} /></dd>
                <dt className="font-medium text-success">{t("col.rebate")}</dt><dd className="text-right font-medium text-success"><Money value={rebate} /></dd>
              </dl>
              <div className="grid grid-cols-2 gap-3">
                <Field id="discount" label={ts("field.discount")} error={err("discount")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("discount", { valueAsNumber: true })} />}</Field>
                <Field id="paid" label={t("col.paid")} error={err("paid")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("paid", { valueAsNumber: true })} />}</Field>
              </div>
              <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1 border-t pt-3">
                <dt className="font-semibold">{t("col.total")}</dt><dd className="text-right text-xl font-semibold"><span className="text-sm text-muted-foreground">৳ </span><Money value={totals.netTotal} /></dd>
                <dt className="text-sm text-muted-foreground">{t("payable")}</dt><dd className="text-right text-sm"><Money value={payable} /></dd>
              </dl>
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("rebateHint")}</p>
              <div className="grid gap-2">
                {canApprove && <Button type="button" onClick={() => submit("Approved")} disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Send />} {ts("saveApprove")}</Button>}
                <Button type="submit" variant={canApprove ? "outline" : "default"} disabled={create.isPending}><Save /> {initial ? ts("saveChanges") : ts("saveDraft")}</Button>
                <Button type="button" variant="ghost" onClick={onCancel}>{tc("cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
      <PartySheet kind="vendor" open={addingVendor} onOpenChange={setAddingVendor}
        onSaved={(v) => { qc.invalidateQueries({ queryKey: ["vendors"] }); setValue("vendorId", v.id, { shouldDirty: true, shouldValidate: true }) }} />
    </form>
  )
}
