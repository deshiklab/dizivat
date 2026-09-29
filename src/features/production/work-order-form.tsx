"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCheck, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtNum } from "@/lib/format"
import { workOrderInput } from "@/lib/schemas"
import type { WorkOrder } from "@/lib/types"
import { useR3Refresh } from "@/features/r3/use-r3-actions"

interface FormValues { requisitionNo: string; issueDate: string; dueDate: string; remark: string; process: "Created" | "Approved"; lines: { itemId: string; qty: number }[] }

/** New / edit-draft work order. Only finished goods with an active price declaration (BOM) can be ordered. */
export function WorkOrderForm({ open, onOpenChange, doc, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; doc?: WorkOrder | null; onSaved?: (w: WorkOrder) => void }) {
  const t = useTranslations("workOrder")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR3Refresh()
  const items = useQuery({ queryKey: ["items", "all"], queryFn: () => api.items.list({ size: 500 }), enabled: open })
  const boms = useQuery({ queryKey: ["boms", { status: "active" }], queryFn: () => api.production.boms.list({ status: "active", size: 500 }), enabled: open })
  const withBom = new Set((boms.data?.data ?? []).map((b) => b.itemId))
  const all = (items.data?.data ?? []).filter((i) => i.group === "Finished Goods" && i.active)
  const byId = (id?: string) => all.find((i) => i.id === id)

  const blank = (): FormValues => ({ requisitionNo: "", issueDate: TODAY, dueDate: "", remark: "", process: "Created", lines: [{ itemId: "", qty: 0 }] })
  const resolver = zodResolver(workOrderInput as never) as unknown as Resolver<FormValues>
  const form = useForm<FormValues>({ resolver, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const lines = useFieldArray({ control, name: "lines" })
  React.useEffect(() => {
    if (!open) return
    reset(doc ? { requisitionNo: doc.requisitionNo ?? "", issueDate: doc.issueDate, dueDate: doc.dueDate ?? "", remark: doc.remark ?? "", process: "Created", lines: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) } : blank())
  }, [open, doc, reset])
  const w = useWatch({ control })
  const chosen = new Set((w.lines ?? []).map((l) => l?.itemId).filter(Boolean))
  const options = all.map((i) => ({
    value: i.id, label: i.name, description: `${i.sku} · ${withBom.has(i.id) ? t("stockNow", { qty: fmtNum(i.remain, locale, 2), unit: i.unit }) : t("noBom")}`,
    keywords: [i.sku, i.hsCode], disabled: !withBom.has(i.id),
  }))

  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.production.workOrders.update(doc.id, v) : api.production.workOrders.create(v)),
    onSuccess: (d) => { refresh("workOrder", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      // field errors show inline — a toast would cover the sheet footer
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
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="requisitionNo" label={t("field.requisitionNo")} error={errors.requisitionNo?.message}>{(a) => <Input autoComplete="off" {...a} {...register("requisitionNo")} />}</Field>
            <Field id="issueDate" label={t("field.issueDate")} required error={errors.issueDate?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}</Field>
            <Field id="dueDate" label={t("field.dueDate")} error={errors.dueDate?.message}>{(a) => <Input type="date" min={w.issueDate} {...a} {...register("dueDate")} />}</Field>
            <Field id="remark" label={t("field.remark")} error={errors.remark?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("remark")} />}</Field>
            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("field.lines")}</legend>
              {lines.fields.map((f, i) => {
                const it = byId(w.lines?.[i]?.itemId)
                const err = errors.lines?.[i]
                return (
                  <div key={f.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-start">
                    <Field id={`lines.${i}.itemId`} label={t("field.itemN", { n: i + 1 })} required error={err?.itemId?.message}>
                      {(a) => <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                        <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={field.onChange}
                          options={options.map((o) => ({ ...o, disabled: o.disabled || (chosen.has(o.value) && o.value !== field.value) }))}
                          placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={t("noItems")} />
                      )} />}
                    </Field>
                    <Field id={`lines.${i}.qty`} label={it ? `${t("field.qty")} (${it.unit})` : t("field.qty")} required error={err?.qty?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />}
                    </Field>
                    <div className="flex items-end sm:pt-6">
                      <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine", { n: i + 1 })} disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}><Trash2 /></Button>
                    </div>
                  </div>
                )
              })}
              {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs font-medium text-destructive">{errors.lines.message}</p>}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={lines.fields.length >= 50} onClick={() => lines.append({ itemId: "", qty: 0 })}><Plus /> {t("addLine")}</Button>
              {all.some((i) => !withBom.has(i.id)) && <p className="flex items-start gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("bomNote")}</p>}
            </fieldset>
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
