"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Factory, Pencil, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Num } from "@/components/common/money"
import { ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { useR3Actions } from "@/features/r3/use-r3-actions"
import { DetailList, MiniTable, ModePill, Progress, WoStatusPill, woProgress } from "./parts"

/** Read view of a work order: ordered vs issued / received / damaged per item, and the batches that reference it. */
export function WorkOrderSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("workOrder")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState("details")
  React.useEffect(() => { setTab("details") }, [id])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["workOrder", id], queryFn: () => api.production.workOrders.get(id!), enabled: !!id })
  const actions = useR3Actions("workOrder", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const live = (d?.batches ?? []).some((b) => b.process !== "Cancelled")
  const canBatch = !!d && d.process === "Approved" && d.lines.some((l) => l.remaining > 0) && can("doc.create")

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <WoStatusPill status={d.status} /> <ProcessBadge value={d.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${fmtDate(d.issueDate, locale)}${d.requisitionNo ? ` · ${t("col.requisition")} ${d.requisitionNo}` : ""}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t("draftNote")} />
                <DetailList rows={[
                  [t("field.issueDate"), fmtDate(d.issueDate, locale)],
                  [t("field.dueDate"), d.dueDate ? fmtDate(d.dueDate, locale) : "—"],
                  [t("field.requisitionNo"), d.requisitionNo || "—"],
                  [t("field.issuedBy"), d.issuedBy],
                  [t("col.progress"), <Progress key="p" value={woProgress(d)} label={t("progressOf", { no: d.no })} />],
                  [t("field.remark"), d.remark || "—"],
                ]} />
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("field.lines")}</h3>
                  <MiniTable caption={t("field.lines")} minWidth={640} head={[
                    { label: t("col.item") }, { label: t("col.ordered"), right: true }, { label: t("col.issued"), right: true }, { label: t("col.received"), right: true },
                    { label: t("col.damaged"), right: true }, { label: t("col.remaining"), right: true },
                  ]}>
                    {d.lines.map((l) => (
                      <tr key={l.itemId} className="border-b last:border-0">
                        <td className="px-3 py-2"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground tabular">{l.sku}</span></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={l.qty} digits={2} /> {l.uom}</td>
                        <td className="px-3 py-2 text-right"><Num value={l.issued ?? 0} digits={2} /></td>
                        <td className="px-3 py-2 text-right"><Num value={l.received} digits={2} /></td>
                        <td className="px-3 py-2 text-right"><Num value={l.damaged} digits={2} /></td>
                        <td className={`px-3 py-2 text-right font-medium ${l.remaining > 0 ? "" : "text-success"}`}><Num value={l.remaining} digits={2} /></td>
                      </tr>
                    ))}
                  </MiniTable>
                </section>
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("batchesTitle")}</h3>
                  {d.batches.length ? (
                    <ul className="grid gap-2 text-sm">
                      {d.batches.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2">
                          <Link href={`/production/batches?view=${b.id}`} className="font-medium text-primary tabular hover:underline">{b.no}</Link>
                          <ModePill mode={b.mode} />
                          <span className="text-xs text-muted-foreground">{fmtDate(b.issueDate, locale)}</span>
                          <span className="ml-auto text-xs tabular">{t("batchQty", { issued: fmtNum(b.totalIssue, locale, 2), received: fmtNum(b.totalReceive, locale, 2) })}</span>
                          <ProcessBadge value={b.process} />
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted-foreground">{t("noBatches")}</p>}
                  {canBatch && <Button variant="outline" size="sm" className="justify-self-start" render={<Link href={`/production/batches?new=1&workOrder=${d.id}`} />}><Factory /> {t("newBatch")}</Button>}
                </section>
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {d && draft && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && d.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy || live} title={live ? t("cancelBlocked") : undefined} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}
