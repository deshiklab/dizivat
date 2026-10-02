"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowLeft, FileMinus2, HandCoins, Link2, Mail, Printer, ShieldCheck, Ship } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, Pill, ProcessBadge } from "@/components/common/status-badge"
import { Money, Num } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { customsHouseName } from "@/lib/r2"
import { exportCompliance, fcToBdt } from "@/lib/rmg"
import { ExportChecklist } from "@/features/vat/export-checklist"
import { useCan, useCompany } from "@/components/auth/me-provider"
import type { Sale } from "@/lib/types"
import { Mushak63 } from "./mushak-63"
import { RecordHistory } from "@/features/audit/record-history"
import { useDocActions } from "@/features/docs/use-doc-actions"
import { ProceedsCard } from "@/features/vat/proceeds"
import { DocActionButtons, DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { PeriodLockNote } from "@/features/r4/period-lock"

export function SaleDetail({ id }: { id: string }) {
  const t = useTranslations("sales")
  const can = useCan()
  const company = useCompany()
  const tr4 = useTranslations("r4link")
  const tc = useTranslations("common")
  const tpm = useTranslations("method")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("overview"))
  const [printFlag, setPrintFlag] = useQueryState("print")
  const { data: s, isLoading, error } = useQuery({ queryKey: ["sale", id], queryFn: () => api.sales.get(id) })

  const actions = useDocActions("sale", { onDeleted: () => router.push(s?.category === "service" ? "/sales/services" : "/sales") })

  const print = React.useCallback(() => { setTab("mushak"); setTimeout(() => window.print(), 150) }, [setTab])
  React.useEffect(() => {
    if (s && printFlag) { setPrintFlag(null); print() }
  }, [s, printFlag, setPrintFlag, print])

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-16 w-80" /><Skeleton className="h-96" /></div>
  if (error || !s) {
    return <EmptyState title={error instanceof ApiError && error.status === 404 ? t("notFound") : tt("error")} hint={error?.message} action={<Button variant="outline" render={<Link href="/sales" />}><ArrowLeft /> {t("backToList")}</Button>} />
  }
  const url = typeof window !== "undefined" ? window.location.href.split("?")[0] : ""
  const share = () => { navigator.clipboard?.writeText(url); toast.success(tt("linkCopied")) }
  const mail = `mailto:?subject=${encodeURIComponent(`Mushak 6.3 – ${s.invoiceNo} – ${company.name}`)}&body=${encodeURIComponent(`${s.customerName}\n${t("col.netTotal")}: BDT ${s.netTotal}\n${url}`)}`

  return (
    <>
      <PageHeader
        crumbs={[{ label: s.invoiceNo }]}
        title={<span className="flex flex-wrap items-center gap-2">{s.invoiceNo} <ProcessBadge value={s.process} /> <ModeBadge value={s.mode} />
          {s.category === "service" && <Pill tone="info">{t("services.badge")}</Pill>}
          {s.export && <Pill tone={s.export.deemed ? "info" : "success"}>{t(`trade.${s.export.deemed ? "deemed" : "export"}`)}</Pill>}</span>}
        description={t("detailSub", { challan: s.challanNo, customer: s.customerName, date: fmtDate(s.issueDate, locale) })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={share}><Link2 /> {tt("copyLink")}</Button>
            <Button variant="outline" size="sm" render={<a href={mail} />}><Mail /> {t("email")}</Button>
            <PdfButton filename={`Mushak-6.3_${s.invoiceNo}`} title={`Mushak 6.3 – ${s.invoiceNo}`} prepare={() => setTab("mushak")} />
            <Button variant="outline" size="sm" onClick={print}><Printer /> {t("printMushak")}</Button>
            <DocActionButtons doc={s} base="/sales" actions={actions} />
          </>
        }
      />
      {actions.dialog}
      <PeriodLockNote date={s.issueDate} />
      <DocBanner doc={s} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="no-print mb-4">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="mushak">{t("tabMushak")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={s.id} /></TabsContent>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card className="self-start">
              <CardHeader><CardTitle>{t("lines")}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto px-0" tabIndex={0} role="region" aria-label={t("lines")}>
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("lines")}</caption>
                  <thead><tr className="border-b text-left text-xs text-muted-foreground">
                    {["product", "hs", "qty", "price", "subtotal", "sd", "vat", "total"].map((c, i) => <th key={c} scope="col" className={`px-4 py-2 font-medium whitespace-nowrap ${i > 1 ? "text-right" : ""}`}>{t(`line.${c}`)}</th>)}
                  </tr></thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-2">{l.name}{l.batchNo && <span className="block text-xs text-muted-foreground">{t("lot.label")}: <Link href={`/production/batches?view=${l.batchId}`} className="tabular hover:underline">{l.batchNo}</Link></span>}</td>
                        <td className="px-4 py-2 tabular text-muted-foreground">{l.hsCode}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap"><Num value={l.qty} /> {l.uom}</td>
                        <td className="px-4 py-2 text-right"><Money value={l.price} /></td>
                        <td className="px-4 py-2 text-right"><Money value={l.subtotal} /></td>
                        <td className="px-4 py-2 text-right"><Money value={l.sd} /></td>
                        <td className="px-4 py-2 text-right whitespace-nowrap"><Money value={l.vat} /> <span className="text-xs text-muted-foreground">({l.vatRate}%)</span></td>
                        <td className="px-4 py-2 text-right font-medium"><Money value={l.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              <Card>
                <CardHeader><CardTitle>{t("summaryTitle")}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{t("col.subtotal")}</dt><dd className="text-right"><Money value={s.subtotal} /></dd>
                    <dt className="text-muted-foreground">{t("col.sd")}</dt><dd className="text-right"><Money value={s.sd} /></dd>
                    <dt className="text-muted-foreground">{t("col.vat")}</dt><dd className="text-right"><Money value={s.vat} /></dd>
                    <dt className="text-muted-foreground">{t("col.discount")}</dt><dd className="text-right"><Money value={-s.discount} /></dd>
                    <dt className="border-t pt-2 font-semibold">{t("col.netTotal")}</dt><dd className="border-t pt-2 text-right font-semibold"><Money value={s.netTotal} /></dd>
                    <dt className="text-muted-foreground">{t("col.received")}</dt><dd className="text-right"><Money value={s.paid} /></dd>
                    <dt className="font-medium">{t("col.due")}</dt><dd className="text-right font-medium">{s.due > 0 ? <Pill tone="warning"><Money value={s.due} /></Pill> : <Pill tone="success">{t("payment.paid")}</Pill>}</dd>
                  </dl>
                  {s.process === "Approved" && can("doc.create") && (s.due > 0 || s.vds) && (
                    <div className="no-print mt-4 grid gap-2">
                      {s.due > 0 && <Button variant="outline" size="sm" render={<Link href={`/accounting/receipts?new=1&party=${s.customerId}&invoice=${s.id}`} />}><HandCoins /> {tr4("recordReceipt")}</Button>}
                      {s.vds && <Button variant="outline" size="sm" render={<Link href={`/vat/vds?new=1&vdsMode=sales&doc=${s.id}`} />}><ShieldCheck /> {tr4("recordVds")}</Button>}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t("details")}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid gap-2 text-sm">
                    {[
                      [t("field.customer"), s.customerName], [t("field.bin"), s.customerBin], [t("field.branch"), s.branchName], [t("field.delivery"), s.deliveryAddress],
                      [t("field.vehicle"), s.vehicle || "—"], [t("field.issueTime"), `${fmtDate(s.issueDate, locale)} ${s.issueTime}`],
                      [t("field.method"), tpm(s.method)], [t("field.vds"), s.vds ? tc("yes") : tc("no")], [t("field.issuedBy"), `${s.issuedBy} · ${s.designation}`],
                    ].map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}
                  </dl>
                </CardContent>
              </Card>
              {s.export && <ExportCard s={s} />}
              {s.export && <ProceedsCard s={s} />}
              <CreditNotesCard s={s} />
              <HistoryCard history={s.history} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="mushak" className="rounded-lg bg-muted/60 p-2 sm:p-6 print:bg-transparent print:p-0">
          <Mushak63 sale={s} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ExportCard({ s }: { s: Sale }) {
  const t = useTranslations("sales")
  const locale = useLocale()
  const trm = useTranslations("rmg")
  const e = s.export!
  // R6 (RMG): the buyer's bond licence / exporter type feed the deemed-export conditions
  const buyer = useQuery({ queryKey: ["customers", "credit", s.customerId], queryFn: () => api.customers.get(s.customerId) })
  // R6.2: deemed exports are checked against the exporter's UD quantities when the UD is in the register
  const fit = useQuery({
    queryKey: ["uds", "fit", s.id, s.export?.udNo ?? ""], enabled: !!e.deemed && !!e.udNo && s.process !== "Cancelled",
    queryFn: () => api.vat.uds.fit({ saleId: s.id, customerId: s.customerId, issueDate: s.issueDate, udNo: e.udNo, lines: s.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) }),
  })
  const c = buyer.data || !e.deemed ? exportCompliance(s, buyer.data, fit.data) : undefined
  const bdt = fcToBdt(e)
  const rows: [string, string][] = [
    [t("export.lcNo"), `${e.lcNo} · ${fmtDate(e.lcDate, locale)}`],
    ...(e.deemed ? [
      [trm("udNo"), e.udNo ? `${e.udNo}${e.udDate ? ` · ${fmtDate(e.udDate, locale)}` : ""}` : "—"],
      [trm("exporterBond"), e.exporterBond || buyer.data?.bondLicenseNo || "—"],
    ] as [string, string][] : [[trm("expNo"), e.expNo || "—"]] as [string, string][]),
    ...(e.ownUdNo ? [[trm("ownUdNo"), e.ownUdNo]] as [string, string][] : []),
    [trm("fcValue"), e.fcValue ? `${e.currency ?? ""} ${fmtNum(e.fcValue, locale, 2)}${e.exchangeRate ? ` @ ${fmtNum(e.exchangeRate, locale, 2)}${bdt ? ` = Tk ${fmtNum(bdt, locale, 2)}` : ""}` : ""}` : "—"],
    ...(!e.deemed ? [
      [t("export.billNo"), `${e.billNo} · ${e.billDate ? fmtDate(e.billDate, locale) : "—"}`], [t("export.customsHouse"), customsHouseName(e.customsHouse)],
      [t("export.country"), e.country], [t("export.shippingAddress"), e.shippingAddress], [t("export.cnfFirm"), e.cnfFirm || "—"],
    ] as [string, string][] : []),
  ]
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Ship className="size-4" aria-hidden /> {e.deemed ? t("export.deemedTitle") : t("export.title")}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid gap-2 text-sm">{rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
        {c && s.process !== "Cancelled" && <ExportChecklist c={c} fit={fit.data} names={Object.fromEntries(s.lines.map((l) => [l.itemId, l.name]))} />}
      </CardContent>
    </Card>
  )
}

/** Credit notes (Mushak 6.7) issued against this invoice, with a shortcut to issue one. */
function CreditNotesCard({ s }: { s: Sale }) {
  const t = useTranslations("sales")
  const tcr = useTranslations("credit")
  const locale = useLocale()
  const can = useCan()
  const { data } = useQuery({ queryKey: ["creditNotes", { sale: s.id }], queryFn: () => api.creditNotes.list({ sale: s.id, size: 50 }) })
  const notes = data?.data ?? []
  if (!notes.length && (s.process !== "Approved" || !can("doc.create"))) return null
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileMinus2 className="size-4" aria-hidden /> {t("creditNotes")}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {notes.length ? (
          <ul className="grid gap-2 text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2">
                <Link href={`/sales/credit-notes?view=${n.id}`} className="font-medium text-primary tabular hover:underline">{n.no}</Link>
                <span className="text-xs text-muted-foreground">{fmtDate(n.issueDate, locale)}</span>
                <ProcessBadge value={n.process} />
                <Money value={n.total} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("noCreditNotes")}</p>}
        {s.process === "Approved" && can("doc.create") && <Button variant="outline" size="sm" render={<Link href={`/sales/credit-notes?new=1&sale=${s.id}`} />}><FileMinus2 /> {tcr("new")}</Button>}
      </CardContent>
    </Card>
  )
}
