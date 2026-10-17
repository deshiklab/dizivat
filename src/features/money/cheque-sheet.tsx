"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CalendarClock, CheckCheck, FileX, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { CHEQUE_KIND_TONE } from "@/lib/money-ops"

/** One cheque of the register: the instrument's details, its lifecycle so far, and the next move it allows. */
export function ChequeSheet({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("cheques")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const { data: d, isLoading, error } = useQuery({ queryKey: ["cheques", id], queryFn: () => api.accounting.cheques.list({ q: id! }).then((r) => r.data.find((x) => x.id === id)), enabled: !!id })
  const [action, setAction] = React.useState<"presented" | "cleared" | "bounced" | null>(null)
  const [date, setDate] = React.useState(TODAY)
  const [reason, setReason] = React.useState("")
  React.useEffect(() => { setAction(null); setReason(""); setDate(d?.presentedOn && d.status !== "outstanding" ? d.presentedOn : TODAY) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.accounting.cheques.action(id!, { action: action!, date, ...(action === "bounced" ? { reason } : {}) }),
    onSuccess: (row) => { toast.success(t(action === "bounced" ? "bouncedMsg" : action === "cleared" ? "clearedMsg" : "presentedMsg", { no: row.no })); setAction(null); setReason("") },
    onError: (e) => toast.error(e.message),
  })

  const may = (a: string) => d && (a === "presented" ? ["outstanding", "presented"] : a === "bounced" ? ["outstanding", "presented"] : ["presented"]).includes(d.status)

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} {d.postDated && <Pill tone="info">{t("postDated")}</Pill>}</> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${d.partyName} · ${t(`kind.${d.kind}`)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
          : error || !d ? <div className="p-4"><EmptyState title={t("notFound")} hint={error?.message} /></div>
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <div role="status" className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${d.status === "bounced" ? "border-destructive/30 bg-destructive/5" : d.status === "cleared" ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}`}>
                <span className="font-medium">{t(`status.${d.status}`)}</span>
                {d.ageDays > 0 && d.status === "outstanding" && <span className="text-muted-foreground">{t("aged", { n: fmtNum(d.ageDays, locale) })}</span>}
                {d.bouncedOn && <span className="text-xs text-muted-foreground tabular">{t("bouncedOn", { date: fmtDate(d.bouncedOn, locale) })}</span>}
              </div>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.party")}:</dt><dd className="font-medium">{d.partyName}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.kind")}:</dt><dd>{t(`kind.${d.kind}`)}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.chequeNo")}:</dt><dd className="font-medium tabular">{d.no}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.chequeDate")}:</dt><dd className="tabular">{fmtDate(d.chequeDate, locale)}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.bank")}:</dt><dd>{d.chequeBank || "—"}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.account")}:</dt><dd>{d.accountName}</dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.amount")}:</dt><dd><Money value={d.amount} className="font-semibold" /></dd></div>
                <div className="flex gap-2 text-sm"><dt className="text-muted-foreground">{t("col.doc")}:</dt><dd className="font-medium"><Link href={d.kind === "issued" ? `/accounting/payments?view=${d.moneyId}` : `/accounting/receipts?view=${d.moneyId}`} className="text-primary hover:underline tabular">{d.moneyNo}</Link></dd></div>
              </dl>
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">{t("timeline")}</h3>
                <ol className="grid gap-0 overflow-hidden rounded-md border text-sm">
                  <li className="flex items-center gap-3 border-b bg-muted/30 px-3 py-2">
                    <Pill tone={CHEQUE_KIND_TONE[d.kind]}>{t(`kind.${d.kind}`)}</Pill>
                    <span className="tabular">{fmtDate(d.chequeDate, locale)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{t("issuedOn")}</span>
                  </li>
                  {d.events.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 border-b px-3 py-2 last:border-0">
                      <Pill tone={e.action === "cleared" ? "success" : e.action === "bounced" ? "danger" : "info"}>{t(`action.${e.action}`)}</Pill>
                      <span className="tabular">{fmtDate(e.date, locale)}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{e.by}</span>
                      {e.reason && <p className="w-full text-xs text-muted-foreground">{t("reason")}: {e.reason}</p>}
                    </li>
                  ))}
                </ol>
              </section>
              {action && (
                <form className="grid gap-3 rounded-md border bg-muted/40 p-3" onSubmit={(e) => { e.preventDefault(); if (date >= d.chequeDate && date <= TODAY) save.mutate() }}>
                  <p className="text-sm font-medium">{t(`actionTitle.${action}`)}</p>
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">{t("actionDate")}</span>
                    <Input type="date" value={date} min={d.chequeDate} max={TODAY} onChange={(e) => setDate(e.target.value)} className="bg-background" />
                  </label>
                  {action === "bounced" && (
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted-foreground">{t("bounceReason")}</span>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="bg-background" placeholder={t("bounceReasonPh")} />
                    </label>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setAction(null)}>{tc("cancel")}</Button>
                    <Button type="submit" size="sm" disabled={save.isPending || (action === "bounced" && reason.trim().length < 10)}>{t(`actionGo.${action}`)}</Button>
                  </div>
                </form>
              )}
            </div>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {d && may("presented") && can("doc.edit") && !action && <Button variant="outline" onClick={() => setAction("presented")}><Send /> {t("action.presented")}</Button>}
          {d && may("cleared") && can("doc.edit") && !action && <Button onClick={() => setAction("cleared")}><CheckCheck /> {t("action.cleared")}</Button>}
          {d && may("bounced") && can("doc.edit") && !action && <Button variant="destructive" onClick={() => setAction("bounced")}><FileX /> {t("action.bounced")}</Button>}
          {d && d.status === "outstanding" && d.postDated && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden /> {t("postDatedHint")}</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
