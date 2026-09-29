"use client"

import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { AlertTriangle, ArrowRight, BookOpen, CalendarClock, FileCheck2, FileSpreadsheet, Landmark, Lock, ReceiptText, Scale, Settings2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import type { TaxPeriod } from "@/lib/types"

const TONE: Record<TaxPeriod["status"], "success" | "warning" | "danger" | "info"> = { submitted: "success", draft: "warning", overdue: "danger", open: "info" }

/** Official Mushak outputs and where each one lives in the new UI. */
const REPORTS: { form: string; key: string; href: string }[] = [
  { form: "4.3", key: "m43", href: "/production/bom" },
  { form: "6.1", key: "m61", href: "/vat/mushak-6-1" },
  { form: "6.2", key: "m62", href: "/vat/mushak-6-2" },
  { form: "6.3", key: "m63", href: "/sales" },
  { form: "6.5", key: "m65", href: "/inventory/transfers" },
  { form: "6.6", key: "m66", href: "/vat/vds" },
  { form: "6.7", key: "m67", href: "/sales/credit-notes" },
  { form: "6.8", key: "m68", href: "/purchases/debit-notes" },
  { form: "6.10", key: "m610", href: "/vat/mushak-6-10" },
  { form: "9.1", key: "m91", href: "/vat/return-9-1" },
  { form: "TR-6", key: "tr6", href: "/vat/tr-6" },
]

/** Compliance centre: one tax period at a glance — return status, deposits, VDS, drafts — plus the report catalogue. */
export function ComplianceHub() {
  const t = useTranslations("comp")
  const tr = useTranslations("ret")
  const locale = useLocale()
  const can = useCan()
  const [periodQ, setPeriod] = useQueryState("period", parseAsString)
  const q = useQuery({ queryKey: ["compliance", periodQ ?? ""], queryFn: () => api.vat.compliance(periodQ ?? undefined), placeholderData: keepPreviousData })
  const d = q.data
  const c = d?.computation
  const periods = d?.periods ?? []
  const status: TaxPeriod["status"] | undefined = periods.find((p) => p.period === d?.period)?.status
  const short = (c?.shortVat ?? 0) + (c?.shortSd ?? 0)

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={
          <div className="grid gap-1">
            <Label htmlFor="comp-period" className="text-xs text-muted-foreground">{tr("period")}</Label>
            <Select value={d?.period ?? ""} onValueChange={(v) => setPeriod(v as string)} items={periods.map((p) => ({ value: p.period, label: `${periodLabel(p.period)} · ${tr(`status.${p.status}`)}` }))}>
              <SelectTrigger id="comp-period" className="w-56"><SelectValue placeholder={tr("pickPeriod")} /></SelectTrigger>
              <SelectContent>{periods.map((p) => <SelectItem key={p.period} value={p.period}>{periodLabel(p.period)} · {tr(`status.${p.status}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        } />
      {q.isLoading ? <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : q.error ? <EmptyState title={t("error")} hint={q.error.message} />
        : d && c && (
          <div className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-start justify-between gap-2">
                  <div className="grid gap-1">
                    <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-4" aria-hidden /> {t("returnTitle", { period: periodLabel(d.period) })}</CardTitle>
                    <CardDescription>{d.locked ? t("submittedOn", { date: fmtDate(d.submissionDate, locale), ack: d.ackNo ?? "" }) : d.daysLeft >= 0 ? t("dueIn", { date: fmtDate(d.due, locale), n: d.daysLeft }) : t("overdueBy", { date: fmtDate(d.due, locale), n: -d.daysLeft })}</CardDescription>
                  </div>
                  {status && <Pill tone={TONE[status]} icon={d.locked ? Lock : undefined}>{tr(`status.${status}`)}</Pill>}
                </CardHeader>
                <CardContent className="grid gap-4">
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {([["out", c.outputVat], ["in", c.inputVat], ["payable", c.payableVat], ["deposited", c.depositedVat]] as const).map(([k, v]) => (
                      <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{tr(`kpi.${k}`)}</dt><dd><Money value={v} className="text-base font-semibold" /></dd></div>
                    ))}
                  </dl>
                  {!d.locked && short > 0 && <p role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {t("short", { amount: fmtNum(short, locale, 2) })}</p>}
                  {!d.locked && c.drafts > 0 && <p className="text-sm text-muted-foreground">{t("drafts", { n: fmtNum(c.drafts, locale) })}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button render={<Link href={`/vat/return-9-1?period=${d.period}`} />}>{d.locked ? t("viewReturn") : d.notStarted ? t("prepareReturn") : t("continueReturn")} <ArrowRight /></Button>
                    {!d.locked && short > 0 && can("doc.create") && <Button variant="outline" render={<Link href={`/vat/tr-6?new=1&period=${d.period}&head=${c.shortVat ? "vat" : "sd"}&amount=${Math.ceil(c.shortVat || c.shortSd)}`} />}><Landmark /> {t("deposit")}</Button>}
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-4">
                <Card size="sm">
                  <CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="size-4" aria-hidden /> {t("deposits")}</CardTitle></CardHeader>
                  <CardContent className="grid gap-1 text-sm">
                    <p>{t("depositsBody", { n: fmtNum(d.deposits.count, locale) })} <Money value={d.deposits.amount} className="font-semibold" /></p>
                    {d.deposits.pending > 0 && <p className="text-warning">{t("depositsPending", { n: fmtNum(d.deposits.pending, locale) })}</p>}
                    <Link href={`/vat/tr-6?period=${d.period}`} className="text-primary hover:underline">{t("openTr6")}</Link>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" aria-hidden /> {t("vds")}</CardTitle></CardHeader>
                  <CardContent className="grid gap-1 text-sm">
                    <p>{t("vdsIssue", { n: fmtNum(d.vds.toIssue, locale) })} <Money value={d.vds.toIssueAmount} /></p>
                    <p>{t("vdsAwaited", { n: fmtNum(d.vds.awaited, locale) })} <Money value={d.vds.awaitedAmount} /></p>
                    <Link href="/vat/vds" className="text-primary hover:underline">{t("openVds")}</Link>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden /> {t("calendar")}</CardTitle><CardDescription>{t("calendarHint")}</CardDescription></CardHeader>
              <CardContent>
                <ol className="flex gap-2 overflow-x-auto pb-1" tabIndex={0} role="region" aria-label={t("calendar")}>
                  {[...periods].reverse().map((p) => (
                    <li key={p.period}>
                      <button type="button" onClick={() => setPeriod(p.period)} aria-current={p.period === d.period ? "true" : undefined}
                        className={`grid min-h-11 min-w-24 gap-1 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted ${p.period === d.period ? "border-primary ring-1 ring-primary" : ""}`}>
                        <span className="font-semibold tabular">{periodLabel(p.period)}</span>
                        <Pill tone={TONE[p.status]}>{tr(`status.${p.status}`)}</Pill>
                      </button>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="size-4" aria-hidden /> {t("reports")}</CardTitle><CardDescription>{t("reportsHint")}</CardDescription></CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {REPORTS.map((r) => (
                    <li key={r.form}>
                      <Link href={r.form === "9.1" ? `${r.href}?period=${d.period}` : r.href} className="flex min-h-11 items-start gap-3 rounded-md border p-3 hover:bg-muted">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary tabular">{r.form}</span>
                        <span className="grid gap-0.5"><span className="text-sm font-medium">{t(`r.${r.key}`)}</span><span className="text-xs text-muted-foreground">{t(`r.${r.key}Hint`)}</span></span>
                      </Link>
                    </li>
                  ))}
                  <li><Link href="/vat/adjustments" className="flex min-h-11 items-start gap-3 rounded-md border p-3 hover:bg-muted"><Scale className="mt-0.5 size-4 text-primary" aria-hidden /><span className="grid gap-0.5"><span className="text-sm font-medium">{t("r.adjust")}</span><span className="text-xs text-muted-foreground">{t("r.adjustHint")}</span></span></Link></li>
                  <li><Link href="/accounting/statements" className="flex min-h-11 items-start gap-3 rounded-md border p-3 hover:bg-muted"><ReceiptText className="mt-0.5 size-4 text-primary" aria-hidden /><span className="grid gap-0.5"><span className="text-sm font-medium">{t("r.statements")}</span><span className="text-xs text-muted-foreground">{t("r.statementsHint")}</span></span></Link></li>
                  {can("settings.manage") && <li><Link href="/vat/settings" className="flex min-h-11 items-start gap-3 rounded-md border p-3 hover:bg-muted"><Settings2 className="mt-0.5 size-4 text-primary" aria-hidden /><span className="grid gap-0.5"><span className="text-sm font-medium">{t("r.settings")}</span><span className="text-xs text-muted-foreground">{t("r.settingsHint")}</span></span></Link></li>}
                  <li><Link href="/vat/tariff" className="flex min-h-11 items-start gap-3 rounded-md border p-3 hover:bg-muted"><FileCheck2 className="mt-0.5 size-4 text-primary" aria-hidden /><span className="grid gap-0.5"><span className="text-sm font-medium">{t("r.tariff")}</span><span className="text-xs text-muted-foreground">{t("r.tariffHint")}</span></span></Link></li>
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
    </>
  )
}
