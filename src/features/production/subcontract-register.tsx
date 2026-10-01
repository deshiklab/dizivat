"use client"

import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { Clock, Download, Factory, PackageCheck, Printer, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/page-header"
import { PdfButton } from "@/components/common/pdf-button"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Pill, type Tone } from "@/components/common/status-badge"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { registerFrom } from "@/lib/rmg"
import type { SubconRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS = ["all", "atContractor", "partial", "overdue", "returned", "draft", "cancelled"] as const
const TONE: Record<SubconRow["status"], Tone> = { atContractor: "info", partial: "info", overdue: "danger", returned: "success", draft: "neutral", cancelled: "neutral" }

/**
 * R6.2 (RMG) — Subcontracting register. Garment and accessory makers send inputs out for printing, embroidery, washing
 * or full manufacture under Mushak 6.4; this lists every contractual batch, what is still at the contractor and for how
 * long (overdue after the chosen number of days), so the inputs can be accounted for in the stock and VAT books.
 */
export function SubcontractRegisterPage() {
  const t = useTranslations("subcon")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(registerFrom(TODAY)))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(TODAY))
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("all"))
  const [days, setDays] = useQueryState("days", parseAsString.withDefault("30"))
  const valid = !!from && !!to && to >= from
  const p = { from, to, status: status === "all" ? undefined : status, days: Number(days) || 30 }
  const q = useQuery({ queryKey: ["production", "subcontract", p], queryFn: () => api.production.subcontract(p), enabled: valid, placeholderData: keepPreviousData })
  const d = q.data

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={d ? <>
          <Button variant="outline" render={<a href={api.production.subcontractCsvUrl(p)} download={`subcontract-register-${from}-${to}.csv`} />}><Download /> {tt("exportCsv")}</Button>
          <PdfButton size="default" landscape filename={`Subcontract-register_${from}_${to}`} />
          <Button onClick={() => window.print()}><Printer /> {tc("print")}</Button>
        </> : undefined} />
      <section aria-label={t("filters")} className="no-print mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5"><Label htmlFor="sc-from">{t("from")}</Label><Input id="sc-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || null)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="sc-to">{t("to")}</Label>
          <Input id="sc-to" type="date" value={to} min={from} max={TODAY} aria-invalid={!valid || undefined} aria-describedby={!valid ? "sc-to-err" : undefined} onChange={(e) => setTo(e.target.value || null)} />
          {!valid && <p id="sc-to-err" className="text-xs text-destructive">{t("toBeforeFrom")}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sc-status">{t("status")}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v === "all" ? null : (v as string))} items={STATUS.map((s) => ({ value: s, label: t(`st.${s}`) }))}>
            <SelectTrigger id="sc-status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS.map((s) => <SelectItem key={s} value={s}>{t(`st.${s}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="sc-days">{t("days")}</Label><Input id="sc-days" type="number" min={1} max={365} inputMode="numeric" className="tabular" value={days} onChange={(e) => setDays(e.target.value || null)} /></div>
      </section>
      {!valid ? null : q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("error")} hint={q.error.message} /> : d && (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Truck className="size-4" aria-hidden /> {t("totals.atContractor")}</CardTitle></CardHeader><CardContent><span className="text-2xl font-semibold tabular">{fmtNum(d.totals.atContractor, locale)}</span></CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Factory className="size-4" aria-hidden /> {t("totals.pendingValue")}</CardTitle></CardHeader><CardContent><Money value={d.totals.pendingValue} className="text-lg font-semibold" /></CardContent></Card>
            <Card size="sm" className={d.totals.overdue ? "border-destructive/50" : undefined}><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Clock className="size-4 text-destructive" aria-hidden /> {t("totals.overdue", { n: d.overdueDays })}</CardTitle></CardHeader><CardContent><span className="text-2xl font-semibold tabular">{fmtNum(d.totals.overdue, locale)}</span></CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><PackageCheck className="size-4" aria-hidden /> {t("totals.returned")}</CardTitle></CardHeader><CardContent><span className="text-2xl font-semibold tabular">{fmtNum(d.totals.returned, locale)}</span></CardContent></Card>
          </div>
          <article className="print-area rounded-lg border bg-card" aria-label={t("title")}>
            <h2 className="hidden p-4 text-base font-semibold print:block">{t("title")} · {fmtDate(d.from, locale)} – {fmtDate(d.to, locale)}</h2>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("table")}>
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">{t("table")}</caption>
                <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.batch")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.contractor")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("process")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.sent")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.returned")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.pending")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.material")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.days")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("status")}</th>
                </tr></thead>
                <tbody>
                  {d.rows.length ? d.rows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="px-3 py-2"><Link href={`/production/batches?view=${r.id}`} className="font-medium text-primary tabular hover:underline print:text-foreground">{r.no}</Link><span className="block text-xs text-muted-foreground">{fmtDate(r.issueDate, locale)}{r.receiveDate ? ` → ${fmtDate(r.receiveDate, locale)}` : ""}</span></td>
                      <td className="px-3 py-2">{r.vendorName || "—"}<span className="block text-xs text-muted-foreground tabular">{r.vendorBin ? `BIN ${r.vendorBin}` : ""}</span></td>
                      <td className="px-3 py-2">{t(`proc.${r.process}`)}</td>
                      <td className="px-3 py-2 text-right tabular">{fmtNum(r.issued, locale)}</td>
                      <td className="px-3 py-2 text-right tabular">{r.received ? fmtNum(r.received, locale) : "—"}{r.damaged ? <span className="block text-xs text-muted-foreground">{t("wastage", { n: fmtNum(r.damaged, locale) })}</span> : null}</td>
                      <td className={cn("px-3 py-2 text-right tabular", r.pending > 0 && "font-medium")}>{r.pending ? fmtNum(r.pending, locale) : "—"}</td>
                      <td className="px-3 py-2 text-right"><Money value={r.materialValue} /></td>
                      <td className={cn("px-3 py-2 text-right tabular", r.status === "overdue" && "font-medium text-destructive")}>{fmtNum(r.days, locale)}</td>
                      <td className="px-3 py-2"><Pill tone={TONE[r.status]}>{t(`st.${r.status}`)}</Pill></td>
                    </tr>
                  )) : <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">{t("empty")}</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
          <p className="text-xs text-muted-foreground">{t("note")}</p>
        </div>
      )}
    </>
  )
}
