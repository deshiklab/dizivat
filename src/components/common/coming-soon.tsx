"use client"

import { useLocale, useTranslations } from "next-intl"
import { CalendarRange, ExternalLink, Hammer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "./page-header"
import { Pill } from "./status-badge"
import { NAV, RELEASE_DATES } from "@/lib/nav"
import { fmtDate } from "@/lib/format"

/** Address of the current RBS VAT system (strangler hand-off). Set at build time — never commit the production host. */
const LEGACY_URL = (process.env.NEXT_PUBLIC_LEGACY_URL ?? "").replace(/\/$/, "")

/** Unbuilt modules get an honest roadmap page instead of a dead link or a disabled menu item. */
export function ComingSoon({ path }: { path: string }) {
  const group = NAV.find((g) => g.items.some((i) => i.href === path))!
  const item = group.items.find((i) => i.href === path)!
  const t = useTranslations("placeholder")
  const tn = useTranslations("nav")
  const locale = useLocale()
  return (
    <>
      <PageHeader title={tn(item.key)} description={t("subtitle", { group: tn(group.key) })} />
      <Card className="max-w-2xl">
        <CardContent className="grid gap-4 py-2">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Hammer className="size-5" aria-hidden /></span>
            <div>
              <p className="font-semibold">{t("title", { release: item.release })}</p>
              <p className="flex items-center gap-1 text-sm text-muted-foreground"><CalendarRange className="size-4" aria-hidden /> {t("target", { date: fmtDate(RELEASE_DATES[item.release], locale) })}</p>
            </div>
            <Pill tone="info" className="ml-auto">{item.release}</Pill>
          </div>
          <p className="text-sm text-muted-foreground">{t("body")}</p>
          {LEGACY_URL && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" render={<a href={`${LEGACY_URL}/${locale}/`} target="_blank" rel="noreferrer" />}>
                <ExternalLink /> {t("legacy")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
