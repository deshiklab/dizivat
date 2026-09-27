"use client"

import { useLocale, useTranslations } from "next-intl"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import { Card } from "@/components/ui/card"
import { fmtCompact, fmtMoney, fmtPct } from "@/lib/format"
import { cn } from "@/lib/utils"

export function KpiCard({ label, value, prev, icon: Icon, hint, goodWhenUp = true, emphasis }: {
  label: string; value: number; prev?: number; icon: React.ElementType; hint?: string; goodWhenUp?: boolean; emphasis?: boolean
}) {
  const t = useTranslations("dashboard")
  const locale = useLocale()
  const delta = prev ? ((value - prev) / Math.abs(prev)) * 100 : null
  const up = (delta ?? 0) > 0.05, down = (delta ?? 0) < -0.05
  const good = up ? goodWhenUp : down ? !goodWhenUp : null
  const DIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  return (
    <Card className={cn("gap-2 p-4", emphasis && "border-primary/40 bg-accent/60")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden><Icon className="size-4" /></span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular" title={`৳ ${fmtMoney(value, locale)}`}>
        <span className="mr-0.5 text-base font-normal text-muted-foreground">৳</span>{fmtCompact(value, locale)}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {delta !== null && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", good === true && "text-success", good === false && "text-danger")}>
            <DIcon className="size-3.5" aria-hidden />
            <span className="sr-only">{up ? t("up") : down ? t("down") : t("flat")}</span>
            {fmtPct(Math.abs(delta), locale)}
          </span>
        )}
        <span>{hint ?? t("vsLastPeriod")}</span>
      </p>
    </Card>
  )
}
