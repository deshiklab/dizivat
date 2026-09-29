"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCheck, History, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtMoney, fmtNum } from "@/lib/format"
import { COST_HEADS } from "@/lib/r3"
import { bomInput } from "@/lib/schemas"
import { calcBom } from "@/lib/vat"
import type { BomRow, CostHead } from "@/lib/types"
import { useR3Refresh } from "@/features/r3/use-r3-actions"

interface FormValues {
  itemId: string; effectiveDate: string; licenseDate: string; amendmentReason: string; note: string; process: "Created" | "Approved"
  inputs: { itemId: string; qty: number; wastagePct: number; price: number }[]
  costs: { head: CostHead; amount: number }[]
}
const blankCosts = () => COST_HEADS.map((head) => ({ head, amount: 0 }))

/**
 * New / edit-draft / amend (new version) form for a price declaration. Coefficients and the declared price are
 * recalculated live with the same `calcBom` the API uses.
 */
export function BomForm({ open, onOpenChange, doc, base, itemId, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void
  /** draft being edited */ doc?: BomRow | null
  /** approved version being amended (its figures pre-fill a new version) */ base?: BomRow | null
  itemId?: string | null
  onSaved?: (b: BomRow) => void
}) {
  const t = useTranslations("bom")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR3Refresh()
  const items = useQuery({ queryKey: ["items", "all"], queryFn: () => api.items.list({ size: 500 }), enabled: open })
  const all = items.data?.data ?? []
  const byId = (id?: string) => all.find((i) => i.id === id)

  const resolver = zodResolver(bomInput as never) as unknown as Resolver<FormValues>
  const blank = React.useCallback((): FormValues => ({
    itemId: itemId ?? "", effectiveDate: TODAY, licenseDate: "", amendmentReason: "", note: "", process: "Created",
    inputs: [{ itemId: "", qty: 0, wastagePct: 0, price: 0 }], costs: blankCosts(),
  }), [itemId])
  const form = useForm<FormValues>({ resolver, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const inputs = useFieldArray({ control, name: "inputs" })
  React.useEffect(() => {
    if (!open) return
    const src = doc ?? base
    if (src) {
      reset({
        itemId: src.itemId, effectiveDate: doc ? doc.effectiveDate : TODAY, licenseDate: doc?.licenseDate ?? "", amendmentReason: doc?.amendmentReason ?? "", note: doc?.note ?? "", process: "Created",
        inputs: src.inputs.map((i) => ({ itemId: i.itemId, qty: i.qty, wastagePct: i.wastagePct, price: i.price })),
        costs: COST_HEADS.map((head) => ({ head, amount: src.costs.find((c) => c.head === head)?.amount ?? 0 })),
      })
    } else reset(blank())
  }, [open, doc, base, reset, blank])

  const w = useWatch({ control })
  const product = byId(w.itemId)
  // existing versions of the chosen item decide whether this is an amendment
  const versions = useQuery({ queryKey: ["boms", { item: w.itemId }], queryFn: () => api.production.boms.list({ item: w.itemId, size: 50 }), enabled: open && !!w.itemId })
  const others = (versions.data?.data ?? []).filter((v) => v.id !== doc?.id)
  const active = others.find((v) => v.status === "active")
  const otherDraft = others.find((v) => v.process === "Created")
  const isAmendment = !!doc ? doc.version > 1 : others.some((v) => v.process === "Approved")
  const calc = calcBom((w.inputs ?? []).map((i) => ({ qty: Number(i?.qty) || 0, wastagePct: Number(i?.wastagePct) || 0, price: Number(i?.price) || 0 })), (w.costs ?? []).map((c) => ({ head: c?.head ?? "other", amount: Number(c?.amount) || 0 })))
  const chosen = new Set((w.inputs ?? []).map((l) => l?.itemId).filter(Boolean))
  const fgOptions = all.filter((i) => i.group === "Finished Goods" && i.active).map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${i.hsCode} · ${i.unit}`, keywords: [i.sku, i.hsCode] }))
  const inputOptions = all.filter((i) => i.group !== "Finished Goods" && i.active).map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · ${i.group} · ${fmtMoney(i.costPrice || i.purchasePrice, locale)}/${i.unit}`, keywords: [i.sku, i.hsCode] }))

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { ...v, costs: v.costs.filter((c) => c.amount > 0) }
      return doc ? api.production.boms.update(doc.id, body) : api.production.boms.create(body)
    },
    onSuccess: (d) => {
      refresh("bom", d)
      toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no }))
      onSaved?.(d)
      onOpenChange(false)
    },
    onError: (e) => {
      // field errors show inline — a toast would cover the sheet footer
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const title = doc ? t("editTitle", { no: doc.no }) : base ? t("amendTitle", { no: base.no }) : t("newTitle")

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="itemId" label={t("field.item")} required error={errors.itemId?.message} className="sm:col-span-2"
              hint={product ? t("itemHint", { unit: product.unit, price: fmtMoney(product.salePrice, locale) }) : undefined}>
              {(a) => <Controller control={control} name="itemId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={field.onChange} disabled={!!doc || !!base}
                  options={fgOptions} placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={t("noItems")} />
              )} />}
            </Field>
            {(active || otherDraft) && !doc && (
              <p role="status" className={`flex items-start gap-2 rounded-md p-3 text-xs sm:col-span-2 ${otherDraft ? "bg-warning-soft" : "bg-info-soft"}`}>
                {otherDraft ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> : <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                {otherDraft ? t("draftExists", { no: otherDraft.no }) : t("amendNote", { no: active!.no, price: fmtMoney(active!.price, locale) })}
              </p>
            )}
            <Field id="effectiveDate" label={t("field.effectiveDate")} required error={errors.effectiveDate?.message} hint={t("hint.effectiveDate")}>{(a) => <Input type="date" {...a} {...register("effectiveDate")} />}</Field>
            <Field id="licenseDate" label={t("field.licenseDate")} error={errors.licenseDate?.message} hint={t("hint.licenseDate")}>{(a) => <Input type="date" max={TODAY} {...a} {...register("licenseDate")} />}</Field>
            {isAmendment && (
              <Field id="amendmentReason" label={t("field.amendmentReason")} required error={errors.amendmentReason?.message} className="sm:col-span-2">
                {(a) => <Textarea rows={2} placeholder={t("hint.amendmentReason")} {...a} {...register("amendmentReason")} />}
              </Field>
            )}

            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("inputsTitle", { uom: product?.unit ?? t("unit") })}</legend>
              {inputs.fields.map((f, i) => {
                const l = w.inputs?.[i]
                const it = byId(l?.itemId)
                const c = calc.lines[i]
                const err = errors.inputs?.[i]
                return (
                  <div key={f.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_7rem_6rem_7rem_auto] sm:items-start">
                    <Field id={`inputs.${i}.itemId`} label={t("field.inputN", { n: i + 1 })} required error={err?.itemId?.message}>
                      {(a) => <Controller control={control} name={`inputs.${i}.itemId`} render={({ field }) => (
                        <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value}
                          onChange={(v) => { field.onChange(v); const x = byId(v); if (x && !(Number(l?.price) > 0)) setValue(`inputs.${i}.price`, x.costPrice || x.purchasePrice) }}
                          options={inputOptions.map((o) => ({ ...o, disabled: chosen.has(o.value) && o.value !== field.value }))}
                          placeholder={t("pickInput")} searchPlaceholder={t("searchItem")} empty={t("noItems")} />
                      )} />}
                    </Field>
                    <Field id={`inputs.${i}.qty`} label={it ? `${t("field.qty")} (${it.unit})` : t("field.qty")} required error={err?.qty?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`inputs.${i}.qty`, { valueAsNumber: true })} />}
                    </Field>
                    <Field id={`inputs.${i}.wastagePct`} label={t("field.wastagePct")} required error={err?.wastagePct?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} max={50} className="tabular" {...a} {...register(`inputs.${i}.wastagePct`, { valueAsNumber: true })} />}
                    </Field>
                    <Field id={`inputs.${i}.price`} label={t("field.price")} required error={err?.price?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`inputs.${i}.price`, { valueAsNumber: true })} />}
                    </Field>
                    <div className="flex items-end sm:pt-6">
                      <Button type="button" variant="ghost" size="icon" aria-label={t("removeInput", { n: i + 1 })} disabled={inputs.fields.length === 1} onClick={() => inputs.remove(i)}><Trash2 /></Button>
                    </div>
                    {it && c && (
                      <p className="text-xs text-muted-foreground sm:col-span-5" data-testid={`input-calc-${i}`}>
                        {t("lineCalc", { wastage: fmtNum(c.wastageQty, locale, 4), gross: fmtNum(c.grossQty, locale, 4), unit: it.unit })} · {t("col.value")} <Money value={c.value} />
                      </p>
                    )}
                  </div>
                )
              })}
              {typeof errors.inputs?.message === "string" && <p role="alert" className="text-xs font-medium text-destructive">{errors.inputs.message}</p>}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={inputs.fields.length >= 50} onClick={() => inputs.append({ itemId: "", qty: 0, wastagePct: 0, price: 0 })}><Plus /> {t("addInput")}</Button>
            </fieldset>

            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("costsTitle")}</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                {COST_HEADS.map((h, i) => (
                  <Field key={h} id={`costs.${i}.amount`} label={t(`head.${h}`)} error={errors.costs?.[i]?.amount?.message}>
                    {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`costs.${i}.amount`, { valueAsNumber: true })} />}
                  </Field>
                ))}
              </div>
            </fieldset>

            <Field id="note" label={t("field.note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>

            <section className="grid gap-1.5 rounded-md border bg-muted/30 p-4 text-sm sm:col-span-2" aria-live="polite" aria-label={t("summaryTitle")} data-testid="bom-summary">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
                <dt className="text-muted-foreground">{t("col.material")}</dt><dd className="text-right"><Money value={calc.materialValue} /></dd>
                <dt className="text-muted-foreground">{t("wastageIncluded")}</dt><dd className="text-right text-muted-foreground"><Money value={calc.wastageValue} /></dd>
                <dt className="text-muted-foreground">{t("col.valueAdded")}</dt><dd className="text-right"><Money value={calc.valueAdded} /></dd>
                <dt className="border-t pt-1.5 font-semibold">{t("col.price")}</dt><dd className="border-t pt-1.5 text-right font-semibold" data-testid="bom-price"><Money value={calc.price} /></dd>
                <dt className="text-muted-foreground">{t("col.unitCost")}</dt><dd className="text-right"><Money value={calc.unitCost} /></dd>
                {active && <><dt className="text-muted-foreground">{t("vsActive", { no: active.no })}</dt><dd className="text-right"><Money value={active.price} /></dd></>}
              </dl>
              {product && product.salePrice > 0 && calc.price > product.salePrice && <p role="status" className="rounded-md bg-warning-soft p-2 text-xs">{t("aboveSalePrice", { price: fmtMoney(product.salePrice, locale) })}</p>}
            </section>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending || (!!otherDraft && !doc)}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || (!!otherDraft && !doc)} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
