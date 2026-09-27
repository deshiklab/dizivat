"use client"

import * as React from "react"
import { useCan, useCompany, useMe } from "@/components/auth/me-provider"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import dynamic from "next/dynamic"
import { AlertTriangle, ArrowRight, BadgePercent, CalendarClock, CheckCircle2, CircleDollarSign, HandCoins, Landmark, Plus, Receipt, TableProperties, BarChart3 } from "lucide-react"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PageHeader } from "@/components/common/page-header"
import { ProcessBadge, Pill } from "@/components/common/status-badge"
import { Money } from "@/components/common/money"
import { Link, useRouter } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtCompact, fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import { KpiCard } from "./kpi-card"

// recharts is the largest dependency on this page — fetch it after first paint (S4-03)
const chartSkeleton = () => <Skeleton className="size-full" aria-hidden />
const SalesPurchasesChart = dynamic(() => import("./charts").then((m) => m.SalesPurchasesChart), { ssr: false, loading: chartSkeleton })
const VatTrendChart = dynamic(() => import("./charts").then((m) => m.VatTrendChart), { ssr: false, loading: chartSkeleton })

function ChartCard({ title, description, table, children }: { title: string; description: string; table: React.ReactNode; children: React.ReactNode }) {
  const t = useTranslations("dashboard")
  const [asTable, setAsTable] = React.useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <UITooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} aria-label={asTable ? t("showChart") : t("showTable")} />}>
              {asTable ? <BarChart3 /> : <TableProperties />}
            </TooltipTrigger>
            <TooltipContent>{asTable ? t("showChart") : t("showTable")}</TooltipContent>
          </UITooltip>
        </CardAction>
      </CardHeader>
      <CardContent>{asTable ? <div className="max-h-64 overflow-auto">{table}</div> : <div className="h-64" role="img" aria-label={`${title}. ${description}`}>{children}</div>}</CardContent>
    </Card>
  )
}

export function Dashboard() {
  const company = useCompany()
  const t = useTranslations("dashboard")
  const locale = useLocale()
  const router = useRouter()
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard })
  const me = useMe()
  const can = useCan()
  const monthLabel = (m: string) => fmtDate(`${m}-01`, locale, "MMM yy")
  const [hour, setHour] = React.useState(12)
  React.useEffect(() => setHour(new Date().getHours()), [])
  const greet = hour < 12 ? t("morning") : hour < 17 ? t("afternoon") : t("evening")

  if (isLoading || !data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-12 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      </div>
    )
  }
  const k = data.kpis
  const series = data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }))
  const maxCust = Math.max(...data.topCustomers.map((c) => c.amount), 1)
  const period = fmtDate(`${data.period.label}-01`, locale, "MMMM yyyy")

  const monthTable = (keys: [string, string][]) => (
    <table className="w-full text-sm">
      <caption className="sr-only">{t("dataTable")}</caption>
      <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="py-1">{t("month")}</th>{keys.map(([k2, l]) => <th key={k2} scope="col" className="py-1 text-right">{l}</th>)}</tr></thead>
      <tbody>{series.map((r) => <tr key={r.month} className="border-t"><th scope="row" className="py-1 text-left font-normal">{r.label}</th>{keys.map(([k2]) => <td key={k2} className="py-1 text-right tabular">{fmtMoney((r as unknown as Record<string, number>)[k2], locale)}</td>)}</tr>)}</tbody>
    </table>
  )

  return (
    <>
      <PageHeader
        title={`${greet}, ${me.user.name.replace(/^Md\.\s*/, "").split(" ")[0]}`}
        description={t("subtitle", { company: company.name, period, date: fmtDate(data.period.returnDue, locale), days: fmtNum(data.period.daysLeft, locale) })}
        actions={
          can("doc.create") ? <>
            <Button variant="outline" size="sm" render={<Link href="/purchases/new" />}><Plus /> {t("newPurchase")}</Button>
            <Button size="sm" render={<Link href="/sales/new" />}><Plus /> {t("newSale")}</Button>
          </> : undefined
        }
      />

      <section aria-labelledby="kpi-h" className="mb-4">
        <h2 id="kpi-h" className="sr-only">{t("kpis", { period })}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard label={t("salesPeriod")} value={k.sales} prev={k.salesPrev} icon={Receipt} />
          <KpiCard label={t("outputVat")} value={k.outputVat} prev={k.outputVatPrev} icon={BadgePercent} />
          <KpiCard label={t("inputVat")} value={k.inputVat} prev={k.inputVatPrev} icon={HandCoins} />
          <KpiCard label={t("netPayable")} value={k.netPayable} prev={k.netPayablePrev} icon={Landmark} goodWhenUp={false} emphasis hint={t("netPayableHint")} />
          <KpiCard label={t("receivable")} value={k.receivable} icon={CircleDollarSign} hint={t("receivableHint", { payable: fmtCompact(k.payable, locale) })} />
        </div>
      </section>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <ChartCard title={t("salesVsPurchases")} description={t("last12")} table={monthTable([["sales", t("sales")], ["purchases", t("purchases")]])}>
          <SalesPurchasesChart data={series} labels={{ sales: t("sales"), purchases: t("purchases") }} />
        </ChartCard>
        <ChartCard title={t("vatTrend")} description={t("vatTrendHint")} table={monthTable([["outputVat", t("outputVat")], ["inputVat", t("inputVat")]])}>
          <VatTrendChart data={series} labels={{ outputVat: t("outputVat"), inputVat: t("inputVat") }} />
        </ChartCard>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden /> {t("deadlines")}</CardTitle><CardDescription>{t("deadlinesHint")}</CardDescription></CardHeader>
          <CardContent>
            <ol className="grid gap-3">
              {data.deadlines.map((d) => {
                const days = Math.round((Date.parse(d.due) - Date.parse(TODAY)) / 864e5)
                return (
                  <li key={d.id} className="flex items-start gap-3">
                    {d.status === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />}
                    <div className="grid flex-1 gap-0.5">
                      <Link href={d.href ?? "/"} className="text-sm font-medium hover:underline">{t(`deadline.${d.title}`)}</Link>
                      <span className="text-xs text-muted-foreground">{fmtDate(d.due, locale)}</span>
                    </div>
                    {d.status === "done" ? <Pill tone="success">{t("submitted")}</Pill> : <Pill tone={days <= 7 ? "danger" : "warning"}>{t("inDays", { days: fmtNum(days, locale) })}</Pill>}
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("topCustomers")}</CardTitle><CardDescription>{t("fyToDate")}</CardDescription></CardHeader>
          <CardContent>
            <ol className="grid gap-3">
              {data.topCustomers.map((c) => (
                <li key={c.name} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate" title={c.name}>{c.name}</span>
                    <span className="shrink-0 tabular font-medium">৳&nbsp;{fmtCompact(c.amount, locale)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-primary" style={{ width: `${(c.amount / maxCust) * 100}%` }} /></div>
                  <span className="text-xs text-muted-foreground">{t("invoices", { count: fmtNum(c.count, locale) })}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden /> {t("lowStock")}</CardTitle>
            <CardDescription>{t("lowStockHint")}</CardDescription>
            <CardAction><Button variant="link" size="sm" render={<Link href="/inventory/items?stock=low,out" />}>{t("viewAll")}</Button></CardAction>
          </CardHeader>
          <CardContent>
            {data.lowStock.length === 0 ? <p className="text-sm text-muted-foreground">{t("stockOk")}</p> : (
              <ul className="grid gap-3">
                {data.lowStock.map((i) => (
                  <li key={i.id} className="grid gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{i.name}</span>
                      <span className="shrink-0 tabular text-xs text-muted-foreground">{fmtNum(i.remain, locale)} / {fmtNum(i.reorderLevel, locale)} {i.unit}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-warning" style={{ width: `${Math.max(4, Math.min(100, (i.remain / i.reorderLevel) * 100))}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("recentSales")}</CardTitle>
          <CardDescription>{t("pendingCount", { count: fmtNum(k.pendingApproval, locale) })}</CardDescription>
          <CardAction><Button variant="outline" size="sm" render={<Link href="/sales" />}>{t("allInvoices")} <ArrowRight /></Button></CardAction>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("recentSales")}</caption>
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">{t("invoice")}</th><th scope="col" className="px-4 py-2 font-medium">{t("customer")}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t("date")}</th><th scope="col" className="px-4 py-2 text-right font-medium">{t("vat")}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{t("total")}</th><th scope="col" className="px-4 py-2 font-medium">{t("status")}</th>
            </tr></thead>
            <tbody>
              {data.recentSales.map((s) => (
                <tr key={s.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/60" onClick={() => router.push(`/sales/${s.id}`)}>
                  <td className="px-4 py-2"><Link href={`/sales/${s.id}`} className="font-medium text-primary hover:underline">{s.invoiceNo}</Link></td>
                  <td className="max-w-64 truncate px-4 py-2">{s.customerName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.issueDate, locale)}</td>
                  <td className="px-4 py-2 text-right"><Money value={s.vat} /></td>
                  <td className="px-4 py-2 text-right font-medium"><Money value={s.netTotal} /></td>
                  <td className="px-4 py-2"><ProcessBadge value={s.process} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  )
}
