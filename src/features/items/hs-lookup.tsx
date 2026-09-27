"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, BookOpenCheck, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api/client"
import { fmtHs, fmtPct } from "@/lib/format"

/**
 * Live HS-code check against the NBR tariff: shows the official description and rates, offers to copy
 * VAT/SD into the item, and warns when the code isn't in the tariff (the 9.1 return would reject it).
 */
export function HsLookup({ hs, vatRate, sdRate, onUse }: { hs: string; vatRate: number; sdRate: number; onUse: (vat: number, sd: number) => void }) {
  const t = useTranslations("items.hs")
  const locale = useLocale()
  const valid = /^\d{8}$/.test(hs ?? "")
  const q = useQuery({ queryKey: ["tariff", "hs", hs], queryFn: () => api.tariff.lookup(hs), enabled: valid, retry: false, staleTime: 3600_000 })
  if (!valid) return null
  if (q.isLoading) return <p className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2" role="status"><Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("checking")}</p>
  if (q.error) {
    const missing = q.error instanceof ApiError && q.error.status === 404
    return (
      <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs text-warning sm:col-span-2" role="status">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {missing ? t("unknown", { hs: fmtHs(hs) }) : t("error")}
      </p>
    )
  }
  const tl = q.data!
  const same = tl.vat === vatRate && tl.sd === sdRate
  return (
    <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-xs sm:col-span-2" role="status">
      <p className="flex items-start gap-2"><BookOpenCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span><span className="tabular font-medium">{fmtHs(tl.hsCode)}</span> — {tl.description}</span></p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">{t("rates", { vat: fmtPct(tl.vat, locale), sd: fmtPct(tl.sd, locale), cd: fmtPct(tl.cd, locale) })}</span>
        {same
          ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" aria-hidden /> {t("match")}</span>
          : <Button type="button" size="sm" variant="outline" onClick={() => onUse(tl.vat, tl.sd)}>{t("use")}</Button>}
      </div>
    </div>
  )
}
