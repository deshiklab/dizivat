"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, Plus, Save, Send, Ship, Trash2 } from "lucide-react"
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
import { useCan, useMe } from "@/components/auth/me-provider"
import { useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { importInput } from "@/lib/schemas"
import { TODAY } from "@/lib/company"
import { CUSTOMS_HOUSES, ORIGIN_COUNTRIES } from "@/lib/r2"
import type { Purchase } from "@/lib/types"
import { fmtHs, fmtNum } from "@/lib/format"
import { calcImportLine, round2 } from "@/lib/vat"
import { atRateFor, profileOf } from "@/lib/rules"

type In = z.input<typeof importInput>
type Out = z.output<typeof importInput>
const RATE_KEYS = ["cdRate", "rdRate", "sdRate", "vatRate", "aitRate", "atRate"] as const
const RATE_LABEL: Record<(typeof RATE_KEYS)[number], string> = { cdRate: "CD", rdRate: "RD", sdRate: "SD", vatRate: "VAT", aitRate: "AIT", atRate: "AT" }
const blankLine = (usdRate = 122, atRate = 2) => ({ itemId: "", qty: undefined as unknown as number, usd: undefined as unknown as number, usdRate, av: undefined, price: 0, cdRate: 0, rdRate: 0, sdRate: 0, vatRate: 15, aitRate: 5, atRate, rebateable: true, vds: false })

/**
 * Import purchase against a Bill of Entry (legacy "Purchase → Import"). Duty rates pre-fill from the NBR tariff for
 * the item's HS code; AV = USD × rate unless customs re-assessed it. TTI, rebate (VAT + AT) and landed cost are live.
 */
export function ImportForm({ initial }: { initial?: Purchase } = {}) {
  const t = useTranslations("imports")
  const tp = useTranslations("purchases")
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
  const { data: vendors = [] } = useQuery({ queryKey: ["vendors", "options"], queryFn: () => api.vendors.options() })
  const { data: itemsPage } = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }) })
  const branches = itemsPage?.branches ?? []
  const mainBranch = branches.find((b) => b.category === "factory")?.id ?? branches[0]?.id ?? ""
  const buyables = (itemsPage?.data ?? []).filter((i) => i.group !== "Finished Goods" && i.active)
  const foreign = vendors.filter((v) => v.mode === "Foreign")
  // R6: advance tax follows the company's importer class (manufacturer 2 % / commercial importer 7.5 %), not the tariff row
  const { data: vatSettings } = useQuery({ queryKey: ["vat-settings"], queryFn: () => api.vat.settings() })

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(importInput), mode: "onTouched",
    defaultValues: initial ? {
      vendorId: initial.vendorId, issueDate: initial.issueDate, challanNo: initial.challanNo, challanDate: initial.challanDate, method: initial.method,
      discount: initial.discount, paid: initial.paid, issuedBy: initial.issuedBy, designation: initial.designation, narration: initial.narration ?? "", process: "Created", branchId: initial.branchId ?? "", category: "goods",
      boe: { lcNo: initial.boe?.lcNo ?? "", lcDate: initial.boe?.lcDate ?? "", customsHouse: initial.boe?.customsHouse ?? "301", origin: initial.boe?.origin ?? "", cnfFirm: initial.boe?.cnfFirm ?? "", receiveAddress: initial.boe?.receiveAddress ?? "" },
      lines: initial.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, usd: l.duty?.usd ?? 0, usdRate: l.duty?.usdRate ?? 122, av: l.duty && round2(l.duty.usd * l.duty.usdRate) !== l.duty.av ? l.duty.av : undefined, price: 0,
        cdRate: l.duty?.cdRate ?? 0, rdRate: l.duty?.rdRate ?? 0, sdRate: l.sdRate, vatRate: l.vatRate, aitRate: l.duty?.aitRate ?? 0, atRate: l.duty?.atRate ?? 0, rebateable: l.rebateable ?? true, vds: false })),
    } : {
      vendorId: "", issueDate: TODAY, challanNo: "", challanDate: TODAY, method: "Transaction", discount: 0, paid: 0, issuedBy: me.user.name, designation: me.user.designation,
      narration: "", process: "Created", branchId: "", category: "goods",
      boe: { lcNo: "", lcDate: "", customsHouse: "301", origin: "", cnfFirm: "", receiveAddress: "" }, lines: [blankLine()],
    },
  })
  const { register, control, handleSubmit, setValue, getValues, setError, formState: { errors, isDirty, isSubmitting } } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  useUnsavedGuard(isDirty && !isSubmitting)
  const w = useWatch({ control })
  const vendor = vendors.find((v) => v.id === w.vendorId)
  const [tariffNote, setTariffNote] = React.useState<Record<number, string>>({})
  const atRate = atRateFor(profileOf(vatSettings), w.issueDate || TODAY)

  const calc = (w.lines ?? []).map((l) => calcImportLine({
    qty: Number(l?.qty) || 0, usd: Number(l?.usd) || 0, usdRate: Number(l?.usdRate) || 0, av: Number(l?.av) || undefined,
    cdRate: Number(l?.cdRate) || 0, rdRate: Number(l?.rdRate) || 0, sdRate: Number(l?.sdRate) || 0, vatRate: Number(l?.vatRate) || 0, aitRate: Number(l?.aitRate) || 0, atRate: Number(l?.atRate) || 0,
  }, !!l?.rebateable))
  const sum = (k: keyof (typeof calc)[number]) => round2(calc.reduce((a, c) => a + (c[k] as number), 0))
  const tot = { av: sum("av"), cd: sum("cd"), rd: sum("rd"), sd: sum("sd"), vat: sum("vat"), ait: sum("ait"), at: sum("at"), tti: sum("tti"), total: sum("total"), rebate: sum("rebate") }
  const net = round2(tot.total - (Number(w.discount) || 0))
  const payable = Math.max(0, round2(net - (Number(w.paid) || 0)))

  const pickItem = async (i: number, id: string) => {
    const it = buyables.find((b) => b.id === id)
    if (!it) return
    try {
      const tl = await qc.fetchQuery({ queryKey: ["tariff", "hs", it.hsCode], queryFn: () => api.tariff.lookup(it.hsCode), staleTime: 3600_000 })
      const r = { cdRate: tl.cd, rdRate: tl.rd, sdRate: tl.sd, vatRate: tl.vat, aitRate: tl.ait, atRate: tl.at > 0 ? atRate : 0 }
      for (const k of RATE_KEYS) setValue(`lines.${i}.${k}`, r[k], { shouldDirty: true })
      setTariffNote((n) => ({ ...n, [i]: t("fromTariff", { hs: fmtHs(it.hsCode), tti: fmtNum(tl.tti, locale) }) }))
    } catch {
      setValue(`lines.${i}.vatRate`, it.vatRate)
      setTariffNote((n) => ({ ...n, [i]: t("notInTariff", { hs: fmtHs(it.hsCode) }) }))
    }
  }

  const save = useMutation({
    mutationFn: (v: Out) => (initial ? api.purchases.update(initial.id, v) : api.purchases.create(v)),
    onSuccess: (p) => {
      qc.setQueryData(["purchase", p.id], p)
      for (const k of ["purchases", "dashboard", "notifications", "items", "stock"]) qc.invalidateQueries({ queryKey: [k] })
      form.reset(getValues())
      toast.success(tp("saved", { no: p.invoiceNo }))
      router.push(`/purchases/${p.id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: "Created" | "Approved") => handleSubmit((v) => save.mutate({ ...v, process: canApprove ? process : "Created", lines: v.lines.map((l) => ({ ...l, av: l.av || undefined })) }), () => toast.error(ts("fixErrors")))()
  const onCancel = async () => {
    if (!isDirty || (await confirm({ title: tf("discardTitle"), description: tf("discardBody"), confirm: tf("discard"), cancel: tf("keepEditing"), destructive: true }))) { form.reset(); router.push(initial ? `/purchases/${initial.id}` : "/purchases") }
  }
  const err = (path: string) => {
    let e: unknown = errors
    for (const p of path.split(".")) e = (e as Record<string, unknown>)?.[p]
    return (e as { message?: string } | undefined)?.message
  }
  const methodItems = (["Transaction", "Bank", "Cheque"] as const).map((v) => ({ value: v, label: tpm(v) }))
  const chItems = CUSTOMS_HOUSES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))
  const originItems = ORIGIN_COUNTRIES.map((c) => ({ value: c, label: c }))
  const sel = (name: "boe.customsHouse" | "boe.origin" | "method" | "branchId", label: string, items: { value: string; label: string }[], opts: { required?: boolean; fallback?: string } = {}) => (
    <Field id={name} label={label} required={opts.required} error={err(name)}>
      {(a) => <Controller control={control} name={name} render={({ field }) => (
        <Select value={(field.value as string) || opts.fallback || ""} onValueChange={(v) => { field.onChange(v); field.onBlur() }} items={items}>
          <SelectTrigger id={a.id} className="w-full min-w-0 *:data-[slot=select-value]:truncate" aria-invalid={a["aria-invalid"]} aria-describedby={a["aria-describedby"]}><SelectValue placeholder={t("select")} /></SelectTrigger>
          <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      )} />}
    </Field>
  )

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); submit("Created") }}>
      <PageHeader crumbs={initial ? [{ label: initial.invoiceNo, href: `/purchases/${initial.id}` }, { label: tc("edit") }] : [{ label: t("new") }]}
        title={initial ? tp("editTitle", { no: initial.invoiceNo }) : t("newTitle")} description={t("newSub")}
        actions={<span className="rounded-md border bg-card px-2.5 py-1 text-sm text-muted-foreground">{tp("purchaseNo")}: <span className="font-medium text-foreground">{initial?.invoiceNo ?? ts("autoNo")}</span></span>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_19rem] 2xl:grid-cols-[1fr_22rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Ship className="size-4" aria-hidden /> {t("sectionBoe")}</CardTitle><CardDescription>{t("sectionBoeHint")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field id="vendorId" label={tp("field.vendor")} required error={err("vendorId")} className="md:col-span-2 lg:col-span-3">
                {(a) => <Controller control={control} name="vendorId" render={({ field }) => (
                  <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={a["aria-invalid"]} value={field.value}
                    onChange={(v) => { field.onChange(v); field.onBlur(); const c = foreign.find((x) => x.id === v)?.country; if (c && !getValues("boe.origin")) setValue("boe.origin", c, { shouldValidate: true }) }}
                    placeholder={t("selectVendor")} searchPlaceholder={tp("searchVendor")} empty={tc("noResults")}
                    options={foreign.map((v) => ({ value: v.id, label: v.name, description: v.country ?? "" }))} />
                )} />}
              </Field>
              {vendor && <p className="text-sm text-muted-foreground md:col-span-2 lg:col-span-3">{vendor.address}{vendor.country ? ` · ${vendor.country}` : ""}</p>}
              <Field id="challanNo" label={t("field.boeNo")} required error={err("challanNo")}>{(a) => <Input {...a} {...register("challanNo")} />}</Field>
              <Field id="challanDate" label={t("field.boeDate")} required error={err("challanDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("challanDate")} />}</Field>
              <Field id="issueDate" label={tp("field.receiveDate")} required error={err("issueDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}</Field>
              <Field id="boe.lcNo" label={t("field.lcNo")} required error={err("boe.lcNo")}>{(a) => <Input {...a} {...register("boe.lcNo")} />}</Field>
              <Field id="boe.lcDate" label={t("field.lcDate")} required error={err("boe.lcDate")} hint={t("hint.lcDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("boe.lcDate")} />}</Field>
              {sel("boe.customsHouse", t("field.customsHouse"), chItems, { required: true })}
              {sel("boe.origin", t("field.origin"), originItems, { required: true })}
              <Field id="boe.cnfFirm" label={t("field.cnfFirm")} error={err("boe.cnfFirm")}>{(a) => <Input {...a} {...register("boe.cnfFirm")} />}</Field>
              {sel("branchId", tp("field.branch"), branches.map((b) => ({ value: b.id, label: b.name })), { fallback: mainBranch })}
              {sel("method", ts("field.method"), methodItems)}
              <Field id="boe.receiveAddress" label={t("field.receiveAddress")} error={err("boe.receiveAddress")} className="md:col-span-2">{(a) => <Input {...a} {...register("boe.receiveAddress")} />}</Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("sectionDuty")}</CardTitle><CardDescription>{t("sectionDutyHint")}</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              {typeof errors.lines?.message === "string" && <p className="text-sm font-medium text-destructive" role="alert">{tv(errors.lines.message)}</p>}
              {fields.map((f, i) => {
                const c = calc[i]
                return (
                  <fieldset key={f.id} className="grid gap-3 rounded-lg border p-3">
                    <legend className="px-1 text-xs font-semibold text-muted-foreground">{t("line", { n: fmtNum(i + 1, locale) })}</legend>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_auto]">
                      <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
                        <Label className="text-xs">{tp("line.item")} <span className="text-destructive" aria-hidden>*</span></Label>
                        <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                          <Combobox ariaLabel={`${tp("line.item")} ${i + 1}`} value={field.value} invalid={!!err(`lines.${i}.itemId`)} placeholder={tp("selectItem")} searchPlaceholder={ts("searchProduct")} empty={tc("noResults")}
                            onChange={(v) => { field.onChange(v); void pickItem(i, v) }}
                            options={buyables.map((b) => ({ value: b.id, label: b.name, description: `${b.sku} · HS ${fmtHs(b.hsCode)} · ${b.unit}`, keywords: [b.sku, b.hsCode] }))} />
                        )} />
                        {tariffNote[i] && <p className="text-xs text-muted-foreground">{tariffNote[i]}</p>}
                      </div>
                      {([["qty", t("col.qty"), "any"], ["usd", t("col.usd"), "0.01"], ["usdRate", t("col.usdRate"), "0.0001"]] as const).map(([k, l, step]) => (
                        <div key={k} className="grid content-start gap-1.5">
                          <Label htmlFor={`l${i}-${k}`} className="text-xs">{l} <span className="text-destructive" aria-hidden>*</span></Label>
                          <Input id={`l${i}-${k}`} type="number" step={step} min={0} className="text-right tabular" aria-invalid={!!err(`lines.${i}.${k}`) || undefined} {...register(`lines.${i}.${k}`, { valueAsNumber: true })} />
                        </div>
                      ))}
                      <div className="grid content-start gap-1.5">
                        <Label htmlFor={`l${i}-av`} className="text-xs">{t("col.avOverride")}</Label>
                        <Input id={`l${i}-av`} type="number" step="0.01" min={0} className="text-right tabular" placeholder={Number(w.lines?.[i]?.usd) > 0 ? fmtNum(round2(Number(w.lines?.[i]?.usd) * (Number(w.lines?.[i]?.usdRate) || 0)), locale, 2) : t("auto")} {...register(`lines.${i}.av`, { setValueAs: (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v)) })} />
                      </div>
                      <div className="flex items-end"><Button type="button" variant="ghost" size="icon" aria-label={ts("removeLine", { n: i + 1 })} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 /></Button></div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {RATE_KEYS.map((k) => (
                        <div key={k} className="grid gap-1">
                          <Label htmlFor={`l${i}-${k}`} className="text-xs">{RATE_LABEL[k]} %</Label>
                          <Input id={`l${i}-${k}`} type="number" step="0.01" min={0} className="h-9 text-right tabular" aria-invalid={!!err(`lines.${i}.${k}`) || undefined} {...register(`lines.${i}.${k}`, { valueAsNumber: true })} />
                        </div>
                      ))}
                    </div>
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-1 rounded-md bg-muted/50 p-2 text-xs sm:grid-cols-5 lg:grid-cols-10" aria-live="polite">
                      {([["AV", c?.av], ["CD", c?.cd], ["RD", c?.rd], ["SD", c?.sd], ["VAT", c?.vat], ["AIT", c?.ait], ["AT", c?.at], ["TTI", c?.tti], [t("col.rebate"), c?.rebate], [t("col.total"), c?.total]] as const).map(([l, v], j) => (
                        <div key={j} className={j >= 7 ? "font-semibold" : undefined}><dt className="text-muted-foreground">{l}</dt><dd className="text-right tabular"><Money value={v ?? 0} /></dd></div>
                      ))}
                    </dl>
                    <div className="flex items-center gap-2">
                      <Controller control={control} name={`lines.${i}.rebateable`} render={({ field }) => <Switch id={`l${i}-reb`} checked={!!field.value} onCheckedChange={field.onChange} />} />
                      <Label htmlFor={`l${i}-reb`} className="text-xs">{t("rebateable")}</Label>
                      {c && c.av > 0 && Number(w.lines?.[i]?.qty) > 0 && <span className="ml-auto text-xs text-muted-foreground tabular">{t("unitLanded", { v: fmtNum(round2(c.total / Number(w.lines?.[i]?.qty)), locale, 2) })}</span>}
                    </div>
                  </fieldset>
                )
              })}
              <div><Button type="button" variant="outline" size="sm" onClick={() => append(blankLine(Number(getValues("lines.0.usdRate")) || 122, atRate))}><Plus /> {ts("addLine")}</Button></div>
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
            <CardHeader><CardTitle>{t("summaryTitle")}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm" aria-live="polite">
                <dt className="text-muted-foreground">{t("sum.av")}</dt><dd className="text-right"><Money value={tot.av} /></dd>
                {(["cd", "rd", "sd", "vat", "ait", "at"] as const).map((k) => <React.Fragment key={k}><dt className="text-muted-foreground">{k.toUpperCase()}</dt><dd className="text-right"><Money value={tot[k]} /></dd></React.Fragment>)}
                <dt className="border-t pt-1.5 font-medium">{t("sum.tti")}</dt><dd className="border-t pt-1.5 text-right font-medium"><Money value={tot.tti} /></dd>
                <dt className="font-medium text-success">{t("sum.rebate")}</dt><dd className="text-right font-medium text-success"><Money value={tot.rebate} /></dd>
              </dl>
              <div className="grid grid-cols-2 gap-3">
                <Field id="discount" label={ts("field.discount")} error={err("discount")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("discount", { valueAsNumber: true })} />}</Field>
                <Field id="paid" label={tp("col.paid")} error={err("paid")}>{(a) => <Input type="number" step="0.01" min={0} className="text-right tabular" {...a} {...register("paid", { valueAsNumber: true })} />}</Field>
              </div>
              <dl className="grid grid-cols-[1fr_auto] items-baseline gap-y-1 border-t pt-3">
                <dt className="font-semibold">{t("sum.landed")}</dt><dd className="text-right text-xl font-semibold"><span className="text-sm text-muted-foreground">৳ </span><Money value={net} /></dd>
                <dt className="text-sm text-muted-foreground">{tp("payable")}</dt><dd className="text-right text-sm"><Money value={payable} /></dd>
              </dl>
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("rebateHint")}</p>
              <div className="grid gap-2">
                {canApprove && <Button type="button" onClick={() => submit("Approved")} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Send />} {ts("saveApprove")}</Button>}
                <Button type="submit" variant={canApprove ? "outline" : "default"} disabled={save.isPending}><Save /> {initial ? ts("saveChanges") : ts("saveDraft")}</Button>
                <Button type="button" variant="ghost" onClick={onCancel}>{tc("cancel")}</Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </form>
  )
}
