"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { periodLabel, RETURN_SECTION, RETURN_TYPES } from "@/lib/r4"
import { returnInput, type ReturnInput } from "@/lib/schemas"
import type { ReturnManual, ReturnView, VatReturnType } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

type FormValues = { type: VatReturnType; amendReason: string; activities: boolean; submissionDate: string; manual: ReturnManual }
const MANUAL: { key: keyof ReturnManual; note: number }[] = [
  { key: "interestVat", note: 41 }, { key: "interestSd", note: 42 }, { key: "penaltyLate", note: 43 }, { key: "penaltyOther", note: 44 },
  { key: "excise", note: 45 }, { key: "devSurcharge", note: 46 }, { key: "ictSurcharge", note: 47 }, { key: "healthSurcharge", note: 48 }, { key: "envSurcharge", note: 49 },
]

/** Part 2 header, manual notes 41–49 and the Part 11 refund request of a draft return (explicit edit mode). */
export function ReturnForm({ open, onOpenChange, ret }: { open: boolean; onOpenChange: (o: boolean) => void; ret: ReturnView }) {
  const t = useTranslations("ret")
  const tc = useTranslations("common")
  const refresh = useR4Refresh()
  const values = React.useCallback((): FormValues => ({ type: ret.type, amendReason: ret.amendReason ?? "", activities: ret.activities, submissionDate: ret.submissionDate ?? "", manual: { ...ret.manual } }), [ret])
  const form = useForm<FormValues>({ resolver: zodResolver(returnInput as never) as unknown as Resolver<FormValues>, defaultValues: values(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  React.useEffect(() => { if (open) reset(values()) }, [open, reset, values])
  const type = useWatch({ control, name: "type" })
  const refund = useWatch({ control, name: "manual.refund" })
  const save = useMutation({
    mutationFn: (v: FormValues) => api.vat.returns.update(ret.period, v as ReturnInput),
    onSuccess: () => { refresh(); toast.success(t("savedToast", { period: periodLabel(ret.period) })); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const me = errors.manual as Partial<Record<keyof ReturnManual, { message?: string }>> | undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{t("editTitle", { period: periodLabel(ret.period) })}</SheetTitle>
            <SheetDescription>{t("editSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">{t("part2")}</legend>
              <Field id="type" label={t("typeLabel")} required error={errors.type?.message} hint={t("section", { s: RETURN_SECTION[type ?? "original"] })}>
                {(a) => <Controller control={control} name="type" render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={RETURN_TYPES.map((k) => ({ value: k, label: t(`type.${k}`) }))}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                    <SelectContent>{RETURN_TYPES.map((k) => <SelectItem key={k} value={k}>{t(`type.${k}`)}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
              <Field id="submissionDate" label={t("submissionDate")} error={errors.submissionDate?.message} hint={t("submissionDateHint", { due: ret.due })}>{(a) => <Input type="date" max={TODAY} {...a} {...register("submissionDate")} />}</Field>
              {type === "amended" && <Field id="amendReason" label={t("amendReason")} required error={errors.amendReason?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("amendReason")} />}</Field>}
              <Controller control={control} name="activities" render={({ field }) => (
                <label htmlFor="activities" className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2"><Switch id="activities" checked={field.value} onCheckedChange={field.onChange} /> {t("activities")}</label>
              )} />
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold">{t("manualNotes")}</legend>
              {MANUAL.map((m) => (
                <Field key={m.key} id={`m-${m.key}`} label={t("manualLabel", { n: m.note, label: t(`manual.${m.key}`) })} error={me?.[m.key]?.message}>
                  {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register(`manual.${m.key}` as const, { valueAsNumber: true })} />}
                </Field>
              ))}
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">{t("part11")}</legend>
              <Controller control={control} name="manual.refund" render={({ field }) => (
                <label htmlFor="refund" className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2"><Switch id="refund" checked={field.value} onCheckedChange={field.onChange} /> {t("refund")}</label>
              )} />
              <Field id="m-refundVat" label={t("manualLabel", { n: 67, label: t("manual.refundVat") })} error={me?.refundVat?.message}>
                {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} disabled={!refund} className="text-right tabular" {...a} {...register("manual.refundVat", { valueAsNumber: true })} />}
              </Field>
              <Field id="m-refundSd" label={t("manualLabel", { n: 68, label: t("manual.refundSd") })} error={me?.refundSd?.message}>
                {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} disabled={!refund} className="text-right tabular" {...a} {...register("manual.refundSd", { valueAsNumber: true })} />}
              </Field>
            </fieldset>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDetails")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
