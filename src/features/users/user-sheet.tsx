"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { HistorySection } from "@/features/audit/record-history"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { useMe } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { ROLES, type User } from "@/lib/auth/roles"
import { userInput } from "@/lib/schemas"

type In = z.input<typeof userInput>
type Out = z.output<typeof userInput>
const blank: In = { username: "", name: "", designation: "", email: "", mobile: "", department: "", role: "operator", active: true }

/** Invite a user (returns a one-time password) or edit profile / role / status. */
export function UserSheet({ open, onOpenChange, user, onInvited }: {
  open: boolean; onOpenChange: (o: boolean) => void; user: User | null; onInvited: (username: string, password: string) => void
}) {
  const t = useTranslations("users")
  const tr = useTranslations("roles")
  const tc = useTranslations("common")
  const me = useMe()
  const qc = useQueryClient()
  const self = !!user && user.id === me.user.id
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(userInput), defaultValues: blank, mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  React.useEffect(() => {
    if (!open) return
    reset(user ? {
      username: user.username, name: user.name, designation: user.designation, email: user.email,
      mobile: user.mobile ?? "", department: user.department ?? "", role: user.role, active: user.active,
    } : blank)
  }, [open, user, reset])

  const save = useMutation({
    mutationFn: async (v: Out) => {
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { username, ...rest } = v
        return { user: await api.users.update(user.id, rest), tempPassword: null }
      }
      return api.users.invite(v)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["users"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      if (r.tempPassword) onInvited(r.user.username, r.tempPassword)
      else toast.success(t("updated", { name: r.user.name }))
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{user ? t("editTitle") : t("newTitle")}</SheetTitle>
            <SheetDescription>{user ? `${user.name} · @${user.username}` : t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-w-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="name" label={t("field.name")} required error={errors.name?.message} className="sm:col-span-2">
              {(a) => <Input autoFocus autoComplete="off" {...a} {...register("name")} />}
            </Field>
            <Field id="username" label={t("field.username")} required error={errors.username?.message} hint={user ? t("hint.usernameFixed") : t("hint.username")}>
              {(a) => <Input autoComplete="off" spellCheck={false} disabled={!!user} className="lowercase" {...a} {...register("username")} />}
            </Field>
            <Field id="designation" label={t("field.designation")} required error={errors.designation?.message}>
              {(a) => <Input autoComplete="organization-title" {...a} {...register("designation")} />}
            </Field>
            <Field id="email" label={t("field.email")} required error={errors.email?.message}>
              {(a) => <Input type="email" autoComplete="off" {...a} {...register("email")} />}
            </Field>
            <Field id="mobile" label={t("field.mobile")} error={errors.mobile?.message} hint="01XXX-XXXXXX">
              {(a) => <Input type="tel" autoComplete="off" className="tabular" {...a} {...register("mobile")} />}
            </Field>
            <Field id="department" label={t("field.department")} error={errors.department?.message} hint={t("hint.department")} className="sm:col-span-2">
              {(a) => <Input autoComplete="off" {...a} {...register("department")} />}
            </Field>

            <fieldset className="grid gap-2 sm:col-span-2" disabled={self}>
              <legend className="mb-1.5 text-sm font-medium">{t("field.role")}<span className="text-destructive" aria-hidden> *</span></legend>
              <Controller control={control} name="role" render={({ field }) => (
                <RadioGroup disabled={self} value={field.value} onValueChange={(v) => field.onChange(v as In["role"])} className="grid gap-2" aria-describedby={errors.role ? "role-err" : undefined}>
                  {ROLES.map((r) => (
                    <label key={r} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-70">
                      <RadioGroupItem value={r} className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{tr(r)}</span>
                        <span className="text-xs text-muted-foreground">{t(`roleHint.${r}`)}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )} />
              {errors.role?.message && <p id="role-err" role="alert" className="text-xs font-medium text-destructive">{t(`error.${errors.role.message}`)}</p>}
            </fieldset>

            <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
              <div className="grid gap-0.5">
                <Label htmlFor="active">{t("field.active")}</Label>
                <p className="text-xs text-muted-foreground">{t("hint.active")}</p>
              </div>
              <Controller control={control} name="active" render={({ field }) => <Switch id="active" checked={field.value} onCheckedChange={field.onChange} disabled={self} />} />
            </div>
            {errors.active?.message && <p role="alert" className="text-xs font-medium text-destructive sm:col-span-2">{t(`error.${errors.active.message}`)}</p>}
            {self && <p className="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2"><Lock className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("selfNote")}</p>}
            {!user && <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-xs sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("inviteNote")}</p>}
            {user && <HistorySection entityId={user.id} className="sm:col-span-2" />}
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {user ? tc("save") : t("invite")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
