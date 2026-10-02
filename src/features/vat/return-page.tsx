"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { parseAsInteger, parseAsString, useQueryState } from "nuqs"
import { AlertTriangle, CheckCircle2, Download, FilePlus2, Landmark, ListTree, Lock, Pencil, Printer, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format"
import { periodEnd, periodLabel, RETURN_NOTES, RETURN_PARTS, RETURN_SECTION } from "@/lib/r4"
import type { ReturnNote, ReturnView, TaxPeriod } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"
import { useOnceOpen } from "@/hooks/use-once-open"
import { ReturnAppsBanner } from "@/features/vat/return-apps"

const ReturnForm = dynamic(() => import("./return-form").then((m) => m.ReturnForm), { ssr: false })
const SubFormSheet = dynamic(() => import("./subform-sheet").then((m) => m.SubFormSheet), { ssr: false })

const STATUS_TONE: Record<TaxPeriod["status"], "success" | "warning" | "danger" | "info"> = { submitted: "success", draft: "warning", overdue: "danger", open: "info" }

/**
 * Mushak 9.1 return builder: parts 3–11 computed live from approved documents, notes drill down to their sub-forms (source
 * documents), deposits checked against note 50 before submission, and the period locks once submitted.
 * ?period=YYYY-MM (&note=N opens the sub-form — the legacy sub-form menu crashed with HTTP 500, D-04).
 */
export function ReturnPage() {
  const t = useTranslations("ret")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const confirm = useConfirm()
  const refresh = useR4Refresh()
  const [periodQ, setPeriod] = useQueryState("period", parseAsString)
  const [note, setNote] = useQueryState("note", parseAsInteger)
  const [editOpen, setEditOpen] = React.useState(false)
  const list = useQuery({ queryKey: ["returns", "list"], queryFn: () => api.vat.returns.list({ size: 100 }) })
  const periods = list.data?.periods ?? []
  // default: the oldest period still to file, else the current one
  const period = periodQ ?? [...periods].reverse().find((p) => p.status !== "submitted")?.period ?? periods[0]?.period
  const q = useQuery({ queryKey: ["return", period], queryFn: () => api.vat.returns.get(period!), enabled: !!period, placeholderData: keepPreviousData })
  const r = q.data && q.data.period === period ? q.data : undefined
  const p = periods.find((x) => x.period === period)
  const formMounted = useOnceOpen(editOpen)
  const subMounted = useOnceOpen(note != null)

  const start = useMutation({ mutationFn: () => api.vat.returns.start(period!), onSuccess: () => { refresh(); toast.success(t("started", { period: periodLabel(period!) })) }, onError: (e) => toast.error(e.message) })
  const submit = useMutation({ mutationFn: () => api.vat.returns.submit(period!), onSuccess: (v) => { refresh(); toast.success(t("submittedToast", { period: periodLabel(v.period), ack: v.ackNo ?? "" })) }, onError: (e) => toast.error(e.message) })
  const remove = useMutation({ mutationFn: () => api.vat.returns.remove(period!), onSuccess: () => { refresh(); toast.success(t("deleted")) }, onError: (e) => toast.error(e.message) })
  const askSubmit = async () => {
    if (!r) return
    if (await confirm({ title: t("submitTitle", { period: periodLabel(r.period) }), description: t("submitBody", { payable: fmtNum(r.computation.payableVat, locale, 2), deposited: fmtNum(r.computation.depositedVat, locale, 2), drafts: fmtNum(r.computation.drafts, locale) }), confirm: t("submitConfirm"), cancel: tc("cancel") })) submit.mutate()
  }
  const askDelete = async () => { if (await confirm({ title: t("deleteTitle"), description: t("deleteBody"), confirm: t("deleteConfirm"), cancel: tc("cancel"), destructive: true })) remove.mutate() }

  const c = r?.computation
  const submitted = r?.status === "submitted"
  const draft = !!r && !r.notStarted && r.status === "draft"
  const ended = !!period && TODAY > periodEnd(period)
  const drillNotes = (c?.notes ?? []).filter((n) => n.drill)

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={
          <div className="no-print flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="ret-period" className="text-xs text-muted-foreground">{t("period")}</Label>
              <Select value={period ?? ""} onValueChange={(v) => { setPeriod(v as string); setNote(null) }} items={periods.map((x) => ({ value: x.period, label: `${periodLabel(x.period)} · ${t(`status.${x.status}`)}` }))}>
                <SelectTrigger id="ret-period" className="w-56"><SelectValue placeholder={t("pickPeriod")} /></SelectTrigger>
                <SelectContent>{periods.map((x) => <SelectItem key={x.period} value={x.period}>{periodLabel(x.period)} · {t(`status.${x.status}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {r && <Button variant="outline" onClick={() => window.print()}><Printer /> {t("print")}</Button>}
            {r && period && <PdfButton size="default" filename={`Mushak-9.1_${period}`} />}
          </div>
        } />

      {/* overlay, not in flow: recomputing must not shift the page (CLS) */}
      <div className="relative h-0">{q.isFetching && <div role="status" aria-live="polite" className="no-print absolute inset-x-0 -top-5 z-10 grid gap-0.5 md:-top-6"><div className="h-1 overflow-hidden rounded bg-muted"><div className="h-1 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-primary" /></div><span className="text-xs text-muted-foreground">{t("computing")}</span></div>}</div>

      {!period || (!r && q.isLoading) ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>
        : q.error ? <EmptyState title={t("error")} hint={q.error.message} />
        : !r || !c ? null
        : (
          <div className="print-area grid gap-4">
            {/* status strip */}
            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="grid"><span className="text-xs text-muted-foreground">{t("period")}</span><span className="text-lg font-semibold tabular">{periodLabel(r.period)}</span></div>
                <div className="grid"><span className="text-xs text-muted-foreground">{t("due")}</span><span className="tabular">{fmtDate(r.due, locale)}</span></div>
                <div className="grid"><span className="text-xs text-muted-foreground">{t("statusLabel")}</span>
                  <span>{r.notStarted ? <Pill tone={p?.status === "overdue" ? "danger" : "info"}>{t(p?.status === "overdue" ? "status.overdue" : "notStarted")}</Pill> : <Pill tone={STATUS_TONE[p?.status ?? "draft"]} icon={submitted ? Lock : undefined}>{t(`status.${submitted ? "submitted" : p?.status === "overdue" ? "overdue" : "draft"}`)}</Pill>}</span></div>
                {submitted && <div className="grid"><span className="text-xs text-muted-foreground">{t("ack")}</span><span className="tabular">{r.ackNo} · {fmtDate(r.submissionDate, locale)}{r.late && <Pill tone="danger" className="ml-2">{t("late")}</Pill>}</span></div>}
                {!submitted && !r.notStarted && <div className="grid"><span className="text-xs text-muted-foreground">{t("typeLabel")}</span><span>{t(`type.${r.type}`)} · {t("section", { s: RETURN_SECTION[r.type] })}</span></div>}
                <div className="no-print ml-auto flex flex-wrap gap-2">
                  {r.notStarted && can("doc.create") && <Button onClick={() => start.mutate()} disabled={start.isPending}><FilePlus2 /> {t("start")}</Button>}
                  {draft && can("doc.edit") && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> {t("edit")}</Button>}
                  {draft && can("doc.delete") && <Button variant="outline" onClick={askDelete} disabled={remove.isPending}><Trash2 /> {t("delete")}</Button>}
                  {draft && can("doc.approve") && <Button onClick={askSubmit} disabled={submit.isPending || !ended || c.shortVat > 0 || c.shortSd > 0 || !r.submissionDate}><Send /> {t("submit")}</Button>}
                </div>
              </CardContent>
            </Card>

            {/* guidance */}
            {submitted && <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm"><Lock className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {t("lockedBanner", { by: r.submittedBy ?? "", when: r.submittedAt ? fmtDateTime(r.submittedAt, locale) : "" })}</p>}
            {!submitted && !ended && <p role="status" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-info" aria-hidden /> {t("openPeriod", { end: fmtDate(periodEnd(r.period), locale) })}</p>}
            {!submitted && (c.shortVat > 0 || c.shortSd > 0) && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                <p className="flex-1">{t("shortfall", { amount: fmtNum(c.shortVat || c.shortSd, locale, 2), code: c.notes.find((n) => n.note === (c.shortVat ? 58 : 59))?.code ?? "" })}</p>
                {can("doc.create") && <Button size="sm" variant="outline" className="no-print" render={<Link href={`/vat/tr-6?new=1&period=${r.period}&head=${c.shortVat ? "vat" : "sd"}&amount=${Math.ceil(c.shortVat || c.shortSd)}`} />}><Landmark /> {t("deposit")}</Button>}
              </div>
            )}
            {!submitted && draft && !r.submissionDate && ended && <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">{t("needDate")}</p>}
            {!submitted && c.drafts > 0 && <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">{t("draftsNote", { n: fmtNum(c.drafts, locale) })}</p>}

            {/* R6.6: Mushak 9.3 / 9.4 applications for the period */}
            <ReturnAppsBanner period={r.period} submitted={submitted} overdue={p?.status === "overdue"} apps={r.applications} />

            {/* key figures */}
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {([["out", c.outputVat, 9], ["in", c.inputVat, 23], ["net", c.netVat, 34], ["payable", c.payableVat, 50], ["deposited", c.depositedVat, 58], ["closing", c.closingVat, 65]] as const).map(([k, v, n]) => (
                <Card key={k} size="sm"><CardContent className="grid gap-0.5"><span className="text-xs text-muted-foreground">{t(`kpi.${k}`)} <span className="tabular">({t("noteShort", { n: fmtNum(n, locale) })})</span></span><Money value={v} className="text-lg font-semibold" /></CardContent></Card>
              ))}
            </div>

            {/* sub-form selector (D-04) */}
            <div className="no-print flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="subform-pick" className="text-xs text-muted-foreground">{t("subforms")}</Label>
                <Select value="" onValueChange={(v) => v && setNote(Number(v))} items={drillNotes.map((n) => ({ value: String(n.note), label: t("subformItem", { n: n.note, count: n.count ?? 0 }) }))}>
                  <SelectTrigger id="subform-pick" className="w-64"><SelectValue placeholder={t("pickSubform", { n: drillNotes.length })} /></SelectTrigger>
                  <SelectContent>{drillNotes.map((n) => <SelectItem key={n.note} value={String(n.note)}>{t("subformItem", { n: n.note, count: n.count ?? 0 })}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!r.live && <Pill tone="info" icon={Lock}>{t("frozen")}</Pill>}
            </div>

            {/* the form, part by part */}
            {RETURN_PARTS.map((part) => <PartCard key={part.part} part={part} notes={c.notes} onDrill={(n) => setNote(n)} />)}
          </div>
        )}

      {r && <ReturnHistory periods={periods} rows={list.data?.data ?? []} onPick={(x) => { setPeriod(x); setNote(null); window.scrollTo({ top: 0 }) }} csvUrl={api.vat.returns.csvUrl({})} />}

      {formMounted && r && draft && <ReturnForm open={editOpen} onOpenChange={setEditOpen} ret={r} />}
      {subMounted && period && <SubFormSheet period={period} note={note} onOpenChange={(o) => { if (!o) setNote(null) }} />}
    </>
  )
}

function PartCard({ part, notes, onDrill }: { part: (typeof RETURN_PARTS)[number]; notes: ReturnNote[]; onDrill: (n: number) => void }) {
  const t = useTranslations("ret")
  const locale = useLocale()
  const isBn = locale === "bn"
  const defs = RETURN_NOTES.filter((n) => n.part === part.part)
  const kind = defs[0]?.kind
  const cols = part.part === 3 ? ["value", "sd", "vat"] : part.part === 4 ? ["value", "vat"] : ["amount"]
  return (
    <Card>
      <CardHeader><CardTitle>{isBn ? part.bn : part.en}</CardTitle>{part.part === 9 && <CardDescription>{t("part9Hint")}</CardDescription>}</CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={isBn ? part.bn : part.en}>
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">{isBn ? part.bn : part.en}</caption>
            <thead><tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="w-14 px-4 py-2 font-medium">{t("col.note")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("col.desc")}</th>
              {part.part === 9 && <th scope="col" className="px-2 py-2 font-medium">{t("col.code")}</th>}
              {cols.map((k) => <th key={k} scope="col" className="px-2 py-2 text-right font-medium">{t(`col.${k}`)}</th>)}
              <th scope="col" className="w-24 px-4 py-2"><span className="sr-only">{t("col.drill")}</span></th>
            </tr></thead>
            <tbody>
              {defs.map((d) => {
                const n = notes.find((x) => x.note === d.note)
                const total = d.total || d.formula
                return (
                  <tr key={d.note} className={`border-b last:border-0 ${total ? "bg-muted/30 font-medium" : ""}`}>
                    <td className="px-4 py-1.5 tabular">{d.note}</td>
                    <td className="px-2 py-1.5">{isBn ? d.bn : d.en}{d.formula && <span className="block text-xs font-normal text-muted-foreground tabular">{d.formula}</span>}</td>
                    {part.part === 9 && <td className="px-2 py-1.5 tabular text-muted-foreground">{n?.code ?? ""}</td>}
                    {cols.map((k) => {
                      const v = (n as Record<string, number | undefined> | undefined)?.[k]
                      return <td key={k} className="px-2 py-1.5 text-right">{kind === "vv" && k === "sd" ? "" : v == null ? "—" : <Money value={v} className={v < 0 ? "text-destructive" : ""} />}</td>
                    })}
                    <td className="px-4 py-1.5 text-right">
                      {n?.drill && <Button variant="ghost" size="sm" className="no-print" onClick={() => onDrill(d.note)} aria-label={t("drillFor", { n: d.note })}><ListTree /> <span className="tabular">{fmtNum(n.count ?? 0, locale)}</span></Button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function ReturnHistory({ periods, rows, onPick, csvUrl }: { periods: TaxPeriod[]; rows: (Omit<ReturnView, "computation" | "live">)[]; onPick: (p: string) => void; csvUrl: string }) {
  const t = useTranslations("ret")
  const locale = useLocale()
  const byPeriod = new Map(rows.map((r) => [r.period, r]))
  return (
    <Card className="no-print mt-4">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="grid gap-1"><CardTitle>{t("history")}</CardTitle><CardDescription>{t("historyHint")}</CardDescription></div>
        <Button variant="outline" size="sm" render={<a href={csvUrl} download />}><Download /> CSV</Button>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("history")}>
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">{t("history")}</caption>
            <thead><tr className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">{t("period")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("statusLabel")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("due")}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t("submittedOn")}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{t("kpi.payable")}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{t("kpi.deposited")}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{t("kpi.closing")}</th>
            </tr></thead>
            <tbody>
              {periods.map((p) => {
                const r = byPeriod.get(p.period)
                return (
                  <tr key={p.period} className="border-b last:border-0">
                    <td className="px-4 py-1.5"><button type="button" className="font-medium text-primary hover:underline tabular" onClick={() => onPick(p.period)}>{periodLabel(p.period)}</button></td>
                    <td className="px-2 py-1.5"><Pill tone={STATUS_TONE[p.status]} icon={p.locked ? Lock : undefined}>{t(`status.${p.status}`)}</Pill>{r?.late && <Pill tone="danger" className="ml-1">{t("late")}</Pill>}</td>
                    <td className="px-2 py-1.5 tabular">{fmtDate(p.due, locale)}</td>
                    <td className="px-2 py-1.5 tabular">{r?.submissionDate ? fmtDate(r.submissionDate, locale) : "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r ? <Money value={r.netPayable} /> : "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r ? <Money value={r.deposited} /> : "—"}</td>
                    <td className="px-4 py-1.5 text-right">{r ? <Money value={r.closing} /> : "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
