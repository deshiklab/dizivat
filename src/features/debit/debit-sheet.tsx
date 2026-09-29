"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Pencil, Printer, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money, Num } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import type { DebitNote } from "@/lib/types"
import { useR2Actions } from "@/features/r2/use-r2-actions"
import { Mushak68 } from "@/features/r2/mushak-68"

export const DEBIT_REASON_TONE = { damaged: "danger", quality: "warning", excess: "info", wrongItem: "neutral", priceDispute: "neutral" } as const

/** Read view of a debit note with its Mushak 6.8 print and history. Linkable via ?view=<id> (&tab=mushak). */
export function DebitSheet({ id, onOpenChange, onEdit, initialTab }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; initialTab?: string }) {
  const t = useTranslations("debit")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["debit", id], queryFn: () => api.debitNotes.get(id!), enabled: !!id })
  const actions = useR2Actions("debit", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const print = () => { setTab("mushak"); setTimeout(() => window.print(), 200) }

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ProcessBadge value={d.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${d.vendorName} · ${fmtDate(d.issueDate, locale)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="no-print mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="mushak">{t("tabMushak")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t("draftNote")} />
                <Details d={d} />
                <Lines d={d} />
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="mushak" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak68 note={d} /></TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="no-print flex-row flex-wrap justify-end gap-2 border-t">
          {d && <Button variant="outline" onClick={print}><Printer /> {t("print")}</Button>}
          {d && draft && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && d.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}

function Details({ d }: { d: DebitNote }) {
  const t = useTranslations("debit")
  const tm = useTranslations("mode")
  const locale = useLocale()
  const rows: [string, React.ReactNode][] = [
    [t("field.purchase"), <Link key="p" href={`/purchases/${d.purchaseId}`} className="font-medium text-primary hover:underline tabular">{d.purchaseNo}</Link>],
    [t("field.challan"), <span key="c" className="tabular">{d.challanNo} · {fmtDate(d.purchaseDate, locale)} · {tm(d.purchaseMode)}</span>],
    [t("field.vendor"), <span key="v">{d.vendorName}<span className="block text-xs text-muted-foreground tabular">{d.vendorBin}</span></span>],
    [t("field.branch"), d.branchName],
    [t("field.issued"), `${fmtDate(d.issueDate, locale)} · ${d.issueTime}`],
    [t("field.reason"), <Pill key="r" tone={DEBIT_REASON_TONE[d.reason]}>{t(`reason.${d.reason}`)}</Pill>],
    [t("field.note"), d.note || "—"],
    [t("field.issuedBy"), `${d.issuedBy} · ${d.designation}`],
  ]
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
}

function Lines({ d }: { d: DebitNote }) {
  const t = useTranslations("debit")
  const imp = d.tti > 0
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("field.lines")}</h3>
      <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("field.lines")}>
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">{t("field.lines")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.item")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.purchased")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.returned")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.value")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.vat")}</th>
            {imp && <th scope="col" className="px-3 py-2 text-right font-medium">TTI</th>}
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.total")}</th>
          </tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.itemId} className="border-b last:border-0">
                <td className="px-3 py-2"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground tabular">HS {l.hsCode}</span></td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground"><Num value={l.purchasedQty} digits={2} /> {l.uom}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap font-medium"><Num value={l.qty} digits={2} /> {l.uom}</td>
                <td className="px-3 py-2 text-right"><Money value={l.subtotal} /></td>
                <td className="px-3 py-2 text-right"><Money value={l.vat} /></td>
                {imp && <td className="px-3 py-2 text-right"><Money value={l.tti} /></td>}
                <td className="px-3 py-2 text-right font-medium"><Money value={l.total} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t bg-muted/30 font-semibold">
            <th scope="row" colSpan={3} className="px-3 py-2 text-left">{t("col.total")}</th>
            <td className="px-3 py-2 text-right"><Money value={d.subtotal} /></td>
            <td className="px-3 py-2 text-right"><Money value={d.vat} /></td>
            {imp && <td className="px-3 py-2 text-right"><Money value={d.tti} /></td>}
            <td className="px-3 py-2 text-right"><Money value={d.total} /></td>
          </tr></tfoot>
        </table>
      </div>
      <p className="rounded-md bg-warning-soft p-3 text-xs">{t("rebateNote")} <strong><Money value={d.rebate} /></strong></p>
    </section>
  )
}
