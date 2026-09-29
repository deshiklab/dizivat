"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCheck, Info, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import { periodLabel, VDS_MODES } from "@/lib/r4"
import { vdsInput } from "@/lib/schemas"
import type { VdsEntry, VdsMode } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues { mode: VdsMode; docId: string; amount: number; certificateNo: string; certificateDate: string; treasuryId: string; remark: string; process: "Created" | "Approved" }
const NONE = "__none"

/** New / edit-draft VDS entry against one approved invoice; the amount is capped at the VAT still to withhold. */
export function VdsForm({ open, onOpenChange, doc, preset, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: VdsEntry | null; preset?: { mode?: VdsMode; docId?: string | null }; onSaved?: (d: VdsEntry) => void
}) {
  const t = useTranslations("vds")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const blank = React.useCallback((): FormValues => ({ mode: preset?.mode ?? "purchase", docId: preset?.docId ?? "", amount: NaN, certificateNo: "", certificateDate: TODAY, treasuryId: "", remark: "", process: "Created" }), [preset?.mode, preset?.docId])
  const form = useForm<FormValues>({ resolver: zodResolver(vdsInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, getValues, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? { mode: doc.mode, docId: doc.docId, amount: doc.amount, certificateNo: doc.certificateNo ?? "", certificateDate: doc.certificateDate, treasuryId: doc.treasuryId ?? "", remark: doc.remark ?? "", process: "Created" } : blank())
  }, [open, doc, reset, blank])
  const w = useWatch({ control })
  const mode = (w.mode ?? "purchase") as VdsMode
  const eligible = useQuery({ queryKey: ["vdsEligible", mode, doc?.id], queryFn: () => api.vat.vdsEligible(mode, doc?.id), enabled: open })
  const period = (w.certificateDate ?? TODAY).slice(0, 7)
  const challans = useQuery({ queryKey: ["treasury", "vds-challans"], queryFn: () => api.vat.treasury.list({ head: "vds", size: 200, sort: "challanDate.desc" }), enabled: open && mode === "purchase" })
  const inv = eligible.data?.find((e) => e.id === w.docId)
  // default the amount to what is still to withhold
  React.useEffect(() => { if (inv && !doc && !(getValues("amount") > 0)) setValue("amount", inv.remaining) }, [inv, doc, getValues, setValue])
  const rows = (eligible.data ?? []).filter((e) => e.remaining > 0.004 || e.id === doc?.docId)
  const options = rows.map((e) => ({ value: e.id, label: `${e.no} · ${e.partyName}`, description: `${fmtDate(e.date, locale)} · ${t("remainingShort")} ${e.remaining.toLocaleString("en-IN")}`, keywords: [e.challanNo, e.partyName] }))
  const challanItems = (challans.data?.data ?? []).filter((c) => c.process !== "Cancelled" && c.taxPeriod >= period).map((c) => ({ value: c.id, label: `${c.challanNo} · ${periodLabel(c.taxPeriod)} · ${c.amount.toLocaleString("en-IN")}` }))
  const over = !!inv && (Number(w.amount) || 0) > inv.remaining + 0.004

  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.vat.vds.update(doc.id, v) : api.vat.vds.create(v)),
    onSuccess: (d) => { refresh("vds", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t(`newSub.${mode}`)}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="mode" label={t("field.mode")} required error={errors.mode?.message} className="sm:col-span-2">
              {(a) => <Controller control={control} name="mode" render={({ field }) => (
                <Select value={field.value} disabled={!!doc} onValueChange={(v) => { field.onChange(v); setValue("docId", ""); setValue("amount", NaN); setValue("treasuryId", "") }} items={VDS_MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{VDS_MODES.map((m) => <SelectItem key={m} value={m}>{t(`mode.${m}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="docId" label={t(`field.invoice.${mode}`)} required error={errors.docId?.message} className="sm:col-span-2">
              {(a) => <Controller control={control} name="docId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} disabled={!!doc} onChange={(v) => { field.onChange(v); field.onBlur(); setValue("amount", NaN) }}
                  options={options} placeholder={t("pickInvoice")} searchPlaceholder={t("searchInvoice")} empty={t("noEligible")} />
              )} />}
            </Field>
            {inv && (
              <dl className="grid gap-3 rounded-md bg-muted/60 p-3 text-sm sm:col-span-2 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">{t("col.party")}</dt><dd className="truncate" title={inv.partyName}>{inv.partyName}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("col.vat")}</dt><dd><Money value={inv.vat} /></dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("withheld")}</dt><dd><Money value={inv.withheld} /></dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("remaining")}</dt><dd className="font-semibold"><Money value={inv.remaining} /></dd></div>
              </dl>
            )}
            <Field id="amount" label={t("field.amount")} required error={over ? "exceedsVds" : errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} max={inv?.remaining} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>
            <Field id="certificateDate" label={t("field.certificateDate")} required error={errors.certificateDate?.message} hint={t("periodHint", { period: periodLabel(period) })}>
              {(a) => <Input type="date" max={TODAY} min={inv?.date} {...a} {...register("certificateDate")} />}
            </Field>
            <Field id="certificateNo" label={t("field.certificateNo")} required={mode === "sales"} error={errors.certificateNo?.message} hint={mode === "purchase" ? t("certNoHint") : undefined}>
              {(a) => <Input className="tabular" {...a} {...register("certificateNo")} />}
            </Field>
            {mode === "purchase" && (
              <Field id="treasuryId" label={t("field.challan")} error={errors.treasuryId?.message} hint={t("challanHint")}>
                {(a) => <Controller control={control} name="treasuryId" render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} items={[{ value: NONE, label: t("notDeposited") }, ...challanItems]}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>{t("notDeposited")}</SelectItem>{challanItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
            )}
            <Field id="remark" label={t("field.remark")} error={errors.remark?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("remark")} />}</Field>
            <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t(`formNote.${mode}`)}</p>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending || over}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || over} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
