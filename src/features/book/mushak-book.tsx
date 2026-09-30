"use client"

import * as React from "react"
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
import type { BookRow, LedgerType } from "@/lib/types"
import { cn } from "@/lib/utils"

const FY_START = `${Number(TODAY.slice(5, 7)) >= 7 ? TODAY.slice(0, 4) : Number(TODAY.slice(0, 4)) - 1}-07-01`
const href = (kind: LedgerType, id: string) =>
  kind === "sale" ? `/sales/${id}` : kind === "purchase" ? `/purchases/${id}` : kind === "damage" ? `/inventory/damage?view=${id}`
    : kind === "opening" ? `/purchases/opening?view=${id}` : kind === "purchaseReturn" ? `/purchases/debit-notes?view=${id}` : kind === "saleReturn" ? `/sales/credit-notes?view=${id}`
      : kind === "prodReceive" || kind === "prodIssue" ? `/production/batches?view=${id}`
      : kind === "transferIn" || kind === "transferOut" ? `/inventory/transfers?view=${id}` : null

/**
 * Mushak 6.1 (purchase book — inputs) and 6.2 (sales book — finished goods), rule 40(1) & 41.
 * Generated from the same stock ledger as the item ledger, so closing = stock on hand. ?item=&from=&to= are linkable.
 */
export function MushakBookPage({ form }: { form: "6.1" | "6.2" }) {
  const t = useTranslations("book")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const [item, setItem] = useQueryState("item", parseAsString.withDefault(""))
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(FY_START))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const k = form === "6.1" ? "b61" : "b62"
  const items = useQuery({ queryKey: ["items", "book-options"], queryFn: () => api.items.list({ size: 500 }), staleTime: 60_000 })
  const options = (items.data?.data ?? []).filter((i) => (form === "6.2") === (i.group === "Finished Goods"))
    .map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${fmtHs(i.hsCode)}`, keywords: [i.sku, i.hsCode] }))
  const valid = !!item && !!from && !!to && to >= from
  const p = { item, from, to }
  const q = useQuery({ queryKey: ["mushak", form, p], queryFn: () => api.mushak.book(form, p), enabled: valid, placeholderData: keepPreviousData, retry: false })
  const b = q.data && q.data.item.id === item ? q.data : undefined
  const n = (v: number) => (v ? fmtNum(v, locale) : "—")
  const m = (v: number) => (v ? fmtMoney(v, locale) : "—")
  const ref = (r: BookRow) => r.ref ? (r.refId && href(r.kind, r.refId) ? <Link href={href(r.kind, r.refId)!} className="font-medium text-primary hover:underline print:text-foreground">{r.ref}</Link> : r.ref) : "—"

  return (
    <>
      <PageHeader title={t(`${k}.title`)} description={t(`${k}.subtitle`)}
        actions={b ? (
          <>
            <Button variant="outline" render={<a href={api.mushak.csvUrl(form, p)} download={`mushak-${form}-${b.item.sku}-${from}-${to}.csv`} />}><Download /> {tt("exportCsv")}</Button>
            <PdfButton size="default" landscape filename={`Mushak-${form}_${b.item.sku}_${from}_${to}`} />
            <Button onClick={() => window.print()}><Printer /> {tc("print")}</Button>
          </>
        ) : undefined} />
      <section aria-label={t("filters")} className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] print:hidden">
        <div className="grid gap-1.5">
          <Label htmlFor="book-item">{t("item")}</Label>
          <Combobox id="book-item" value={item} onChange={(v) => setItem(v || null)} options={options} placeholder={t(`${k}.pickItem`)} searchPlaceholder={t("searchItem")} empty={tc("noResults")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="book-from">{t("from")}</Label>
          <Input id="book-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="book-to">{t("to")}</Label>
          <Input id="book-to" type="date" value={to} min={from} max={TODAY} aria-invalid={to < from || undefined} aria-describedby={to < from ? "book-to-err" : undefined} onChange={(e) => setTo(e.target.value || null)} />
          {to < from && <p id="book-to-err" className="text-xs text-destructive">{t("toBeforeFrom")}</p>}
        </div>
      </section>

      {!item ? <EmptyState icon={BookOpen} title={t(`${k}.pickItem`)} hint={t(`${k}.emptyHint`)} />
        : q.isLoading ? <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> {tc("loading")}</p>
        : q.error ? <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{q.error instanceof ApiError ? q.error.message : String(q.error)}</p>
        : b && (
          <article className={cn("print-area rounded-lg border bg-card print:border-0", q.isFetching && "opacity-70")} aria-busy={q.isFetching}>
            <header className="grid gap-1 border-b p-4 text-center">
              <p className="text-xs text-muted-foreground">{t("govt")}</p>
              <h2 className="text-base font-semibold">{t(`${k}.official`)} <span className="tabular">({t("form", { no: form })})</span></h2>
              <p className="text-xs text-muted-foreground">{t(`${k}.rule`)}</p>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-left text-sm sm:grid-cols-2">
                <p><span className="text-muted-foreground">{t("company")}:</span> {b.company.name}</p>
                <p><span className="text-muted-foreground">BIN:</span> <span className="tabular">{b.company.bin}</span></p>
                <p className="sm:col-span-2"><span className="text-muted-foreground">{t("address")}:</span> {b.company.address}</p>
                <p><span className="text-muted-foreground">{t("item")}:</span> <span className="font-medium">{b.item.name}</span> <span className="text-muted-foreground tabular">({b.item.sku} · HS {fmtHs(b.item.hsCode)} · {b.item.unit})</span></p>
                <p><span className="text-muted-foreground">{t("period")}:</span> <span className="tabular">{fmtDate(b.from, locale)} – {fmtDate(b.to, locale)}</span></p>
              </div>
            </header>
            <dl className="grid grid-cols-2 gap-3 border-b p-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t("openingBal")}</dt><dd className="tabular font-medium">{fmtNum(b.opening.qty, locale)} {b.item.unit} · {fmtMoney(b.opening.value, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t(`${k}.inTotal`)}</dt><dd className="tabular font-medium">{fmtNum(b.totals.inQty, locale)} · {fmtMoney(b.totals.inValue, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t(`${k}.outTotal`)}</dt><dd className="tabular font-medium">{fmtNum(b.totals.outQty, locale)} · {fmtMoney(b.totals.outValue, locale)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("closingBal")}</dt><dd className="tabular font-semibold">{fmtNum(b.closing.qty, locale)} {b.item.unit} · {fmtMoney(b.closing.value, locale)}</dd></div>
            </dl>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t(`${k}.official`)}>
              <table className="w-full min-w-[1100px] border-collapse text-xs">
                <caption className="sr-only">{t(`${k}.official`)} — {b.item.name}</caption>
                <thead className="bg-muted/60 text-left align-bottom">
                  <tr>
                    <th scope="col" rowSpan={2} className="border px-2 py-1">{t("col.sl")}</th>
                    <th scope="col" rowSpan={2} className="border px-2 py-1">{t("col.date")}</th>
                    <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t("col.opening")}</th>
                    {form === "6.2" && <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t("col.produced")}</th>}
                    <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t(form === "6.1" ? "col.challan" : "col.invoice")}</th>
                    <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t(form === "6.1" ? "col.seller" : "col.buyer")}</th>
                    <th scope="col" rowSpan={2} className="border px-2 py-1">{t("col.description")}</th>
                    {form === "6.1" && <th scope="colgroup" colSpan={4} className="border px-2 py-1 text-center">{t("col.purchased")}</th>}
                    {form === "6.2" && <th scope="colgroup" colSpan={4} className="border px-2 py-1 text-center">{t("col.sold")}</th>}
                    {form === "6.1" && <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t("col.consumed")}</th>}
                    <th scope="colgroup" colSpan={2} className="border px-2 py-1 text-center">{t("col.closing")}</th>
                  </tr>
                  <tr>
                    {[...[t("col.qty"), t("col.value")],
                      ...(form === "6.2" ? [t("col.qty"), t("col.value")] : []),
                      t("col.no"), t("col.date"), t("col.name"), "BIN",
                      t("col.qty"), t("col.value"), "SD", "VAT",
                      ...(form === "6.1" ? [t("col.qty"), t("col.value")] : []),
                      t("col.qty"), t("col.value")].map((h, i) => <th key={i} scope="col" className="border px-2 py-1 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.length === 0 && <tr><td colSpan={form === "6.1" ? 19 : 19} className="p-6 text-center text-muted-foreground">{t("noRows")}</td></tr>}
                  {b.rows.map((r) => (
                    <tr key={r.sl} className={cn("align-top even:bg-muted/20", r.summary && "font-medium text-muted-foreground")}>
                      <td className="border px-2 py-1 tabular">{fmtNum(r.sl, locale)}</td>
                      <td className="border px-2 py-1 whitespace-nowrap tabular">{fmtDate(r.date, locale)}</td>
                      <td className="border px-2 py-1 text-right tabular">{fmtNum(r.openQty, locale)}</td>
                      <td className="border px-2 py-1 text-right tabular">{fmtMoney(r.openValue, locale)}</td>
                      {form === "6.2" && <><td className="border px-2 py-1 text-right tabular">{r.kind === "prodReceive" || r.kind === "opening" ? n(r.inQty) : "—"}</td><td className="border px-2 py-1 text-right tabular">{r.kind === "prodReceive" || r.kind === "opening" ? m(r.inValue) : "—"}</td></>}
                      <td className="border px-2 py-1 whitespace-nowrap">{ref(r)}</td>
                      <td className="border px-2 py-1 whitespace-nowrap tabular">{r.refDate ? fmtDate(r.refDate, locale) : "—"}</td>
                      <td className="border px-2 py-1">{r.party ?? "—"}{r.partyAddress && <span className="block text-muted-foreground">{r.partyAddress}</span>}</td>
                      <td className="border px-2 py-1 whitespace-nowrap tabular">{r.partyBin ?? "—"}</td>
                      <td className="border px-2 py-1">{r.description}</td>
                      {form === "6.1"
                        ? <><td className="border px-2 py-1 text-right tabular">{n(r.inQty)}</td><td className="border px-2 py-1 text-right tabular">{m(r.inValue)}</td></>
                        : <><td className="border px-2 py-1 text-right tabular">{n(r.outQty)}</td><td className="border px-2 py-1 text-right tabular">{m(r.outValue)}</td></>}
                      <td className="border px-2 py-1 text-right tabular">{m(r.sd)}</td>
                      <td className="border px-2 py-1 text-right tabular">{m(r.vat)}</td>
                      {form === "6.1" && <><td className="border px-2 py-1 text-right tabular">{n(r.outQty)}</td><td className="border px-2 py-1 text-right tabular">{m(r.outValue)}</td></>}
                      <td className="border px-2 py-1 text-right tabular font-medium">{fmtNum(r.closeQty, locale)}</td>
                      <td className="border px-2 py-1 text-right tabular font-medium">{fmtMoney(r.closeValue, locale)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/60 font-semibold">
                  <tr>
                    <th scope="row" colSpan={form === "6.1" ? 9 : 11} className="border px-2 py-1 text-right">{t("total")}</th>
                    <td className="border px-2 py-1 text-right tabular">{fmtNum(form === "6.1" ? b.totals.inQty : b.totals.outQty, locale)}</td>
                    <td className="border px-2 py-1 text-right tabular">{fmtMoney(form === "6.1" ? b.totals.inValue : b.totals.outValue, locale)}</td>
                    <td className="border px-2 py-1 text-right tabular">{fmtMoney(b.totals.sd, locale)}</td>
                    <td className="border px-2 py-1 text-right tabular">{fmtMoney(b.totals.vat, locale)}</td>
                    {form === "6.1" && <><td className="border px-2 py-1 text-right tabular">{fmtNum(b.totals.outQty, locale)}</td><td className="border px-2 py-1 text-right tabular">{fmtMoney(b.totals.outValue, locale)}</td></>}
                    <td className="border px-2 py-1 text-right tabular">{fmtNum(b.closing.qty, locale)}</td>
                    <td className="border px-2 py-1 text-right tabular">{fmtMoney(b.closing.value, locale)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="p-4 text-xs text-muted-foreground">{t("footNote")} <Link href={`/inventory/items?ledger=${b.item.id}`} className="text-primary underline underline-offset-2 print:hidden">{t("openLedger")}</Link></p>
          </article>
        )}
    </>
  )
}
