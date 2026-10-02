"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCheck, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { Money } from "@/components/common/money"
import { round2 } from "@/lib/vat"
import { ADJUSTMENT_KINDS, ADJUSTMENT_NOTE, periodLabel } from "@/lib/r4"
import { adjustmentInput } from "@/lib/schemas"
import type { AdjustmentKind, VatAdjustment } from "@/lib/types"
import { usePeriods, useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues { kind: AdjustmentKind; issueDate: string; taxPeriod: string; amount: number; description: string; reference: string; purchaseId: string; itemId: string; saleId: string; qty: number; process: "Created" | "Approved" }
/** R6.3: pre-selected SD-paid purchase line (Claim button of the six-month register) */
export interface SdPreset { purchaseId: string; itemId: string }

/** New / edit-draft VAT adjustment. Only open tax periods are offered (submitted periods are locked). */
export function AdjustForm({ open, onOpenChange, doc, onSaved, preset }: { open: boolean; onOpenChange: (o: boolean) => void; doc?: VatAdjustment | null; onSaved?: (d: VatAdjustment) => void; preset?: SdPreset | null }) {
  const locale = useLocale()
  const t = useTranslations("adjust")
  const tc = useTranslations("common")
  const can = useCan()
  const refresh = useR4Refresh()
  const periods = usePeriods()
  const openPeriods = (periods.data ?? []).filter((p) => !p.locked)
  const blank = React.useCallback((): FormValues => ({
    kind: preset ? "sdExport" : "otherIncrease", issueDate: TODAY, taxPeriod: TODAY.slice(0, 7), amount: NaN, description: "", reference: "",
    purchaseId: preset?.purchaseId ?? "", itemId: preset?.itemId ?? "", saleId: "", qty: NaN, process: "Created",
  }), [preset])
  const form = useForm<FormValues>({ resolver: zodResolver(adjustmentInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? {
      kind: doc.kind, issueDate: doc.issueDate, taxPeriod: doc.taxPeriod, amount: doc.amount, description: doc.description, reference: doc.reference ?? "",
      purchaseId: doc.sdExport?.purchaseId ?? "", itemId: doc.sdExport?.itemId ?? "", saleId: doc.sdExport?.saleId ?? "", qty: doc.sdExport?.qty ?? NaN, process: "Created",
    } : blank())
  }, [open, doc, reset, blank])
  const kind = (useWatch({ control, name: "kind" }) ?? "otherIncrease") as AdjustmentKind
  // R6.3 — SD on exported inputs: pick the SD-paid purchase line and the export; the amount follows from the quantity
  const sd = kind === "sdExport"
  const eligible = useQuery({ queryKey: ["sdEligible", doc?.id ?? ""], queryFn: () => api.vat.sdEligible(doc?.id), enabled: open && sd })
  const [purchaseId, itemId, saleId, qty] = useWatch({ control, name: ["purchaseId", "itemId", "saleId", "qty"] }) as [string, string, string, number]
  const lineKey = purchaseId && itemId ? `${purchaseId}|${itemId}` : ""
  const lines = (eligible.data?.rows ?? []).filter((r) => (r.state === "open" || r.state === "expiring") || `${r.purchaseId}|${r.itemId}` === lineKey)
  const line = lines.find((r) => `${r.purchaseId}|${r.itemId}` === lineKey)
  const exportsFor = line ? (eligible.data?.exports ?? []).filter((x) => x.date >= line.purchaseDate && x.date <= line.deadline) : []
  const sale = exportsFor.find((x) => x.saleId === saleId)
  const computed = line && Number.isFinite(qty) && qty > 0 ? round2((line.sd * qty) / line.qty) : NaN
  React.useEffect(() => { if (sd && Number.isFinite(computed)) setValue("amount", computed, { shouldValidate: false }) }, [sd, computed, setValue])
  const autoDesc = React.useRef("")
  React.useEffect(() => {
    if (!sd || !line || !sale) return
    const text = t("sd.autoDescription", { item: line.name, boe: line.boeNo ?? line.purchaseNo, sale: sale.invoiceNo, customer: sale.customerName })
    const cur = form.getValues("description")
    if (!cur || cur === autoDesc.current) { setValue("description", text); autoDesc.current = text }
  }, [sd, line, sale, t, form, setValue])
  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.vat.adjustments.update(doc.id, v) : api.vat.adjustments.create(v)),
    onSuccess: (d) => { refresh("adjustment", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => {
    setValue("process", process)
    return handleSubmit((v) => save.mutate(v.kind === "sdExport" ? { ...v, process } : { ...v, purchaseId: "", itemId: "", saleId: "", qty: undefined as unknown as number, process }))()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="kind" label={t("field.kind")} required error={errors.kind?.message} className="sm:col-span-2" hint={t("noteHint", { n: ADJUSTMENT_NOTE[kind] })}>
              {(a) => <Controller control={control} name="kind" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={ADJUSTMENT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{ADJUSTMENT_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`kind.${k}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="issueDate" label={t("field.date")} required error={errors.issueDate?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}</Field>
            <Field id="taxPeriod" label={t("field.period")} required error={errors.taxPeriod?.message}>
              {(a) => <Controller control={control} name="taxPeriod" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={openPeriods.map((p) => ({ value: p.period, label: periodLabel(p.period) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{openPeriods.map((p) => <SelectItem key={p.period} value={p.period}>{periodLabel(p.period)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            {sd && <>
              <Field id="purchaseId" label={t("sd.input")} required error={errors.purchaseId?.message ?? errors.itemId?.message} className="sm:col-span-2"
                hint={line ? t("sd.inputHint", { remaining: fmtNum(line.remainingQty, locale), uom: line.uom, deadline: fmtDate(line.deadline, locale), days: line.daysLeft }) : eligible.data && !lines.length ? t("sd.noneOpen") : undefined}>
                {(a) => (
                  <Select value={lineKey} onValueChange={(v) => { const [p, i] = String(v).split("|"); setValue("purchaseId", p, { shouldValidate: true }); setValue("itemId", i); setValue("saleId", "") }}
                    items={lines.map((r) => ({ value: `${r.purchaseId}|${r.itemId}`, label: `${r.purchaseNo} · ${r.name}` }))}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("sd.pickInput")} /></SelectTrigger>
                    <SelectContent>{lines.map((r) => <SelectItem key={`${r.purchaseId}|${r.itemId}`} value={`${r.purchaseId}|${r.itemId}`}>{r.purchaseNo} · {r.name} — {t("sd.left", { qty: fmtNum(r.remainingQty, locale), uom: r.uom })}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </Field>
              <Field id="saleId" label={t("sd.export")} required error={errors.saleId?.message} className="sm:col-span-2" hint={line ? t("sd.exportHint", { from: fmtDate(line.purchaseDate, locale), to: fmtDate(line.deadline, locale) }) : undefined}>
                {(a) => <Controller control={control} name="saleId" render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={exportsFor.map((x) => ({ value: x.saleId, label: `${x.invoiceNo} · ${x.customerName}` }))}>
                    <SelectTrigger id={a.id} className="w-full" disabled={!line} aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={line && !exportsFor.length ? t("sd.noExport") : t("sd.pickExport")} /></SelectTrigger>
                    <SelectContent>{exportsFor.map((x) => <SelectItem key={x.saleId} value={x.saleId}>{x.invoiceNo} · {fmtDate(x.date, locale)} · {x.customerName}{x.expNo ? ` · ${x.expNo}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
              <Field id="qty" label={line ? t("sd.qtyUom", { uom: line.uom }) : t("sd.qty")} required error={errors.qty?.message}>
                {(a) => <Input type="number" inputMode="decimal" step="any" min={0} max={line?.remainingQty} className="text-right tabular" {...a} {...register("qty", { valueAsNumber: true })} />}
              </Field>
              <div className="grid content-start gap-1.5">
                <span className="text-sm font-medium">{t("field.amount")}</span>
                <div className="flex h-9 items-center justify-end rounded-md border bg-muted/40 px-3" aria-live="polite" data-testid="sd-amount">{Number.isFinite(computed) ? <Money value={computed} className="font-semibold" /> : <span className="text-muted-foreground">—</span>}</div>
                <span className="text-xs text-muted-foreground">{line ? t("sd.amountHint", { sd: fmtNum(line.sd, locale), qty: fmtNum(line.qty, locale), uom: line.uom }) : t("sd.amountAuto")}</span>
              </div>
            </>}
            {!sd && <Field id="amount" label={t("field.amount")} required error={errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>}
            <Field id="reference" label={t("field.reference")} error={errors.reference?.message}>{(a) => <Input {...a} {...register("reference")} />}</Field>
            <Field id="description" label={t("field.description")} required error={errors.description?.message} className="sm:col-span-2" hint={t("descriptionHint")}>{(a) => <Textarea rows={3} {...a} {...register("description")} />}</Field>
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
