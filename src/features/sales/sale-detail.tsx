"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowLeft, Download, Link2, Mail, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { ModeBadge, Pill, ProcessBadge } from "@/components/common/status-badge"
import { Money, Num } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { Mushak63 } from "./mushak-63"
import { RecordHistory } from "@/features/audit/record-history"
import { useDocActions } from "@/features/docs/use-doc-actions"
import { DocActionButtons, DocBanner, HistoryCard } from "@/features/docs/doc-parts"

export function SaleDetail({ id }: { id: string }) {
  const t = useTranslations("sales")
  const tc = useTranslations("common")
  const tpm = useTranslations("method")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("overview"))
  const [printFlag, setPrintFlag] = useQueryState("print")
  const { data: s, isLoading, error } = useQuery({ queryKey: ["sale", id], queryFn: () => api.sales.get(id) })

  const actions = useDocActions("sale", { onDeleted: () => router.push("/sales") })

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
  const mail = `mailto:?subject=${encodeURIComponent(`Mushak 6.3 – ${s.invoiceNo} – RUPSHA FLEXIPACK LTD`)}&body=${encodeURIComponent(`${s.customerName}\n${t("col.netTotal")}: BDT ${s.netTotal}\n${url}`)}`

  return (
    <>
      <PageHeader
        crumbs={[{ label: s.invoiceNo }]}
        title={<span className="flex flex-wrap items-center gap-2">{s.invoiceNo} <ProcessBadge value={s.process} /> <ModeBadge value={s.mode} /></span>}
        description={t("detailSub", { challan: s.challanNo, customer: s.customerName, date: fmtDate(s.issueDate, locale) })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={share}><Link2 /> {tt("copyLink")}</Button>
            <Button variant="outline" size="sm" render={<a href={mail} />}><Mail /> {t("email")}</Button>
            <Button variant="outline" size="sm" onClick={() => toast.info(t("pdfLater"))}><Download /> PDF</Button>
            <Button variant="outline" size="sm" onClick={print}><Printer /> {t("printMushak")}</Button>
            <DocActionButtons doc={s} base="/sales" actions={actions} />
          </>
        }
      />
      {actions.dialog}
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
                        <td className="px-4 py-2">{l.name}</td>
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
