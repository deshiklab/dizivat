"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { periodLabel } from "@/lib/r4"

/** Tax periods (sorted newest first, one entry each — legacy list was unsorted with duplicates, D-15). */
export function usePeriods() {
  return useQuery({ queryKey: ["periods"], queryFn: () => api.vat.periods(), staleTime: 30_000 })
}

/** "Tax period locked" note for documents dated in a period whose Mushak 9.1 return has been submitted. */
export function PeriodLockNote({ date }: { date?: string }) {
  const t = useTranslations("ret")
  const locale = useLocale()
  const periods = usePeriods()
  if (!date) return null
  const p = periods.data?.find((x) => x.period === date.slice(0, 7) && x.locked)
  if (!p) return null
  return (
    <div role="status" className="no-print mb-4 flex gap-3 rounded-lg border border-info/30 bg-info-soft p-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p>{t("lockedNote", { period: periodLabel(p.period), date: p.submittedAt ? fmtDate(p.submittedAt, locale) : "" })}</p>
    </div>
  )
}
