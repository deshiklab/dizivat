"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowLeft, Link2, Printer } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { fmtDate } from "@/lib/format"

export function PurchaseDetail({ id }: { id: string }) {
  const company = useCompany()
  const t = useTranslations("purchases")
  const ts = useTranslations("sales")
  const tc = useTranslations("common")
  const tt = useTranslations("table")
  const locale = useLocale()
  const router = useRouter()
  const { data: p, isLoading, error } = useQuery({ queryKey: ["purchase", id], queryFn: () => api.purchases.get(id) })
  const actions = useDocActions("purchase", { onDeleted: () => router.push("/purchases") })
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("overview"))
  if (isLoading) return <Skeleton className="h-96" />
  if (error || !p) return <EmptyState title={t("notFound")} action={<Button variant="outline" render={<Link href="/purchases" />}><ArrowLeft /> {t("backToList")}</Button>} />
  return (
    <>
      <PageHeader
        crumbs={[{ label: p.invoiceNo }]}
        title={<span className="flex flex-wrap items-center gap-2">{p.invoiceNo} <ProcessBadge value={p.process} /> <ModeBadge value={p.mode} /></span>}
        description={t("detailSub", { challan: p.challanNo, vendor: p.vendorName, date: fmtDate(p.issueDate, locale) })}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success(tt("linkCopied")) }}><Link2 /> {tt("copyLink")}</Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> {tc("print")}</Button>
            <DocActionButtons doc={p} base="/purchases" actions={actions} />
          </>
        }
      />
      {actions.dialog}
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
        <Card className="content-start">
          <CardHeader><CardTitle>{ts("summaryTitle")}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("col.subtotal")}</dt><dd className="text-right"><Money value={p.subtotal} /></dd>
              <dt className="text-muted-foreground">{t("col.vat")}</dt><dd className="text-right"><Money value={p.vat} /></dd>
              <dt className="text-muted-foreground">{t("col.tti")}</dt><dd className="text-right"><Money value={p.tti} /></dd>
              <dt className="border-t pt-2 font-semibold">{t("col.total")}</dt><dd className="border-t pt-2 text-right font-semibold"><Money value={p.netTotal} /></dd>
              <dt className="text-muted-foreground">{t("col.paid")}</dt><dd className="text-right"><Money value={p.paid} /></dd>
              <dt className="text-muted-foreground">{t("col.due")}</dt><dd className="text-right"><Money value={p.due} /></dd>
              <dt className="font-medium text-success">{t("col.rebate")}</dt><dd className="text-right font-medium text-success"><Money value={p.rebate} /></dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t("rebateHint")}</p>
            <dl className="mt-4 grid gap-2 border-t pt-4 text-sm">
              {[[t("field.vendor"), p.vendorName], [t("field.bin"), p.vendorBin], [t("field.challanDate"), fmtDate(p.challanDate, locale)], [ts("field.branch"), p.branchName], [ts("field.issuedBy"), `${p.issuedBy} · ${p.designation}`]].map(([k, v]) => (
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
