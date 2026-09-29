"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Pencil, Printer, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import { DefList, PeriodLockNote, useR4Actions } from "@/features/r4/r4-actions"
import { usePeriodLocked } from "@/features/r4/period-lock"
import { Mushak66 } from "./mushak-66"

/** VDS entry read view with the Mushak 6.6 certificate and history. */
export function VdsSheet({ id, onOpenChange, onEdit, initialTab }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; initialTab?: string }) {
  const t = useTranslations("vds")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "vds", id], queryFn: () => api.vat.vds.get(id!), enabled: !!id })
  const actions = useR4Actions("vds", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const locked = usePeriodLocked(d?.certificateDate)
  const print = () => { setTab("print"); setTimeout(() => window.print(), 200) }

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ProcessBadge value={d.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${t(`mode.${d.mode}`)} · ${d.partyName} · ${fmtDate(d.certificateDate, locale)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="no-print mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="print">{t("tabPrint")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <PeriodLockNote date={d.certificateDate} />
                <DocBanner doc={d} draftNote={t("draftNote")} />
                <DefList rows={[
                  [t("field.mode"), <Pill key="m" tone={d.mode === "purchase" ? "warning" : "info"}>{t(`mode.${d.mode}`)}</Pill>],
                  [t(`field.invoice.${d.mode}`), <Link key="i" href={d.mode === "sales" ? `/sales/${d.docId}` : `/purchases/${d.docId}`} className="text-primary hover:underline tabular">{d.docNo} · {d.challanNo}</Link>],
                  [t("col.party"), <span key="p">{d.partyName}<span className="block text-xs text-muted-foreground tabular">{d.partyBin}</span></span>],
                  [t("col.vat"), <span key="v"><Money value={d.docVat} /> <span className="text-xs text-muted-foreground">/ <Money value={d.docValue} /></span></span>],
                  [t("field.amount"), <Money key="a" value={d.amount} className="font-semibold" />],
                  [t("field.certificateNo"), d.certificateNo || "—"],
                  [t("field.certificateDate"), fmtDate(d.certificateDate, locale)],
                  [t("col.period"), <Link key="per" href={`/vat/return-9-1?period=${d.taxPeriod}`} className="text-primary hover:underline tabular">{periodLabel(d.taxPeriod)} · {t(`note.${d.mode}`)}</Link>],
                  ...(d.mode === "purchase" ? [[t("field.challan"), d.treasuryChallan ?? t("notDeposited")] as [string, React.ReactNode]] : []),
                  [t("settled"), <Money key="s" value={d.settled ?? 0} />],
                  [t("field.remark"), d.remark || "—"],
                ]} />
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="print" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak66 v={d} /></TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="no-print flex-row flex-wrap justify-end gap-2 border-t">
          {d && <Button variant="outline" onClick={print}><Printer /> {t("print")}</Button>}
          {d && draft && !locked && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && d.process !== "Cancelled" && !locked && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && !locked && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}
