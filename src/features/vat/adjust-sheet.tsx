"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Pencil, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { ADJUSTMENT_TONE, periodLabel } from "@/lib/r4"
import { DefList, PeriodLockNote, useR4Actions } from "@/features/r4/r4-actions"

/** VAT adjustment read view. */
export function AdjustSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("adjust")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "adjustment", id], queryFn: () => api.vat.adjustments.get(id!), enabled: !!id })
  const actions = useR4Actions("adjustment", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ProcessBadge value={d.process} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${t(`kind.${d.kind}`)} · ${periodLabel(d.taxPeriod)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <PeriodLockNote date={`${d.taxPeriod}-01`} />
              <DocBanner doc={d} draftNote={t("draftNote")} />
              <DefList rows={[
                [t("field.kind"), <Pill key="k" tone={ADJUSTMENT_TONE[d.kind]}>{t(`kind.${d.kind}`)}</Pill>],
                [t("col.note"), <Link key="n" href={`/vat/return-9-1?period=${d.taxPeriod}&note=${d.note}`} className="text-primary hover:underline tabular">{t("noteLink", { n: d.note, period: periodLabel(d.taxPeriod) })}</Link>],
                [t("field.date"), fmtDate(d.issueDate, locale)],
                [t("field.amount"), <Money key="a" value={d.amount} className="font-semibold" />],
                [t("field.reference"), d.reference || "—"],
                [t("field.issuedBy"), d.issuedBy || "—"],
              ]} />
              <div className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">{t("field.description")}</span><p className="whitespace-pre-wrap">{d.description}</p></div>
              <HistoryCard history={d.history} />
            </div>
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
