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

/** Read view of a transfer with its history; drafts can be edited / deleted, approved ones cancelled with a reason. */
export function TransferSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("transfers")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "ownTransfer", id], queryFn: () => api.accounting.transfers.get(id!), enabled: !!id })
  const actions = useR4Actions("ownTransfer", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no}</> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? fmtDate(d.date, locale) : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
          : error || !d ? <div className="p-4"><EmptyState title={t("notFound")} hint={error?.message} /></div>
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <DocBanner doc={d} draftNote={t("draftNote")} />
              <DefList rows={[
                [t("field.date"), fmtDate(d.date, locale)],
                [t("field.from"), <span key="f">{d.fromAccount}</span>],
                [t("field.to"), <span key="to">{d.toAccount}</span>],
                [t("field.amount"), <Money key="a" value={d.amount} className="font-semibold" />],
                [t("field.charge"), <Money key="c" value={d.charge} />],
                [t("field.reference"), d.reference || "—"],
                [t("field.note"), d.note || "—"],
                [t("field.issuedBy"), d.issuedBy || "—"],
              ]} />
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
