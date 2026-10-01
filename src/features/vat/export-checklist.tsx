"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, CircleAlert, XCircle } from "lucide-react"
import type { UdFit, ExportCompliance } from "@/lib/rmg"
import { cn } from "@/lib/utils"

/** R6 (RMG): the NBR zero-rating conditions of an export / deemed-export invoice, ticked or missing. */
export function ExportChecklist({ c, className, fit, names }: { c: ExportCompliance; className?: string; fit?: UdFit | null; names?: Record<string, string> }) {
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
      {fit && !fit.ok && (
        <ul className="grid gap-0.5 rounded bg-background/60 p-2 text-xs" aria-label={t("udProblems")}>
          {fit.problems.includes("closed") && <li>{t("udp.closed")}</li>}
          {fit.problems.includes("expired") && <li>{t("udp.expired")}</li>}
          {fit.lines.filter((l) => !l.listed).map((l) => <li key={`n-${l.itemId}`}>{t("udp.notListed", { item: names?.[l.itemId] ?? l.itemId })}</li>)}
          {fit.lines.filter((l) => l.listed && l.qty > l.remaining + 1e-9).map((l) => <li key={`x-${l.itemId}`}>{t("udp.exceeds", { item: names?.[l.itemId] ?? l.itemId, qty: l.qty, remaining: Math.max(0, l.remaining) })}</li>)}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{c.kind === "deemed" ? t("deemedRule") : t("directRule")}</p>
    </section>
  )
}
