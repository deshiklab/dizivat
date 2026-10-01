"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react"
import type { ExportCompliance } from "@/lib/rmg"
import { cn } from "@/lib/utils"

/** R6 (RMG): the NBR zero-rating conditions of an export / deemed-export invoice, ticked or missing. */
export function ExportChecklist({ c, className }: { c: ExportCompliance; className?: string }) {
  const t = useTranslations("rmg")
  const n = c.missing.length
  return (
    <section aria-label={t("checklistTitle")} className={cn("grid gap-2 rounded-md border p-3", n ? "border-warning/50 bg-warning-soft" : "border-success/40 bg-success-soft", className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        {n ? <CircleAlert className="size-4 text-warning" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
        {t("checklistTitle")} — {n ? t("incomplete", { n }) : t("complete")}
      </p>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {c.checks.map((x) => (
          <li key={x.key} className="flex items-start gap-2">
            {x.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />}
            <span><span className="sr-only">{x.ok ? t("met") : t("notMet")}: </span>{t(`check.${x.key}`)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{c.kind === "deemed" ? t("deemedRule") : t("directRule")}</p>
    </section>
  )
}
