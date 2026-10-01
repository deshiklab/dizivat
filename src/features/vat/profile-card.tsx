"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, useWatch } from "react-hook-form"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, CalendarClock, Loader2, Pencil, Save, Shirt } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Field } from "@/components/common/field"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import { atRateFor, FILER_CATEGORIES, IMPORTER_TYPES, isRmg, profileOf, returnDueDate, SEGMENTS } from "@/lib/rules"
import { vatProfileInput } from "@/lib/schemas"
import type { VatProfile, VatSettings } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

type FormValues = Omit<VatProfile, "holidays"> & { holidays: string }
const toForm = (p: VatProfile): FormValues => ({ ...p, holidays: p.holidays.join("\n") })
const CUR = TODAY.slice(0, 7)

/**
 * R6 — taxpayer profile: business segment (RMG direct / deemed exporter …), 100 % export-oriented status (Rule 21),
 * advance-tax class, return-deadline category, bond licence and the year's extra holidays used for due dates.
 */
export function ProfileCard({ settings }: { settings?: VatSettings }) {
  const t = useTranslations("rmg.profile")
  const tc = useTranslations("common")
  const tv = useTranslations("validation")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const [editing, setEditing] = React.useState(false)
  const current = profileOf(settings)
  const form = useForm<FormValues>({ defaultValues: toForm(current) })
  const { register, control, handleSubmit, reset, setError, formState: { errors, isDirty } } = form
  React.useEffect(() => { if (settings && !editing) reset(toForm(profileOf(settings))) }, [settings, editing, reset])
  const w = useWatch({ control }) as FormValues
  const live: VatProfile = editing ? { ...current, ...w, holidays: (w.holidays ?? "").split(/\s+/).filter(Boolean) } : current
  const save = useMutation({
    mutationFn: (profile: VatProfile) => api.vat.saveSettings({ zoneCode: settings!.zoneCode, profile }),
    onSuccess: () => { refresh(); toast.success(t("saved")); setEditing(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k.replace(/^profile\./, "").replace(/\.\d+$/, "") as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = handleSubmit((v) => {
    const r = vatProfileInput.safeParse({ ...v, holidays: v.holidays.split(/\s+/).filter(Boolean) })
    if (!r.success) { r.error.issues.forEach((i) => setError(String(i.path[0]) as never, { message: i.message })); return }
    save.mutate(r.data)
  })
  const msg = (m?: string) => (m ? (tv.has(m) ? tv(m) : m) : undefined)
  const bondSoon = live.bondLicenseExpiry && live.bondLicenseExpiry <= new Date(Date.parse(TODAY) + 90 * 864e5).toISOString().slice(0, 10)
  const sel = <K extends "segment" | "importerType" | "filerCategory">(name: K, opts: readonly string[], label: string, hint?: string) => (
    <Field id={`profile-${name}`} label={label} hint={hint} error={msg(errors[name]?.message)}>
      {(a) => <Controller control={control} name={name} render={({ field }) => (
        <Select value={field.value as string} onValueChange={(v) => field.onChange(v)} items={opts.map((o) => ({ value: o, label: t(`${name}.${o}` as never) }))}>
          <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{t(`${name}.${o}` as never)}</SelectItem>)}</SelectContent>
        </Select>
      )} />}
    </Field>
  )

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="grid gap-1"><CardTitle className="flex items-center gap-2"><Shirt className="size-4" aria-hidden /> {t("title")}</CardTitle><CardDescription>{t("sub")}</CardDescription></div>
          {can("settings.manage") && !editing && settings && <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> {t("edit")}</Button>}
        </CardHeader>
        <CardContent className="grid gap-4">
          {!settings ? <Skeleton className="h-40" /> : editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {sel("segment", SEGMENTS, t("segmentLabel"))}
              {sel("importerType", IMPORTER_TYPES, t("importerTypeLabel"), t("atRate", { rate: atRateFor(live, TODAY) }))}
              {sel("filerCategory", FILER_CATEGORIES, t("filerCategoryLabel"))}
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="grid gap-0.5"><Label htmlFor="profile-exportOriented">{t("exportOriented")}</Label><p className="text-xs text-muted-foreground">{t("exportOrientedHint")}</p></div>
                <Controller control={control} name="exportOriented" render={({ field }) => <Switch id="profile-exportOriented" checked={field.value} onCheckedChange={field.onChange} />} />
              </div>
              <Field id="profile-bondLicenseNo" label={t("bondLicenseNo")} required={isRmg(live) && live.exportOriented} error={msg(errors.bondLicenseNo?.message)}>{(a) => <Input className="tabular" {...a} {...register("bondLicenseNo")} />}</Field>
              <Field id="profile-bondLicenseExpiry" label={t("bondLicenseExpiry")} error={msg(errors.bondLicenseExpiry?.message)}>{(a) => <Input type="date" {...a} {...register("bondLicenseExpiry")} />}</Field>
              <Field id="profile-associationNo" label={t("associationNo")} error={msg(errors.associationNo?.message)} className="sm:col-span-2">{(a) => <Input {...a} {...register("associationNo")} />}</Field>
              <Field id="profile-holidays" label={t("holidays")} hint={t("holidaysHint")} error={msg(errors.holidays?.message)} className="sm:col-span-2">{(a) => <Textarea rows={3} className="tabular" {...a} {...register("holidays")} />}</Field>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t("segmentLabel")}</dt><dd className="font-medium">{t(`segment.${current.segment}`)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("importerTypeLabel")}</dt><dd>{t(`importerType.${current.importerType}`)} · {t("atRate", { rate: atRateFor(current, TODAY) })}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("filerCategoryLabel")}</dt><dd>{t(`filerCategory.${current.filerCategory}`)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("exportOriented")}</dt><dd>{current.exportOriented ? tc("yes") : tc("no")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("bondLicenseNo")}</dt><dd className="tabular">{current.bondLicenseNo || "—"}{current.bondLicenseExpiry && <span className="text-muted-foreground"> · {t("expires", { date: fmtDate(current.bondLicenseExpiry, locale) })}</span>}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("associationNo")}</dt><dd>{current.associationNo || "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{t("holidays")}</dt><dd className="tabular">{current.holidays.length ? current.holidays.map((d) => fmtDate(d, locale)).join(", ") : t("noHolidays")}</dd></div>
            </dl>
          )}
          {settings && bondSoon && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t(live.bondLicenseExpiry < TODAY ? "bondExpired" : "bondSoon", { date: fmtDate(live.bondLicenseExpiry, locale) })}</p>}
          {settings && <p className="flex items-center gap-2 rounded-md bg-muted p-2 text-xs"><CalendarClock className="size-3.5 shrink-0" aria-hidden /> {t("nextDue", { period: CUR, date: fmtDate(returnDueDate(CUR, { profile: live }), locale) })}</p>}
        </CardContent>
        {editing && (
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(toForm(current)); setEditing(false) }}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending || !isDirty}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {tc("save")}</Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
