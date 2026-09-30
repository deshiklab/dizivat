"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowLeft, HandCoins, Link2, Printer, ShieldCheck, Ship, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RecordHistory } from "@/features/audit/record-history"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, Pill, ProcessBadge } from "@/components/common/status-badge"
import { Money, Num } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Link, useRouter } from "@/i18n/navigation"
import { useDocActions } from "@/features/docs/use-doc-actions"
import { DocActionButtons, DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { PeriodLockNote } from "@/features/r4/period-lock"
import { api } from "@/lib/api/client"
import { useCan, useCompany } from "@/components/auth/me-provider"
import { customsHouseName } from "@/lib/r2"
import { round2 } from "@/lib/vat"
import type { Line } from "@/lib/types"
import { fmtDate } from "@/lib/format"

export function PurchaseDetail({ id }: { id: string }) {
  const company = useCompany()
  const t = useTranslations("purchases")
  const tr4 = useTranslations("r4link")
  const ts = useTranslations("sales")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const td = useTranslations("debit")
  const ti = useTranslations("imports")
  const tp = useTranslations("process")
  const can = useCan()
  const { data: p, isLoading, error } = useQuery({ queryKey: ["purchase", id], queryFn: () => api.purchases.get(id) })
  const goods = !!p && p.category !== "service"
  const dns = useQuery({ queryKey: ["debitNotes", "purchase", id], queryFn: () => api.debitNotes.list({ purchase: id, size: 50 } as never), enabled: goods })
  const actions = useDocActions("purchase", { onDeleted: () => router.push("/purchases") })
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("overview"))
  const listHref = p?.category === "service" ? "/purchases/services" : "/purchases"
  if (isLoading) return <Skeleton className="h-96" />
  if (error || !p) return <EmptyState title={t("notFound")} action={<Button variant="outline" render={<Link href={listHref} />}><ArrowLeft /> {t("backToList")}</Button>} />
  return (
    <>
      <PageHeader
        crumbs={[...(goods ? [] : [{ label: t("servicesTitle"), href: listHref }]), { label: p.invoiceNo }]}
        title={<span className="flex flex-wrap items-center gap-2">{p.invoiceNo} <ProcessBadge value={p.process} /> <ModeBadge value={p.mode} />{p.boe && <Pill tone="info"><Ship className="size-3" aria-hidden /> {ti("badge")}</Pill>}{!goods && <Pill tone="neutral">{t("serviceBadge")}</Pill>}</span>}
        description={t("detailSub", { challan: p.challanNo, vendor: p.vendorName, date: fmtDate(p.issueDate, locale) })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success(tt("linkCopied")) }}><Link2 /> {tt("copyLink")}</Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> {tc("print")}</Button>
            <PdfButton filename={`Purchase_${p.invoiceNo}`} prepare={() => setTab("overview")} />
            {goods && p.process === "Approved" && can("doc.create") && <Button variant="outline" size="sm" render={<Link href={`/purchases/debit-notes?new=1&purchase=${p.id}`} />}><Undo2 /> {t("raiseDebit")}</Button>}
            <DocActionButtons doc={p} base="/purchases" actions={actions} />
          </>
        }
      />
      {actions.dialog}
      <PeriodLockNote date={p.issueDate} />
      <DocBanner doc={p} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
      <TabsList className="no-print mb-4">
        <TabsTrigger value="overview">{ts("tabOverview")}</TabsTrigger>
        <TabsTrigger value="history">{ts("tabHistory")}</TabsTrigger>
      </TabsList>
      <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={p.id} /></TabsContent>
      <TabsContent value="overview">
      <div className="print-area grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="hidden print:block">
          <h2 className="text-lg font-bold">{company.name} — {t("voucher")} {p.invoiceNo}</h2>
          <p>{p.vendorName} · {p.challanNo} · {fmtDate(p.issueDate, "en")}</p>
        </div>
        <div className="grid min-w-0 content-start gap-4">
        {p.boe && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Ship className="size-4" aria-hidden /> {ti("sectionBoe")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {[[ti("field.boeNo"), p.challanNo], [ti("field.boeDate"), fmtDate(p.challanDate, locale)], [ti("field.lcNo"), p.boe.lcNo], [ti("field.lcDate"), fmtDate(p.boe.lcDate, locale)],
                  [ti("field.customsHouse"), `${p.boe.customsHouse} — ${customsHouseName(p.boe.customsHouse)}`], [ti("field.origin"), p.boe.origin], [ti("field.cnfFirm"), p.boe.cnfFirm || "—"], [ti("field.receiveAddress"), p.boe.receiveAddress || "—"]].map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular">{v}</dd></div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
        {p.lines.some((l) => l.duty) ? <DutyTable lines={p.lines} /> : (
        <Card className="self-start">
          <CardHeader><CardTitle>{ts("lines")}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto px-0" tabIndex={0} role="region" aria-label={ts("lines")}>
            <table className="w-full text-sm">
              <caption className="sr-only">{ts("lines")}</caption>
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                {[ts("line.product"), ts("line.qty"), ts("line.price"), ts("line.subtotal"), ts("line.vat"), t("col.tti"), t("line.rebate"), ts("line.total")].map((h, i) => <th key={h} scope="col" className={`px-4 py-2 font-medium whitespace-nowrap ${i ? "text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{l.name}<span className="block text-xs text-muted-foreground">HS {l.hsCode}</span></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap"><Num value={l.qty} /> {l.uom}</td>
                    <td className="px-4 py-2 text-right"><Money value={l.price} /></td>
                    <td className="px-4 py-2 text-right"><Money value={l.subtotal} /></td>
                    <td className="px-4 py-2 text-right"><Money value={l.vat} /></td>
                    <td className="px-4 py-2 text-right"><Money value={l.tti ?? 0} /></td>
                    <td className="px-4 py-2 text-right">{l.rebateable ? <Pill tone="success">{tc("yes")}</Pill> : <Pill>{tc("no")}</Pill>}</td>
                    <td className="px-4 py-2 text-right font-medium"><Money value={l.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        )}
        {goods && (dns.data?.data.length ?? 0) > 0 && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Undo2 className="size-4" aria-hidden /> {td("title")}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto px-0">
              <table className="w-full text-sm">
                <caption className="sr-only">{td("title")}</caption>
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  {[td("col.no"), td("col.date"), td("col.reason"), td("col.value"), td("col.vat"), td("col.rebate"), td("col.status")].map((h, i) => <th key={h} scope="col" className={`px-4 py-2 font-medium ${i >= 3 && i < 6 ? "text-right" : ""}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {dns.data!.data.map((n) => (
                    <tr key={n.id} className="border-b last:border-0">
                      <td className="px-4 py-2"><Link href={`/purchases/debit-notes?view=${n.id}`} className="font-medium text-primary hover:underline">{n.no}</Link></td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(n.issueDate, locale)}</td>
                      <td className="px-4 py-2">{td(`reason.${n.reason}`)}</td>
                      <td className="px-4 py-2 text-right"><Money value={n.subtotal} /></td>
                      <td className="px-4 py-2 text-right"><Money value={n.vat} /></td>
                      <td className="px-4 py-2 text-right text-destructive"><Money value={-n.rebate} /></td>
                      <td className="px-4 py-2"><ProcessBadge value={n.process} /> <span className="sr-only">{tp(n.process)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        </div>
        <Card className="content-start">
          <CardHeader><CardTitle>{ts("summaryTitle")}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{p.boe ? ti("sum.av") : t("col.subtotal")}</dt><dd className="text-right"><Money value={p.subtotal} /></dd>
              <dt className="text-muted-foreground">{t("col.vat")}</dt><dd className="text-right"><Money value={p.vat} /></dd>
              {p.lines.some((l) => l.duty) && (["cd", "rd", "sd", "ait", "at"] as const).map((k) => (
                <div key={k} className="contents"><dt className="pl-3 text-xs text-muted-foreground">{k.toUpperCase()}</dt><dd className="text-right text-xs"><Money value={round2(p.lines.reduce((a, l) => a + (k === "sd" ? l.sd : (l.duty?.[k] ?? 0)), 0))} /></dd></div>
              ))}
              <dt className="text-muted-foreground">{t("col.tti")}</dt><dd className="text-right"><Money value={p.tti} /></dd>
              <dt className="border-t pt-2 font-semibold">{t("col.total")}</dt><dd className="border-t pt-2 text-right font-semibold"><Money value={p.netTotal} /></dd>
              <dt className="text-muted-foreground">{t("col.paid")}</dt><dd className="text-right"><Money value={p.paid} /></dd>
              <dt className="text-muted-foreground">{t("col.due")}</dt><dd className="text-right"><Money value={p.due} /></dd>
              <dt className="font-medium text-success">{t("col.rebate")}</dt><dd className="text-right font-medium text-success"><Money value={p.rebate} /></dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{p.boe ? ti("rebateHint") : t("rebateHint")}</p>
            {p.process === "Approved" && can("doc.create") && (p.due > 0 || p.lines.some((l) => l.vds)) && (
              <div className="no-print mt-4 grid gap-2">
                {p.due > 0 && <Button variant="outline" size="sm" render={<Link href={`/accounting/payments?new=1&party=${p.vendorId}&invoice=${p.id}`} />}><HandCoins /> {tr4("recordPayment")}</Button>}
                {p.lines.some((l) => l.vds) && <Button variant="outline" size="sm" render={<Link href={`/vat/vds?new=1&vdsMode=purchase&doc=${p.id}`} />}><ShieldCheck /> {tr4("issueVds")}</Button>}
              </div>
            )}
            <dl className="mt-4 grid gap-2 border-t pt-4 text-sm">
              {[[t("field.vendor"), p.vendorName], [t("field.bin"), p.vendorBin], ...(p.boe ? [] : [[t("field.challanDate"), fmtDate(p.challanDate, locale)]]), [ts("field.branch"), p.branchName], [ts("field.issuedBy"), `${p.issuedBy} · ${p.designation}`]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <div className="no-print lg:col-start-2"><HistoryCard history={p.history} /></div>
      </div>
      </TabsContent>
      </Tabs>
    </>
  )
}

/** Bill-of-Entry duty stack per line (legacy import grid): AV → CD, RD, SD, VAT, AIT, AT → TTI, rebate, total. */
function DutyTable({ lines }: { lines: Line[] }) {
  const t = useTranslations("imports")
  const ts = useTranslations("sales")
  const heads = [ts("line.product"), ts("line.qty"), "USD", t("col.usdRate"), "AV", "CD", "RD", "SD", "VAT", "AIT", "AT", "TTI", t("col.rebate"), t("col.total")]
  return (
    <Card className="self-start">
      <CardHeader><CardTitle>{t("sectionDuty")}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto px-0" tabIndex={0} role="region" aria-label={t("sectionDuty")}>
        <table className="w-full min-w-[1100px] text-sm">
          <caption className="sr-only">{t("sectionDuty")}</caption>
          <thead><tr className="border-b text-left text-xs text-muted-foreground">{heads.map((h, i) => <th key={h} scope="col" className={`px-2 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4 ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const d = l.duty
              const rebate = l.rebateable ? round2(l.vat + (d?.at ?? 0)) : 0
              const pct = (n?: number) => <span className="block text-[0.6875rem] text-muted-foreground">{n ?? 0}%</span>
              return (
                <tr key={i} className="border-b align-top last:border-0">
                  <td className="min-w-40 py-2 pr-2 pl-4">{l.name}<span className="block text-xs text-muted-foreground">HS {l.hsCode}</span></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap"><Num value={l.qty} /> {l.uom}</td>
                  <td className="px-2 py-2 text-right"><Money value={d?.usd ?? 0} /></td>
                  <td className="px-2 py-2 text-right tabular">{d?.usdRate ?? "—"}</td>
                  <td className="px-2 py-2 text-right"><Money value={d?.av ?? l.subtotal} /></td>
                  <td className="px-2 py-2 text-right"><Money value={d?.cd ?? 0} />{pct(d?.cdRate)}</td>
                  <td className="px-2 py-2 text-right"><Money value={d?.rd ?? 0} />{pct(d?.rdRate)}</td>
                  <td className="px-2 py-2 text-right"><Money value={l.sd} />{pct(l.sdRate)}</td>
                  <td className="px-2 py-2 text-right"><Money value={l.vat} />{pct(l.vatRate)}</td>
                  <td className="px-2 py-2 text-right"><Money value={d?.ait ?? 0} />{pct(d?.aitRate)}</td>
                  <td className="px-2 py-2 text-right"><Money value={d?.at ?? 0} />{pct(d?.atRate)}</td>
                  <td className="px-2 py-2 text-right font-medium"><Money value={l.tti ?? 0} /></td>
                  <td className="px-2 py-2 text-right text-success"><Money value={rebate} /></td>
                  <td className="py-2 pr-4 pl-2 text-right font-medium"><Money value={l.total} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
