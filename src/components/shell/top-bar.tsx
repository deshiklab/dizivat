"use client"

import { useTranslations } from "next-intl"
import { BookOpen, CircleHelp, Keyboard, LifeBuoy, Plus, Search } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Link, usePathname, useRouter } from "@/i18n/navigation"
import { resolveNav } from "@/lib/nav"
import { helpForPath } from "@/content/help/registry"
import { cn } from "@/lib/utils"
import { UserMenu } from "./user-menu"
import { Notifications } from "./notifications"
import { useShell } from "./shell-context"
import { useCreateActions } from "./create-actions"
import { useCan } from "@/components/auth/me-provider"

export function TopBar() {
  const t = useTranslations("shell")
  const th = useTranslations("help")
  const tn = useTranslations("nav")
  const creates = useCreateActions()
  const router = useRouter()
  const pathname = usePathname()
  const active = resolveNav(pathname)
  const pageHelp = helpForPath(pathname)
  const can = useCan()
  // Same permission filter as the sidebar — tabs must not advertise pages the role cannot open
  const tabs = active?.group.items.filter((it) => can(it.perm)) ?? []
  const { setPaletteOpen, setHelpOpen } = useShell()

  return (
    <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 no-print">
      <div className="flex h-14 items-center gap-2 px-3 md:px-4">
        <SidebarTrigger aria-label={t("toggleSidebar")} />
        <Separator orientation="vertical" className="mx-1 h-5! hidden md:block" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:border-ring/60 md:max-w-md"
          aria-label={t("searchLabel")}
          data-touch-target
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">{t("searchPlaceholder")}</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          {creates.length > 0 && <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" className="hidden gap-1 sm:inline-flex" />}>
              <Plus /> {t("new")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {creates.map((c) => <DropdownMenuItem key={c.key} onClick={() => router.push(c.href)}><c.icon /> {c.label}</DropdownMenuItem>)}
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("newHint")}</div>
            </DropdownMenuContent>
          </DropdownMenu>}
          <Notifications />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={th("menu")} />} />}>
                <CircleHelp />
              </TooltipTrigger>
              <TooltipContent>{th("menu")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-60">
              {pageHelp && <DropdownMenuItem onClick={() => router.push(`/help/${pageHelp}`)}><LifeBuoy /> {th("forThisPage")}</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => router.push("/help")}><BookOpen /> {th("knowledgeBase")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpOpen(true)}><Keyboard /> {th("shortcuts")} <Kbd className="ml-auto">?</Kbd></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <UserMenu />
        </div>
      </div>
      {active && tabs.length ? (
        <nav aria-label={t("moduleTabs", { group: tn(active.group.key) })} className="-mb-px flex gap-1 overflow-x-auto px-3 md:px-4 [scrollbar-width:none]">
          {tabs.map((it) => {
            const on = active.item?.key === it.key
            return (
              <Link
                key={it.key}
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors pointer-coarse:h-11",
                  on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tn(it.key)}
                {!it.ready && <span className="rounded bg-muted px-1 text-xs text-muted-foreground">{it.release}</span>}
              </Link>
            )
          })}
        </nav>
      ) : null}
    </header>
  )
}
