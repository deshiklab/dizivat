"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Pencil, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { DefList, useR4Actions } from "@/features/r4/r4-actions"

/** Read view of a manual journal entry with its lines and history; drafts edit / delete, approved ones cancel with a reason. */
export function JournalSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("journal")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "journal", id], queryFn: () => api.accounting.journal.get(id!), enabled: !!id })
  const chart = useQuery({ queryKey: ["chart"], queryFn: () => api.accounting.chart.list(), enabled: !!id })
  const actions = useR4Actions("journal", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const name = (code: string) => chart.data?.find((a) => a.code === code)?.name ?? code

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? d.no : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? fmtDate(d.date, locale) : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
          : error || !d ? <div className="p-4"><EmptyState title={t("notFound")} hint={error?.message} /></div>
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <DocBanner doc={d} draftNote={t("draftNote")} />
              <DefList rows={[
                [t("field.date"), fmtDate(d.date, locale)],
                [t("field.memo"), d.memo],
                [t("field.issuedBy"), d.issuedBy || "—"],
                ...(d.cancelReason ? [[t("field.cancelReason"), d.cancelReason] as [string, React.ReactNode]] : []),
              ]} />
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("field.lines")}</caption>
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th scope="col" className="p-2 font-medium">{t("field.account")}</th>
                      <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.debit")}</th>
                      <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2"><span className="font-medium tabular">{l.account}</span> <span className="text-muted-foreground">{name(l.account)}</span></td>
                        <td className="p-2 text-right tabular">{l.debit ? <Money value={l.debit} /> : "—"}</td>
                        <td className="p-2 text-right tabular">{l.credit ? <Money value={l.credit} /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/50 font-medium">
                      <td className="p-2" />
                      <td className="p-2 text-right tabular"><Money value={d.lines.reduce((s, l) => s + l.debit, 0)} /></td>
                      <td className="p-2 text-right tabular"><Money value={d.lines.reduce((s, l) => s + l.credit, 0)} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
