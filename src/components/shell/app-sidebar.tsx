"use client"

import * as React from "react"
import { useCan, useCompany, useMe } from "@/components/auth/me-provider"
import { useTranslations } from "next-intl"
import { BookOpen, ChevronRight } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { resolveNav, visibleNav } from "@/lib/nav"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { LogoMark } from "./logo"
import { BRAND } from "@/lib/brand"
import { cn } from "@/lib/utils"

export function AppSidebar() {
  const company = useCompany()
  const t = useTranslations("nav")
  const ts = useTranslations("shell")
  const tr = useTranslations("roles")
  const th = useTranslations("help")
  const me = useMe()
  const can = useCan()
  const nav = React.useMemo(() => visibleNav(can), [can])
  const pathname = usePathname()
  const active = resolveNav(pathname)
  const { state, isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => { if (active?.group) setOpen((o) => ({ ...o, [active.group.key]: true })) }, [active?.group])
  const collapsed = state === "collapsed" && !isMobile
  const close = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar collapsible="icon" aria-label={ts("mainNav")}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" onClick={close} />} tooltip={BRAND}>
              <LogoMark className="size-8! shrink-0" />
              <span className="grid min-w-0 leading-tight">
                <span className="truncate font-semibold text-white">{BRAND}</span>
                <span className="truncate text-xs text-sidebar-foreground">{company.name}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/80">{ts("modules")}</SidebarGroupLabel>
          <SidebarMenu>
            {nav.map((g) => {
              const Icon = g.icon
              const isActiveGroup = active?.group.key === g.key
              const expanded = !!open[g.key] && !collapsed
              if (!g.items.length || collapsed) {
                return (
                  <SidebarMenuItem key={g.key}>
                    <SidebarMenuButton isActive={isActiveGroup} tooltip={t(g.key)} render={<Link href={g.href} onClick={close} aria-current={isActiveGroup && !g.items.length ? "page" : undefined} />}>
                      <Icon /> <span>{t(g.key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              }
              const subId = `nav-sub-${g.key}`
              return (
                <SidebarMenuItem key={g.key}>
                  <SidebarMenuButton isActive={isActiveGroup} aria-expanded={expanded} aria-controls={subId} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                    <Icon /> <span>{t(g.key)}</span>
                    <ChevronRight className={cn("ml-auto transition-transform", expanded && "rotate-90")} />
                  </SidebarMenuButton>
                  {expanded && (
                    <SidebarMenuSub id={subId}>
                      {g.items.map((it) => {
                        const on = active?.item?.key === it.key
                        return (
                          <SidebarMenuSubItem key={it.key}>
                            <SidebarMenuSubButton isActive={on} aria-current={on ? "page" : undefined} render={<Link href={it.href} onClick={close} />}>
                              <span className="truncate">{t(it.key)}</span>
                              {!it.ready && <span className="ml-auto rounded bg-sidebar-accent px-1.5 text-xs leading-4 text-sidebar-foreground" title={ts("plannedFor", { release: it.release })}>{it.release}</span>}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={pathname === "/help" || pathname.startsWith("/help/")} tooltip={th("helpNav")} render={<Link href="/help" onClick={close} />}>
              <BookOpen /> <span>{th("helpNav")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2 rounded-md p-2 text-xs group-data-[collapsible=icon]:hidden">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent font-semibold text-white">{me.user.initials}</span>
          <span className="grid min-w-0">
            <span className="truncate font-medium text-white">{me.user.name}</span>
            <span className="truncate text-sidebar-foreground">{me.user.designation} · {tr(me.user.role)}</span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
