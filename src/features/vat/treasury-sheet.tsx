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
import { HEAD_NOTE, HEAD_TONE, periodLabel } from "@/lib/r4"
import { DefList, PeriodLockNote, useR4Actions } from "@/features/r4/r4-actions"
import { Tr6Print } from "./tr6-print"

/** Treasury deposit read view with the TR-6 challan print and history. */
export function TreasurySheet({ id, onOpenChange, onEdit, initialTab }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; initialTab?: string }) {
  const t = useTranslations("treasury")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "treasury", id], queryFn: () => api.vat.treasury.get(id!), enabled: !!id })
  const actions = useR4Actions("treasury", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const print = () => { setTab("print"); setTimeout(() => window.print(), 200) }

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.challanNo} <ProcessBadge value={d.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${t(`head.${d.head}`)} · ${periodLabel(d.taxPeriod)} · ${fmtDate(d.challanDate, locale)}` : "\u00a0"}</SheetDescription>
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
                <PeriodLockNote date={`${d.taxPeriod}-01`} />
                <DocBanner doc={d} draftNote={t("draftNote")} />
                <DefList rows={[
                  [t("field.head"), <Pill key="h" tone={HEAD_TONE[d.head]}>{t(`head.${d.head}`)}</Pill>],
                  [t("col.code"), <span key="c" className="tabular">{d.code} · {t("note", { n: HEAD_NOTE[d.head] })}</span>],
                  [t("field.period"), <Link key="p" href={`/vat/return-9-1?period=${d.taxPeriod}`} className="text-primary hover:underline tabular">{periodLabel(d.taxPeriod)}</Link>],
                  [t("field.amount"), <Money key="a" value={d.amount} className="font-semibold" />],
                  [t("field.challanNo"), <span key="n" className="tabular">{d.challanNo} · {d.no}</span>],
                  [t("field.challanDate"), fmtDate(d.challanDate, locale)],
                  [t("field.mode"), t(`mode.${d.mode}`)],
                  [t("field.bank"), `${d.bank}, ${d.bankBranch} (${d.district})`],
                  [t("field.depositor"), `${d.depositor}${d.designation ? ` · ${d.designation}` : ""}`],
                  [t("field.description"), d.description],
                ]} />
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="print" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Tr6Print d={d} /></TabsContent>
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
