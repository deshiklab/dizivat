"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { parseAsString, useQueryState } from "nuqs"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarClock, CheckCircle2, Download, Loader2, Lock, Scale } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useCan } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fiscalYearStart } from "@/lib/statements"
import { fmtDate, fmtNum } from "@/lib/format"

const TABS = ["trial-balance", "profit-loss", "balance-sheet", "cash-flow"] as const
type Tab = (typeof TABS)[number]

/**
 * R9.3 — the statements. Each is a date range over the same derived journal the chart and the register
 * serve: the trial balance proves the books foot, the profit & loss groups the year's movement, the
 * balance sheet carries the profit forward as two computed equity lines, and the cash flow explains
 * every movement of a money account by what caused it. The close moves the books' cut-off — it refuses
 * a non-month-end, the future, and any draft document dated under it (the API answers 409; the panel
 * shows why).
 */
export function ReportsView() {
  const t = useTranslations("reports")
  const tt = useTranslations("table")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("trial-balance"))
  const active: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "trial-balance"
  const [asOf, setAsOf] = useQueryState("asOf", parseAsString.withDefault(TODAY))
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(fiscalYearStart(TODAY)))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const [month, setMonth] = useQueryState("closeMonth", parseAsString.withDefault(""))
  const [note, setNote] = React.useState("")
  const [closeErr, setCloseErr] = React.useState<string | null>(null)

  const tb = useQuery({ queryKey: ["report", "tb", asOf], queryFn: () => api.accounting.reports.trialBalance({ asOf }), enabled: active === "trial-balance" })
  const pl = useQuery({ queryKey: ["report", "pl", from, to], queryFn: () => api.accounting.reports.profitLoss({ from, to }), enabled: active === "profit-loss" })
  const bs = useQuery({ queryKey: ["report", "bs", asOf], queryFn: () => api.accounting.reports.balanceSheet({ asOf }), enabled: active === "balance-sheet" })
  const cf = useQuery({ queryKey: ["report", "cf", from, to], queryFn: () => api.accounting.reports.cashFlow({ from, to }), enabled: active === "cash-flow" })
  const config = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config() })

  const closeBooks = useMutation({
    mutationFn: (b: { to: string; note?: string }) => api.accounting.closeBooks(b),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["accounting-config"] })
      setMonth(""); setNote(""); setCloseErr(null)
      toast.success(t("close.done", { to: fmtDate(c.closedUpTo ?? "", locale) }))
    },
    onError: (e) => setCloseErr(e.message),
  })

  const q = active === "trial-balance" ? tb : active === "profit-loss" ? pl : active === "balance-sheet" ? bs : cf
  const csvUrl =
    active === "trial-balance" ? api.accounting.reports.trialBalanceCsvUrl({ asOf })
    : active === "profit-loss" ? api.accounting.reports.profitLossCsvUrl({ from, to })
    : active === "balance-sheet" ? api.accounting.reports.balanceSheetCsvUrl({ asOf })
    : api.accounting.reports.cashFlowCsvUrl({ from, to })

  const submitClose = (e: React.FormEvent) => {
    e.preventDefault()
    setCloseErr(null)
    if (!month) { setCloseErr(t("close.pickMonth")); return }
    closeBooks.mutate({ to: `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`, ...(note.trim() ? { note: note.trim() } : {}) })
  }

  const th = "p-2 font-medium"
  const td = "p-2 tabular"

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={
          <Button variant="outline" size="sm" render={<a href={csvUrl} download />}>
            <Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span>
          </Button>
        } />

      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((x) => (
          <Button key={x} size="sm" variant={active === x ? "default" : "outline"} onClick={() => setTab(x)}>{t(`tabs.${x}`)}</Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {(active === "trial-balance" || active === "balance-sheet") ? (
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{t("asOf")}</span>
            <Input type="date" value={asOf} max={TODAY} onChange={(e) => setAsOf(e.target.value || TODAY)} className="w-40" />
          </label>
        ) : (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("from")}</span>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || fiscalYearStart(TODAY))} className="w-40" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{t("to")}</span>
              <Input type="date" value={to} max={TODAY} min={from} onChange={(e) => setTo(e.target.value || TODAY)} className="w-40" />
            </label>
          </>
        )}
      </div>

      {q.isLoading ? <Skeleton className="h-96" />
        : q.error ? <EmptyState title={tc("error")} hint={q.error.message} />
        : active === "trial-balance" && tb.data ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("tb.title")}</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th scope="col" className={th}>{t("col.code")}</th>
                  <th scope="col" className={th}>{t("col.account")}</th>
                  <th scope="col" className={th}>{t("col.group")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("col.debit")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("col.credit")}</th>
                </tr>
              </thead>
              <tbody>
                {tb.data.rows.map((r) => (
                  <tr key={r.code} className="border-b last:border-0 hover:bg-muted/30">
                    <td className={`${td} font-medium`}>{r.code}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2 text-muted-foreground">{r.group}</td>
                    <td className={`${td} text-right`}>{r.debit ? <Money value={r.debit} /> : "—"}</td>
                    <td className={`${td} text-right`}>{r.credit ? <Money value={r.credit} /> : "—"}</td>
                  </tr>
                ))}
                {!tb.data.rows.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">{t("empty")}</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-medium">
                  <td colSpan={3} className="p-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Scale className={Math.abs(tb.data.totals.debit - tb.data.totals.credit) < 0.005 ? "size-3.5 text-success" : "size-3.5 text-destructive"} aria-hidden />
                      {t("tb.foot", { asOf: fmtDate(tb.data.asOf, locale) })}
                    </span>
                  </td>
                  <td className={`${td} text-right`}><Money value={tb.data.totals.debit} /></td>
                  <td className={`${td} text-right`}><Money value={tb.data.totals.credit} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : active === "profit-loss" && pl.data ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("pl.title")}</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th scope="col" className={th}>{t("col.code")}</th>
                  <th scope="col" className={th}>{t("col.account")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["revenue", pl.data.revenue, pl.data.revenueTotal, undefined],
                  ["direct", pl.data.direct, pl.data.directTotal, pl.data.grossProfit],
                  ["operating", pl.data.operating, pl.data.operatingTotal, undefined],
                  ["taxCosts", pl.data.taxCosts, pl.data.taxTotal, undefined],
                ] as const).map(([key, rows, total, extra]) => rows.length ? (
                  <React.Fragment key={key}>
                    <tr className="bg-muted/30">
                      <td colSpan={2} className="p-2 font-medium">{t(`pl.${key}`)}</td>
                      <td className={`${td} text-right font-medium`}><Money value={total} /></td>
                    </tr>
                    {rows.map((l) => (
                      <tr key={`${key}-${l.code}`} className="border-b last:border-0">
                        <td className={`${td} text-muted-foreground`}>{l.code}</td>
                        <td className="p-2 pl-6">{l.name}</td>
                        <td className={`${td} text-right`}><Money value={l.amount} /></td>
                      </tr>
                    ))}
                    {extra !== undefined && (
                      <tr className="border-t font-medium">
                        <td colSpan={2} className="p-2">{key === "direct" ? t("pl.gross") : t("pl.net")}</td>
                        <td className={`${td} text-right`}><Money value={extra} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                ) : null)}
                {!pl.data.revenue.length && !pl.data.direct.length && !pl.data.operating.length && !pl.data.taxCosts.length && (
                  <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">{t("empty")}</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-medium">
                  <td colSpan={2} className="p-2">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className={pl.data.netProfit >= 0 ? "size-3.5 text-success" : "size-3.5 text-destructive"} aria-hidden />
                      {t("pl.netFor", { from: fmtDate(pl.data.from, locale), to: fmtDate(pl.data.to, locale) })}
                    </span>
                  </td>
                  <td className={`${td} text-right`}><Money value={pl.data.netProfit} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : active === "balance-sheet" && bs.data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {([
              ["assets", bs.data.assets, bs.data.totals.assets, t("bs.assets")],
              ["liabilities", [...bs.data.liabilities, ...bs.data.equity], bs.data.totals.liabilitiesAndEquity, t("bs.liabilitiesEquity")],
            ] as const).map(([key, sections, total, label]) => (
              <div key={key} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{label} — {t("bs.asOf", { asOf: fmtDate(bs.data!.asOf, locale) })}</caption>
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th scope="col" className={th}>{t("col.code")}</th>
                      <th scope="col" className={th}>{t("col.account")}</th>
                      <th scope="col" className={`${th} text-right`}>{t("col.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((s) => (
                      <React.Fragment key={`${key}-${s.group}`}>
                        <tr className="bg-muted/30">
                          <td colSpan={2} className="p-2 font-medium">{s.group}</td>
                          <td className={`${td} text-right font-medium`}><Money value={s.subtotal} /></td>
                        </tr>
                        {s.rows.map((l, i) => (
                          <tr key={`${key}-${s.group}-${i}`} className="border-b last:border-0">
                            <td className={`${td} text-muted-foreground`}>{l.code || "—"}</td>
                            <td className="p-2 pl-6">{l.name}</td>
                            <td className={`${td} text-right`}><Money value={l.amount} /></td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                    {!sections.length && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">{t("empty")}</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/50 font-medium">
                      <td colSpan={2} className="p-2">{label}</td>
                      <td className={`${td} text-right`}><Money value={total} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground lg:col-span-2">
              <Scale className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {Math.abs(bs.data.totals.assets - bs.data.totals.liabilitiesAndEquity) < 0.005 ? t("bs.balanced") : t("bs.off", { assets: fmtNum(bs.data.totals.assets, locale), other: fmtNum(bs.data.totals.liabilitiesAndEquity, locale) })}
            </p>
          </div>
        ) : cf.data ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("cf.title")}</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th scope="col" className={th}>{t("col.source")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("col.movement")}</th>
                </tr>
              </thead>
              <tbody>
                {cf.data.rows.map((r) => (
                  <tr key={r.kind} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2">{r.label ?? r.kind}</td>
                    <td className={`${td} text-right`}><Money value={r.amount} /></td>
                  </tr>
                ))}
                {!cf.data.rows.length && <tr><td colSpan={2} className="p-4 text-center text-muted-foreground">{t("empty")}</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-medium">
                  <td className="p-2">{t("cf.net", { from: fmtDate(cf.data.from, locale), to: fmtDate(cf.data.to, locale) })}</td>
                  <td className={`${td} text-right`}><Money value={cf.data.netMovement} /></td>
                </tr>
                <tr className="bg-muted/50 text-muted-foreground">
                  <td className="p-2">{t("cf.opening")}</td>
                  <td className={`${td} text-right`}><Money value={cf.data.opening} /></td>
                </tr>
                <tr className="bg-muted/50 text-muted-foreground">
                  <td className="p-2">{t("cf.closing")}</td>
                  <td className={`${td} text-right`}><Money value={cf.data.closing} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}

      {can("settings.manage") && config.data && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="size-4" aria-hidden /> {t("close.title")}</CardTitle>
            <CardDescription>
              {config.data.closedUpTo ? t("close.current", { to: fmtDate(config.data.closedUpTo, locale) }) : t("close.none")}
            </CardDescription>
          </CardHeader>
          <form onSubmit={submitClose} noValidate>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("close.month")}</span>
                  <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setCloseErr(null) }} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted-foreground">{t("close.note")}</span>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("close.notePlaceholder")} />
                </label>
              </div>
              {closeErr && <p className="text-sm text-destructive">{closeErr}</p>}
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("close.hint")}
              </p>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={closeBooks.isPending || !month}>
                {closeBooks.isPending ? <Loader2 className="animate-spin" /> : <Lock />} {t("close.submit")}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </>
  )
}
