"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Pencil, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { Field } from "@/components/common/field"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { accountingConfigInput } from "@/lib/schemas"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface FormValues { closedUpTo: string; allowAdvance: boolean; autoAllocate: boolean }

/** Accounting configuration — books closed up to (legacy "Account close"), advances and auto-allocation. Explicit edit mode. */
export function AccountingConfigPage() {
  const t = useTranslations("acctConfig")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const q = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config() })
  const [editing, setEditing] = React.useState(false)
  const form = useForm<FormValues>({ resolver: zodResolver(accountingConfigInput as never) as unknown as Resolver<FormValues>, defaultValues: { closedUpTo: "", allowAdvance: true, autoAllocate: true } })
  const { register, control, handleSubmit, reset, setError, formState: { errors, isDirty } } = form
  React.useEffect(() => { if (q.data) reset({ closedUpTo: q.data.closedUpTo ?? "", allowAdvance: q.data.allowAdvance, autoAllocate: q.data.autoAllocate }) }, [q.data, reset])
  const save = useMutation({
    mutationFn: (v: FormValues) => api.accounting.saveConfig(v),
    onSuccess: () => { refresh(); toast.success(t("saved")); setEditing(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const cancel = () => { if (q.data) reset({ closedUpTo: q.data.closedUpTo ?? "", allowAdvance: q.data.allowAdvance, autoAllocate: q.data.autoAllocate }); setEditing(false) }
  const c = q.data

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={can("settings.manage") && !editing && c ? <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {t("edit")}</Button> : undefined} />
      {!c ? <Skeleton className="h-64 max-w-2xl" /> : (
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>{t("card")}</CardTitle>
              <CardDescription>{c.updatedAt ? t("updated", { by: c.updatedBy ?? "", when: fmtDateTime(c.updatedAt, locale) }) : t("never")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {editing ? (
                <Field id="closedUpTo" label={t("closedUpTo")} error={errors.closedUpTo?.message} hint={t("closedHint")}>
                  {(a) => <Input type="date" max={TODAY} className="max-w-56" {...a} {...register("closedUpTo")} />}
                </Field>
              ) : (
                <div className="grid gap-1"><span className="text-sm">{t("closedUpTo")}</span><span className="font-medium">{c.closedUpTo ? fmtDate(c.closedUpTo, locale) : t("open")}</span><span className="text-xs text-muted-foreground">{t("closedHint")}</span></div>
              )}
              {(["allowAdvance", "autoAllocate"] as const).map((k) => (
                <div key={k} className="flex items-start gap-3">
                  <Controller control={control} name={k} render={({ field }) => <Switch id={k} checked={field.value} onCheckedChange={field.onChange} disabled={!editing} aria-describedby={`${k}-hint`} />} />
                  <div className="grid gap-0.5"><label htmlFor={k} className="text-sm font-medium">{t(k)}</label><p id={`${k}-hint`} className="text-xs text-muted-foreground">{t(`${k}Hint`)}</p></div>
                </div>
              ))}
            </CardContent>
            {editing && (
              <CardFooter className="justify-end gap-2">
                <Button type="button" variant="outline" onClick={cancel}>{tc("cancel")}</Button>
                <Button type="submit" disabled={save.isPending || !isDirty}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {tc("save")}</Button>
              </CardFooter>
            )}
          </Card>
        </form>
      )}
    </>
  )
}
