"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Link, usePathname } from "@/i18n/navigation"
import { resolveNav } from "@/lib/nav"

export function PageHeader({ title, description, actions, crumbs = [], children }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  crumbs?: { label: string; href?: string }[]
  children?: React.ReactNode
}) {
  const tn = useTranslations("nav")
  const ts = useTranslations("shell")
  const pathname = usePathname()
  const nav = resolveNav(pathname)
  const trail: { label: string; href?: string }[] = [{ label: tn("dashboard"), href: "/" }]
  if (nav && nav.group.key !== "dashboard") {
    trail.push({ label: tn(nav.group.key), href: nav.group.href })
    if (nav.item && nav.item.href !== nav.group.href) trail.push({ label: tn(nav.item.key), href: nav.item.href })
  }
  const all = [...trail, ...crumbs]
  return (
    <div className="no-print mb-4 flex flex-col gap-3 md:mb-6">
      {all.length > 1 && (
        <Breadcrumb aria-label={ts("breadcrumb")}>
          <BreadcrumbList>
            {all.map((c, i) => {
              const last = i === all.length - 1
              return (
                <React.Fragment key={i}>
                  <BreadcrumbItem>
                    {last || !c.href ? <BreadcrumbPage>{c.label}</BreadcrumbPage> : <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>}
                  </BreadcrumbItem>
                  {!last && <BreadcrumbSeparator />}
                </React.Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
