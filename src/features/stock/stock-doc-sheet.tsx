"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CheckCheck, FileText, Pencil, Trash2, XCircle } from "lucide-react"
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
import { fmtDate } from "@/lib/format"
import type { StockDoc, StockDocKind } from "@/lib/types"
import { stockClient, useStockActions } from "./use-stock-actions"

export const REASON_TONE = { damaged: "danger", expired: "warning", wastage: "neutral", lost: "danger" } as const

/** Read view of one transfer / damage entry with its actions and a History tab (S4-06). Linkable via ?view=<id>. */
export function StockDocSheet({ kind, id, onOpenChange, onEdit }: {
  kind: StockDocKind; id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void
}) {
  const t = useTranslations("stock")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState("details")
  React.useEffect(() => { setTab("details") }, [id])
  const { data: d, isLoading, error } = useQuery({ queryKey: [kind, id], queryFn: () => stockClient(kind).get(id!), enabled: !!id })
  const actions = useStockActions(kind, { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ProcessBadge value={d.process} /></> : t(`${kind}.titleOne`)}</SheetTitle>
          <SheetDescription>
            {d ? (d.kind === "transfer" ? `${d.fromBranch} → ${d.toBranch} · ${fmtDate(d.date, locale)}` : `${d.branch} · ${t(`reason.${d.reason}`)} · ${fmtDate(d.date, locale)}`) : "\u00a0"}
          </SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t(`${kind}.notFound`)} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t(`${kind}.draftNote`)} />
                <Header d={d} />
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("field.lines")}</h3>
                  <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("field.lines")}>
                    <table className="w-full text-sm">
                      <caption className="sr-only">{t("field.lines")}</caption>
                      <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">{t("field.item")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("field.qty")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("field.cost")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("field.value")}</th>
                      </tr></thead>
                      <tbody>
                        {d.lines.map((l) => (
                          <tr key={l.itemId} className="border-b last:border-0">
                            <td className="px-3 py-2"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground tabular">{l.sku}</span></td>
                            <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={l.qty} digits={2} /> {l.uom}</td>
                            <td className="px-3 py-2 text-right"><Money value={l.cost} /></td>
                            <td className="px-3 py-2 text-right font-medium"><Money value={l.value} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="border-t bg-muted/30 font-semibold">
                        <th scope="row" colSpan={3} className="px-3 py-2 text-left">{t("field.total")}</th>
                        <td className="px-3 py-2 text-right"><Money value={d.totalValue} /></td>
                      </tr></tfoot>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("costNote")}</p>
                </section>
                {d.kind === "transfer" && (
                  <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-xs">
                    <FileText className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("transfer.mushakNote")}
                  </p>
                )}
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
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

function Header({ d }: { d: StockDoc }) {
  const t = useTranslations("stock")
  const locale = useLocale()
  const rows: [string, React.ReactNode][] = d.kind === "transfer"
    ? [
      [t("field.route"), <span key="r" className="inline-flex flex-wrap items-center gap-1.5">{d.fromBranch} <ArrowRight className="size-3.5 text-muted-foreground" aria-label={t("to")} /> {d.toBranch}</span>],
      [t("field.date"), fmtDate(d.date, locale)],
      [t("field.vehicle"), d.vehicle || "—"],
    ]
    : [
      [t("field.branch"), d.branch],
      [t("field.reason"), <Pill key="r" tone={REASON_TONE[d.reason]}>{t(`reason.${d.reason}`)}</Pill>],
      [t("field.date"), fmtDate(d.date, locale)],
    ]
  rows.push([t("field.note"), d.note || "—"], [t("field.issuedBy"), d.issuedBy])
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}
    </dl>
  )
}
