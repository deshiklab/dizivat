"use client"

import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { BookOpen, Download, Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/common/page-header"
import { Combobox } from "@/components/common/combobox"
import { EmptyState } from "@/components/common/empty-state"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtHs, fmtMoney, fmtNum } from "@/lib/format"
import type { BookRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const FY_START = `${Number(TODAY.slice(5, 7)) >= 7 ? TODAY.slice(0, 4) : Number(TODAY.slice(0, 4)) - 1}-07-01`

/**
 * R6.2 — Mushak 6.2.1 (purchase-sales book, rule 40(1)(a) & 41(1)(a)): for goods bought and resold without
 * processing (traders, and manufacturers' traded lines) the purchase and the sale sit side by side on one register.
 * Built from the same stock ledger as 6.1 / 6.2, so the closing balance equals stock on hand.
 */
export function Mushak621Page() {
  const t = useTranslations("book")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const [item, setItem] = useQueryState("item", parseAsString.withDefault(""))
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(FY_START))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const items = useQuery({ queryKey: ["items", "book-options"], queryFn: () => api.items.list({ size: 500 }), staleTime: 60_000 })
  const options = (items.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${fmtHs(i.hsCode)} · ${i.group}`, keywords: [i.sku, i.hsCode] }))
  const valid = !!item && !!from && !!to && to >= from
  const p = { item, from, to }
  const q = useQuery({ queryKey: ["mushak", "6.2.1", p], queryFn: () => api.mushak.book("6.2.1", p), enabled: valid, placeholderData: keepPreviousData, retry: false })
  const b = q.data && q.data.item.id === item ? q.data : undefined
  const n = (v: number) => (v ? fmtNum(v, locale) : "")
  const m = (v: number) => (v ? fmtMoney(v, locale) : "")
  const href = (r: BookRow) => !r.refId ? null : r.kind === "sale" ? `/sales/${r.refId}` : r.kind === "purchase" ? `/purchases/${r.refId}` : null
  const ref = (r: BookRow) => r.ref ? (href(r) ? <Link href={href(r)!} className="font-medium text-primary hover:underline print:text-foreground">{r.ref}</Link> : r.ref) : ""
  const isIn = (r: BookRow) => r.inQty > 0
  const cell = "border px-2 py-1"

  return (
    <>
      <PageHeader title={t("b621.title")} description={t("b621.subtitle")}
        actions={b ? (
          <>
            <Button variant="outline" render={<a href={api.mushak.csvUrl("6.2.1", p)} download={`mushak-6.2.1-${b.item.sku}-${from}-${to}.csv`} />}><Download /> {tt("exportCsv")}</Button>
            <PdfButton size="default" landscape filename={`Mushak-6.2.1_${b.item.sku}_${from}_${to}`} />
            <Button onClick={() => window.print()}><Printer /> {tc("print")}</Button>
          </>
        ) : undefined} />
      <section aria-label={t("filters")} className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] print:hidden">
        <div className="grid gap-1.5">
          <Label htmlFor="book-item">{t("item")}</Label>
          <Combobox id="book-item" value={item} onChange={(v) => setItem(v || null)} options={options} placeholder={t("b621.pickItem")} searchPlaceholder={t("searchItem")} empty={tc("noResults")} />
        </div>
        <div className="grid gap-1.5"><Label htmlFor="book-from">{t("from")}</Label><Input id="book-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="book-to">{t("to")}</Label>
          <Input id="book-to" type="date" value={to} min={from} max={TODAY} aria-invalid={to < from || undefined} aria-describedby={to < from ? "book-to-err" : undefined} onChange={(e) => setTo(e.target.value || null)} />
          {to < from && <p id="book-to-err" className="text-xs text-destructive">{t("toBeforeFrom")}</p>}
        </div>
      </section>

      {!item ? <EmptyState icon={BookOpen} title={t("b621.pickItem")} hint={t("b621.emptyHint")} />
        : q.isLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> {tc("loading")}</p>
        : q.error ? <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{q.error instanceof ApiError ? q.error.message : String(q.error)}</p>
        : b && (
          <article className={cn("print-area rounded-lg border bg-card print:border-0", q.isFetching && "opacity-70")} aria-busy={q.isFetching}>
            <header className="grid gap-1 border-b p-4 text-center">
              <p className="text-xs text-muted-foreground">{t("govt")}</p>
              <h2 className="text-base font-semibold">{t("b621.official")} <span className="tabular">({t("form", { no: "6.2.1" })})</span></h2>
              <p className="text-xs text-muted-foreground">{t("b621.rule")}</p>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-left text-sm sm:grid-cols-2">
                <p><span className="text-muted-foreground">{t("company")}:</span> {b.company.name}</p>
                <p><span className="text-muted-foreground">BIN:</span> <span className="tabular">{b.company.bin}</span></p>
                <p><span className="text-muted-foreground">{t("item")}:</span> <span className="font-medium">{b.item.name}</span> <span className="text-muted-foreground tabular">({b.item.sku} · HS {fmtHs(b.item.hsCode)} · {b.item.unit})</span></p>
                <p><span className="text-muted-foreground">{t("period")}:</span> <span className="tabular">{fmtDate(b.from, locale)} – {fmtDate(b.to, locale)}</span></p>
              </div>
            </header>
            <dl className="grid grid-cols-2 gap-3 border-b p-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t("openingBal")}</dt><dd className="tabular font-medium">{fmtNum(b.opening.qty, locale)} {b.item.unit} · {fmtMoney(b.opening.value, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("b621.inTotal")}</dt><dd className="tabular font-medium">{fmtNum(b.totals.inQty, locale)} · {fmtMoney(b.totals.inValue, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("b621.outTotal")}</dt><dd className="tabular font-medium">{fmtNum(b.totals.outQty, locale)} · {fmtMoney(b.totals.outValue, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("closingBal")}</dt><dd className="tabular font-semibold">{fmtNum(b.closing.qty, locale)} {b.item.unit} · {fmtMoney(b.closing.value, locale)}</dd></div>
            </dl>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("b621.official")}>
              <table className="w-full min-w-[1400px] border-collapse text-xs">
                <caption className="sr-only">{t("b621.official")} — {b.item.name}</caption>
                <thead className="bg-muted/60 text-left align-bottom">
                  <tr>
                    <th scope="col" rowSpan={2} className={cell}>{t("col.sl")}</th>
                    <th scope="col" rowSpan={2} className={cell}>{t("col.date")}</th>
                    <th scope="colgroup" colSpan={2} className={`${cell} text-center`}>{t("col.opening")}</th>
                    <th scope="colgroup" colSpan={6} className={`${cell} text-center`}>{t("b621.purchase")}</th>
                    <th scope="colgroup" colSpan={6} className={`${cell} text-center`}>{t("b621.sale")}</th>
                    <th scope="colgroup" colSpan={2} className={`${cell} text-center`}>{t("col.closing")}</th>
                    <th scope="col" rowSpan={2} className={cell}>{t("b621.remarks")}</th>
                  </tr>
                  <tr>
                    {[t("col.qty"), t("col.value"),
                      t("col.challan"), t("col.seller"), t("col.qty"), t("col.value"), "SD", "VAT",
                      t("col.invoice"), t("col.buyer"), t("col.qty"), t("col.value"), "SD", "VAT",
                      t("col.qty"), t("col.value")].map((h, i) => <th key={i} scope="col" className={cell}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {b.rows.length === 0 && <tr><td colSpan={19} className="p-6 text-center text-muted-foreground">{t("noRows")}</td></tr>}
                  {b.rows.map((r) => {
                    const side = isIn(r)
                    const party = <>{r.party ?? ""}{r.partyBin ? <span className="block text-muted-foreground">{r.partyBin}</span> : null}</>
                    return (
                      <tr key={r.sl} className="align-top">
                        <td className={`${cell} text-center`}>{r.sl}</td>
                        <td className={`${cell} whitespace-nowrap`}>{fmtDate(r.date, locale)}</td>
                        <td className={`${cell} text-right`}>{fmtNum(r.openQty, locale)}</td><td className={`${cell} text-right`}>{fmtMoney(r.openValue, locale)}</td>
                        {side ? <>
                          <td className={cell}>{ref(r)}{r.refDate ? <span className="block text-muted-foreground">{fmtDate(r.refDate, locale)}</span> : null}</td><td className={cell}>{party}</td>
                          <td className={`${cell} text-right`}>{n(r.inQty)}</td><td className={`${cell} text-right`}>{m(r.inValue)}</td><td className={`${cell} text-right`}>{m(r.sd)}</td><td className={`${cell} text-right`}>{m(r.vat)}</td>
                          <td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} />
                        </> : <>
                          <td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} /><td className={cell} />
                          <td className={cell}>{ref(r)}{r.refDate ? <span className="block text-muted-foreground">{fmtDate(r.refDate, locale)}</span> : null}</td><td className={cell}>{party}</td>
                          <td className={`${cell} text-right`}>{n(r.outQty)}</td><td className={`${cell} text-right`}>{m(r.outValue)}</td><td className={`${cell} text-right`}>{m(r.sd)}</td><td className={`${cell} text-right`}>{m(r.vat)}</td>
                        </>}
                        <td className={`${cell} text-right`}>{fmtNum(r.closeQty, locale)}</td><td className={`${cell} text-right`}>{fmtMoney(r.closeValue, locale)}</td>
                        <td className={cell}>{r.kind === "purchase" || r.kind === "sale" ? "" : r.description}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted/40 font-semibold tabular">
                  <tr>
                    <th scope="row" colSpan={6} className={`${cell} text-right`}>{t("total")}</th>
                    <td className={`${cell} text-right`}>{fmtNum(b.totals.inQty, locale)}</td><td className={`${cell} text-right`}>{fmtMoney(b.totals.inValue, locale)}</td>
                    <td className={cell} colSpan={4} />
                    <td className={`${cell} text-right`}>{fmtNum(b.totals.outQty, locale)}</td><td className={`${cell} text-right`}>{fmtMoney(b.totals.outValue, locale)}</td>
                    <td className={cell} colSpan={2} />
                    <td className={`${cell} text-right`}>{fmtNum(b.closing.qty, locale)}</td><td className={`${cell} text-right`}>{fmtMoney(b.closing.value, locale)}</td>
                    <td className={cell} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        )}
    </>
  )
}
