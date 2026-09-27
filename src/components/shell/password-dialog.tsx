"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, LogOut } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/common/field"
import { useMe } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import type { Me } from "@/lib/auth/roles"
import { passwordChange, type PasswordChange } from "@/lib/schemas"
import { useShell } from "./shell-context"

const blank: PasswordChange = { current: "", next: "", confirm: "" }

/**
 * Change own password. Opens from the user menu, and is FORCED (cannot be dismissed) after an admin
 * reset or first sign-in with a temporary password — the only other way out is signing out.
 */
export function PasswordDialog() {
  const t = useTranslations("password")
  const tc = useTranslations("common")
  const ts = useTranslations("shell")
  const locale = useLocale()
  const me = useMe()
  const qc = useQueryClient()
  const { pwOpen, setPwOpen } = useShell()
  const forced = !!me.user.mustChangePassword
  const open = forced || pwOpen
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<PasswordChange>({ resolver: zodResolver(passwordChange), defaultValues: blank, mode: "onTouched" })
  React.useEffect(() => { if (open) reset(blank) }, [open, reset])

  const save = useMutation({
    mutationFn: (v: PasswordChange) => api.me.changePassword(v),
    onSuccess: (m) => {
      qc.setQueryData<Me>(["me"], m)
      qc.invalidateQueries({ queryKey: ["notifications"] })
      setPwOpen(false)
      toast.success(t("changed"))
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as keyof PasswordChange, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const signOut = async () => {
    await api.auth.logout().catch(() => {})
    qc.clear()
    window.location.assign(`/${locale}/login`)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!forced) setPwOpen(o) }} disablePointerDismissal={forced}>
      <DialogContent showCloseButton={!forced} className="sm:max-w-md">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" aria-hidden /> {forced ? t("forcedTitle") : t("title")}</DialogTitle>
            <DialogDescription>{forced ? t("forcedBody") : t("body")}</DialogDescription>
          </DialogHeader>
          {/* hidden username helps password managers pair the new password with the right account */}
          <input type="text" name="username" autoComplete="username" value={me.user.username} readOnly hidden />
          <Field id="pw-current" label={forced ? t("temporary") : t("current")} required error={errors.current?.message}>
            {(a) => <Input type="password" autoComplete="current-password" autoFocus {...a} {...register("current")} />}
          </Field>
          <Field id="pw-next" label={t("next")} required error={errors.next?.message} hint={t("policy")}>
            {(a) => <Input type="password" autoComplete="new-password" {...a} {...register("next")} />}
          </Field>
          <Field id="pw-confirm" label={t("confirm")} required error={errors.confirm?.message}>
            {(a) => <Input type="password" autoComplete="new-password" {...a} {...register("confirm")} />}
          </Field>
          <DialogFooter>
            {forced
              ? <Button type="button" variant="outline" onClick={signOut}><LogOut /> {ts("signOut")}</Button>
              : <Button type="button" variant="outline" onClick={() => setPwOpen(false)}>{tc("cancel")}</Button>}
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {t("submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
