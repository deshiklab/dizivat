"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { BookOpen, Boxes, Building2, Clock, FileText, Languages, Loader2, Moon, Sun, Truck, UserRound } from "lucide-react"
import { CommandDialog, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command"
import { useRouter, usePathname } from "@/i18n/navigation"
import { visibleNav } from "@/lib/nav"
import { useCan, useSavePrefs } from "@/components/auth/me-provider"
import { useCreateActions } from "./create-actions"
import { api } from "@/lib/api/client"
import type { SearchHit } from "@/lib/types"
import { useShell } from "./shell-context"
import { useSwitchLocale } from "./user-menu"

const RECENT_KEY = "dizivat-recent"
const icons: Record<SearchHit["type"], React.ElementType> = { sale: FileText, purchase: Truck, item: Boxes, customer: UserRound, vendor: Building2 }

function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = React.useState(v)
  React.useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h) }, [v, ms])
  return d
}

/** Records the pages a user visits so the palette can offer "Recent". */
export function useTrackRecent() {
  const pathname = usePathname()
  React.useEffect(() => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")
      localStorage.setItem(RECENT_KEY, JSON.stringify([pathname, ...list.filter((p) => p !== pathname)].slice(0, 6)))
    } catch {}
  }, [pathname])
}

/** The single ⌘K palette: navigate, create, search records (server), switch preferences. */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell()
  const t = useTranslations("palette")
  const tn = useTranslations("nav")
  const th = useTranslations("help")
  const can = useCan()
  const savePrefs = useSavePrefs()
  const allCreates = useCreateActions()
  const router = useRouter()
  const locale = useLocale()
  const switchLocale = useSwitchLocale()
  const { resolvedTheme, setTheme } = useTheme()
  const [q, setQ] = React.useState("")
  const dq = useDebounced(q.trim())
  const [recent, setRecent] = React.useState<string[]>([])
  React.useEffect(() => {
    if (paletteOpen) { setQ(""); try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || "[]")) } catch {} }
  }, [paletteOpen])

  const { data: hits = [], isFetching } = useQuery({ queryKey: ["search", dq], queryFn: () => api.search(dq), enabled: dq.length >= 2 })

  const pages = React.useMemo(
    () => [
      ...visibleNav(can).flatMap((g) => (g.items.length ? g.items.map((i) => ({ href: i.href, label: `${tn(g.key)} › ${tn(i.key)}`, icon: g.icon, ready: i.ready, release: i.release })) : [{ href: g.href, label: tn(g.key), icon: g.icon, ready: true, release: "S1" as const }])),
      { href: "/help", label: `${th("helpNav")} › ${th("knowledgeBase")}`, icon: BookOpen, ready: true, release: "S1" as const },
    ],
    [tn, th, can]
  )
  const match = (s: string) => !q || s.toLowerCase().includes(q.trim().toLowerCase())
  const go = (href: string) => { setPaletteOpen(false); router.push(href) }
  const run = (fn: () => void) => { setPaletteOpen(false); fn() }
  const labelFor = (href: string) => pages.find((p) => p.href === href.split("?")[0])?.label ?? href

  const creates = allCreates.filter((c) => match(c.label))
  const prefs = [
    { id: "theme", label: resolvedTheme === "dark" ? t("lightMode") : t("darkMode"), icon: resolvedTheme === "dark" ? Sun : Moon, fn: () => { const v = resolvedTheme === "dark" ? "light" : "dark"; setTheme(v); savePrefs({ theme: v }) } },
    { id: "lang", label: locale === "bn" ? "Switch to English" : "বাংলায় দেখুন", icon: Languages, fn: () => switchLocale(locale === "bn" ? "en" : "bn") },
  ].filter((p) => match(p.label))
  const pageMatches = pages.filter((p) => match(p.label))
  const grouped = hits.reduce<Record<string, SearchHit[]>>((a, h) => ((a[h.type] ??= []).push(h), a), {})

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title={t("title")} description={t("description")} className="sm:max-w-xl">
      <Command shouldFilter={false} loop>
        <CommandInput value={q} onValueChange={setQ} placeholder={t("placeholder")} />
        <CommandList className="max-h-[60vh]">
          {isFetching && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3 animate-spin" /> {t("searching")}</div>}
          <CommandEmpty>{t("empty")}</CommandEmpty>
          {!q && recent.length > 0 && (
            <CommandGroup heading={t("recent")}>
              {recent.map((r) => (
                <CommandItem key={r} value={`recent-${r}`} onSelect={() => go(r)}><Clock /> {labelFor(r)}</CommandItem>
              ))}
            </CommandGroup>
          )}
          {Object.entries(grouped).map(([type, list]) => (
            <CommandGroup key={type} heading={t(`types.${type}`)}>
              {list.map((h) => {
                const Icon = icons[h.type]
                return (
                  <CommandItem key={h.type + h.id} value={h.type + h.id} onSelect={() => go(h.href)}>
                    <Icon />
                    <span className="grid min-w-0"><span className="truncate">{h.title}</span><span className="truncate text-xs text-muted-foreground">{h.subtitle}</span></span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
          {creates.length > 0 && (
            <CommandGroup heading={t("create")}>
              {creates.map((c) => <CommandItem key={c.href} value={c.href} onSelect={() => go(c.href)}><c.icon /> {c.label}</CommandItem>)}
            </CommandGroup>
          )}
          {pageMatches.length > 0 && (
            <CommandGroup heading={t("pages")}>
              {pageMatches.map((p) => (
                <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                  <p.icon /> {p.label}
                  {!p.ready && <CommandShortcut>{p.release}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {prefs.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("preferences")}>
                {prefs.map((p) => <CommandItem key={p.id} value={p.id} onSelect={() => run(p.fn)}><p.icon /> {p.label}</CommandItem>)}
              </CommandGroup>
            </>
          )}
        </CommandList>
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span>↑↓ {t("navigate")}</span><span>↵ {t("open")}</span><span>Esc {t("close")}</span>
        </div>
      </Command>
    </CommandDialog>
  )
}
