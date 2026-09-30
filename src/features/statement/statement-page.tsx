"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs"
import { AlertTriangle, CheckCircle2, Download, HandCoins, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { Combobox } from "@/components/common/combobox"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import type { StatementRow } from "@/lib/types"

const KINDS = ["customer", "vendor"] as const
const FY_START = `${Number(TODAY.slice(5, 7)) >= 7 ? TODAY.slice(0, 4) : Number(TODAY.slice(0, 4)) - 1}-07-01`

/** Party ledger / due statement with ageing; reconciles against the invoice registers (acceptance: statements agree with sales / purchase totals). */
export function StatementPage() {
  const t = useTranslations("statement")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [kind, setKind] = useQueryState("kind", parseAsStringLiteral(KINDS).withDefault("customer"))
  const [party, setParty] = useQueryState("party", parseAsString)
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(FY_START))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const parties = useQuery({ queryKey: [kind === "customer" ? "customers" : "vendors", "options"], queryFn: () => (kind === "customer" ? api.customers : api.vendors).options() })
  const valid = !!party && !!from && !!to && from <= to
  const s = useQuery({ queryKey: ["statement", kind, party, from, to], queryFn: () => api.accounting.statement({ kind, party: party!, from, to }), enabled: valid })
  const d = s.data
  const options = (parties.data ?? []).map((p) => ({ value: p.id, label: p.name, description: p.bin, keywords: [p.bin] }))
  const k = (x: string) => `${kind}.${x}`
  const href = (r: StatementRow) => {
    if (!r.refId) return null
    if (r.type === "invoice" || r.type === "settledOnInvoice") return kind === "customer" ? `/sales/${r.refId}` : `/purchases/${r.refId}`
    if (r.type === "vds") return `/vat/vds?view=${r.refId}`
    return `/accounting/${kind === "customer" ? "receipts" : "payments"}?view=${r.refId}`
  }
  const ageing = d ? ([["d0_30", d.ageing.d0_30], ["d31_60", d.ageing.d31_60], ["d61_90", d.ageing.d61_90], ["d90", d.ageing.d90]] as const) : []
  const ageMax = Math.max(1, ...ageing.map(([, v]) => v))

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={d ? (
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="outline" render={<a href={api.accounting.statementCsvUrl({ kind, party: party!, from, to })} download />}><Download /> {t("csv")}</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer /> {t("print")}</Button>
            <PdfButton size="default" filename={`Statement_${kind}_${d.party.name}_${from}_${to}`} />
          </div>
        ) : undefined} />
      <Card className="no-print mb-4">
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_1fr_auto_auto]">
          <div className="grid gap-1.5">
            <span className="text-sm" id="kind-label">{t("kind")}</span>
            <div role="radiogroup" aria-labelledby="kind-label" className="inline-flex rounded-lg border p-0.5">
              {KINDS.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={kind === x} onClick={() => { setKind(x); setParty(null) }}
                  className={`min-h-9 rounded-md px-3 text-sm ${kind === x ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{t(`${x}.label`)}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="st-party" className="text-sm">{t(k("party"))}</Label>
            <Combobox id="st-party" value={party ?? ""} onChange={(v) => setParty(v || null)} options={options} placeholder={t(k("pick"))} searchPlaceholder={t("search")} empty={tc("noResults")} />
          </div>
          <div className="grid gap-1.5"><Label htmlFor="st-from" className="text-sm">{t("from")}</Label><Input id="st-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="st-to" className="text-sm">{t("to")}</Label><Input id="st-to" type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value || null)} /></div>
        </CardContent>
      </Card>

      {!party ? <EmptyState title={t(k("empty"))} hint={t("emptyHint")} />
        : s.isLoading ? <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
        : s.error || !d ? <EmptyState title={t("error")} hint={s.error?.message} />
        : (
          <div className="print-area grid gap-4">
            <header className="hidden print:block">
              <h2 className="text-lg font-semibold">{t(k("printTitle"))} — {d.party.name}</h2>
              <p className="text-xs">BIN {d.party.bin} · {fmtDate(d.from, "en")} – {fmtDate(d.to, "en")}</p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([["opening", d.opening], [k("debit"), d.totals.debit], [k("credit"), d.totals.credit], ["closing", d.closing]] as const).map(([label, v]) => (
                <Card key={label} size="sm"><CardContent className="grid gap-0.5"><span className="text-xs text-muted-foreground">{t(label)}</span><Money value={v} className="text-lg font-semibold" /></CardContent></Card>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {d.reconciled
                ? <Pill tone="success" icon={CheckCircle2}>{t("reconciled")}</Pill>
                : <Pill tone="danger" icon={AlertTriangle}>{t("notReconciled")}</Pill>}
              <span className="text-muted-foreground">{t("reconcileNote", { due: fmtNum(d.invoiceDue, locale, 2), adv: fmtNum(d.advances, locale, 2) })}</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>{t("ledger")}</CardTitle><CardDescription>{t("ledgerHint", { n: fmtNum(d.rows.length - 1, locale) })}</CardDescription></CardHeader>
                <CardContent className="px-0">
                  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("ledger")}>
                    <table className="w-full min-w-[640px] text-sm">
                      <caption className="sr-only">{t("ledger")}</caption>
                      <thead><tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-4 py-2 font-medium">{t("col.date")}</th>
                        <th scope="col" className="px-2 py-2 font-medium">{t("col.type")}</th>
                        <th scope="col" className="px-2 py-2 font-medium">{t("col.ref")}</th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">{t(k("debit"))}</th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">{t(k("credit"))}</th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">{t("col.balance")}</th>
                      </tr></thead>
                      <tbody>
                        {d.rows.map((r, i) => {
                          const h = href(r)
                          return (
                            <tr key={i} className={`border-b last:border-0 ${r.type === "opening" ? "bg-muted/30 font-medium" : ""}`}>
                              <td className="px-4 py-1.5 tabular whitespace-nowrap">{fmtDate(r.date, locale)}</td>
                              <td className="px-2 py-1.5">{t(`type.${r.type}`)}</td>
                              <td className="px-2 py-1.5">{r.ref ? (h ? <Link href={h} className="text-primary hover:underline tabular">{r.ref}</Link> : r.ref) : ""}{r.note && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={r.note}>{r.note}</span>}</td>
                              <td className="px-2 py-1.5 text-right">{r.debit ? <Money value={r.debit} /> : ""}</td>
                              <td className="px-2 py-1.5 text-right">{r.credit ? <Money value={r.credit} /> : ""}</td>
                              <td className="px-4 py-1.5 text-right font-medium"><Money value={r.balance} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot><tr className="border-t bg-muted/30 font-semibold">
                        <th scope="row" colSpan={3} className="px-4 py-2 text-left">{t("closing")}</th>
                        <td className="px-2 py-2 text-right"><Money value={d.totals.debit} /></td>
                        <td className="px-2 py-2 text-right"><Money value={d.totals.credit} /></td>
                        <td className="px-4 py-2 text-right"><Money value={d.closing} /></td>
                      </tr></tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
              <div className="grid content-start gap-4">
                <Card>
                  <CardHeader><CardTitle>{t("ageing")}</CardTitle><CardDescription>{t("ageingHint")}</CardDescription></CardHeader>
                  <CardContent>
                    <ul className="grid gap-2">
                      {ageing.map(([b, v]) => (
                        <li key={b} className="grid gap-1">
                          <div className="flex justify-between text-sm"><span>{t(`age.${b}`)}</span><Money value={v} /></div>
                          <div className="h-2 rounded-full bg-muted" aria-hidden><div className={`h-2 rounded-full ${b === "d90" ? "bg-destructive" : b === "d61_90" ? "bg-warning" : "bg-primary"}`} style={{ width: `${(v / ageMax) * 100}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t("open")}</CardTitle><CardDescription>{t("openHint", { n: fmtNum(d.openInvoices.length, locale) })}</CardDescription></CardHeader>
                  <CardContent>
                    {!d.openInvoices.length ? <p className="text-sm text-muted-foreground">{t("allSettled")}</p> : (
                      <ul className="grid gap-2 text-sm">
                        {d.openInvoices.slice(0, 8).map((o) => (
                          <li key={o.id} className="flex items-center gap-2">
                            <span className="grid flex-1"><Link href={kind === "customer" ? `/sales/${o.id}` : `/purchases/${o.id}`} className="font-medium text-primary hover:underline tabular">{o.no}</Link><span className="text-xs text-muted-foreground">{fmtDate(o.date, locale)} · {t("days", { n: fmtNum(o.days, locale) })}</span></span>
                            <Money value={o.due} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.openInvoices.length > 0 && can("doc.create") && (
                      <Button className="no-print mt-3 w-full" variant="outline" render={<Link href={`/accounting/${kind === "customer" ? "receipts" : "payments"}?new=1&party=${d.party.id}`} />}><HandCoins /> {t(k("record"))}</Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}
    </>
  )
}
