"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Banknote, CheckCheck, Loader2, Pencil, Scale, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Field } from "@/components/common/field"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import { round2 } from "@/lib/vat"
import { DefList, useR4Actions, useR4Refresh } from "@/features/r4/r4-actions"

/** Read view of one asset: what it cost, what it carries now, the month-by-month schedule, and the two final actions (sell it, or re-value it). */
export function AssetSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("assets")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const refresh = useR4Refresh()
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", "asset", id], queryFn: () => api.accounting.assets.get(id!), enabled: !!id })
  const cls = useQuery({ queryKey: ["assetClasses"], queryFn: () => api.accounting.assetClasses.list(), enabled: !!id })
  const schedule = useQuery({ queryKey: ["assetSchedule", id], queryFn: () => api.accounting.assets.schedule(id!), enabled: !!id })
  const accounts = useQuery({ queryKey: ["accountOptions"], queryFn: () => api.accounting.accounts.options(), enabled: !!id })
  const actions = useR4Actions("asset", { onDeleted: () => onOpenChange(false) })
  const [act, setAct] = React.useState<"dispose" | "revalue" | null>(null)
  const [actErr, setActErr] = React.useState<string | null>(null)
  const [form, setForm] = React.useState({ date: TODAY, proceeds: "", accountId: "", toValue: "", reason: "" })

  React.useEffect(() => { setActErr(null); setForm({ date: TODAY, proceeds: "", accountId: "", toValue: "", reason: "" }) }, [act])

  const doAction = useMutation({
    mutationFn: (b: { action: "dispose" | "revalue"; date: string; reason: string; proceeds?: number; accountId?: string; toValue?: number }) => api.accounting.assets.action(d!.id, b),
    onSuccess: (a) => {
      refresh("asset", a)
      setAct(null)
      toast.success(t(act ?? "revalued", { no: a.no }))
    },
    onError: (e) => setActErr(e.message),
  })

  const draft = d?.process === "Created"
  const className = d ? (cls.data?.find((c) => c.id === d.classId)?.name ?? d.classId) : ""
  const sched = schedule.data
  const submitAction = (e: React.FormEvent) => {
    e.preventDefault()
    if (!d) return
    setActErr(null)
    if (act === "dispose") {
      const proceeds = round2(Number(form.proceeds) || 0)
      if (!form.proceeds || proceeds <= 0) { setActErr(t("action.proceedsRequired")); return }
      doAction.mutate({ action: "dispose", date: form.date, proceeds, ...(form.accountId ? { accountId: form.accountId } : {}), reason: form.reason.trim() })
    } else {
      const toValue = round2(Number(form.toValue) || 0)
      if (!form.toValue || toValue <= 0) { setActErr(t("action.toValueRequired")); return }
      doAction.mutate({ action: "revalue", date: form.date, toValue, reason: form.reason.trim() })
    }
  }

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? d.no : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${d.name} · ${fmtDate(d.date, locale)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
          : error || !d ? <div className="p-4"><EmptyState title={t("notFound")} hint={error?.message} /></div>
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <DocBanner doc={d} draftNote={t("draftNote")} />
              {d.disposal && (
                <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
                  {t("disposedNote", { date: fmtDate(d.disposal.date, locale) })} <Money value={d.disposal.proceeds} />{d.disposal.reason ? ` — ${d.disposal.reason}` : ""}
                </p>
              )}
              <DefList rows={[
                [t("field.name"), d.name],
                [t("field.class"), `${className}${cls.data?.find((c) => c.id === d.classId) ? ` · ${t("field.rate", { rate: cls.data.find((c) => c.id === d.classId)!.rate })}` : ""}`],
                [t("field.date"), fmtDate(d.date, locale)],
                [t("field.cost"), <Money key="c" value={d.cost} />],
                [t("field.salvage"), d.salvage ? <Money key="s" value={d.salvage} /> : "—"],
                [t("field.inputVat"), d.inputVat ? <span key="v"><Money value={d.inputVat} /> <span className="text-muted-foreground">({d.creditable ? t("creditable") : t("notCreditable")})</span></span> : "—"],
                ...(d.memo ? [[t("field.memo"), d.memo] as [string, React.ReactNode]] : []),
                ...(d.purchaseId ? [[t("field.purchaseId"), d.purchaseId] as [string, React.ReactNode]] : []),
                ...(d.disposal ? [[t("field.disposedOn"), fmtDate(d.disposal.date, locale)] as [string, React.ReactNode]] : []),
                ...(d.cancelReason ? [[t("field.cancelReason"), d.cancelReason] as [string, React.ReactNode]] : []),
              ]} />
              {sched && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("schedule.title")}</caption>
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th scope="col" className="p-2 font-medium">{t("schedule.month")}</th>
                        <th scope="col" className="p-2 text-right font-medium">{t("schedule.base")}</th>
                        <th scope="col" className="p-2 text-right font-medium">{t("schedule.dep")}</th>
                        <th scope="col" className="p-2 text-right font-medium">{t("schedule.accum")}</th>
                        <th scope="col" className="p-2 text-right font-medium">{t("schedule.nbv")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sched.rows.slice(-24).map((r, i) => (
                        <tr key={i} className={`border-b last:border-0 ${r.event ? "bg-muted/30 font-medium" : ""}`}>
                          <td className="p-2 tabular">{r.month}{r.event === "revalued" ? ` · ${t("schedule.revalued")}` : r.event === "disposed" ? ` · ${t("schedule.disposed")}` : ""}</td>
                          <td className="p-2 text-right tabular"><Money value={r.base} /></td>
                          <td className="p-2 text-right tabular">{r.depreciation ? <Money value={r.depreciation} /> : "—"}</td>
                          <td className="p-2 text-right tabular"><Money value={r.accum} /></td>
                          <td className="p-2 text-right tabular"><Money value={r.nbv} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50 font-medium">
                        <td className="p-2">{sched.rows.length > 24 ? t("schedule.lastMonths", { count: 24 }) : t("schedule.total")}</td>
                        <td className="p-2" />
                        <td className="p-2 text-right tabular"><Money value={sched.totals.depreciation} /></td>
                        <td className="p-2" />
                        <td className="p-2 text-right tabular">{sched.disposal ? t("schedule.nbvAtDisposal") : t("schedule.nbvToday")}: <Money value={sched.disposal?.nbvAtDisposal ?? (sched.rows.at(-1)?.nbv ?? 0)} /></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <HistoryCard history={d.history} />
            </div>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {d && draft && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && !draft && d.process !== "Cancelled" && !d.disposal && can("doc.edit") && (
            <>
              <Button variant="outline" disabled={actions.busy} onClick={() => setAct("revalue")}><Scale /> {t("action.revalue")}</Button>
              <Button variant="outline" disabled={actions.busy} onClick={() => setAct("dispose")}><Banknote /> {t("action.dispose")}</Button>
            </>
          )}
          {d && d.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
        <Dialog open={!!act} onOpenChange={(o) => { if (!o) setAct(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t(act === "dispose" ? "action.disposeTitle" : "action.revalueTitle", { no: d?.no ?? "" })}</DialogTitle>
              <DialogDescription>{t(act === "dispose" ? "action.disposeSub" : "action.revalueSub")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitAction} noValidate className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="aa-date" label={t("action.date")} required error={actErr && actErr.includes("date") ? actErr : undefined}>
                  {(a) => <Input type="date" value={form.date} max={TODAY} min={d?.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} {...a} />}
                </Field>
                {act === "dispose" ? (
                  <>
                    <Field id="aa-proceeds" label={t("action.proceeds")} required error={actErr && actErr.toLowerCase().includes("proceed") ? actErr : undefined}>
                      {(a) => <Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={form.proceeds} onChange={(e) => setForm((f) => ({ ...f, proceeds: e.target.value }))} onWheel={(e) => (e.target as HTMLInputElement).blur()} {...a} />}
                    </Field>
                    <Field id="aa-account" label={t("action.account")} error={actErr && actErr.toLowerCase().includes("account") ? actErr : undefined} hint={t("action.accountHint")}>
                      {(a) => (
                        <Select value={form.accountId} onValueChange={(v) => setForm((f) => ({ ...f, accountId: v ?? "" }))} items={(accounts.data ?? []).map((x) => ({ value: x.id, label: `${x.provider} ${x.accountNo?.slice(-4)}` }))}>
                          <SelectTrigger className="w-full" {...a}><SelectValue placeholder={t("action.onAccount")} /></SelectTrigger>
                          <SelectContent>{(accounts.data ?? []).map((x) => <SelectItem key={x.id} value={x.id}>{x.provider} {x.accountNo?.slice(-4)}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </Field>
                  </>
                ) : (
                  <Field id="aa-toValue" label={t("action.toValue")} required error={actErr && actErr.toLowerCase().includes("value") ? actErr : undefined}>
                    {(a) => <Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={form.toValue} onChange={(e) => setForm((f) => ({ ...f, toValue: e.target.value }))} onWheel={(e) => (e.target as HTMLInputElement).blur()} {...a} />}
                  </Field>
                )}
              </div>
              <Field id="aa-reason" label={t("action.reason")} required error={actErr && actErr.toLowerCase().includes("reason") ? actErr : undefined}>
                {(a) => <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t(act === "dispose" ? "action.disposeReasonPlaceholder" : "action.revalueReasonPlaceholder")} {...a} />}
              </Field>
              {actErr && !/date|proceed|account|value|reason/i.test(actErr) && <p className="text-sm text-destructive">{actErr}</p>}
              <p className="text-sm text-muted-foreground">{t("action.finalNote")}</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAct(null)}>{tc("cancel")}</Button>
                <Button type="submit" variant="destructive" disabled={doAction.isPending || form.reason.trim().length < 10}>
                  {doAction.isPending ? <Loader2 className="animate-spin" /> : null} {t(act === "dispose" ? "action.dispose" : "action.revalue")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
