"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, Eye, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, useUnsavedGuard } from "@/components/common/field"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { companyInput } from "@/lib/schemas"
import type { Company } from "@/lib/types"
import { fmtDateTime } from "@/lib/format"

type In = z.input<typeof companyInput>
type Out = z.output<typeof companyInput>
const SLABS = ["standard", "truncated", "turnover", "exempt"] as const
const CATS = ["factory", "warehouse", "office", "sales"] as const

const toForm = (c: Company): In => ({
  name: c.name, vatSlab: c.vatSlab, bin: c.bin, tin: c.tin, mobile: c.mobile, phone: c.phone ?? "", email: c.email, address: c.address,
  owner: { name: c.owner.name, nid: c.owner.nid ?? "", mobile: c.owner.mobile, designation: c.owner.designation ?? "" },
  signatory: { ...c.signatory },
  branches: c.branches.map((b) => ({ id: b.id, name: b.name, address: b.address, category: b.category, code: b.code ?? "" })),
})

/** Company profile (legacy "Manage Organization"). Everyone can read it; settings.manage can edit. */
export function CompanyPage() {
  const t = useTranslations("company")
  const q = useQuery({ queryKey: ["company"], queryFn: api.company.get })
  if (q.error) return <><PageHeader title={t("title")} /><EmptyState title={t("loadError")} action={<Button variant="outline" onClick={() => q.refetch()}>{t("retry")}</Button>} /></>
  if (!q.data) return (
    <><PageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48 w-full" />)}</div></>
  )
  return <CompanyForm company={q.data} />
}

function CompanyForm({ company }: { company: Company }) {
  const t = useTranslations("company")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const canEdit = useCan()("settings.manage")
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(companyInput), defaultValues: toForm(company), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors, isDirty } } = form
  const branches = useFieldArray({ control, name: "branches", keyName: "_key" })
  useUnsavedGuard(isDirty)

  const save = useMutation({
    mutationFn: (v: Out) => api.company.update(v),
    onSuccess: (c) => {
      qc.setQueryData(["company"], c)
      qc.invalidateQueries({ queryKey: ["me"] }) // name/BIN in the shell, footer and Mushak 6.3
      reset(toForm(c))
      toast.success(t("saved"))
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const locked = !canEdit || save.isPending

  const tf = (k: string) => t(`field.${k}`)

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4 pb-20">
      <PageHeader
        title={t("title")}
        description={company.updatedAt ? t("lastUpdated", { by: company.updatedBy ?? "—", when: fmtDateTime(company.updatedAt, locale) }) : t("subtitle")}
      />
      {!canEdit && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm"><Eye className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("readOnly")}</p>
      )}
      {/* base-ui controls (Select) are spans, not form elements — fieldset[disabled] does not reach them */}
      <fieldset disabled={locked} className="grid min-w-0 gap-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4 text-primary" aria-hidden /> {t("sectionOrg")}</CardTitle><CardDescription>{t("sectionOrgSub")}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="name" label={tf("name")} required error={errors.name?.message} className="sm:col-span-2">{(a) => <Input autoComplete="organization" {...a} {...register("name")} />}</Field>
            <Field id="vatSlab" label={tf("vatSlab")} required error={errors.vatSlab?.message}>
              {(a) => <Controller control={control} name="vatSlab" render={({ field }) => (
                <Select disabled={locked} value={field.value} onValueChange={field.onChange} items={SLABS.map((s) => ({ value: s, label: t(`slab.${s}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{SLABS.map((s) => <SelectItem key={s} value={s}>{t(`slab.${s}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="bin" label={tf("bin")} required error={errors.bin?.message} hint={t("hint.bin")}>{(a) => <Input className="tabular" inputMode="numeric" placeholder="000000000-0000" {...a} {...register("bin")} />}</Field>
            <Field id="tin" label={tf("tin")} required error={errors.tin?.message} hint={t("hint.tin")}>{(a) => <Input className="tabular" inputMode="numeric" {...a} {...register("tin")} />}</Field>
            <Field id="email" label={tf("email")} required error={errors.email?.message}>{(a) => <Input type="email" autoComplete="email" {...a} {...register("email")} />}</Field>
            <Field id="mobile" label={tf("mobile")} required error={errors.mobile?.message} hint="01XXX-XXXXXX">{(a) => <Input type="tel" className="tabular" {...a} {...register("mobile")} />}</Field>
            <Field id="phone" label={tf("phone")} error={errors.phone?.message}>{(a) => <Input type="tel" className="tabular" {...a} {...register("phone")} />}</Field>
            <Field id="address" label={tf("address")} required error={errors.address?.message} hint={t("hint.address")} className="sm:col-span-2 lg:col-span-3">{(a) => <Textarea rows={2} autoComplete="street-address" {...a} {...register("address")} />}</Field>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t("sectionOwner")}</CardTitle><CardDescription>{t("sectionOwnerSub")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="owner.name" label={tf("personName")} required error={errors.owner?.name?.message} className="sm:col-span-2">{(a) => <Input {...a} {...register("owner.name")} />}</Field>
              <Field id="owner.designation" label={tf("designation")} error={errors.owner?.designation?.message}>{(a) => <Input {...a} {...register("owner.designation")} />}</Field>
              <Field id="owner.mobile" label={tf("mobile")} required error={errors.owner?.mobile?.message}>{(a) => <Input type="tel" className="tabular" {...a} {...register("owner.mobile")} />}</Field>
              <Field id="owner.nid" label={tf("nid")} error={errors.owner?.nid?.message} className="sm:col-span-2">{(a) => <Input className="tabular" inputMode="numeric" {...a} {...register("owner.nid")} />}</Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("sectionSignatory")}</CardTitle><CardDescription>{t("sectionSignatorySub")}</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="signatory.name" label={tf("personName")} required error={errors.signatory?.name?.message}>{(a) => <Input {...a} {...register("signatory.name")} />}</Field>
              <Field id="signatory.designation" label={tf("designation")} required error={errors.signatory?.designation?.message}>{(a) => <Input {...a} {...register("signatory.designation")} />}</Field>
              <Field id="signatory.mobile" label={tf("mobile")} required error={errors.signatory?.mobile?.message}>{(a) => <Input type="tel" className="tabular" {...a} {...register("signatory.mobile")} />}</Field>
              <Field id="signatory.email" label={tf("email")} required error={errors.signatory?.email?.message}>{(a) => <Input type="email" {...a} {...register("signatory.email")} />}</Field>
              <Field id="signatory.nid" label={tf("nidOrPassport")} required error={errors.signatory?.nid?.message} className="sm:col-span-2">{(a) => <Input className="tabular" {...a} {...register("signatory.nid")} />}</Field>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div className="grid gap-1.5"><CardTitle>{t("sectionBranches")}</CardTitle><CardDescription>{t("sectionBranchesSub")}</CardDescription></div>
            {canEdit && <Button type="button" variant="outline" size="sm" onClick={() => branches.append({ id: "", name: "", address: "", category: "warehouse", code: "" })}><Plus /> {t("addBranch")}</Button>}
          </CardHeader>
          <CardContent className="grid gap-3">
            {branches.fields.map((b, i) => {
              const e = errors.branches?.[i]
              return (
                <fieldset key={b._key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-start">
                  <legend className="sr-only">{t("branchN", { n: i + 1 })}</legend>
                  <Field id={`branches.${i}.name`} label={tf("branchName")} required error={e?.name?.message}>{(a) => <Input {...a} {...register(`branches.${i}.name`)} />}</Field>
                  <Field id={`branches.${i}.category`} label={tf("category")} required>
                    {(a) => <Controller control={control} name={`branches.${i}.category`} render={({ field }) => (
                      <Select disabled={locked} value={field.value} onValueChange={field.onChange} items={CATS.map((c) => ({ value: c, label: t(`cat.${c}`) }))}>
                        <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{t(`cat.${c}`)}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />}
                  </Field>
                  <Field id={`branches.${i}.code`} label={tf("branchCode")} error={e?.code?.message}>{(a) => <Input className="tabular" inputMode="numeric" maxLength={4} {...a} {...register(`branches.${i}.code`)} />}</Field>
                  <div className="flex sm:pt-6">
                    {canEdit && <Button type="button" variant="ghost" size="icon" disabled={branches.fields.length <= 1} aria-label={t("removeBranch", { name: b.name || t("branchN", { n: i + 1 }) })} onClick={() => branches.remove(i)}><Trash2 /></Button>}
                  </div>
                  <Field id={`branches.${i}.address`} label={tf("address")} required error={e?.address?.message} className="sm:col-span-4">{(a) => <Input {...a} {...register(`branches.${i}.address`)} />}</Field>
                </fieldset>
              )
            })}
            {errors.branches?.root?.message && <p role="alert" className="text-xs font-medium text-destructive">{t(`error.${errors.branches.root.message}`)}</p>}
          </CardContent>
        </Card>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {isDirty && <span className="mr-auto text-sm text-muted-foreground" role="status">{t("unsaved")}</span>}
          <Button type="button" variant="outline" disabled={!isDirty || save.isPending} onClick={() => reset(toForm(company))}><RotateCcw /> {t("discard")}</Button>
          <Button type="submit" disabled={!isDirty || save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {tc("save")}</Button>
        </div>
      )}
    </form>
  )
}
