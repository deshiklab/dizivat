"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, Hourglass, PackageCheck, PackageX, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Money } from "@/components/common/money"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { SD_EXPORT_MONTHS, SD_EXPIRING_DAYS } from "@/lib/sd-export"
import type { SdEligibleRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE: Record<SdEligibleRow["state"], Tone> = { open: "success", expiring: "warning", lapsed: "danger", claimed: "neutral" }

/**
 * R6.3 — SD paid on inputs and its six-month export window (Mushak 9.1 note 40). Every approved purchase line that
 * carried supplementary duty, what is already claimed against exports, what is left and until when. "Claim" opens a
 * new adjustment of kind "SD on exported inputs" with the line pre-selected.
 */
export function SdWindowCard({ onClaim }: { onClaim: (row: SdEligibleRow) => void }) {
  const t = useTranslations("adjust.sd")
  const locale = useLocale()
  const can = useCan()
  const [open, setOpen] = React.useState(true)
  const q = useQuery({ queryKey: ["sdEligible", ""], queryFn: () => api.vat.sdEligible() })
  const d = q.data
  if (q.isLoading || q.error || !d || !d.rows.length) return null
  const id = "sd-window"
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-3 rounded-lg border bg-card p-4" data-testid="sd-window">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id={`${id}-h`} className="text-base font-semibold">{t("registerTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("registerSub", { months: SD_EXPORT_MONTHS })}</p>
        </div>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cn("transition-transform", open ? "rotate-180" : "")} /> {open ? t("hide") : t("show")}
        </Button>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><PackageCheck className="size-3.5" /> {t("claimable")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.totals.claimable} /></dd></div>
        <div className={cn("rounded-md border p-3", d.totals.expiring ? "border-warning/60" : "")}><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Hourglass className="size-3.5" /> {t("expiringTotal", { days: SD_EXPIRING_DAYS })}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.totals.expiring} /></dd></div>
        <div className={cn("rounded-md border p-3", d.totals.lapsedUnclaimed ? "border-destructive/50" : "")}><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><PackageX className="size-3.5" /> {t("lapsedTotal")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.totals.lapsedUnclaimed} /></dd></div>
      </dl>
      {open && (
        <div id={`${id}-body`} className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("registerTitle")}>
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">{t("registerTitle")}</caption>
            <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">{t("purchase")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("item")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("sdPaid")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("claimed")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("remaining")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("deadline")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("status")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("actions")}</span></th>
            </tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={`${r.purchaseId}|${r.itemId}`} className="border-b align-top last:border-0">
                  <td className="px-3 py-2"><Link href={`/purchases/${r.purchaseId}`} className="font-medium text-primary tabular hover:underline">{r.purchaseNo}</Link><span className="block text-xs text-muted-foreground tabular">{fmtDate(r.purchaseDate, locale)}{r.boeNo ? ` · ${r.boeNo}` : ""}</span></td>
                  <td className="px-3 py-2">{r.name}<span className="block text-xs text-muted-foreground tabular">{fmtNum(r.qty, locale)} {r.uom} · {r.vendorName}</span></td>
                  <td className="px-3 py-2 text-right"><Money value={r.sd} /></td>
                  <td className="px-3 py-2 text-right"><Money value={r.claimed} /><span className="block text-xs text-muted-foreground tabular">{fmtNum(r.claimedQty, locale)} {r.uom}</span></td>
                  <td className="px-3 py-2 text-right font-medium"><Money value={r.remaining} /><span className="block text-xs font-normal text-muted-foreground tabular">{fmtNum(r.remainingQty, locale)} {r.uom}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(r.deadline, locale)}<span className={cn("block text-xs", r.daysLeft < 0 ? "text-destructive" : r.daysLeft < SD_EXPIRING_DAYS ? "text-warning" : "text-muted-foreground")}>{r.daysLeft < 0 ? t("lapsedAgo", { days: -r.daysLeft }) : t("daysLeft", { days: r.daysLeft })}</span></td>
                  <td className="px-3 py-2"><Pill tone={TONE[r.state]}>{t(`state.${r.state}`)}</Pill></td>
                  <td className="px-3 py-2 text-right">
                    {(r.state === "open" || r.state === "expiring") && can("doc.create") && (
                      <Button variant="outline" size="sm" aria-label={t("claimOne", { no: r.purchaseNo, item: r.name })} onClick={() => onClaim(r)}><Plus /> {t("claim")}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("registerNote")}</p>
    </section>
  )
}
