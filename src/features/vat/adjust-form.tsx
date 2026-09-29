"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
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
import { ADJUSTMENT_KINDS, ADJUSTMENT_NOTE, periodLabel } from "@/lib/r4"
import { adjustmentInput } from "@/lib/schemas"
import type { AdjustmentKind, VatAdjustment } from "@/lib/types"
import { usePeriods, useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues { kind: AdjustmentKind; issueDate: string; taxPeriod: string; amount: number; description: string; reference: string; process: "Created" | "Approved" }

/** New / edit-draft VAT adjustment. Only open tax periods are offered (submitted periods are locked). */
export function AdjustForm({ open, onOpenChange, doc, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; doc?: VatAdjustment | null; onSaved?: (d: VatAdjustment) => void }) {
  const t = useTranslations("adjust")
  const tc = useTranslations("common")
  const can = useCan()
  const refresh = useR4Refresh()
  const periods = usePeriods()
  const openPeriods = (periods.data ?? []).filter((p) => !p.locked)
  const blank = React.useCallback((): FormValues => ({ kind: "otherIncrease", issueDate: TODAY, taxPeriod: TODAY.slice(0, 7), amount: NaN, description: "", reference: "", process: "Created" }), [])
  const form = useForm<FormValues>({ resolver: zodResolver(adjustmentInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? { kind: doc.kind, issueDate: doc.issueDate, taxPeriod: doc.taxPeriod, amount: doc.amount, description: doc.description, reference: doc.reference ?? "", process: "Created" } : blank())
  }, [open, doc, reset, blank])
  const kind = (useWatch({ control, name: "kind" }) ?? "otherIncrease") as AdjustmentKind
  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.vat.adjustments.update(doc.id, v) : api.vat.adjustments.create(v)),
    onSuccess: (d) => { refresh("adjustment", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }

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
            <Field id="amount" label={t("field.amount")} required error={errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>
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
