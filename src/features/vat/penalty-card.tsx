"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ArrowRight, Calculator, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { periodLabel } from "@/lib/r4"

interface Inputs { vat: string; sd: string; paidOn: string; filedOn: string; latePenalty: string }
const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Math.max(0, Number(s)))

/**
 * R6.3 — late payment interest (§127: 1 % a month or part of a month, at most 24 months) on unpaid VAT and SD, and the
 * late-return penalty, for the selected tax period (Mushak 9.1 notes 41–43). Defaults come from the period's return
 * (unpaid tax, filing date); every figure can be changed for a what-if. Below: exposure across all periods today.
 */
export function PenaltyCard({ period }: { period: string }) {
  const t = useTranslations("comp.pen")
  const locale = useLocale()
  const can = useCan()
  const base = useQuery({ queryKey: ["penalty", period, "base"], queryFn: () => api.vat.penalty({ period }) })
  const [v, setV] = React.useState<Inputs | null>(null)
  React.useEffect(() => {
    const b = base.data
    if (!b) return
    setV({ vat: String(b.input.vat), sd: String(b.input.sd), paidOn: b.input.paidOn, filedOn: b.input.filedOn ?? "", latePenalty: String(b.result.penaltyLate || 10_000) })
  }, [base.data])
  const deferred = React.useDeferredValue(v)
  const params = deferred && { period, vat: num(deferred.vat), sd: num(deferred.sd), paidOn: /^\d{4}-\d{2}-\d{2}$/.test(deferred.paidOn) ? deferred.paidOn : undefined, filedOn: /^\d{4}-\d{2}-\d{2}$/.test(deferred.filedOn) ? deferred.filedOn : undefined, latePenalty: num(deferred.latePenalty) }
  const quote = useQuery({ queryKey: ["penalty", params], queryFn: () => api.vat.penalty(params!), enabled: !!params, placeholderData: keepPreviousData })
  const exposure = useQuery({ queryKey: ["penalty", "exposure"], queryFn: () => api.vat.penaltyExposure() })
  const r = quote.data?.result
  const set = (k: keyof Inputs) => (e: React.ChangeEvent<HTMLInputElement>) => setV((o) => (o ? { ...o, [k]: e.target.value } : o))
  const at = exposure.data?.rows.filter((x) => x.result.total > 0) ?? []

  return (
    <Card data-testid="penalty-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Calculator className="size-4" aria-hidden /> {t("title", { period: periodLabel(period) })}</CardTitle>
        <CardDescription>{t("sub")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {v && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1.5"><Label htmlFor="pen-vat">{t("vat")}</Label><Input id="pen-vat" type="number" inputMode="decimal" min={0} step="0.01" className="text-right tabular" value={v.vat} onChange={set("vat")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pen-sd">{t("sd")}</Label><Input id="pen-sd" type="number" inputMode="decimal" min={0} step="0.01" className="text-right tabular" value={v.sd} onChange={set("sd")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pen-paid">{t("paidOn")}</Label><Input id="pen-paid" type="date" min={`${period}-01`} value={v.paidOn} onChange={set("paidOn")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pen-filed">{t("filedOn")}</Label><Input id="pen-filed" type="date" min={`${period}-01`} value={v.filedOn} onChange={set("filedOn")} aria-describedby="pen-filed-h" /><span id="pen-filed-h" className="text-xs text-muted-foreground">{t("filedOnHint")}</span></div>
            <div className="grid gap-1.5"><Label htmlFor="pen-late">{t("latePenalty")}</Label><Input id="pen-late" type="number" inputMode="decimal" min={0} step="1" className="text-right tabular" value={v.latePenalty} onChange={set("latePenalty")} /></div>
          </div>
        )}
        {r && (
          <div className="grid gap-3 rounded-md border p-3" aria-live="polite">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {t("due", { date: fmtDate(r.dueDate, locale) })}
              {r.daysLate > 0
                ? <Pill tone="danger">{t("late", { days: fmtNum(r.daysLate, locale), months: r.chargedMonths })}</Pill>
                : <Pill tone="success">{t("onTime")}</Pill>}
              {r.capped && <Pill tone="warning">{t("capped", { max: r.maxMonths })}</Pill>}
            </p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("note41", { rate: r.ratePct, months: r.chargedMonths })}</dt><dd><Money value={r.interestVat} className="text-base font-semibold" /></dd></div>
              <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("note42", { rate: r.ratePct, months: r.chargedMonths })}</dt><dd><Money value={r.interestSd} className="text-base font-semibold" /></dd></div>
              <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("note43")}</dt><dd><Money value={r.penaltyLate} className="text-base font-semibold" /></dd></div>
              <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("total")}</dt><dd data-testid="penalty-total"><Money value={r.total} className="text-base font-semibold" /></dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">{r.refs.interest} · {r.refs.penalty}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" render={<Link href={`/vat/return-9-1?period=${period}`} />}>{t("openReturn")} <ArrowRight /></Button>
              {r.interestVat + r.interestSd > 0 && can("doc.create") && <Button variant="outline" size="sm" render={<Link href={`/vat/tr-6?new=1&period=${period}&head=interest&amount=${Math.ceil(r.interestVat + r.interestSd)}`} />}><Landmark /> {t("depositInterest")}</Button>}
              {r.penaltyLate > 0 && can("doc.create") && <Button variant="outline" size="sm" render={<Link href={`/vat/tr-6?new=1&period=${period}&head=penalty&amount=${Math.ceil(r.penaltyLate)}`} />}><Landmark /> {t("depositPenalty")}</Button>}
            </div>
          </div>
        )}
        {exposure.data && (
          <section aria-labelledby="pen-exp-h" className="grid gap-2">
            <h3 id="pen-exp-h" className="text-sm font-semibold">{t("exposureTitle", { date: fmtDate(exposure.data.asOf, locale) })}</h3>
            {at.length ? (
              <ul className="grid gap-1 text-sm">
                {at.map((x) => (
                  <li key={x.period} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="font-medium tabular">{periodLabel(x.period)}</span>
                    <span className="text-xs text-muted-foreground">{x.lateFiling ? t("lateFiling") : t("unpaid")} · {t("due", { date: fmtDate(x.dueDate, locale) })}</span>
                    <Money value={x.result.total} className="font-semibold" />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground" data-testid="penalty-clear">{t("exposureNone", { n: exposure.data.rows.length })}</p>}
          </section>
        )}
        <p className="text-xs text-muted-foreground">{t("disclaimer", { today: fmtDate(TODAY, locale) })}</p>
      </CardContent>
    </Card>
  )
}
