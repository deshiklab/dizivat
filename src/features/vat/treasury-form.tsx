"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
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
import { useCan, useCompany, useMe } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { BANKS, DISTRICTS, economicCode, periodLabel, TREASURY_HEADS, TREASURY_MODES } from "@/lib/r4"
import { treasuryInput } from "@/lib/schemas"
import type { TreasuryDeposit, TreasuryHead, TreasuryMode } from "@/lib/types"
import { usePeriods, useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues {
  head: TreasuryHead; taxPeriod: string; challanNo: string; challanDate: string; mode: TreasuryMode; bank: string; bankBranch: string; district: string; bankAddress: string
  accountId: string; amount: number; depositor: string; designation: string; address: string; description: string; process: "Created" | "Approved"
}
const NONE = "__none"

/** New / edit-draft treasury deposit. Only open (not submitted) tax periods can take a deposit. */
export function TreasuryForm({ open, onOpenChange, doc, preset, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: TreasuryDeposit | null; preset?: { period?: string | null; head?: string | null; amount?: string | null }; onSaved?: (d: TreasuryDeposit) => void
}) {
  const t = useTranslations("treasury")
  const tc = useTranslations("common")
  const can = useCan()
  const me = useMe()
  const company = useCompany()
  const refresh = useR4Refresh()
  const periods = usePeriods()
  const settings = useQuery({ queryKey: ["vat-settings"], queryFn: () => api.vat.settings(), enabled: open })
  const accounts = useQuery({ queryKey: ["accounts", "options"], queryFn: () => api.accounting.accounts.options(), enabled: open })
  const openPeriods = (periods.data ?? []).filter((p) => !p.locked)

  const blank = React.useCallback((): FormValues => {
    const head = (TREASURY_HEADS as string[]).includes(preset?.head ?? "") ? (preset!.head as TreasuryHead) : "vat"
    const period = preset?.period ?? TODAY.slice(0, 7)
    return {
      head, taxPeriod: period, challanNo: "", challanDate: TODAY, mode: "online", bank: "SONALI BANK PLC.", bankBranch: "", district: "Gazipur", bankAddress: "", accountId: "",
      amount: preset?.amount ? Number(preset.amount) : NaN, depositor: me.user.name, designation: me.user.designation, address: company.address,
      description: t("defaultDescription", { head: t(`head.${head}`), period: periodLabel(period) }), process: "Created",
    }
  }, [preset, me.user.name, me.user.designation, company.address, t])
  const form = useForm<FormValues>({ resolver: zodResolver(treasuryInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(doc ? {
      head: doc.head, taxPeriod: doc.taxPeriod, challanNo: doc.challanNo, challanDate: doc.challanDate, mode: doc.mode, bank: doc.bank, bankBranch: doc.bankBranch, district: doc.district,
      bankAddress: doc.bankAddress ?? "", accountId: doc.accountId ?? "", amount: doc.amount, depositor: doc.depositor, designation: doc.designation ?? "", address: doc.address, description: doc.description, process: "Created",
    } : blank())
  }, [open, doc, reset, blank])
  const w = useWatch({ control })
  const save = useMutation({
    mutationFn: (v: FormValues) => (doc ? api.vat.treasury.update(doc.id, v) : api.vat.treasury.create(v)),
    onSuccess: (d) => { refresh("treasury", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.challanNo })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const bankAccounts = (accounts.data ?? []).filter((a) => a.kind === "bank")
  const sel = <T extends string>(name: keyof FormValues, items: { value: T; label: string }[], a: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select value={String(field.value ?? "")} onValueChange={(v) => field.onChange(v)} items={items}>
        <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.challanNo }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="head" label={t("field.head")} required error={errors.head?.message} hint={t("codeHint", { code: economicCode((w.head ?? "vat") as TreasuryHead, settings.data?.zoneCode ?? "0015") })}>
              {(a) => sel("head", TREASURY_HEADS.map((h) => ({ value: h, label: t(`head.${h}`) })), a)}
            </Field>
            <Field id="taxPeriod" label={t("field.period")} required error={errors.taxPeriod?.message} hint={t("periodHint")}>
              {(a) => sel("taxPeriod", openPeriods.map((p) => ({ value: p.period, label: periodLabel(p.period) })), a)}
            </Field>
            <Field id="challanNo" label={t("field.challanNo")} required error={errors.challanNo?.message}>{(a) => <Input className="tabular" {...a} {...register("challanNo")} />}</Field>
            <Field id="challanDate" label={t("field.challanDate")} required error={errors.challanDate?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("challanDate")} />}</Field>
            <Field id="amount" label={t("field.amount")} required error={errors.amount?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="1" min={1} className="text-right tabular" {...a} {...register("amount", { valueAsNumber: true })} />}
            </Field>
            <Field id="mode" label={t("field.mode")} required error={errors.mode?.message}>{(a) => sel("mode", TREASURY_MODES.map((m) => ({ value: m, label: t(`mode.${m}`) })), a)}</Field>
            <Field id="bank" label={t("field.bank")} required error={errors.bank?.message}>
              {(a) => <Controller control={control} name="bank" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }}
                  options={BANKS.map((b) => ({ value: b, label: b }))} placeholder={t("pickBank")} searchPlaceholder={t("searchBank")} empty={tc("noResults")} />
              )} />}
            </Field>
            <Field id="bankBranch" label={t("field.branch")} required error={errors.bankBranch?.message}>{(a) => <Input {...a} {...register("bankBranch")} />}</Field>
            <Field id="district" label={t("field.district")} required error={errors.district?.message}>
              {(a) => <Controller control={control} name="district" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={(v) => { field.onChange(v); field.onBlur() }}
                  options={DISTRICTS.map((b) => ({ value: b, label: b }))} placeholder={t("pickDistrict")} searchPlaceholder={t("searchDistrict")} empty={tc("noResults")} />
              )} />}
            </Field>
            <Field id="accountId" label={t("field.account")} error={errors.accountId?.message} hint={t("accountHint")}>
              {(a) => <Controller control={control} name="accountId" render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} items={[{ value: NONE, label: t("noAccount") }, ...bankAccounts.map((x) => ({ value: x.id, label: `${x.provider} · ${x.accountNo}` }))]}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>{t("noAccount")}</SelectItem>{bankAccounts.map((x) => <SelectItem key={x.id} value={x.id}>{x.provider} · {x.accountNo}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="bankAddress" label={t("field.bankAddress")} error={errors.bankAddress?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("bankAddress")} />}</Field>
            <Field id="depositor" label={t("field.depositor")} required error={errors.depositor?.message}>{(a) => <Input {...a} {...register("depositor")} />}</Field>
            <Field id="designation" label={t("field.designation")} error={errors.designation?.message}>{(a) => <Input {...a} {...register("designation")} />}</Field>
            <Field id="address" label={t("field.address")} required error={errors.address?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("address")} />}</Field>
            <Field id="description" label={t("field.description")} required error={errors.description?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("description")} />}</Field>
            <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("formNote")}</p>
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
