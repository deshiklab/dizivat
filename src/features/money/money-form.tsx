"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCheck, Info, ListChecks, Loader2, Save } from "lucide-react"
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
import { fmtDate, fmtNum } from "@/lib/format"
import { BANKS, METHOD_ACCOUNT, MONEY_METHODS } from "@/lib/r4"
import { moneyInput } from "@/lib/schemas"
import type { MoneyDoc, MoneyKind, MoneyMethod } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues {
  partyId: string; date: string; method: MoneyMethod; accountId: string; chequeNo: string; chequeDate: string; chequeBank: string; reference: string
  amount: number; charge: number; note: string; process: "Created" | "Approved"; allocations: { docId: string; amount: number }[]
}

/**
 * New / edit-draft receipt (customer) or payment (supplier). Picking the party lists its open invoices; the amount is
 * allocated oldest-first (or by hand). Anything not allocated stays on account as an advance.
 */
export function MoneyForm({ kind, open, onOpenChange, doc, partyId, invoiceId, onSaved }: {
  kind: MoneyKind; open: boolean; onOpenChange: (o: boolean) => void; doc?: MoneyDoc | null; partyId?: string | null; invoiceId?: string | null; onSaved?: (d: MoneyDoc) => void
}) {
  const t = useTranslations("money")
  const tc = useTranslations("common")
  const tv = useTranslations("validation")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const k = (s: string) => `${kind}.${s}`
  const parties = useQuery({ queryKey: [kind === "receipt" ? "customers" : "vendors", "options"], queryFn: () => (kind === "receipt" ? api.customers : api.vendors).options(), enabled: open })
  const accounts = useQuery({ queryKey: ["accounts", "options"], queryFn: () => api.accounting.accounts.options(), enabled: open })
  const config = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config(), enabled: open })

  const blank = React.useCallback((): FormValues => ({
    partyId: partyId ?? "", date: TODAY, method: "bankTransfer", accountId: "", chequeNo: "", chequeDate: "", chequeBank: "", reference: "", amount: NaN, charge: 0, note: "", process: "Created", allocations: [],
  }), [partyId])
  const form = useForm<FormValues>({ resolver: zodResolver(moneyInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, getValues, formState: { errors } } = form
  const allocs = useFieldArray({ control, name: "allocations" })
  React.useEffect(() => {
    if (!open) return
    reset(doc ? {
      partyId: doc.partyId, date: doc.date, method: doc.method, accountId: doc.accountId, chequeNo: doc.chequeNo ?? "", chequeDate: doc.chequeDate ?? "", chequeBank: doc.chequeBank ?? "",
      reference: doc.reference ?? "", amount: doc.amount, charge: doc.charge, note: doc.note ?? "", process: "Created", allocations: [],
    } : blank())
  }, [open, doc, reset, blank])

  const w = useWatch({ control })
  const inv = useQuery({ queryKey: ["openInvoices", kind, w.partyId], queryFn: () => api.accounting.openInvoices(kind, w.partyId!), enabled: open && !!w.partyId })
  const rows = React.useMemo(() => inv.data ?? [], [inv.data])
  // one allocation row per open invoice; pre-filled from the draft, or the invoice the form was opened from
  React.useEffect(() => {
    if (!inv.data) return
    const pre = (id: string, due: number) => (doc && doc.partyId === w.partyId ? doc.allocations.find((a) => a.docId === id)?.amount ?? 0 : id === invoiceId ? due : 0)
    allocs.replace(inv.data.map((r) => ({ docId: r.id, amount: pre(r.id, r.due) })))
    if (!doc && invoiceId) { const r = inv.data.find((x) => x.id === invoiceId); if (r && !(getValues("amount") > 0)) setValue("amount", r.due) }
  }, [inv.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const acctOptions = (accounts.data ?? []).filter((a) => a.kind === METHOD_ACCOUNT[w.method ?? "bankTransfer"])
  // keep the account consistent with the method
  React.useEffect(() => {
    if (!open || !accounts.data) return
    if (!acctOptions.some((a) => a.id === getValues("accountId"))) setValue("accountId", acctOptions[0]?.id ?? "")
  }, [w.method, accounts.data, open]) // eslint-disable-line react-hooks/exhaustive-deps
  const acct = accounts.data?.find((a) => a.id === w.accountId)

  const amount = Number(w.amount) || 0
  const allocated = round2(rows.reduce((s, _r, i) => s + (Number(w.allocations?.[i]?.amount) || 0), 0))
  const onAccount = round2(amount - allocated)
  const overDue = rows.some((r, i) => (Number(w.allocations?.[i]?.amount) || 0) > r.due + 0.004)
  const overAlloc = allocated > amount + 0.004
  const advanceBlocked = config.data && !config.data.allowAdvance && onAccount > 0.004
  const autoAllocate = () => {
    let left = amount
    rows.forEach((r, i) => { const a = round2(Math.max(0, Math.min(r.due, left))); left = round2(left - a); setValue(`allocations.${i}.amount`, a, { shouldDirty: true }) })
  }
  const suggestedCharge = kind === "receipt" && acct?.serviceCharge ? round2((amount * acct.serviceCharge) / 100) : 0

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { ...v, allocations: v.allocations.filter((a) => a.amount > 0), charge: kind === "receipt" ? v.charge || 0 : 0 }
      const res = kind === "receipt" ? api.accounting.receipts : api.accounting.payments
      return doc ? res.update(doc.id, body) : res.create(body)
    },
    onSuccess: (d) => { refresh(kind, d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([key, v]) => setError(key as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const blocked = save.isPending || overDue || overAlloc || !!advanceBlocked
  const partyOptions = (parties.data ?? []).map((p) => ({ value: p.id, label: p.name, description: `${p.bin} · ${p.mobile}`, keywords: [p.bin] }))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t(k("newTitle"))}</SheetTitle>
            <SheetDescription>{t(k("newSub"))}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="partyId" label={t(k("party"))} required error={errors.partyId?.message} className="sm:col-span-2" hint={doc ? t("partyLocked") : undefined}>
              {(a) => <Controller control={control} name="partyId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }} disabled={!!doc}
                  options={partyOptions} placeholder={t(k("pickParty"))} searchPlaceholder={t("searchParty")} empty={tc("noResults")} />
              )} />}
            </Field>
            <Field id="date" label={t("field.date")} required error={errors.date?.message} hint={config.data?.closedUpTo ? t("closedHint", { date: fmtDate(config.data.closedUpTo, locale) }) : undefined}>
              {(a) => <Input type="date" max={TODAY} min={config.data?.closedUpTo} {...a} {...register("date")} />}
            </Field>
            <Field id="method" label={t("field.method")} required error={errors.method?.message}>
              {(a) => <Controller control={control} name="method" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={MONEY_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{MONEY_METHODS.map((m) => <SelectItem key={m} value={m}>{t(`method.${m}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="accountId" label={t(k("account"))} required error={errors.accountId?.message} className="sm:col-span-2"
              hint={acct ? t("accountHint", { kind: t(`kind.${acct.kind}`), charge: fmtNum(acct.serviceCharge, locale, 2) }) : undefined}>
              {(a) => <Controller control={control} name="accountId" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={acctOptions.map((x) => ({ value: x.id, label: `${x.provider} · ${x.accountNo}` }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("pickAccount")} /></SelectTrigger>
                  <SelectContent>{acctOptions.map((x) => <SelectItem key={x.id} value={x.id}>{x.provider} · {x.accountNo}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            {w.method === "cheque" && (
              <>
                <Field id="chequeNo" label={t("field.chequeNo")} required error={errors.chequeNo?.message}>{(a) => <Input {...a} {...register("chequeNo")} />}</Field>
                <Field id="chequeDate" label={t("field.chequeDate")} required error={errors.chequeDate?.message}>{(a) => <Input type="date" {...a} {...register("chequeDate")} />}</Field>
                <Field id="chequeBank" label={t("field.chequeBank")} error={errors.chequeBank?.message} className="sm:col-span-2">
                  {(a) => <><Input list="banks-list" {...a} {...register("chequeBank")} /><datalist id="banks-list">{BANKS.map((b) => <option key={b} value={b} />)}</datalist></>}
                </Field>
              </>
            )}
            <Field id="reference" label={t(w.method === "mobile" ? "field.trxId" : "field.reference")} required={w.method === "mobile" || w.method === "bankTransfer"} error={errors.reference?.message} className="sm:col-span-2">
              {(a) => <Input {...a} {...register("reference")} />}
            </Field>
            <Field id="amount" label={t("field.amount")} required error={errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>
            {kind === "receipt" && (
              <Field id="charge" label={t("field.charge")} error={errors.charge?.message} hint={suggestedCharge ? t("chargeHint", { amount: fmtNum(suggestedCharge, locale, 2) }) : undefined}>
                {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("charge", { valueAsNumber: true })} />}
              </Field>
            )}

            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                {t("allocations")}
                {rows.length > 0 && <Button type="button" variant="outline" size="sm" onClick={autoAllocate} disabled={!amount}><ListChecks /> {t("autoAllocate")}</Button>}
              </legend>
              {!w.partyId ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t(k("pickPartyFirst"))}</p>
                : inv.isLoading ? <p className="p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />{tc("loading")}</p>
                : !rows.length ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("noOpen")}</p>
                : (
                  <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("allocations")}>
                    <table className="w-full min-w-[600px] text-sm">
                      <caption className="sr-only">{t("allocations")}</caption>
                      <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">{t("col.invoice")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.total")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.due")}</th>
                        <th scope="col" className="w-36 px-3 py-2 text-right font-medium">{t("col.allocate")}</th>
                      </tr></thead>
                      <tbody>
                        {allocs.fields.map((f, i) => {
                          const r = rows[i]
                          if (!r) return null
                          const v = Number(w.allocations?.[i]?.amount) || 0
                          const bad = v > r.due + 0.004 || !!errors.allocations?.[i]?.amount
                          return (
                            <tr key={f.id} className="border-b align-top last:border-0">
                              <td className="px-3 py-2"><span className="font-medium tabular">{r.no}</span><span className="block text-xs text-muted-foreground tabular">{fmtDate(r.date, locale)} · {t("days", { n: fmtNum(r.days, locale) })}</span></td>
                              <td className="px-3 py-2 text-right"><Money value={r.total} /></td>
                              <td className="px-3 py-2 text-right font-medium"><Money value={r.due} /></td>
                              <td className="px-3 py-1.5">
                                <Input aria-label={t("allocateFor", { no: r.no })} aria-invalid={bad || undefined} type="number" inputMode="decimal" step="0.01" min={0} max={r.due}
                                  className="text-right tabular" {...register(`allocations.${i}.amount`, { valueAsNumber: true })} />
                                {bad && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{tv("exceedsDue")}</p>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot className="border-t bg-muted/30 text-sm">
                        <tr><th scope="row" colSpan={3} className="px-3 py-1.5 text-left font-medium">{t("allocated")}</th><td className="px-3 py-1.5 text-right font-semibold"><Money value={allocated} /></td></tr>
                        <tr><th scope="row" colSpan={3} className="px-3 py-1.5 text-left font-medium">{t("onAccount")}</th><td className="px-3 py-1.5 text-right"><Money value={Math.max(0, onAccount)} /></td></tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              {overAlloc && <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-xs text-danger"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {tv("overAllocated")}</p>}
              {advanceBlocked && <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {tv("advanceNotAllowed")}</p>}
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t(k("formNote"))}</p>
            </fieldset>
            <Field id="note" label={t("field.note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={blocked}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={blocked} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
