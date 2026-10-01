"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Pencil, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { Field } from "@/components/common/field"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { fmtDateTime } from "@/lib/format"
import { economicCode, HEAD_NOTE, RETURN_NOTES, RETURN_PARTS, TREASURY_HEADS } from "@/lib/r4"
import { vatSettingsInput } from "@/lib/schemas"
import { useR4Refresh } from "@/features/r4/r4-actions"
import { ProfileCard } from "./profile-card"

/** NBR settings: VAT zone code for the economic codes (Part 9 of 9.1), and the Mushak 9.1 note catalogue with where each note comes from. */
export function VatSettingsPage() {
  const t = useTranslations("vatSettings")
  const tr = useTranslations("treasury")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const q = useQuery({ queryKey: ["vat-settings"], queryFn: () => api.vat.settings() })
  const [editing, setEditing] = React.useState(false)
  const form = useForm<{ zoneCode: string }>({ resolver: zodResolver(vatSettingsInput as never) as unknown as Resolver<{ zoneCode: string }>, defaultValues: { zoneCode: "" } })
  const { register, handleSubmit, reset, setError, watch, formState: { errors, isDirty } } = form
  React.useEffect(() => { if (q.data) reset({ zoneCode: q.data.zoneCode }) }, [q.data, reset])
  const save = useMutation({
    mutationFn: (v: { zoneCode: string }) => api.vat.saveSettings({ ...v, profile: q.data?.profile }),
    onSuccess: () => { refresh(); toast.success(t("saved")); setEditing(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const zone = (editing ? watch("zoneCode") : q.data?.zoneCode) || "0000"
  const isBn = locale === "bn"

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-4">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="grid gap-1"><CardTitle>{t("zoneCard")}</CardTitle><CardDescription>{q.data?.updatedAt ? t("updated", { by: q.data.updatedBy ?? "", when: fmtDateTime(q.data.updatedAt, locale) }) : t("zoneHint")}</CardDescription></div>
              {can("settings.manage") && !editing && q.data && <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> {t("edit")}</Button>}
            </CardHeader>
            <CardContent className="grid gap-4">
              {!q.data ? <Skeleton className="h-10" /> : editing
                ? <Field id="zoneCode" label={t("zoneCode")} required error={errors.zoneCode?.message} hint={t("zoneHint")}>{(a) => <Input inputMode="numeric" maxLength={4} className="max-w-32 tabular" {...a} {...register("zoneCode")} />}</Field>
                : <div className="grid gap-1"><span className="text-sm">{t("zoneCode")}</span><span className="text-lg font-semibold tabular">{q.data.zoneCode}</span></div>}
              <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("codes")}>
                <table className="w-full min-w-[420px] text-sm">
                  <caption className="sr-only">{t("codes")}</caption>
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">{t("col.head")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("col.code")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.note")}</th>
                  </tr></thead>
                  <tbody>
                    {TREASURY_HEADS.map((h) => (
                      <tr key={h} className="border-b last:border-0"><td className="px-3 py-1.5">{tr(`head.${h}`)}</td><td className="px-3 py-1.5 tabular">{economicCode(h, zone)}</td><td className="px-3 py-1.5 text-right tabular">{HEAD_NOTE[h]}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
            {editing && (
              <CardFooter className="justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => { reset({ zoneCode: q.data?.zoneCode ?? "" }); setEditing(false) }}>{tc("cancel")}</Button>
                <Button type="submit" disabled={save.isPending || !isDirty}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {tc("save")}</Button>
              </CardFooter>
            )}
          </Card>
        </form>
        <ProfileCard settings={q.data} />
        </div>
        <Card>
          <CardHeader><CardTitle>{t("notesCard")}</CardTitle><CardDescription>{t("notesHint")}</CardDescription></CardHeader>
          <CardContent className="px-0">
            <div className="max-h-[36rem] overflow-y-auto" tabIndex={0} role="region" aria-label={t("notesCard")}>
              <table className="w-full text-sm">
                <caption className="sr-only">{t("notesCard")}</caption>
                <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">{t("col.noteNo")}</th>
                  <th scope="col" className="px-2 py-2 font-medium">{t("col.desc")}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t("col.source")}</th>
                </tr></thead>
                {RETURN_PARTS.map((p) => (
                  <tbody key={p.part}>
                    <tr className="bg-muted/40"><th scope="rowgroup" colSpan={3} className="px-4 py-1.5 text-left text-xs font-semibold">{isBn ? p.bn : p.en}</th></tr>
                    {RETURN_NOTES.filter((n) => n.part === p.part).map((n) => (
                      <tr key={n.note} className="border-b last:border-0">
                        <td className="px-4 py-1.5 tabular">{n.note}</td>
                        <td className="px-2 py-1.5">{isBn ? n.bn : n.en}</td>
                        <td className="px-4 py-1.5 text-xs text-muted-foreground">{n.formula ?? (t.has(`source.${n.note}`) ? t(`source.${n.note}`) : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
