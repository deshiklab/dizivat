"use client"

import { useLocale, useTranslations } from "next-intl"
import { CalendarClock } from "lucide-react"
import { TODAY } from "@/lib/company"
import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtNum } from "@/lib/format"
import { Credit } from "@/components/common/credit"

/** Slim status bar: company BIN, current VAT period, the 9.1 deadline, build info and the copyright line. */
export function StatusFooter() {
  const company = useCompany()
  const t = useTranslations("shell")
  const locale = useLocale()
  const due = "2026-10-15"
  const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5)
  return (
    <footer className="no-print hidden items-center gap-4 border-t bg-surface px-4 py-1.5 text-xs text-muted-foreground md:flex md:flex-wrap md:gap-y-1">
      <span>{company.name} · {t("bin")} <span className="tabular font-medium text-foreground">{company.bin}</span></span>
      <span className="flex items-center gap-1"><CalendarClock className="size-3.5" /> {t("vatPeriod")}: <span className="font-medium text-foreground">{fmtDate(TODAY, locale, "MMMM yyyy")}</span></span>
      <span>{t("returnDue", { date: fmtDate(due, locale), days: fmtNum(days, locale) })}</span>
      <span className="ml-auto">{t("buildInfo", { version: "0.8", release: "KB" })} · {t("mockData")}</span>
      <Credit className="basis-full text-center lg:basis-auto lg:text-right" linkClassName="text-foreground" />
    </footer>
  )
}
