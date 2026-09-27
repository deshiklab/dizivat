"use client"

import { useTranslations } from "next-intl"
import { Boxes, LayoutDashboard, Menu, PackageOpen, ShoppingCart } from "lucide-react"
import { Link, usePathname } from "@/i18n/navigation"
import { useSidebar } from "@/components/ui/sidebar"
import { resolveNav } from "@/lib/nav"
import { cn } from "@/lib/utils"

/** Bottom tab bar on phones (≥44px targets) — the prototype had no mobile navigation. */
export function MobileNav() {
  const t = useTranslations("nav")
  const ts = useTranslations("shell")
  const pathname = usePathname()
  const g = resolveNav(pathname)?.group.key
  const { setOpenMobile } = useSidebar()
  const items = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "sales", href: "/sales", icon: ShoppingCart },
    { key: "purchase", href: "/purchases", icon: PackageOpen },
    { key: "inventory", href: "/inventory/items", icon: Boxes },
  ]
  return (
    <nav aria-label={ts("mobileNav")} className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((it) => (
        <Link key={it.key} href={it.href} aria-current={g === it.key ? "page" : undefined}
          className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", g === it.key ? "text-primary font-medium" : "text-muted-foreground")}>
          <it.icon className="size-5" aria-hidden />
          <span className="max-w-full truncate px-1">{t(it.key)}</span>
        </Link>
      ))}
      <button type="button" onClick={() => setOpenMobile(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground">
        <Menu className="size-5" aria-hidden /> {ts("more")}
      </button>
    </nav>
  )
}
