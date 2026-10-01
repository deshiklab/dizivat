"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Eye, EyeOff, FlaskConical, Info, Languages, Loader2, LockKeyhole, LogIn, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { LogoMark } from "@/components/shell/logo"
import { BRAND } from "@/lib/brand"
import { Credit } from "@/components/common/credit"
import { api, ApiError } from "@/lib/api/client"
import type { Role } from "@/lib/auth/roles"
import { cn } from "@/lib/utils"
import { STATIC_DEMO, appUrl } from "@/lib/base-path"
import { DemoResetButton } from "@/components/auth/demo-reset"
import { useSearchParams } from "next/navigation"

export interface DemoAccount { username: string; name: string; designation: string; role: Role }

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/")

/**
 * Sign-in. Errors are announced (role=alert), the password can be revealed, and after 5 failures the
 * account is locked for 60 s with a live countdown. Demo accounts (mock backend only) fill the form on click.
 */
export function LoginForm({ demo, demoPassword, company, next, reason }: {
  demo: DemoAccount[]; demoPassword: string; company: { name: string; bin: string }; next: string | null; reason: string | null
}) {
  const t = useTranslations("auth")
  const tr = useTranslations("roles")
  const locale = useLocale()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [remember, setRemember] = React.useState(true)
  const [show, setShow] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErr, setFieldErr] = React.useState<{ username?: boolean; password?: boolean }>({})
  const [lockedFor, setLockedFor] = React.useState(0)
  const [caps, setCaps] = React.useState(false)
  const userRef = React.useRef<HTMLInputElement>(null)
  const passRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (lockedFor <= 0) return
    const h = window.setTimeout(() => setLockedFor((s) => s - 1), 1000)
    return () => window.clearTimeout(h)
  }, [lockedFor])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fe = { username: !username.trim(), password: !password }
    setFieldErr(fe)
    if (fe.username || fe.password) { setError(t("required")); (fe.username ? userRef : passRef).current?.focus(); return }
    setPending(true); setError(null)
    try {
      await api.auth.login({ username: username.trim(), password, remember })
      // Full navigation so the server layout renders with the new session cookie
      window.location.assign(appUrl(`/${locale}${safeNext(next) === "/" ? "" : safeNext(next)}`))
    } catch (err) {
      setPending(false)
      if (err instanceof ApiError && err.status === 429) {
        setLockedFor(Number(err.errors?._?.[0] ?? 60)); setError(null)
      } else if (err instanceof ApiError && err.status === 401) {
        const left = Number(err.errors?._?.[0] ?? 0)
        setError(left > 0 ? t("invalidLeft", { count: left }) : t("invalid"))
        if (left === 0) setLockedFor(60)
        setPassword(""); passRef.current?.focus()
      } else if (err instanceof ApiError && err.status === 403) {
        // R6.2: a VAT officer whose access period has ended gets its own message
        setError(t(err.message === "expired" ? "accessExpired" : "disabled"))
      } else {
        setError(err instanceof Error ? err.message : t("network"))
      }
    }
  }
  const fill = (u: string) => { setUsername(u); setPassword(demoPassword); setError(null); setFieldErr({}); setLockedFor(0) }
  const otherLocale = locale === "bn" ? "en" : "bn"
  const qs = new URLSearchParams({ ...(next ? { next } : {}), ...(reason ? { reason } : {}) }).toString()
  const switchHref = appUrl(`/${otherLocale}/login${qs ? `?${qs}` : ""}`)

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-sidebar p-10 text-white lg:flex lg:flex-col" aria-label={t("brandPanel")}>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)", backgroundSize: "22px 22px" }} />
        <div aria-hidden className="pointer-events-none absolute -right-32 -bottom-32 size-[28rem] rounded-full bg-swatch-blue/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <p className="text-lg font-semibold">{BRAND}</p>
            <p className="text-sm text-white/70">{t("tagline")}</p>
          </div>
        </div>
        <div className="relative mt-auto grid gap-6">
          <h2 className="max-w-md text-3xl leading-tight font-semibold text-balance">{t("hero")}</h2>
          <ul className="grid gap-3 text-sm text-white/80">
            {(["f1", "f2", "f3"] as const).map((k) => (
              <li key={k} className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-swatch-sky" aria-hidden /> {t(`feature.${k}`)}</li>
            ))}
          </ul>
          <p className="border-t border-white/10 pt-4 text-xs text-white/60">{company.name} · BIN {company.bin}</p>
        </div>
      </section>

      {/* Form */}
      <main id="main" className="flex flex-col bg-background px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 lg:invisible"><LogoMark /><span className="font-semibold">{BRAND}</span></div>
          <Button variant="ghost" size="sm" render={<a href={switchHref} hrefLang={otherLocale} lang={otherLocale} />}>
            <Languages /> {otherLocale === "bn" ? "বাংলা" : "English"}
          </Button>
        </div>
        <div className="mx-auto grid w-full max-w-sm flex-1 content-center gap-6 py-8">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle", { company: company.name })}</p>
          </div>

          {reason === "expired" && !error && !lockedFor && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm text-info"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("expired")}</p>
          )}
          {lockedFor > 0 && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger"><LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("locked", { s: lockedFor })}</p>
          )}
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}</p>
          )}

          <form onSubmit={submit} noValidate className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="username">{t("username")}</Label>
              <Input ref={userRef} id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
                value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={fieldErr.username || undefined} className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t("password")}</Label>
                <span className="text-xs text-muted-foreground">{t("forgot")}</span>
              </div>
              <div className="relative">
                <Input ref={passRef} id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={fieldErr.password || undefined}
                  onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)} aria-describedby={caps ? "caps" : undefined} className="h-10 pr-11" />
                <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label={show ? t("hidePassword") : t("showPassword")} aria-pressed={show} aria-controls="password" onClick={() => setShow((s) => !s)}>
                  {show ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              {caps && <p id="caps" className="text-xs text-warning">{t("capsLock")}</p>}
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(!!v)} /> {t("remember")}
            </label>
            <Button type="submit" size="lg" className="h-10" disabled={pending || lockedFor > 0}>
              {pending ? <Loader2 className="animate-spin" /> : <LogIn />} {pending ? t("signingIn") : t("signIn")}
            </Button>
          </form>

          <section aria-labelledby="demo-h" className="grid gap-2 rounded-lg border border-dashed p-3">
            <h2 id="demo-h" className="text-xs font-medium text-muted-foreground">{t("demoTitle", { pw: demoPassword })}</h2>
            <ul className="grid gap-1">
              {demo.map((d) => (
                <li key={d.username}>
                  <button type="button" onClick={() => fill(d.username)}
                    className={cn("flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", username === d.username && "bg-muted")}>
                    <span className="w-20 shrink-0 font-mono text-xs">{d.username}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name} <span className="text-muted-foreground">· {d.designation}</span></span>
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{tr(d.role)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {STATIC_DEMO && (
            <section aria-labelledby="static-demo-h" className="grid gap-2 rounded-lg bg-info-soft p-3 text-sm text-info">
              <h2 id="static-demo-h" className="flex items-center gap-2 font-medium"><FlaskConical className="size-4 shrink-0" aria-hidden /> {t("staticDemoTitle")}</h2>
              <p className="text-xs">{t("staticDemoBody")}</p>
              <DemoResetButton />
            </section>
          )}
        </div>
        <div className="grid gap-1 text-center text-xs text-muted-foreground">
          <p>{t("footer")}</p>
          <Credit linkClassName="text-foreground" />
        </div>
      </main>
    </div>
  )
}

/** Static GitHub Pages demo: the page HTML is pre-built, so ?next= and ?reason= come from the browser URL. */
export function LoginFormFromUrl(props: Omit<React.ComponentProps<typeof LoginForm>, "next" | "reason">) {
  const sp = useSearchParams()
  return <LoginForm {...props} next={sp.get("next")} reason={sp.get("reason")} />
}
