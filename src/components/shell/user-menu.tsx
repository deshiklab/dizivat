"use client"

import { useLocale, useTranslations } from "next-intl"
import { useCompany, useMe, useSavePrefs } from "@/components/auth/me-provider"
import { useTheme } from "next-themes"
import { KeyRound, Keyboard, Languages, LogOut, Moon, Palette, Rows3, Sun, Type, UserRound } from "lucide-react"
import { toast } from "sonner"
import { usePathname, useRouter } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { usePrefs, type Accent, type Density, type TextSize } from "@/components/prefs"
import { useShell } from "./shell-context"

// Full class names (not built from strings) so Tailwind emits them; colours live in globals.css @theme
const ACCENTS: { v: Accent; c: string }[] = [
  { v: "blue", c: "bg-swatch-blue" }, { v: "emerald", c: "bg-swatch-emerald" }, { v: "violet", c: "bg-swatch-violet" }, { v: "orange", c: "bg-swatch-orange" },
]

export function useSwitchLocale() {
  const router = useRouter(), pathname = usePathname()
  return (locale: string) => {
    const q = window.location.search.replace(/^\?/, "")
    router.replace(q ? `${pathname}?${q}` : pathname, { locale })
  }
}

export function UserMenu() {
  const company = useCompany()
  const t = useTranslations("prefs")
  const ts = useTranslations("shell")
  const { theme, setTheme } = useTheme()
  const prefs = usePrefs()
  const locale = useLocale()
  const switchLocale = useSwitchLocale()
  const { setHelpOpen, setPwOpen } = useShell()
  const tr = useTranslations("roles")
  const me = useMe()
  const qc = useQueryClient()
  const savePrefs = useSavePrefs()
  // Apply locally (instant) and persist to the user's server profile so it follows them to other devices
  const setPref = (p: Parameters<typeof prefs.set>[0]) => { prefs.set(p); savePrefs(p) }
  const changeTheme = (v: string) => { setTheme(v); savePrefs({ theme: v as "light" | "dark" | "system" }) }
  const signOut = async () => {
    await api.auth.logout().catch(() => {})
    qc.clear()
    window.location.assign(`/${locale}/login`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={ts("userMenu")} />}>
        <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{me.user.initials}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-foreground">
            <div className="font-semibold">{me.user.name}</div>
            <div className="font-normal text-muted-foreground">{me.user.designation} · {company.name}</div>
            <div className="mt-1 font-normal"><span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tr(me.user.role)}</span> <span className="text-xs text-muted-foreground">@{me.user.username}</span></div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => toast.info(ts("profileSoon"))}><UserRound /> {ts("profile")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPwOpen(true)}><KeyRound /> {ts("changePassword")}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{theme === "dark" ? <Moon /> : <Sun />} {t("theme")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={(v) => changeTheme(v as string)}>
                <DropdownMenuRadioItem value="light">{t("light")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">{t("dark")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">{t("system")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Palette /> {t("accent")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={prefs.accent} onValueChange={(v) => setPref({ accent: v as Accent })}>
                {ACCENTS.map((a) => (
                  <DropdownMenuRadioItem key={a.v} value={a.v}>
                    <span className={`size-3 rounded-full ${a.c}`} aria-hidden /> {t(a.v)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Rows3 /> {t("density")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={prefs.density} onValueChange={(v) => setPref({ density: v as Density })}>
                <DropdownMenuRadioItem value="compact">{t("compact")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="cozy">{t("cozy")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="comfortable">{t("comfortable")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Type /> {t("textSize")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={prefs.text} onValueChange={(v) => setPref({ text: v as TextSize })}>
                <DropdownMenuRadioItem value="md">{t("textMd")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="lg">{t("textLg")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="xl">{t("textXl")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><Languages /> {t("language")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={locale} onValueChange={(v) => switchLocale(v as string)}>
                {/* eslint-disable-next-line no-restricted-syntax -- language endonyms are shown in their own language on purpose */}
                <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="bn" lang="bn">বাংলা</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard /> {ts("shortcuts")}<DropdownMenuShortcut>?</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}><LogOut /> {ts("signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
