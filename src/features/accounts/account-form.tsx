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
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { ACCOUNT_KINDS, BANKS, WALLETS } from "@/lib/r4"
import { accountInput } from "@/lib/schemas"
import type { AccountKind, BankAccountType, MoneyAccountRow, WalletType } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues {
  kind: AccountKind; provider: string; accountNo: string; owner: string; branch: string; address: string; bankType?: BankAccountType; walletType?: WalletType
  authorised: string; serviceCharge: number; openingBalance: number; openingDate: string; active: boolean
}
const BANK_TYPES: BankAccountType[] = ["current", "savings", "transaction", "other"]
const WALLET_TYPES: WalletType[] = ["merchant", "general", "personal"]

/** Add / edit a bank, mobile-wallet or cash account. Kind is fixed once created. */
export function AccountForm({ open, onOpenChange, account, kind }: { open: boolean; onOpenChange: (o: boolean) => void; account?: MoneyAccountRow | null; kind?: AccountKind }) {
  const t = useTranslations("acct")
  const tc = useTranslations("common")
  const refresh = useR4Refresh()
  const blank = React.useCallback((): FormValues => ({
    kind: kind ?? "bank", provider: "", accountNo: "", owner: "", branch: "", address: "", bankType: "current", walletType: "merchant", authorised: "", serviceCharge: 0, openingBalance: 0, openingDate: TODAY, active: true,
  }), [kind])
  const form = useForm<FormValues>({ resolver: zodResolver(accountInput as never) as unknown as Resolver<FormValues>, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(account ? {
      kind: account.kind, provider: account.provider, accountNo: account.accountNo, owner: account.owner, branch: account.branch ?? "", address: account.address ?? "",
      bankType: account.bankType ?? "current", walletType: account.walletType ?? "merchant", authorised: account.authorised ?? "", serviceCharge: account.serviceCharge,
      openingBalance: account.openingBalance, openingDate: account.openingDate, active: account.active,
    } : blank())
  }, [open, account, reset, blank])
  const k = useWatch({ control, name: "kind" })
  const save = useMutation({
    mutationFn: (v: FormValues) => (account ? api.accounting.accounts.update(account.id, v) : api.accounting.accounts.create(v)),
    onSuccess: (a) => { refresh(); toast.success(t(account ? "updated" : "created", { name: `${a.provider} · ${a.accountNo}` })); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([key, v]) => setError(key as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const providers = k === "bank" ? BANKS : k === "mobile" ? WALLETS : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{account ? t("editTitle", { name: account.provider }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("formSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="kind" label={t("field.kind")} required error={errors.kind?.message} className="sm:col-span-2" hint={account ? t("kindLocked") : undefined}>
              {(a) => <Controller control={control} name="kind" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v)} disabled={!!account} items={ACCOUNT_KINDS.map((x) => ({ value: x, label: t(`kind.${x}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_KINDS.map((x) => <SelectItem key={x} value={x}>{t(`kind.${x}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="provider" label={t(`field.provider.${k}`)} required error={errors.provider?.message} className="sm:col-span-2">
              {(a) => <><Input list="provider-list" autoComplete="off" {...a} {...register("provider")} /><datalist id="provider-list">{providers.map((b) => <option key={b} value={b} />)}</datalist></>}
            </Field>
            <Field id="accountNo" label={t(`field.accountNo.${k}`)} required={k !== "cash"} error={errors.accountNo?.message}>{(a) => <Input inputMode={k === "mobile" ? "tel" : undefined} className="tabular" {...a} {...register("accountNo")} />}</Field>
            {k === "bank" && <Field id="branch" label={t("field.branch")} error={errors.branch?.message}>{(a) => <Input {...a} {...register("branch")} />}</Field>}
            {k === "bank" && (
              <Field id="bankType" label={t("field.bankType")} required error={errors.bankType?.message}>
                {(a) => <Controller control={control} name="bankType" render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={BANK_TYPES.map((x) => ({ value: x, label: t(`bankType.${x}`) }))}>
                    <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{BANK_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`bankType.${x}`)}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
            )}
            {k === "mobile" && (
              <>
                <Field id="walletType" label={t("field.walletType")} required error={errors.walletType?.message}>
                  {(a) => <Controller control={control} name="walletType" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)} items={WALLET_TYPES.map((x) => ({ value: x, label: t(`walletType.${x}`) }))}>
                      <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{WALLET_TYPES.map((x) => <SelectItem key={x} value={x}>{t(`walletType.${x}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />}
                </Field>
                <Field id="authorised" label={t("field.authorised")} required error={errors.authorised?.message}>{(a) => <Input {...a} {...register("authorised")} />}</Field>
              </>
            )}
            <Field id="owner" label={t("field.owner")} required error={errors.owner?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("owner")} />}</Field>
            <Field id="serviceCharge" label={t("field.serviceCharge")} required error={errors.serviceCharge?.message} hint={t("hint.serviceCharge")}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} max={10} className="text-right tabular" {...a} {...register("serviceCharge", { valueAsNumber: true })} />}
            </Field>
            <Field id="openingBalance" label={t("field.openingBalance")} required error={errors.openingBalance?.message}>
              {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("openingBalance", { valueAsNumber: true })} />}
            </Field>
            <Field id="openingDate" label={t("field.openingDate")} required error={errors.openingDate?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("openingDate")} />}</Field>
            <Field id="address" label={t("field.address")} error={errors.address?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("address")} />}</Field>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} />} />
              <label htmlFor="active" className="text-sm">{t("field.active")}</label>
            </div>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {tc("save")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
