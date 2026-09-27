"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowRightLeft, CheckCheck, Loader2, Plus, Save, Trash2 } from "lucide-react"
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
import { fmtNum } from "@/lib/format"
import { damageInput, transferInput } from "@/lib/schemas"
import type { DamageReason, StockDoc, StockDocKind } from "@/lib/types"
import { useStockRefresh } from "./use-stock-actions"

const REASONS: DamageReason[] = ["damaged", "expired", "wastage", "lost"]
interface FormValues {
  fromBranchId: string; toBranchId: string; branchId: string; reason: DamageReason
  date: string; vehicle: string; note: string; process: "Created" | "Approved"
  lines: { itemId: string; qty: number }[]
}

/**
 * New / edit-draft form for a stock transfer (Mushak 6.5) or a damage entry, in a side sheet.
 * Shows the quantity available at the source branch per line; the API re-checks on approval.
 */
export function StockDocForm({ kind, open, onOpenChange, doc, onSaved }: {
  kind: StockDocKind; open: boolean; onOpenChange: (o: boolean) => void; doc?: StockDoc | null; onSaved?: (d: StockDoc) => void
}) {
  const t = useTranslations("stock")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useStockRefresh()
  const stock = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }), enabled: open })
  const branches = stock.data?.branches ?? []
  const main = branches.find((b) => b.category === "factory")?.id ?? branches[0]?.id ?? ""
  const other = branches.find((b) => b.id !== main)?.id ?? ""

  const blank = React.useCallback((): FormValues => ({
    fromBranchId: main, toBranchId: other, branchId: main, reason: "damaged", date: TODAY, vehicle: "", note: "", process: "Created", lines: [{ itemId: "", qty: 0 }],
  }), [main, other])
  const resolver = zodResolver((kind === "transfer" ? transferInput : damageInput) as never) as unknown as Resolver<FormValues>
  const form = useForm<FormValues>({ resolver, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const lines = useFieldArray({ control, name: "lines" })
  React.useEffect(() => {
    if (!open) return
    if (doc) {
      reset({
        ...blank(), date: doc.date, note: doc.note ?? "", process: "Created", lines: doc.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        ...(doc.kind === "transfer" ? { fromBranchId: doc.fromBranchId, toBranchId: doc.toBranchId, vehicle: doc.vehicle ?? "" } : { branchId: doc.branchId, reason: doc.reason }),
      })
    } else reset(blank())
  }, [open, doc, reset, blank])

  const w = useWatch({ control })
  const source = (kind === "transfer" ? w.fromBranchId : w.branchId) ?? ""
  const rows = stock.data?.data ?? []
  const row = (id?: string) => rows.find((r) => r.id === id)
  const avail = (id?: string) => row(id)?.byBranch[source] ?? 0
  const chosen = new Set((w.lines ?? []).map((l) => l?.itemId).filter(Boolean))
  const options = rows.filter((r) => r.active).map((r) => ({
    value: r.id, label: r.name, description: `${r.sku} · ${fmtNum(r.byBranch[source] ?? 0, locale, 2)} ${r.unit} ${t("atSource")}`,
    keywords: [r.sku, r.hsCode], disabled: (r.byBranch[source] ?? 0) <= 0,
  }))
  const total = (w.lines ?? []).reduce((a, l) => a + (Number(l?.qty) || 0) * (row(l?.itemId)?.costPrice ?? 0), 0)
  const short = (w.lines ?? []).some((l) => l?.itemId && (Number(l.qty) || 0) > avail(l.itemId) + 1e-9)

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = kind === "transfer"
        ? { fromBranchId: v.fromBranchId, toBranchId: v.toBranchId, date: v.date, vehicle: v.vehicle, note: v.note, process: v.process, lines: v.lines }
        : { branchId: v.branchId, reason: v.reason, date: v.date, note: v.note, process: v.process, lines: v.lines }
      const c = kind === "transfer" ? api.transfers : api.damage
      return (doc ? c.update(doc.id, body as never) : c.create(body as never)) as Promise<StockDoc>
    },
    onSuccess: (d) => {
      refresh(kind, d)
      toast.success(t(d.process === "Approved" ? `${kind}.approved` : "saved", { no: d.no }))
      onSaved?.(d)
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const branchSelect = (name: "fromBranchId" | "toBranchId" | "branchId", label: string) => (
    <Field id={name} label={label} required error={errors[name]?.message}>
      {(a) => <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={branches.map((b) => ({ value: b.id, label: b.name }))}>
          <SelectTrigger id={a.id} className="w-full" aria-invalid={a["aria-invalid"]} aria-describedby={a["aria-describedby"]}><SelectValue placeholder={t("pickBranch")} /></SelectTrigger>
          <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
        </Select>
      )} />}
    </Field>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t(`${kind}.editTitle`, { no: doc.no }) : t(`${kind}.newTitle`)}</SheetTitle>
            <SheetDescription>{t(`${kind}.newSub`)}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            {kind === "transfer" ? (
              <>
                {branchSelect("fromBranchId", t("field.from"))}
                {branchSelect("toBranchId", t("field.to"))}
                <Field id="date" label={t("field.date")} required error={errors.date?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("date")} />}</Field>
                <Field id="vehicle" label={t("field.vehicle")} error={errors.vehicle?.message} hint={t("hint.vehicle")}>{(a) => <Input {...a} {...register("vehicle")} />}</Field>
              </>
            ) : (
              <>
                {branchSelect("branchId", t("field.branch"))}
                <Field id="date" label={t("field.date")} required error={errors.date?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("date")} />}</Field>
                <Field id="reason" label={t("field.reason")} required error={errors.reason?.message} hint={w.reason ? t(`reasonHint.${w.reason}`) : undefined} className="sm:col-span-2">
                  {(a) => <Controller control={control} name="reason" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={REASONS.map((r) => ({ value: r, label: t(`reason.${r}`) }))}>
                      <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                      <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{t(`reason.${r}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />}
                </Field>
              </>
            )}
            <Field id="note" label={t("field.note")} required={kind === "damage" && w.reason === "lost"} error={errors.note?.message} className="sm:col-span-2">
              {(a) => <Textarea rows={2} {...a} {...register("note")} />}
            </Field>

            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("field.lines")}</legend>
              {lines.fields.map((f, i) => {
                const l = w.lines?.[i]
                const it = row(l?.itemId)
                const over = !!l?.itemId && (Number(l.qty) || 0) > avail(l.itemId) + 1e-9
                const lineErr = errors.lines?.[i]
                return (
                  <div key={f.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-start">
                    <Field id={`lines.${i}.itemId`} label={t("field.itemN", { n: i + 1 })} required error={lineErr?.itemId?.message}>
                      {(a) => <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                        <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={field.onChange}
                          options={options.map((o) => ({ ...o, disabled: o.disabled || (chosen.has(o.value) && o.value !== field.value) }))}
                          placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={t("noItems")} />
                      )} />}
                    </Field>
                    <Field id={`lines.${i}.qty`} label={it ? `${t("field.qty")} (${it.unit})` : t("field.qty")} required error={lineErr?.qty?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`lines.${i}.qty`, { valueAsNumber: true })} />}
                    </Field>
                    <div className="flex items-end sm:pt-6">
                      <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine", { n: i + 1 })} disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}><Trash2 /></Button>
                    </div>
                    {it && (
                      <p className={`text-xs sm:col-span-3 ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                        {over && <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />}
                        {t("available", { qty: fmtNum(avail(it.id), locale, 2), unit: it.unit, branch: branches.find((b) => b.id === source)?.name ?? "" })}
                        {" · "}{t("valueAtCost")} <Money value={(Number(l?.qty) || 0) * it.costPrice} />
                      </p>
                    )}
                  </div>
                )
              })}
              {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs font-medium text-destructive">{errors.lines.message}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" disabled={lines.fields.length >= 50} onClick={() => lines.append({ itemId: "", qty: 0 })}><Plus /> {t("addLine")}</Button>
                <p className="text-sm">{t("field.total")}: <Money value={total} className="font-semibold" /></p>
              </div>
              {short && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {t("shortNote")}</p>}
              {kind === "transfer" && <p className="flex items-start gap-2 text-xs text-muted-foreground"><ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("transfer.formNote")}</p>}
            </fieldset>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || short} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
