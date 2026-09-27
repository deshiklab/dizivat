"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Globe2, Info, Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { api, ApiError } from "@/lib/api/client"
import { partyInput } from "@/lib/schemas"
import type { Party, PartyRow } from "@/lib/types"
import { HistorySection } from "@/features/audit/record-history"

type In = z.input<typeof partyInput>
type Out = z.output<typeof partyInput>
type Kind = "customer" | "vendor"
const blank: In = { name: "", mode: "Local", bin: "", country: "", mobile: "", email: "", contactPerson: "", address: "", active: true }

/**
 * Create / edit a customer or vendor in a side sheet (also used for quick-add from the invoice forms).
 * The BIN field adapts to the registration type: 13-digit BIN (Local), NID (Non-registered vendor), foreign reference (Foreign).
 */
export function PartySheet({ kind, open, onOpenChange, party, onSaved, readOnly = false }: {
  kind: Kind; open: boolean; onOpenChange: (o: boolean) => void; party?: Party | PartyRow | null; onSaved?: (p: Party) => void; readOnly?: boolean
}) {
  const t = useTranslations("parties")
  const tk = useTranslations(`parties.${kind}`)
  const tm = useTranslations("mode")
  const tc = useTranslations("common")
  const mk = (m: string) => m.replace("-r", "R") // "Non-registered" → catalog key "NonRegistered"
  const qc = useQueryClient()
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(partyInput), defaultValues: blank, mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(party ? {
      name: party.name, mode: party.mode, bin: party.bin, country: party.country ?? "", mobile: party.mobile, email: party.email ?? "",
      contactPerson: party.contactPerson ?? "", address: party.address, active: party.active !== false,
    } : blank)
  }, [open, party, reset])
  const mode = useWatch({ control, name: "mode" })
  const hasDocs = !!party && "docs" in party && party.docs > 0
  const client = kind === "customer" ? api.customers : api.vendors
  const save = useMutation({
    mutationFn: (v: Out) => (party ? client.update(party.id, v) : client.create(v)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [`${kind}s`] })
      toast.success(party ? t("updated", { name: r.name }) : t("created", { name: r.name }))
      onSaved?.(r)
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      // Field errors are shown inline (role=alert); a toast would also cover the sheet's Save button
      if (!(e instanceof ApiError && e.errors)) toast.error(e.message)
    },
  })
  const modes = kind === "customer" ? (["Local", "Foreign"] as const) : (["Local", "Foreign", "Non-registered"] as const)
  const binLabel = mode === "Local" ? t("field.bin") : mode === "Foreign" ? t("field.foreignRef") : t("field.nid")
  const binHint = mode === "Local" ? t("hint.bin") : mode === "Foreign" ? t("hint.foreignRef") : t("hint.nid")

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{readOnly ? tk("viewTitle") : party ? tk("editTitle") : tk("newTitle")}</SheetTitle>
            <SheetDescription>{party ? party.name : tk("newSub")}</SheetDescription>
          </SheetHeader>
          <fieldset disabled={readOnly} className="grid min-w-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label id="mode-label" className="text-sm">{t("field.mode")}<span className="text-destructive" aria-hidden> *</span></Label>
              <Controller control={control} name="mode" render={({ field }) => (
                <ToggleGroup aria-labelledby="mode-label" variant="outline" className="w-full" disabled={hasDocs}
                  value={[field.value]} onValueChange={(v: string[]) => { if (v[0]) field.onChange(v[0]) }}>
                  {modes.map((m) => <ToggleGroupItem key={m} value={m} className="flex-1">{m === "Foreign" && <Globe2 />} {tm(mk(m))}</ToggleGroupItem>)}
                </ToggleGroup>
              )} />
              {hasDocs
                ? <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("modeLocked")}</p>
                : <p className="text-xs text-muted-foreground">{t(`modeHint.${mk(mode)}`)}</p>}
              {errors.mode?.message && <p className="text-xs font-medium text-destructive" role="alert">{t(`error.${errors.mode.message}`)}</p>}
            </div>
            <Field id="name" label={t("field.name")} required error={errors.name?.message} hint={t("hint.name")} className="sm:col-span-2">
              {(a) => <Input autoFocus autoComplete="organization" className="uppercase placeholder:normal-case" {...a} {...register("name")} />}
            </Field>
            <Field id="bin" label={binLabel} required={mode !== "Non-registered"} error={errors.bin?.message} hint={binHint}>
              {(a) => <Input className="tabular" inputMode={mode === "Foreign" ? "text" : "numeric"} placeholder={mode === "Local" ? "000000000-0000" : ""} {...a} {...register("bin")} />}
            </Field>
            {mode === "Foreign"
              ? <Field id="country" label={t("field.country")} required error={errors.country?.message}>{(a) => <Input autoComplete="country-name" {...a} {...register("country")} />}</Field>
              : <Field id="contactPerson" label={t("field.contact")} error={errors.contactPerson?.message}>{(a) => <Input autoComplete="name" {...a} {...register("contactPerson")} />}</Field>}
            <Field id="mobile" label={t("field.mobile")} error={errors.mobile?.message} hint={mode === "Foreign" ? undefined : "01XXX-XXXXXX"}>
              {(a) => <Input type="tel" autoComplete="tel" className="tabular" {...a} {...register("mobile")} />}
            </Field>
            <Field id="email" label={t("field.email")} error={errors.email?.message}>{(a) => <Input type="email" autoComplete="email" {...a} {...register("email")} />}</Field>
            {mode === "Foreign" && <Field id="contactPerson" label={t("field.contact")} error={errors.contactPerson?.message} className="sm:col-span-2">{(a) => <Input autoComplete="name" {...a} {...register("contactPerson")} />}</Field>}
            <Field id="address" label={t("field.address")} required error={errors.address?.message} hint={kind === "customer" ? t("hint.address") : undefined} className="sm:col-span-2">
              {(a) => <Textarea rows={2} autoComplete="street-address" {...a} {...register("address")} />}
            </Field>
            {mode === "Foreign" && (
              <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-xs sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {tk("foreignNote")}</p>
            )}
            {mode === "Non-registered" && (
              <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("nonRegNote")}</p>
            )}
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
              <div className="grid gap-0.5">
                <Label htmlFor="active">{t("field.active")}</Label>
                <p className="text-xs text-muted-foreground">{tk("activeHint")}</p>
              </div>
              <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />} />
            </div>
            {party && <HistorySection entityId={party.id} className="sm:col-span-2" />}
          </fieldset>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? tc("close") : tc("cancel")}</Button>
            {!readOnly && <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {tc("save")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
