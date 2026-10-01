"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { Banknote, CheckCircle2, CircleAlert, Clock, Download, Printer, Ship } from "lucide-react"
import { useCan } from "@/components/auth/me-provider"
import { PROCEEDS_TONE, RealiseDialog, type RealiseTarget } from "./proceeds"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Pill } from "@/components/common/status-badge"
import { Money } from "@/components/common/money"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { registerFrom } from "@/lib/rmg"

const KINDS = ["all", "direct", "deemed"] as const
const PROCEEDS = ["all", "open", "overdue", "partial", "realised"] as const

/**
 * R6 (RMG) — Export & deemed-export register. Every zero-rated export invoice with its LC / UD / EXP / Bill-of-Export
 * references and the NBR conditions it meets, so incomplete files are fixed before the return (note 1 / note 2) is filed.
 */
export function ExportRegisterPage() {
  const t = useTranslations("rmg")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(registerFrom(TODAY)))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const [kind, setKind] = useQueryState("kind", parseAsString.withDefault("all"))
  const [risk, setRisk] = useQueryState("risk", parseAsString.withDefault(""))
  const [proceeds, setProceeds] = useQueryState("proceeds", parseAsString.withDefault("all"))
  const tp = useTranslations("proceeds")
  const can = useCan()
  const [realise, setRealise] = React.useState<RealiseTarget | null>(null)
  const valid = !!from && !!to && to >= from
  const p = { from, to, kind: kind === "all" ? undefined : kind, risk: risk || undefined, proceeds: proceeds === "all" ? undefined : proceeds }
  const q = useQuery({ queryKey: ["vat", "exports", p], queryFn: () => api.vat.exports(p), enabled: valid, placeholderData: keepPreviousData })
  const d = q.data

  return (
    <>
      <PageHeader title={t("register.title")} description={t("register.subtitle")}
        actions={d ? (
          <>
            <Button variant="outline" render={<a href={api.vat.exportsCsvUrl(p)} download={`export-register-${from}-${to}.csv`} />}><Download /> {tt("exportCsv")}</Button>
            <PdfButton size="default" filename={`Export-register_${from}_${to}`} />
            <Button onClick={() => window.print()}><Printer /> {tc("print")}</Button>
          </>
        ) : undefined} />
      <section aria-label={t("register.filters")} className="no-print mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1.5"><Label htmlFor="ex-from">{t("register.from")}</Label><Input id="ex-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-to">{t("register.to")}</Label>
          <Input id="ex-to" type="date" value={to} min={from} max={TODAY} aria-invalid={!valid || undefined} aria-describedby={!valid ? "ex-to-err" : undefined} onChange={(e) => setTo(e.target.value || null)} />
          {!valid && <p id="ex-to-err" className="text-xs text-destructive">{t("register.toBeforeFrom")}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-kind">{t("register.kind")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v === "all" ? null : (v as string))} items={KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}>
            <SelectTrigger id="ex-kind" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{t(`kind.${k}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-proceeds">{tp("filter")}</Label>
          <Select value={proceeds} onValueChange={(v) => setProceeds(v === "all" ? null : (v as string))} items={PROCEEDS.map((k) => ({ value: k, label: tp(`f.${k}`) }))}>
            <SelectTrigger id="ex-proceeds" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{PROCEEDS.map((k) => <SelectItem key={k} value={k}>{tp(`f.${k}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 pb-2"><Switch id="ex-risk" checked={risk === "1"} onCheckedChange={(on) => setRisk(on ? "1" : null)} /><Label htmlFor="ex-risk">{t("register.riskOnly")}</Label></div>
      </section>
      {!valid ? null : q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("register.error")} hint={q.error.message} /> : d && (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Ship className="size-4" aria-hidden /> {t("register.totalsDirect")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><Money value={d.totals.direct.value} className="text-lg font-semibold" /> <span className="text-muted-foreground">· {t("register.invoices", { n: fmtNum(d.totals.direct.count, locale), count: d.totals.direct.count })}</span></CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Ship className="size-4" aria-hidden /> {t("register.totalsDeemed")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><Money value={d.totals.deemed.value} className="text-lg font-semibold" /> <span className="text-muted-foreground">· {t("register.invoices", { n: fmtNum(d.totals.deemed.count, locale), count: d.totals.deemed.count })}</span></CardContent></Card>
            <Card size="sm" className={d.totals.atRisk.count ? "border-warning/60" : undefined}><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><CircleAlert className="size-4 text-warning" aria-hidden /> {t("register.totalsRisk")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><Money value={d.totals.atRisk.value} className="text-lg font-semibold" /> <span className="text-muted-foreground">· {t("register.invoices", { n: fmtNum(d.totals.atRisk.count, locale), count: d.totals.atRisk.count })}</span>
                {d.totals.atRisk.count > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("register.riskHint")}</p>}</CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Banknote className="size-4" aria-hidden /> {tp("totalsOpen")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><Money value={d.totals.unrealised.value} className="text-lg font-semibold" /> <span className="text-muted-foreground">· {t("register.invoices", { n: fmtNum(d.totals.unrealised.count, locale), count: d.totals.unrealised.count })}</span></CardContent></Card>
            <Card size="sm" className={d.totals.overdue.count ? "border-destructive/50" : undefined}><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Clock className="size-4 text-destructive" aria-hidden /> {tp("totalsOverdue")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><Money value={d.totals.overdue.value} className="text-lg font-semibold" /> <span className="text-muted-foreground">· {t("register.invoices", { n: fmtNum(d.totals.overdue.count, locale), count: d.totals.overdue.count })}</span>
                {d.totals.overdue.count > 0 && <p className="mt-1 text-xs text-muted-foreground">{tp("overdueHint")}</p>}</CardContent></Card>
          </div>
          <article className="print-area rounded-lg border bg-card" aria-label={t("register.title")}>
            <h2 className="hidden p-4 text-base font-semibold print:block">{t("register.title")} · {fmtDate(d.from, locale)} – {fmtDate(d.to, locale)}</h2>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("register.table")}>
              <table className="w-full min-w-[1220px] text-sm">
                <caption className="sr-only">{t("register.table")}</caption>
                <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.date")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.invoice")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.customer")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.kind")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.lc")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.doc")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.fc")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.value")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{tp("col")}</th>
                </tr></thead>
                <tbody>
                  {d.rows.length ? d.rows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(r.date, locale)}</td>
                      <td className="px-3 py-2 tabular"><Link href={`/sales/${r.id}`} className="text-primary hover:underline print:text-foreground">{r.invoiceNo}</Link>{r.process !== "Approved" && <span className="block text-xs text-muted-foreground">{r.process}</span>}</td>
                      <td className="px-3 py-2">{r.customer}<span className="block text-xs text-muted-foreground tabular">{r.bin ? `BIN ${r.bin}` : r.country}</span></td>
                      <td className="px-3 py-2"><Pill tone={r.kind === "deemed" ? "info" : "neutral"}>{t(`kind.${r.kind}`)}</Pill></td>
                      <td className="px-3 py-2 tabular">{r.lcNo}<span className="block text-xs text-muted-foreground">{r.lcDate ? fmtDate(r.lcDate, locale) : ""}</span></td>
                      <td className="px-3 py-2 text-xs tabular">{r.kind === "deemed" ? <>UD {r.udNo || "—"}</> : <>EXP {r.expNo || "—"}<span className="block">B/E {r.billNo || "—"}</span></>}</td>
                      <td className="px-3 py-2 text-right tabular">{r.fcValue ? `${r.currency} ${fmtNum(r.fcValue, locale, 2)}` : "—"}{r.exchangeRate ? <span className="block text-xs text-muted-foreground">@ {fmtNum(r.exchangeRate, locale, 2)}</span> : null}</td>
                      <td className="px-3 py-2 text-right"><Money value={r.value} /></td>
                      <td className="px-3 py-2">
                        {r.complete
                          ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" aria-hidden /> {t("complete")}</span>
                          : <><span className="flex items-center gap-1 font-medium text-warning"><CircleAlert className="size-3.5" aria-hidden /> {t("atRisk")}</span>
                            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">{r.missing.map((m) => <li key={m}>{t(`check.${m}`)}</li>)}</ul></>}
                      </td>
                      <td className="px-3 py-2">
                        {r.proceeds === "na" ? <span className="text-muted-foreground">—</span> : <>
                          <Pill tone={PROCEEDS_TONE[r.proceeds]}>{tp(`state.${r.proceeds}`)}</Pill>
                          {r.outstandingFc > 0 && <span className="mt-1 block text-xs tabular">{tp("short", { amount: `${r.currency} ${fmtNum(r.outstandingFc, locale, 2)}` })}</span>}
                          {r.proceedsDue && r.outstandingFc > 0 && <span className={r.proceeds === "overdue" ? "block text-xs text-destructive tabular" : "block text-xs text-muted-foreground tabular"}>{tp("dueOn", { date: fmtDate(r.proceedsDue, locale) })}</span>}
                          {r.outstandingFc > 0 && r.process === "Approved" && can("doc.edit") && (
                            <Button variant="outline" size="xs" className="no-print mt-1" aria-label={tp("recordFor", { no: r.invoiceNo })}
                              onClick={() => setRealise({ saleId: r.id, invoiceNo: r.invoiceNo, invoiceDate: r.date, currency: r.currency!, outstandingFc: r.outstandingFc, rate: r.exchangeRate })}>{tp("recordShort")}</Button>
                          )}
                        </>}
                      </td>
                    </tr>
                  )) : <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">{t("register.empty")}</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}
      <RealiseDialog target={realise} onOpenChange={(o) => !o && setRealise(null)} />
    </>
  )
}
