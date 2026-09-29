"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCheck, Info, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { Money } from "@/components/common/money"
import { useCan, useMe } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { DEBIT_REASONS } from "@/lib/r2"
import { debitNoteInput } from "@/lib/schemas"
import type { DebitNote, DebitReason } from "@/lib/types"
import { calcLine, round2 } from "@/lib/vat"
import { useR2Refresh } from "@/features/r2/use-r2-actions"

interface FormValues {
  purchaseId: string; issueDate: string; issueTime: string; reason: DebitReason; note: string
  issuedBy: string; designation: string; process: "Created" | "Approved"; lines: { itemId: string; qty: number }[]
}
const nowTime = () => new Date().toTimeString().slice(0, 5)

/**
 * New / edit-draft debit note (Mushak 6.8) in a side sheet. Picking the purchase challan fills vendor and lines
 * (legacy behaviour); the return quantity per line is capped at what is still returnable.
 */
export function DebitForm({ open, onOpenChange, doc, purchaseId, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: DebitNote | null; purchaseId?: string | null; onSaved?: (d: DebitNote) => void
}) {
  const t = useTranslations("debit")
  const tc = useTranslations("common")
  const tv = useTranslations("validation")
  const locale = useLocale()
  const can = useCan()
  const me = useMe()
  const refresh = useR2Refresh()
  const purchases = useQuery({ queryKey: ["purchases", "approved-goods"], queryFn: () => api.purchases.list({ process: "Approved", size: 500, sort: "issueDate.desc" }), enabled: open })

  const blank = React.useCallback((): FormValues => ({
    purchaseId: purchaseId ?? "", issueDate: TODAY, issueTime: nowTime(), reason: "quality", note: "", issuedBy: me.user.name, designation: me.user.designation, process: "Created", lines: [],
  }), [purchaseId, me.user.name, me.user.designation])
  const form = useForm<FormValues>({ resolver: zodResolver(debitNoteInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const lines = useFieldArray({ control, name: "lines" })
  React.useEffect(() => {
    if (!open) return
    reset(doc ? { purchaseId: doc.purchaseId, issueDate: doc.issueDate, issueTime: doc.issueTime, reason: doc.reason, note: doc.note ?? "", issuedBy: doc.issuedBy, designation: doc.designation, process: "Created", lines: [] } : blank())
  }, [open, doc, reset, blank])

  const w = useWatch({ control })
  const ret = useQuery({ queryKey: ["returnable", w.purchaseId, doc?.id], queryFn: () => api.returnable(w.purchaseId!, doc?.id), enabled: open && !!w.purchaseId })
  // One row per purchase line, pre-filled with the draft's quantities when editing
  React.useEffect(() => {
    if (!ret.data) return
    lines.replace(ret.data.lines.map((r) => ({ itemId: r.itemId, qty: doc && doc.purchaseId === w.purchaseId ? doc.lines.find((l) => l.itemId === r.itemId)?.qty ?? 0 : 0 })))
  }, [ret.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const purchase = purchases.data?.data.find((p) => p.id === w.purchaseId)
  const rows = ret.data?.lines ?? []
  const calc = rows.map((r, i) => {
    const qty = Number(w.lines?.[i]?.qty) || 0
    return r.import ? { subtotal: round2(qty * r.price), vat: NaN, total: NaN } : calcLine({ qty, price: r.price, sdRate: r.sdRate, vatRate: r.vatRate })
  })
  const totals = calc.reduce((a, c) => ({ subtotal: a.subtotal + c.subtotal, vat: a.vat + (c.vat || 0), total: a.total + (c.total || 0) }), { subtotal: 0, vat: 0, total: 0 })
  const over = rows.some((r, i) => (Number(w.lines?.[i]?.qty) || 0) > r.remaining + 1e-9)
  const nothing = !rows.some((_, i) => (Number(w.lines?.[i]?.qty) || 0) > 0)

  const save = useMutation({
    mutationFn: (v: FormValues) => { const body = { ...v, lines: v.lines.filter((l) => l.qty > 0) }; return doc ? api.debitNotes.update(doc.id, body) : api.debitNotes.create(body) },
    onSuccess: (d) => { refresh("debit", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const purchaseOptions = (purchases.data?.data ?? []).map((p) => ({ value: p.id, label: `${p.invoiceNo} · ${p.vendorName}`, description: `${p.challanNo} · ${fmtDate(p.issueDate, locale)} · ${p.lines.map((l) => l.name).join(", ")}`, keywords: [p.challanNo, p.vendorName] }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="purchaseId" label={t("field.purchase")} required error={errors.purchaseId?.message} hint={t("hint.purchase")} className="sm:col-span-2">
              {(a) => <Controller control={control} name="purchaseId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }}
                  options={purchaseOptions} placeholder={t("pickPurchase")} searchPlaceholder={t("searchPurchase")} empty={tc("noResults")} />
              )} />}
            </Field>
            {purchase && (
              <dl className="grid gap-3 rounded-md bg-muted/60 p-3 text-sm sm:col-span-2 sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">{t("field.vendor")}</dt><dd>{purchase.vendorName}<span className="block text-xs tabular text-muted-foreground">{purchase.vendorBin}</span></dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("field.challan")}</dt><dd className="tabular">{purchase.challanNo} · {fmtDate(purchase.challanDate, locale)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("field.branch")}</dt><dd>{purchase.branchName}</dd></div>
              </dl>
            )}
            <Field id="issueDate" label={t("field.issueDate")} required error={errors.issueDate?.message}>{(a) => <Input type="date" max={TODAY} min={purchase?.issueDate} {...a} {...register("issueDate")} />}</Field>
            <Field id="issueTime" label={t("field.issueTime")} required error={errors.issueTime?.message}>{(a) => <Input type="time" {...a} {...register("issueTime")} />}</Field>
            <Field id="reason" label={t("field.reason")} required error={errors.reason?.message} className="sm:col-span-2">
              {(a) => <Controller control={control} name="reason" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={DEBIT_REASONS.map((r) => ({ value: r, label: t(`reason.${r}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{DEBIT_REASONS.map((r) => <SelectItem key={r} value={r}>{t(`reason.${r}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="note" label={t("field.note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>

            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("field.lines")}</legend>
              {!w.purchaseId ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("pickPurchaseFirst")}</p>
                : ret.isLoading ? <p className="p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />{tc("loading")}</p>
                : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[620px] text-sm">
                      <caption className="sr-only">{t("field.lines")}</caption>
                      <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">{t("col.item")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.purchased")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.remaining")}</th>
                        <th scope="col" className="w-32 px-3 py-2 text-right font-medium">{t("col.returnQty")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.value")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.vat")}</th>
                      </tr></thead>
                      <tbody>
                        {lines.fields.map((f, i) => {
                          const r = rows[i]
                          if (!r) return null
                          const q = Number(w.lines?.[i]?.qty) || 0
                          const bad = q > r.remaining + 1e-9 || !!errors.lines?.[i]?.qty
                          return (
                            <tr key={f.id} className="border-b align-top last:border-0">
                              <td className="px-3 py-2"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground tabular">HS {r.hsCode} · <Money value={r.price} />/{r.uom}</span></td>
                              <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular">{fmtNum(r.purchasedQty, locale, 2)} {r.uom}{r.returnedQty > 0 && <span className="block text-xs">{t("alreadyReturned", { qty: fmtNum(r.returnedQty, locale, 2) })}</span>}</td>
                              <td className="px-3 py-2 text-right whitespace-nowrap tabular">{fmtNum(r.remaining, locale, 2)}</td>
                              <td className="px-3 py-1.5">
                                <Input aria-label={t("returnQtyFor", { item: r.name })} aria-invalid={bad || undefined} type="number" inputMode="decimal" step="any" min={0} max={r.remaining} disabled={r.remaining <= 0}
                                  className="text-right tabular" {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                                {bad && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{tv("exceedsRemaining")}</p>}
                              </td>
                              <td className="px-3 py-2 text-right"><Money value={calc[i]?.subtotal ?? 0} /></td>
                              <td className="px-3 py-2 text-right">{Number.isNaN(calc[i]?.vat) ? <span className="text-xs text-muted-foreground">{t("onSave")}</span> : <Money value={calc[i]?.vat ?? 0} />}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot><tr className="border-t bg-muted/30 font-semibold">
                        <th scope="row" colSpan={4} className="px-3 py-2 text-left">{t("col.total")}</th>
                        <td className="px-3 py-2 text-right"><Money value={totals.subtotal} /></td>
                        <td className="px-3 py-2 text-right"><Money value={totals.vat} /></td>
                      </tr></tfoot>
                    </table>
                  </div>
                )}
              {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs font-medium text-destructive">{tv(errors.lines.message)}</p>}
              {over && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {t("overNote")}</p>}
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("formNote")}</p>
            </fieldset>
            <Field id="issuedBy" label={t("field.issuedByName")} required error={errors.issuedBy?.message}>{(a) => <Input {...a} {...register("issuedBy")} />}</Field>
            <Field id="designation" label={t("field.designation")} required error={errors.designation?.message}>{(a) => <Input {...a} {...register("designation")} />}</Field>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending || over || nothing}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || over || nothing} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
