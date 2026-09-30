"use client"

import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import { M610_LIMIT, periodEnd, periodLabel, prevPeriod } from "@/lib/r4"
import type { M610Row } from "@/lib/types"

const LAST = prevPeriod(TODAY.slice(0, 7))
const PERIODS = Array.from({ length: 15 }, (_, i) => { let p = TODAY.slice(0, 7); for (let k = 0; k < i; k++) p = prevPeriod(p); return p })

/**
 * Mushak 6.10 — purchases and sales above Tk 2,00,000 per invoice (rule 42(1)), filed with the monthly return.
 * The legacy report failed with "totalPurchase" missing (D-05); here both parts and totals always render, empty or not.
 */
export function Mushak610Page() {
  const t = useTranslations("m610")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(`${LAST}-01`))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(periodEnd(LAST)))
  const valid = !!from && !!to && to >= from
  const q = useQuery({ queryKey: ["mushak", "6.10", from, to], queryFn: () => api.mushak.m610({ from, to }), enabled: valid, placeholderData: keepPreviousData })
  const d = q.data
  const period = from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01") && to === periodEnd(from.slice(0, 7)) ? from.slice(0, 7) : ""

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle", { limit: fmtNum(M610_LIMIT, locale) })}
        actions={d ? (
          <>
            <Button variant="outline" render={<a href={api.mushak.m610CsvUrl({ from, to })} download={`mushak-6.10-${from}-${to}.csv`} />}><Download /> {tt("exportCsv")}</Button>
            <PdfButton size="default" filename={`Mushak-6.10_${from}_${to}`} />
            <Button onClick={() => window.print()}><Printer /> {tc("print")}</Button>
          </>
        ) : undefined} />
      <section aria-label={t("filters")} className="no-print mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m610-period">{t("period")}</Label>
          <Select value={period} onValueChange={(v) => { const p = v as string; if (p) { setFrom(`${p}-01`); setTo(periodEnd(p)) } }} items={PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}>
            <SelectTrigger id="m610-period" className="w-full"><SelectValue placeholder={t("custom")} /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="m610-from">{t("from")}</Label><Input id="m610-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="m610-to">{t("to")}</Label>
          <Input id="m610-to" type="date" value={to} min={from} max={TODAY} aria-invalid={!valid || undefined} aria-describedby={!valid ? "m610-to-err" : undefined} onChange={(e) => setTo(e.target.value || null)} />
          {!valid && <p id="m610-to-err" className="text-xs text-destructive">{t("toBeforeFrom")}</p>}
        </div>
      </section>
      {q.isFetching && <p role="status" className="no-print mb-2 text-xs text-muted-foreground">{t("generating")}</p>}
      {!valid ? null : q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("error")} hint={q.error.message} /> : d && (
        <article className="print-area grid gap-6 rounded-lg border bg-card p-4 text-sm sm:p-6" aria-label={t("title")}>
          <header className="grid gap-1 text-center">
            <p className="text-xs">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার, জাতীয় রাজস্ব বোর্ড · Government of the People’s Republic of Bangladesh, National Board of Revenue</p>
            <h2 className="text-base font-semibold">দুই লক্ষ টাকার অধিক মূল্যমানের ক্রয়-বিক্রয় চালানপত্রের তথ্য · Information on purchase &amp; sale invoices above Tk 2,00,000</h2>
            <p className="text-xs">[বিধি ৪২(১) দ্রষ্টব্য · See rule 42(1)] <span className="ml-2 rounded border px-1.5 py-0.5 font-semibold">মূসক-৬.১০ · Mushak-6.10</span></p>
          </header>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">নিবন্ধিত ব্যক্তির নাম · Registered person</dt><dd className="font-medium">{d.company.name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">বিআইএন · BIN</dt><dd className="tabular">{d.company.bin}</dd></div>
            <div><dt className="text-xs text-muted-foreground">সময়কাল · Period</dt><dd className="tabular">{fmtDate(d.from, locale)} – {fmtDate(d.to, locale)}</dd></div>
            <div className="sm:col-span-3"><dt className="text-xs text-muted-foreground">ঠিকানা · Address</dt><dd>{d.company.address}</dd></div>
          </dl>
          <Part title="অংশ-ক: ক্রয় · Part A: Purchases" party="বিক্রেতার নাম · Supplier" rows={d.purchases} total={d.totals.purchases} hrefFor={(r) => `/purchases/${r.id}`} empty={t("emptyPart")} />
          <Part title="অংশ-খ: বিক্রয় · Part B: Sales" party="ক্রেতার নাম · Customer" rows={d.sales} total={d.totals.sales} hrefFor={(r) => `/sales/${r.id}`} empty={t("emptyPart")} />
          <footer className="grid gap-8 pt-6 sm:grid-cols-2">
            <p className="border-t pt-1 text-xs">দায়িত্বপ্রাপ্ত ব্যক্তির স্বাক্ষর · Signature of the authorised person</p>
            <p className="border-t pt-1 text-xs sm:text-right">তারিখ · Date: {fmtDate(TODAY, locale)}</p>
          </footer>
        </article>
      )}
    </>
  )
}

function Part({ title, party, rows, total, hrefFor, empty }: { title: string; party: string; rows: M610Row[]; total: { value: number; vat: number; total: number }; hrefFor: (r: M610Row) => string; empty: string }) {
  const locale = useLocale()
  const m = (v: number) => fmtMoney(v, locale)
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold">{title}</h3>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full min-w-[860px] border-collapse text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="w-10">ক্রমিক · SL</th><th scope="col">চালানপত্র নং · Invoice no</th><th scope="col">তারিখ · Date</th>
              <th scope="col">{party}</th><th scope="col">ঠিকানা · Address</th><th scope="col">বিআইএন · BIN</th>
              <th scope="col" className="text-right">মূল্য · Value</th><th scope="col" className="text-right">মূসক · VAT</th><th scope="col" className="text-right">মোট · Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id}>
                <td className="tabular">{r.sl}</td>
                <td className="tabular"><Link href={hrefFor(r)} className="text-primary hover:underline print:text-foreground">{r.no}</Link>{r.challanNo && r.challanNo !== r.no && <span className="block text-muted-foreground">{r.challanNo}</span>}</td>
                <td className="tabular whitespace-nowrap">{fmtDate(r.date, locale)}</td>
                <td>{r.party}</td><td>{r.address}</td><td className="tabular">{r.bin || "—"}</td>
                <td className="text-right tabular">{m(r.value)}</td><td className="text-right tabular">{m(r.vat)}</td><td className="text-right tabular">{m(r.total)}</td>
              </tr>
            )) : <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">{empty}</td></tr>}
          </tbody>
          <tfoot className="bg-muted/40 font-semibold">
            <tr><th scope="row" colSpan={6} className="text-left">সর্বমোট · Total ({fmtNum(rows.length, locale)})</th><td className="text-right tabular">{m(total.value)}</td><td className="text-right tabular">{m(total.vat)}</td><td className="text-right tabular">{m(total.total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
