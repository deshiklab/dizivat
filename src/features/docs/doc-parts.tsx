"use client"

import { useLocale, useTranslations } from "next-intl"
import { Ban, CheckCheck, CircleDot, FilePen, FilePlus2, Info, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { fmtDateTime } from "@/lib/format"
import type { HistoryAction, HistoryEntry, Purchase, Sale } from "@/lib/types"
import { cn } from "@/lib/utils"

type Doc = Sale | Purchase
// Audit timestamps are UTC instants — shown in Bangladesh time by the shared formatter
const time = (iso: string, locale: string) => fmtDateTime(iso, locale)

/** Top-of-page status strip: cancelled (with reason) or draft (not yet in the VAT return). */
export function DocBanner({ doc }: { doc: Doc }) {
  const t = useTranslations("docs")
  const locale = useLocale()
  if (doc.process === "Cancelled") {
    const h = [...(doc.history ?? [])].reverse().find((x) => x.action === "cancelled")
    return (
      <div role="status" className="no-print mb-4 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <Ban className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="grid gap-0.5">
          <p className="font-medium text-destructive">{h ? t("cancelledBy", { by: h.by, when: time(h.at, locale) }) : t("cancelledPlain")}</p>
          <p><span className="text-muted-foreground">{t("reason")}:</span> {doc.cancelReason ?? h?.note ?? "—"}</p>
        </div>
      </div>
    )
  }
  if (doc.process === "Created") {
    return (
      <div role="status" className="no-print mb-4 flex gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>{t("draftNote")}</p>
      </div>
    )
  }
  return null
}

const ICON: Record<HistoryAction, typeof CircleDot> = { created: FilePlus2, edited: FilePen, approved: CheckCheck, cancelled: XCircle, deleted: Trash2, restored: RotateCcw }
const TONE: Partial<Record<HistoryAction, string>> = { approved: "text-success bg-success/10", cancelled: "text-destructive bg-destructive/10", deleted: "text-destructive bg-destructive/10" }

/** Audit trail — who did what and when (Mushak records must be traceable for NBR audits). */
export function HistoryCard({ history }: { history?: HistoryEntry[] }) {
  const t = useTranslations("docs")
  const locale = useLocale()
  const items = [...(history ?? [])].reverse()
  return (
    <Card>
      <CardHeader><CardTitle>{t("history")}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : (
          <ol className="grid gap-3">
            {items.map((h, i) => {
              const Icon = ICON[h.action] ?? CircleDot
              return (
                <li key={i} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                  <span className={cn("grid size-7 place-items-center rounded-full bg-muted text-muted-foreground", TONE[h.action])}><Icon className="size-3.5" aria-hidden /></span>
                  <div className="min-w-0">
                    <p><span className="font-medium">{t(`action.${h.action}`)}</span> · {h.by}</p>
                    <p className="text-xs text-muted-foreground"><time dateTime={h.at}>{time(h.at, locale)}</time></p>
                    {h.note && <p className="mt-1 rounded bg-muted/60 px-2 py-1 text-xs break-words">{h.note}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** Header buttons whose visibility follows the user's permissions and the document state. */
export function DocActionButtons({ doc, base, actions }: {
  doc: Doc; base: "/sales" | "/purchases"
  actions: { approve: (d: Doc) => void; askCancel: (d: Doc) => void; askDelete: (d: Doc) => void; busy: boolean }
}) {
  const t = useTranslations("docs")
  const can = useCan()
  const draft = doc.process === "Created"
  return (
    <>
      {draft && can("doc.edit") && <Button variant="outline" size="sm" render={<Link href={`${base}/${doc.id}/edit`} />}><Pencil /> {t("edit")}</Button>}
      {draft && can("doc.delete") && <Button variant="outline" size="sm" disabled={actions.busy} onClick={() => actions.askDelete(doc)}><Trash2 /> {t("delete")}</Button>}
      {draft && can("doc.approve") && <Button size="sm" disabled={actions.busy} onClick={() => actions.approve(doc)}><CheckCheck /> {t("approve")}</Button>}
      {doc.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" size="sm" disabled={actions.busy} onClick={() => actions.askCancel(doc)}><XCircle /> {t("cancel")}</Button>}
    </>
  )
}
