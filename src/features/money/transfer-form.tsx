"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowRight, CheckCheck, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import { moneyTransferInput } from "@/lib/schemas"
import type { MoneyTransfer } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues { date: string; fromAccountId: string; toAccountId: string; amount: number; charge: number; reference: string; note: string; process: "Created" | "Approved" }

/**
 * New / edit-draft transfer between two of the company's own accounts. The pair of accounts can't change once
 * saved (the way a money document's party can't) — amend and cancel is the correct path instead.
 */
export function TransferForm({ open, onOpenChange, doc, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: MoneyTransfer | null; onSaved?: (d: MoneyTransfer) => void
}) {
  const t = useTranslations("transfers")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const accounts = useQuery({ queryKey: ["accounts", "options"], queryFn: () => api.accounting.accounts.options(), enabled: open })
  const config = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config(), enabled: open })

  const blank = React.useCallback((): FormValues => ({ date: TODAY, fromAccountId: "", toAccountId: "", amount: NaN, charge: 0, reference: "", note: "", process: "Created" }), [])
  const form = useForm<FormValues>({ resolver: zodResolver(moneyTransferInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, getValues, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? {
      date: doc.date, fromAccountId: doc.fromAccountId, toAccountId: doc.toAccountId, amount: doc.amount, charge: doc.charge,
      reference: doc.reference ?? "", note: doc.note ?? "", process: "Created",
    } : blank())
  }, [open, doc, reset, blank])

  const w = useWatch({ control })
  const options = accounts.data ?? []
  const label = (id: string) => options.find((a) => a.id === id)
  // keep the two accounts distinct
  React.useEffect(() => {
    if (!open) return
    if (w.fromAccountId && w.toAccountId === w.fromAccountId) setValue("toAccountId", "")
  }, [w.fromAccountId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (v: FormValues) => doc ? api.accounting.transfers.update(doc.id, v) : api.accounting.transfers.create(v),
    onSuccess: (d) => { refresh("ownTransfer", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([key, v]) => setError(key as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const amount = Number(w.amount) || 0
  const charge = Number(w.charge) || 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <Field id="date" label={t("field.date")} required error={errors.date?.message} hint={config.data?.closedUpTo ? t("closedHint", { date: fmtDate(config.data.closedUpTo, locale) }) : undefined}>
              {(a) => <Input type="date" max={TODAY} min={config.data?.closedUpTo} {...a} {...register("date")} />}
            </Field>
            <Field id="fromAccountId" label={t("field.from")} required error={errors.fromAccountId?.message} hint={doc ? t("pairLocked") : undefined}>
              {(a) => <Controller control={control} name="fromAccountId" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} disabled={!!doc} items={options.map((x) => ({ value: x.id, label: `${x.provider} · ${x.accountNo}` }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("pickAccount")} /></SelectTrigger>
                  <SelectContent>{options.map((x) => <SelectItem key={x.id} value={x.id}>{x.provider} · {x.accountNo}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="toAccountId" label={t("field.to")} required error={errors.toAccountId?.message}>
              {(a) => <Controller control={control} name="toAccountId" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} disabled={!!doc}
                  items={options.filter((x) => x.id !== getValues("fromAccountId")).map((x) => ({ value: x.id, label: `${x.provider} · ${x.accountNo}` }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("pickOther")} /></SelectTrigger>
                  <SelectContent>{options.filter((x) => x.id !== getValues("fromAccountId")).map((x) => <SelectItem key={x.id} value={x.id}>{x.provider} · {x.accountNo}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="amount" label={t("field.amount")} required error={errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>
            <Field id="charge" label={t("field.charge")} error={errors.charge?.message} hint={t("chargeHint")}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("charge", { valueAsNumber: true })} />}
            </Field>
            <Field id="reference" label={t("field.reference")} error={errors.reference?.message}>
              {(a) => <Input {...a} {...register("reference")} />}
            </Field>
            <Field id="note" label={t("field.note")} error={errors.note?.message}>{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>
            {w.fromAccountId && w.toAccountId && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm" aria-live="polite">
                <p className="mb-2 flex items-center gap-1.5 font-medium"><ArrowRight className="size-3.5" aria-hidden /> {t("landsAs")}</p>
                <dl className="grid gap-1 tabular">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label(w.toAccountId)?.provider ?? w.toAccountId} +</dt><dd><Money value={amount} /></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label(w.fromAccountId)?.provider ?? w.fromAccountId} −</dt><dd><Money value={amount + charge} /></dd></div>
                  {charge > 0 && <div className="flex justify-between gap-3 text-xs text-muted-foreground"><dt>{t("ofWhichCharge")}</dt><dd><Money value={charge} /></dd></div>}
                </dl>
              </div>
            )}
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
