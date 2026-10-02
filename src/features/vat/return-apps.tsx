"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { toast } from "sonner"
import { ArrowLeft, CheckCircle2, ClockAlert, FilePenLine, FilePlus2, FileText, Hourglass, Loader2, Pencil, Plus, Printer, Send, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Field } from "@/components/common/field"
import { PdfButton } from "@/components/common/pdf-button"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { Mushak93 } from "@/features/vat/mushak-9-3"
import { Mushak94 } from "@/features/vat/mushak-9-4"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { periodLabel, RETURN_NOTES } from "@/lib/r4"
import { AMEND_DECIDE_DAYS, AMEND_MAX_LINES, AMEND_YEARS, AMENDABLE_NOTES, fieldsOf, LATE_APPLY_DAYS, LATE_DECIDE_DAYS, lateLimits, noteValue } from "@/lib/return-apps"
import type { AmendField, AmendmentState, AmendReason, LateFilingReason, LateFilingRow, LateFilingState, ReturnAmendmentRow, ReturnComputation } from "@/lib/types"
import { cn } from "@/lib/utils"

export const LATE_TONE: Record<LateFilingState, Tone> = { draft: "neutral", filed: "info", approved: "success", deemed: "success", rejected: "danger" }
export const AMEND_TONE: Record<AmendmentState, Tone> = { draft: "neutral", filed: "info", approved: "warning", deemed: "warning", rejected: "danger", amended: "success" }
const LATE_REASONS: LateFilingReason[] = ["systemFailure", "disaster", "illness", "documents", "other"]
const AMEND_REASONS: AmendReason[] = ["clerical", "underpaid", "overpaid", "other"]
const selectCls = "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
const CURRENT = TODAY.slice(0, 7)
const errMap = (t: { has: (k: string) => boolean; (k: string): string }, e: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(e).map(([k, x]) => [k, t.has(`err.${x[0]}`) ? t(`err.${x[0]}`) : x[0]]))

/** /vat/return-applications — Mushak 9.3 (late filing) and 9.4 (amended return) applications. */
export function ReturnApplicationsPage() {
  const t = useTranslations("rapp")
  const tn = useTranslations("nav")
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("late"))
  return (
    <>
      <PageHeader title={tn("returnApps")} description={t("intro")} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="mb-4">
          <TabsTrigger value="late" data-testid="rapp-tab-late">{t("tab.late")}</TabsTrigger>
          <TabsTrigger value="amend" data-testid="rapp-tab-amend">{t("tab.amend")}</TabsTrigger>
        </TabsList>
        <TabsContent value="late"><LateTab /></TabsContent>
        <TabsContent value="amend"><AmendTab /></TabsContent>
      </Tabs>
    </>
  )
}

function Count({ label, n, icon: Icon, tone, testId }: { label: string; n: number; icon?: React.ElementType; tone?: "warning" | "danger"; testId?: string }) {
  return (
    <div className={cn("rounded-md border bg-card p-3", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : "")} data-testid={testId}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" aria-hidden />}{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular">{n}</dd>
    </div>
  )
}

/* ── Mushak 9.3 ───────────────────────────────────────────────────────────────────────────────────────────── */

function LateTab() {
  const t = useTranslations("rapp")
  const locale = useLocale()
  const can = useCan()
  const [period] = useQueryState("period", parseAsString.withDefault(""))
  const [creating, setCreating] = React.useState(false)
  React.useEffect(() => { if (period && can("doc.create")) setCreating(true) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ["lateFilings"], queryFn: () => api.vat.lateFilings.list() })
  const d = q.data
  if (q.isLoading) return <Skeleton className="h-72" />
  if (q.error || !d) return <EmptyState title={t("error")} hint={q.error?.message} />
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <dl className="grid flex-1 gap-3 sm:grid-cols-3">
          <Count label={t("late.tot.pending")} n={d.totals.pending} icon={Hourglass} testId="late-pending" />
          <Count label={t("late.tot.allowed")} n={d.totals.allowed} icon={CheckCircle2} testId="late-allowed" />
          <Count label={t("late.tot.rejected")} n={d.totals.rejected} icon={XCircle} tone={d.totals.rejected ? "danger" : undefined} />
        </dl>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" render={<a href={api.vat.lateFilings.csvUrl()} download={`mushak-9.3-${TODAY}.csv`} />}>{t("csv")}</Button>
          {can("doc.create") && <Button size="sm" onClick={() => setCreating(true)} data-testid="late-new"><FilePlus2 /> {t("late.new")}</Button>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("late.table")}>
        <table className="w-full min-w-[880px] text-sm">
          <caption className="sr-only">{t("late.table")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.app")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.period")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.due")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.requested")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.filed")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.return")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
          </tr></thead>
          <tbody>
            {d.rows.length ? d.rows.map((r) => (
              <tr key={r.id} className="border-b align-top last:border-0" data-testid={`late-row-${r.no}`}>
                <td className="px-3 py-2"><Link href={`/vat/return-applications/late/${r.id}`} className="font-medium text-primary tabular underline underline-offset-2">{r.no}</Link><span className="block text-xs text-muted-foreground">{t(`lateReason.${r.reasonKind}`)}</span></td>
                <td className="px-3 py-2 tabular">{periodLabel(r.period)}</td>
                <td className="px-3 py-2 text-xs tabular">{fmtDate(r.due, locale)}</td>
                <td className="px-3 py-2 text-xs tabular">{fmtDate(r.requestedDate, locale)}{r.effectiveDate && <span className="block text-success">{t("allowedTo", { date: fmtDate(r.effectiveDate, locale) })}</span>}</td>
                <td className="px-3 py-2 text-xs tabular">{r.filedOn ? fmtDate(r.filedOn, locale) : <span className={cn(TODAY > r.applyBy ? "text-destructive" : "text-muted-foreground")}>{t("applyBy", { date: fmtDate(r.applyBy, locale) })}</span>}</td>
                <td className="px-3 py-2 text-xs">{t(`returnStatus.${r.returnStatus}`)}{r.returnSubmittedOn && <span className="block tabular text-muted-foreground">{fmtDate(r.returnSubmittedOn, locale)}</span>}</td>
                <td className="px-3 py-2"><Pill tone={LATE_TONE[r.state]}>{t(`lateState.${r.state}`)}</Pill>{r.state === "filed" && r.deemedOn && <span className="block text-xs text-muted-foreground">{t("deemedAfter", { date: fmtDate(r.deemedOn, locale) })}</span>}</td>
              </tr>
            )) : <tr><td colSpan={7} className="px-3 py-10"><EmptyState icon={ClockAlert} title={t("late.empty")} hint={t("late.emptyHint")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("late.note", { apply: LATE_APPLY_DAYS, decide: LATE_DECIDE_DAYS })}</p>
      <LateFormDialog open={creating} initialPeriod={period || undefined} onOpenChange={setCreating} />
    </div>
  )
}

/** New / edit a Mushak 9.3 draft. */
function LateFormDialog({ open, onOpenChange, edit, initialPeriod }: { open: boolean; onOpenChange: (o: boolean) => void; edit?: LateFilingRow; initialPeriod?: string }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const router = useRouter()
  const periods = useQuery({ queryKey: ["vat", "periods"], queryFn: api.vat.periods, enabled: open })
  const settings = useQuery({ queryKey: ["vat", "settings"], queryFn: api.vat.settings, staleTime: 5 * 60_000 })
  const open_ = (periods.data ?? []).filter((p) => p.status !== "submitted" && p.period <= CURRENT).map((p) => p.period).sort().reverse()
  const [v, setV] = React.useState({ period: "", reasonKind: "systemFailure" as LateFilingReason, reason: "", requestedDate: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const lim = v.period ? lateLimits(v.period, settings.data) : null
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    if (edit) setV({ period: edit.period, reasonKind: edit.reasonKind, reason: edit.reason, requestedDate: edit.requestedDate })
    else { const p = initialPeriod ?? CURRENT; setV({ period: p, reasonKind: "systemFailure", reason: "", requestedDate: lateLimits(p, settings.data).maxDate }) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => (edit ? api.vat.lateFilings.update(edit.id, v) : api.vat.lateFilings.create(v)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["lateFilings"] }); qc.setQueryData(["lateFilings", "one", r.id], r)
      toast.success(t(edit ? "saved" : "created", { no: r.no })); onOpenChange(false)
      if (!edit) router.push(`/vat/return-applications/late/${r.id}`)
    },
    onError: (e) => { if (e instanceof ApiError && e.errors) setErrors(errMap(t, e.errors)); else toast.error(e.message) },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <DialogHeader><DialogTitle>{edit ? t("late.editTitle", { no: edit.no }) : t("late.newTitle")}</DialogTitle><DialogDescription>{t("late.formBody")}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="lf-period" label={t("col.period")} required error={errors.period}>
              {(a) => (
                <select className={selectCls} value={v.period} data-testid="lf-period" onChange={(e) => setV({ ...v, period: e.target.value, requestedDate: lateLimits(e.target.value, settings.data).maxDate })} {...a}>
                  {[...new Set([v.period, ...open_])].filter(Boolean).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                </select>
              )}
            </Field>
            <Field id="lf-date" label={t("late.requested")} required error={errors.requestedDate} hint={lim ? t("late.window", { due: fmtDate(lim.due, locale), max: fmtDate(lim.maxDate, locale) }) : undefined}>
              {(a) => <Input type="date" min={lim?.due} max={lim?.maxDate} value={v.requestedDate} data-testid="lf-date" onChange={(e) => setV({ ...v, requestedDate: e.target.value })} {...a} />}
            </Field>
            <Field id="lf-kind" label={t("reasonKind")} required error={errors.reasonKind} className="sm:col-span-2">
              {(a) => <select className={selectCls} value={v.reasonKind} onChange={(e) => setV({ ...v, reasonKind: e.target.value as LateFilingReason })} {...a}>{LATE_REASONS.map((k) => <option key={k} value={k}>{t(`lateReason.${k}`)}</option>)}</select>}
            </Field>
            <Field id="lf-reason" label={t("reasonDetail")} required error={errors.reason} className="sm:col-span-2" hint={t("minChars", { n: 10 })}>
              {(a) => <Textarea rows={4} maxLength={500} value={v.reason} data-testid="lf-reason" onChange={(e) => setV({ ...v, reason: e.target.value })} {...a} />}
            </Field>
          </div>
          {lim && TODAY > lim.applyBy && <p role="note" className="rounded-md border border-warning/60 bg-warning-soft p-2 text-xs">{t("late.pastApplyBy", { date: fmtDate(lim.applyBy, locale) })}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending} data-testid="lf-save">{save.isPending && <Loader2 className="animate-spin" />} {t("saveDraft")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type LateAction = "file" | "approve" | "reject"
/** /vat/return-applications/late/[id] */
export function LateDetailPage({ id }: { id: string }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const [tab, setTab] = React.useState("form")
  const [action, setAction] = React.useState<LateAction | null>(null)
  const [editing, setEditing] = React.useState(false)
  const q = useQuery({ queryKey: ["lateFilings", "one", id], queryFn: () => api.vat.lateFilings.get(id) })
  const r = q.data
  const remove = useMutation({
    mutationFn: () => api.vat.lateFilings.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lateFilings"] }); toast.success(t("deleted", { no: r?.no ?? "" })); router.push("/vat/return-applications?tab=late") },
    onError: (e) => toast.error(e.message),
  })
  const back = <Button variant="outline" render={<Link href="/vat/return-applications?tab=late" />}><ArrowLeft /> {t("back")}</Button>
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !r) return <EmptyState title={t("notFound")} action={back} />
  const actions: { a: LateAction; icon: React.ElementType; perm: "doc.create" | "doc.approve"; variant?: "outline" }[] =
    r.state === "draft" ? [{ a: "file", icon: Send, perm: "doc.create" }]
      : r.state === "filed" ? [{ a: "approve", icon: CheckCircle2, perm: "doc.approve" }, { a: "reject", icon: XCircle, perm: "doc.approve", variant: "outline" }]
        : r.state === "deemed" ? [{ a: "approve", icon: CheckCircle2, perm: "doc.approve", variant: "outline" }] : []
  return (
    <>
      <PageHeader crumbs={[{ label: t("tab.late"), href: "/vat/return-applications?tab=late" }, { label: r.no }]}
        title={<span className="flex flex-wrap items-center gap-2">{t("late.detailTitle", { no: r.no })} <Pill tone={LATE_TONE[r.state]}>{t(`lateState.${r.state}`)}</Pill></span>}
        description={t("late.detailSub", { period: periodLabel(r.period), due: fmtDate(r.due, locale) })}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setTab("form"); setTimeout(() => window.print(), 200) }}><Printer /> {tc("print")}</Button>
          <PdfButton filename={`Mushak-9.3_${r.no}`} prepare={() => setTab("form")} />
          {r.state === "draft" && can("doc.edit") && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="late-edit"><Pencil /> {t("edit")}</Button>}
          {actions.filter((x) => can(x.perm)).map((x) => <Button key={x.a} size="sm" variant={x.variant ?? "default"} onClick={() => setAction(x.a)} data-testid={`late-action-${x.a}`}><x.icon /> {t(`lateAction.${x.a}`)}</Button>)}
          {r.state === "draft" && can("doc.delete") && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: t("deleteTitle", { no: r.no }), description: t("deleteBody"), confirm: t("delete"), cancel: tc("cancel"), destructive: true })) remove.mutate() }}><Trash2 /> {t("delete")}</Button>}
        </>} />
      <section aria-label={t("summary")} className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("col.due")} value={fmtDate(r.due, locale)} hint={t("late.maxDate", { date: fmtDate(r.maxDate, locale) })} />
        <Fact label={t("col.filed")} value={r.filedOn ? fmtDate(r.filedOn, locale) : "—"} hint={r.filedRef ?? (r.state === "draft" ? t("applyBy", { date: fmtDate(r.applyBy, locale) }) : undefined)} tone={r.state === "draft" && TODAY > r.applyBy ? "danger" : undefined} />
        <Fact label={t("late.requested")} value={fmtDate(r.requestedDate, locale)} hint={r.state === "filed" && r.deemedOn ? t("deemedAfter", { date: fmtDate(r.deemedOn, locale) }) : undefined} />
        <Fact label={t("late.allowed")} value={r.effectiveDate ? fmtDate(r.effectiveDate, locale) : "—"} hint={r.state === "deemed" ? t("late.deemedHint", { date: fmtDate(r.deemedOn!, locale) }) : r.decidedOn ? `${fmtDate(r.decidedOn, locale)}${r.commissionerRef ? ` · ${r.commissionerRef}` : ""}` : undefined} tone={r.state === "rejected" ? "danger" : undefined} />
      </section>
      {r.rejectReason && <p role="note" className="no-print mb-4 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="late-reject-reason"><span className="font-medium">{t("refused", { date: fmtDate(r.decidedOn!, locale) })}</span> {r.rejectReason}</p>}
      {(r.state === "approved" || r.state === "deemed") && (
        <p role="note" className="no-print mb-4 rounded-md border border-success/50 bg-success-soft p-3 text-sm" data-testid="late-effect">
          {r.returnStatus === "submitted" ? (r.withinExtension ? t("late.effectWithin", { date: fmtDate(r.returnSubmittedOn!, locale) }) : t("late.effectSubmitted", { date: fmtDate(r.returnSubmittedOn!, locale) })) : t("late.effect", { date: fmtDate(r.effectiveDate!, locale) })}{" "}
          <Link href={`/vat/return-9-1?period=${r.period}`} className="underline">{t("openReturn")}</Link>
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="no-print mb-4">
          <TabsTrigger value="form"><FileText className="size-4" aria-hidden /> {t("tabForm93")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak93 app={r} /></TabsContent>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={r.id} /></TabsContent>
      </Tabs>
      <LateFormDialog open={editing} onOpenChange={setEditing} edit={r} />
      <LateActionDialog app={r} action={action} onOpenChange={(o) => !o && setAction(null)} />
    </>
  )
}

function Fact({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warning" | "danger" | "success" }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : tone === "success" ? "border-success/50" : "")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular">{value}</div>
      {hint && <p className={cn("mt-0.5 text-xs", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>{hint}</p>}
    </div>
  )
}

function LateActionDialog({ app: r, action, onOpenChange }: { app: LateFilingRow; action: LateAction | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const [v, setV] = React.useState({ date: TODAY, ref: "", grantedDate: "", reason: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (action) { setErrors({}); setV({ date: TODAY, ref: "", grantedDate: r.requestedDate, reason: "" }) } }, [action]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: () => api.vat.lateFilings.action(r.id, { action: action!, date: v.date, ref: v.ref || undefined, grantedDate: action === "approve" ? v.grantedDate || undefined : undefined, reason: v.reason || undefined }),
    onSuccess: (x) => { qc.setQueryData(["lateFilings", "one", r.id], x); qc.invalidateQueries({ queryKey: ["lateFilings"] }); qc.invalidateQueries({ queryKey: ["vat"] }); toast.success(t(`lateDone.${action}`, { no: x.no })); onOpenChange(false) },
    onError: (e) => { if (e instanceof ApiError && e.errors) setErrors(errMap(t, e.errors)); else toast.error(e.message) },
  })
  if (!action) return null
  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run.mutate() }}>
          <DialogHeader><DialogTitle>{t(`lateDialog.${action}.title`, { no: r.no })}</DialogTitle><DialogDescription>{t(`lateDialog.${action}.body`, { applyBy: fmtDate(r.applyBy, locale) })}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="la-date" label={t(`lateDialog.${action}.date`)} required error={errors.date}>{(a) => <Input type="date" max={TODAY} value={v.date} data-testid="la-date" onChange={(e) => setV({ ...v, date: e.target.value })} {...a} />}</Field>
            <Field id="la-ref" label={t(`lateDialog.${action}.ref`)} error={errors.ref}>{(a) => <Input autoComplete="off" className="tabular" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} {...a} />}</Field>
            {action === "approve" && <Field id="la-granted" label={t("late.allowed")} required error={errors.grantedDate} hint={t("late.grantedHint", { date: fmtDate(r.requestedDate, locale) })}>{(a) => <Input type="date" min={r.due} max={r.requestedDate} value={v.grantedDate} data-testid="la-granted" onChange={(e) => setV({ ...v, grantedDate: e.target.value })} {...a} />}</Field>}
            {action === "reject" && <Field id="la-reason" label={t("rejectReason")} required error={errors.reason} className="sm:col-span-2">{(a) => <Textarea rows={3} maxLength={300} value={v.reason} data-testid="la-reason" onChange={(e) => setV({ ...v, reason: e.target.value })} {...a} />}</Field>}
          </div>
          {errors.period && <p role="alert" className="text-sm text-destructive">{errors.period}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={action === "reject" ? "destructive" : "default"} disabled={run.isPending} data-testid="la-submit">{run.isPending && <Loader2 className="animate-spin" />} {t(`lateAction.${action}`)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ── Mushak 9.4 ───────────────────────────────────────────────────────────────────────────────────────────── */

function AmendTab() {
  const t = useTranslations("rapp")
  const locale = useLocale()
  const can = useCan()
  const [period] = useQueryState("amend", parseAsString.withDefault(""))
  const [creating, setCreating] = React.useState(false)
  React.useEffect(() => { if (period && can("doc.create")) setCreating(true) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ["amendments"], queryFn: () => api.vat.amendments.list() })
  const d = q.data
  if (q.isLoading) return <Skeleton className="h-72" />
  if (q.error || !d) return <EmptyState title={t("error")} hint={q.error?.message} />
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <dl className="grid flex-1 gap-3 sm:grid-cols-3">
          <Count label={t("amend.tot.pending")} n={d.totals.pending} icon={Hourglass} testId="amend-pending" />
          <Count label={t("amend.tot.toFile")} n={d.totals.toFile} icon={FilePenLine} tone={d.totals.toFile ? "warning" : undefined} testId="amend-tofile" />
          <Count label={t("amend.tot.amended")} n={d.totals.amended} icon={CheckCircle2} testId="amend-amended" />
        </dl>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" render={<a href={api.vat.amendments.csvUrl()} download={`mushak-9.4-${TODAY}.csv`} />}>{t("csv")}</Button>
          {can("doc.create") && <Button size="sm" onClick={() => setCreating(true)} data-testid="amend-new"><FilePlus2 /> {t("amend.new")}</Button>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("amend.table")}>
        <table className="w-full min-w-[920px] text-sm">
          <caption className="sr-only">{t("amend.table")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.app")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.period")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.corrections")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.deltaVat")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.deltaSd")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.effect")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
          </tr></thead>
          <tbody>
            {d.rows.length ? d.rows.map((r) => (
              <tr key={r.id} className="border-b align-top last:border-0" data-testid={`amend-row-${r.no}`}>
                <td className="px-3 py-2"><Link href={`/vat/return-applications/amend/${r.id}`} className="font-medium text-primary tabular underline underline-offset-2">{r.no}</Link><span className="block text-xs text-muted-foreground">{t(`amendReason.${r.reasonKind}`)}</span></td>
                <td className="px-3 py-2 tabular">{periodLabel(r.period)}{r.revision > 1 && <span className="block text-xs text-muted-foreground">{t("revision", { n: r.revision })}</span>}</td>
                <td className="px-3 py-2 text-xs">{r.corrections.map((c) => t("noteN", { n: c.note })).join(", ")}</td>
                <td className="px-3 py-2 text-right"><Signed v={r.effect.deltaVat} /></td>
                <td className="px-3 py-2 text-right"><Signed v={r.effect.deltaSd} /></td>
                <td className="px-3 py-2 text-xs">{r.effect.direction === "increase" ? <>{t("toPay")} <Money value={r.amended?.payment?.amount ?? r.effect.toPay} /></> : r.effect.direction === "decrease" ? <>{t("decreaseAdj")} <Money value={r.effect.decreaseVat + r.effect.decreaseSd} />{r.adjustPeriod && <span className="block text-muted-foreground">{t("inPeriod", { period: periodLabel(r.adjustPeriod) })}</span>}</> : t("noChange")}</td>
                <td className="px-3 py-2"><Pill tone={AMEND_TONE[r.state]}>{t(`amendState.${r.state}`)}</Pill>{r.state === "filed" && r.deemedOn && <span className="block text-xs text-muted-foreground">{t("deemedAfter", { date: fmtDate(r.deemedOn, locale) })}</span>}</td>
              </tr>
            )) : <tr><td colSpan={7} className="px-3 py-10"><EmptyState icon={FilePenLine} title={t("amend.empty")} hint={t("amend.emptyHint")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("amend.note", { years: AMEND_YEARS, days: AMEND_DECIDE_DAYS })}</p>
      <AmendFormDialog open={creating} initialPeriod={period || undefined} onOpenChange={setCreating} rows={d.rows} />
    </div>
  )
}

function Signed({ v }: { v: number }) {
  const locale = useLocale()
  if (Math.abs(v) < 0.005) return <span className="text-muted-foreground tabular">0.00</span>
  return <span className={cn("font-medium tabular", v > 0 ? "text-destructive" : "text-success")}>{v > 0 ? "+" : "−"}{fmtNum(Math.abs(v), locale, 2)}</span>
}

type CorrDraft = { note: number; field: AmendField; to: string; explanation: string }
/** New / edit a Mushak 9.4 draft: the period, reason, declaration and the corrected 9.1 notes. */
function AmendFormDialog({ open, onOpenChange, edit, initialPeriod, rows }: { open: boolean; onOpenChange: (o: boolean) => void; edit?: ReturnAmendmentRow; initialPeriod?: string; rows?: ReturnAmendmentRow[] }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const router = useRouter()
  const periods = useQuery({ queryKey: ["vat", "periods"], queryFn: api.vat.periods, enabled: open })
  const submitted = (periods.data ?? []).filter((p) => p.status === "submitted").map((p) => p.period).sort().reverse()
  const [v, setV] = React.useState({ period: "", reasonKind: "clerical" as AmendReason, description: "", noAudit: false })
  const [lines, setLines] = React.useState<CorrDraft[]>([])
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const ret = useQuery({ queryKey: ["vat", "return", v.period], queryFn: () => api.vat.returns.get(v.period), enabled: open && !!v.period && !(edit && edit.period === v.period) })
  // the figures being amended: the latest amended return of the period, else the submitted one
  const amendedBase = (rows ?? []).filter((r) => r.period === v.period && r.state === "amended" && r.id !== edit?.id).sort((a, b) => b.revision - a.revision)[0]?.computation
  const base: ReturnComputation | undefined = edit && edit.period === v.period ? edit.base : amendedBase ?? ret.data?.computation
  const fromOf = (c: CorrDraft) => (base ? noteValue(base, c.note, c.field) : 0)
  const label = (n: number) => { const d = RETURN_NOTES.find((x) => x.note === n); return d ? `${t("noteN", { n })} — ${locale === "bn" ? d.bn : d.en}` : t("noteN", { n }) }
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    if (edit) { setV({ period: edit.period, reasonKind: edit.reasonKind, description: edit.description, noAudit: edit.noAudit }); setLines(edit.corrections.map((c) => ({ note: c.note, field: c.field, to: String(c.to), explanation: c.explanation }))) }
    else { setV({ period: initialPeriod ?? "", reasonKind: "clerical", description: "", noAudit: false }); setLines([]) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (open && !v.period && submitted[0]) setV((x) => ({ ...x, period: submitted[0] })) }, [open, submitted.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const addLine = () => { const note = AMENDABLE_NOTES[0].note; const field = fieldsOf(note).at(-1)!; setLines((l) => [...l, { note, field, to: base ? String(noteValue(base, note, field)) : "", explanation: "" }]) }
  const save = useMutation({
    mutationFn: () => {
      const b = { ...v, corrections: lines.map((c) => ({ note: c.note, field: c.field, to: c.to === "" ? Number.NaN : Number(c.to), explanation: c.explanation })) }
      return edit ? api.vat.amendments.update(edit.id, b) : api.vat.amendments.create(b)
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["amendments"] }); qc.setQueryData(["amendments", "one", r.id], r)
      toast.success(t(edit ? "saved" : "created", { no: r.no })); onOpenChange(false)
      if (!edit) router.push(`/vat/return-applications/amend/${r.id}`)
    },
    onError: (e) => { if (e instanceof ApiError && e.errors) setErrors(errMap(t, e.errors)); else toast.error(e.message) },
  })
  const setLine = (i: number, p: Partial<CorrDraft>) => setLines((l) => l.map((x, k) => (k === i ? { ...x, ...p } : x)))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
          <DialogHeader><DialogTitle>{edit ? t("amend.editTitle", { no: edit.no }) : t("amend.newTitle")}</DialogTitle><DialogDescription>{t("amend.formBody", { years: AMEND_YEARS })}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="am-period" label={t("col.period")} required error={errors.period}>
              {(a) => (
                <select className={selectCls} value={v.period} data-testid="am-period" onChange={(e) => { setV({ ...v, period: e.target.value }); setLines([]) }} {...a}>
                  {!v.period && <option value="">—</option>}
                  {[...new Set([v.period, ...submitted])].filter(Boolean).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
                </select>
              )}
            </Field>
            <Field id="am-kind" label={t("reasonKind")} required error={errors.reasonKind} className="sm:col-span-2">
              {(a) => <select className={selectCls} value={v.reasonKind} onChange={(e) => setV({ ...v, reasonKind: e.target.value as AmendReason })} {...a}>{AMEND_REASONS.map((k) => <option key={k} value={k}>{t(`amendReason.${k}`)}</option>)}</select>}
            </Field>
            <Field id="am-desc" label={t("amend.description")} required error={errors.description} className="sm:col-span-3" hint={t("minChars", { n: 10 })}>
              {(a) => <Textarea rows={3} maxLength={1000} value={v.description} data-testid="am-desc" onChange={(e) => setV({ ...v, description: e.target.value })} {...a} />}
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t("amend.corrections")}</legend>
            {errors.corrections && <p role="alert" className="text-xs text-destructive">{errors.corrections}</p>}
            {lines.map((c, i) => renderLine(c, i))}
            {lines.length < AMEND_MAX_LINES && <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={addLine} disabled={!v.period} data-testid="am-add"><Plus /> {t("amend.addLine")}</Button>}
          </fieldset>
          <div className="grid gap-1">
            <label className="flex items-start gap-2 text-sm" htmlFor="am-noaudit">
              <Checkbox id="am-noaudit" checked={v.noAudit} onCheckedChange={(x) => setV({ ...v, noAudit: !!x })} aria-describedby={errors.noAudit ? "am-noaudit-err" : undefined} data-testid="am-noaudit" />
              <span>{t("amend.declaration")}</span>
            </label>
            {errors.noAudit && <p id="am-noaudit-err" role="alert" className="text-xs text-destructive">{errors.noAudit}</p>}
            <p className="text-xs text-muted-foreground">{t("amend.notFor")}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending} data-testid="am-save">{save.isPending && <Loader2 className="animate-spin" />} {t("saveDraft")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  function renderLine(c: CorrDraft, i: number) {
    const k = `corrections.${i}`
    const from = fromOf(c)
    const err = errors[`${k}.note`] ?? errors[`${k}.field`] ?? errors[`${k}.to`] ?? errors[`${k}.explanation`] ?? errors[k]
    return (
      <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,2.2fr)_7rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" data-testid={`am-line-${i}`}>
        <Field id={`am-note-${i}`} label={t("amend.note91")}>
          {(a) => (
            <select className={selectCls} value={c.note} data-testid={`am-note-${i}`} {...a}
              onChange={(e) => { const note = Number(e.target.value); const field = fieldsOf(note).at(-1)!; setLine(i, { note, field, to: base ? String(noteValue(base, note, field)) : c.to }) }}>
              {AMENDABLE_NOTES.map((n) => <option key={n.note} value={n.note}>{label(n.note)}</option>)}
            </select>
          )}
        </Field>
        <Field id={`am-field-${i}`} label={t("amend.column")}>
          {(a) => <select className={selectCls} value={c.field} {...a} onChange={(e) => { const field = e.target.value as AmendField; setLine(i, { field, to: base ? String(noteValue(base, c.note, field)) : c.to }) }}>{fieldsOf(c.note).map((f) => <option key={f} value={f}>{t(`field.${f}`)}</option>)}</select>}
        </Field>
        <div className="text-xs"><span className="text-muted-foreground">{t("amend.asFiled")}</span><span className="block h-9 content-center text-right text-sm tabular" data-testid={`am-from-${i}`}>{fmtNum(from, locale, 2)}</span></div>
        <Field id={`am-to-${i}`} label={t("amend.corrected")}>
          {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" value={c.to} data-testid={`am-to-${i}`} onChange={(e) => setLine(i, { to: e.target.value })} {...a} />}
        </Field>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("amend.removeLine", { n: i + 1 })} onClick={() => setLines((l) => l.filter((_, j) => j !== i))}><Trash2 /></Button>
        <Field id={`am-expl-${i}`} label={t("amend.explanation")} className="sm:col-span-5">
          {(a) => <Input autoComplete="off" maxLength={300} value={c.explanation} data-testid={`am-expl-${i}`} onChange={(e) => setLine(i, { explanation: e.target.value })} {...a} />}
        </Field>
        {err && <p role="alert" className="text-xs text-destructive sm:col-span-5">{err}</p>}
      </div>
    )
  }
}

type AmendAction = "file" | "approve" | "reject" | "amend"
/** /vat/return-applications/amend/[id] */
export function AmendDetailPage({ id }: { id: string }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const [tab, setTab] = React.useState("form")
  const [action, setAction] = React.useState<AmendAction | null>(null)
  const [editing, setEditing] = React.useState(false)
  const q = useQuery({ queryKey: ["amendments", "one", id], queryFn: () => api.vat.amendments.get(id) })
  const r = q.data
  const remove = useMutation({
    mutationFn: () => api.vat.amendments.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["amendments"] }); toast.success(t("deleted", { no: r?.no ?? "" })); router.push("/vat/return-applications?tab=amend") },
    onError: (e) => toast.error(e.message),
  })
  const back = <Button variant="outline" render={<Link href="/vat/return-applications?tab=amend" />}><ArrowLeft /> {t("back")}</Button>
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !r) return <EmptyState title={t("notFound")} action={back} />
  const e = r.effect
  const actions: { a: AmendAction; icon: React.ElementType; perm: "doc.create" | "doc.approve"; variant?: "outline" }[] =
    r.state === "draft" ? [{ a: "file", icon: Send, perm: "doc.create" }]
      : r.state === "filed" ? [{ a: "approve", icon: CheckCircle2, perm: "doc.approve" }, { a: "reject", icon: XCircle, perm: "doc.approve", variant: "outline" }]
        : r.state === "approved" || r.state === "deemed" ? [{ a: "amend", icon: FilePenLine, perm: "doc.approve" }] : []
  const KEY = [34, 35, 36, 37, 38, 39, 41, 42, 50, 51, 52, 53]
  return (
    <>
      <PageHeader crumbs={[{ label: t("tab.amend"), href: "/vat/return-applications?tab=amend" }, { label: r.no }]}
        title={<span className="flex flex-wrap items-center gap-2">{t("amend.detailTitle", { no: r.no })} <Pill tone={AMEND_TONE[r.state]}>{t(`amendState.${r.state}`)}</Pill></span>}
        description={t("amend.detailSub", { period: periodLabel(r.period), date: fmtDate(r.original.submissionDate, locale), ack: r.original.ackNo ?? "—" })}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setTab("form"); setTimeout(() => window.print(), 200) }}><Printer /> {tc("print")}</Button>
          <PdfButton filename={`Mushak-9.4_${r.no}`} prepare={() => setTab("form")} />
          {r.state === "draft" && can("doc.edit") && <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="amend-edit"><Pencil /> {t("edit")}</Button>}
          {actions.filter((x) => can(x.perm)).map((x) => <Button key={x.a} size="sm" variant={x.variant ?? "default"} onClick={() => setAction(x.a)} data-testid={`amend-action-${x.a}`}><x.icon /> {t(`amendAction.${x.a}`)}</Button>)}
          {r.state === "draft" && can("doc.delete") && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: t("deleteTitle", { no: r.no }), description: t("deleteBody"), confirm: t("delete"), cancel: tc("cancel"), destructive: true })) remove.mutate() }}><Trash2 /> {t("delete")}</Button>}
        </>} />
      <section aria-label={t("summary")} className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("col.deltaVat")} value={<Signed v={e.deltaVat} />} hint={t("fromTo", { from: fmtNum(e.netVatFrom, locale, 2), to: fmtNum(e.netVatTo, locale, 2) })} />
        <Fact label={t("col.deltaSd")} value={<Signed v={e.deltaSd} />} hint={t("fromTo", { from: fmtNum(e.netSdFrom, locale, 2), to: fmtNum(e.netSdTo, locale, 2) })} />
        {e.direction === "increase"
          ? <Fact label={t("toPayInterest")} value={<Money value={r.amended?.payment?.amount ?? e.toPay} />} hint={t("interestHint", { amount: fmtNum(e.interestVat + e.interestSd, locale, 2), months: e.months, date: fmtDate(e.paidOn ?? TODAY, locale) })} tone={r.state !== "amended" ? "warning" : undefined} />
          : e.direction === "decrease"
            ? <Fact label={t("decreaseAdj")} value={<Money value={e.decreaseVat + e.decreaseSd} />} hint={r.adjustPeriod ? t("inPeriod", { period: periodLabel(r.adjustPeriod) }) : t("decreaseHint", { days: AMEND_DECIDE_DAYS })} tone="success" />
            : <Fact label={t("col.effect")} value={t("noChange")} />}
        <Fact label={t("col.filed")} value={r.filedOn ? fmtDate(r.filedOn, locale) : "—"} hint={r.state === "draft" ? t("applyBy", { date: fmtDate(r.applyBy, locale) }) : r.state === "filed" && r.deemedOn ? t("deemedAfter", { date: fmtDate(r.deemedOn, locale) }) : r.state === "deemed" ? t("amend.deemedHint", { date: fmtDate(r.deemedOn!, locale) }) : r.filedRef} />
      </section>
      {r.rejectReason && <p role="note" className="no-print mb-4 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="amend-reject-reason"><span className="font-medium">{t("refused", { date: fmtDate(r.decidedOn!, locale) })}</span> {r.rejectReason}</p>}
      {r.amended && (
        <p role="note" className="no-print mb-4 rounded-md border border-success/50 bg-success-soft p-3 text-sm" data-testid="amend-done">
          {t("amend.doneNote", { date: fmtDate(r.amended.date, locale), ack: r.amended.ackNo })}
          {r.amended.payment && <> {t("amend.donePaid", { amount: fmtNum(r.amended.payment.amount, locale, 2), challan: r.amended.payment.challanNo, date: fmtDate(r.amended.payment.date, locale) })}</>}
          {r.amended.adjustmentIds?.length ? <> {t("amend.doneAdjusted", { period: periodLabel(r.adjustPeriod!) })} <Link href="/vat/adjustments" className="underline">{t("amend.viewAdjustments")}</Link></> : null}
        </p>
      )}
      {(r.state === "approved" || r.state === "deemed") && <p role="note" className="no-print mb-4 rounded-md border border-warning/60 bg-warning-soft p-3 text-sm" data-testid="amend-next">{e.direction === "increase" ? t("amend.nextIncrease", { amount: fmtNum(e.toPay, locale, 2) }) : t("amend.nextDecrease")}</p>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="no-print mb-4">
          <TabsTrigger value="form"><FileText className="size-4" aria-hidden /> {t("tabForm94")}</TabsTrigger>
          <TabsTrigger value="computation">{t("tabComputation")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="form" className="bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak94 app={r} /></TabsContent>
        <TabsContent value="computation">
          <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("tabComputation")}>
            <table className="w-full min-w-[640px] text-sm" data-testid="amend-computation">
              <caption className="sr-only">{t("tabComputation")}</caption>
              <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t("amend.note91")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("amend.asFiled")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("amend.amendedCol")}</th>
              </tr></thead>
              <tbody>
                {[...new Set([...r.corrections.map((c) => c.note), ...KEY])].sort((a, b) => a - b).map((n) => {
                  const f = fieldsOf(n).at(-1) ?? "amount"
                  const before = noteValue(r.base, n, f)
                  const after = noteValue(r.computation, n, f)
                  const d = RETURN_NOTES.find((x) => x.note === n)
                  return (
                    <tr key={n} className={cn("border-b last:border-0", Math.abs(after - before) > 0.004 && "bg-warning-soft")}>
                      <td className="px-3 py-1.5">{t("noteN", { n })} — {d ? (locale === "bn" ? d.bn : d.en) : ""}</td>
                      <td className="px-3 py-1.5 text-right tabular">{fmtNum(before, locale, 2)}</td>
                      <td className="px-3 py-1.5 text-right tabular">{fmtNum(after, locale, 2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={r.id} /></TabsContent>
      </Tabs>
      <AmendFormDialog open={editing} onOpenChange={setEditing} edit={r} />
      <AmendActionDialog app={r} action={action} onOpenChange={(o) => !o && setAction(null)} />
    </>
  )
}

function AmendActionDialog({ app: r, action, onOpenChange }: { app: ReturnAmendmentRow; action: AmendAction | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("rapp")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const periods = useQuery({ queryKey: ["vat", "periods"], queryFn: api.vat.periods, enabled: !!action })
  const adjustable = (periods.data ?? []).filter((p) => p.period > r.period && p.period <= CURRENT && p.status !== "submitted").map((p) => p.period).sort().reverse()
  const dec = r.effect.direction === "decrease", inc = r.effect.direction === "increase"
  const [v, setV] = React.useState({ date: TODAY, ref: "", reason: "", adjustPeriod: CURRENT, challanNo: "", challanDate: TODAY, amount: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (action) { setErrors({}); setV({ date: TODAY, ref: "", reason: "", adjustPeriod: r.adjustPeriod ?? CURRENT, challanNo: "", challanDate: TODAY, amount: inc ? String(r.effect.toPay) : "" }) } }, [action]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: () => api.vat.amendments.action(r.id, {
      action: action!, date: v.date, ref: v.ref || undefined, reason: v.reason || undefined,
      adjustPeriod: dec && (action === "approve" || action === "amend") ? v.adjustPeriod : undefined,
      ...(action === "amend" && inc ? { challanNo: v.challanNo, challanDate: v.challanDate, amount: v.amount ? Number(v.amount) : undefined } : {}),
    }),
    onSuccess: (x) => {
      qc.setQueryData(["amendments", "one", r.id], x); qc.invalidateQueries({ queryKey: ["amendments"] }); qc.invalidateQueries({ queryKey: ["vat"] }); qc.invalidateQueries({ queryKey: ["adjustments"] })
      toast.success(t(`amendDone.${action}`, { no: x.no })); onOpenChange(false)
    },
    onError: (e) => { if (e instanceof ApiError && e.errors) setErrors(errMap(t, e.errors)); else toast.error(e.message) },
  })
  if (!action) return null
  const body = action === "amend" ? (inc ? t("amendDialog.amend.bodyIncrease", { amount: fmtNum(r.effect.toPay, locale, 2) }) : t("amendDialog.amend.bodyDecrease")) : t(`amendDialog.${action}.body`)
  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run.mutate() }}>
          <DialogHeader><DialogTitle>{t(`amendDialog.${action}.title`, { no: r.no })}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="aa-date" label={t(`amendDialog.${action}.date`)} required error={errors.date}>{(a) => <Input type="date" max={TODAY} value={v.date} data-testid="aa-date" onChange={(e) => setV({ ...v, date: e.target.value })} {...a} />}</Field>
            {action !== "reject" && <Field id="aa-ref" label={t(`amendDialog.${action}.ref`)} error={errors.ref}>{(a) => <Input autoComplete="off" className="tabular" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} {...a} />}</Field>}
            {dec && (action === "approve" || (action === "amend" && !r.adjustPeriod)) && (
              <Field id="aa-adj" label={t("adjustPeriod")} required error={errors.adjustPeriod} hint={t("adjustHint")}>
                {(a) => <select className={selectCls} value={v.adjustPeriod} data-testid="aa-adj" onChange={(e) => setV({ ...v, adjustPeriod: e.target.value })} {...a}>{[...new Set([v.adjustPeriod, ...adjustable])].map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select>}
              </Field>
            )}
            {action === "amend" && inc && <>
              <Field id="aa-challan" label={t("challanNo")} required error={errors.challanNo}>{(a) => <Input autoComplete="off" className="tabular" value={v.challanNo} data-testid="aa-challan" onChange={(e) => setV({ ...v, challanNo: e.target.value })} {...a} />}</Field>
              <Field id="aa-cdate" label={t("challanDate")} required error={errors.challanDate} hint={t("challanHint")}>{(a) => <Input type="date" max={TODAY} value={v.challanDate} onChange={(e) => setV({ ...v, challanDate: e.target.value })} {...a} />}</Field>
              <Field id="aa-amount" label={t("deposited")} required error={errors.amount} className="sm:col-span-2" hint={t("depositHint", { amount: fmtNum(r.effect.toPay, locale, 2) })}>{(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" value={v.amount} data-testid="aa-amount" onChange={(e) => setV({ ...v, amount: e.target.value })} {...a} />}</Field>
            </>}
            {action === "reject" && <Field id="aa-reason" label={t("rejectReason")} required error={errors.reason} className="sm:col-span-2">{(a) => <Textarea rows={3} maxLength={300} value={v.reason} data-testid="aa-reason" onChange={(e) => setV({ ...v, reason: e.target.value })} {...a} />}</Field>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={action === "reject" ? "destructive" : "default"} disabled={run.isPending} data-testid="aa-submit">{run.isPending && <Loader2 className="animate-spin" />} {t(`amendAction.${action}`)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Return page: the period's 9.3 / 9.4 applications, and links to apply. */
export function ReturnAppsBanner({ period, submitted, overdue, apps }: { period: string; submitted: boolean; overdue: boolean; apps?: { late?: { id: string; no: string; state: LateFilingState; effectiveDate?: string }; amendments: { id: string; no: string; state: AmendmentState }[] } }) {
  const t = useTranslations("rapp")
  const locale = useLocale()
  const can = useCan()
  const late = apps?.late
  const open = (apps?.amendments ?? []).filter((a) => a.state !== "rejected")
  const lim = lateLimits(period)
  const canApplyLate = !submitted && !late && TODAY <= lim.applyBy && TODAY > `${period}-01`
  if (!late && !open.length && !canApplyLate && !(submitted && can("doc.create")) && !overdue) return null
  return (
    <div className="no-print mb-4 grid gap-2" data-testid="return-apps-banner">
      {late && (
        <p role="note" className={cn("rounded-md border p-3 text-sm", late.effectiveDate ? "border-success/50 bg-success-soft" : "border-info/50 bg-info-soft")}>
          <Link href={`/vat/return-applications/late/${late.id}`} className="font-medium underline">{t("banner.late", { no: late.no })}</Link>{" "}
          {late.effectiveDate ? t("banner.lateAllowed", { date: fmtDate(late.effectiveDate, locale) }) : t(`lateState.${late.state}`)}
        </p>
      )}
      {open.map((a) => (
        <p key={a.id} role="note" className="rounded-md border border-info/50 bg-info-soft p-3 text-sm">
          <Link href={`/vat/return-applications/amend/${a.id}`} className="font-medium underline">{t("banner.amend", { no: a.no })}</Link> {t(`amendState.${a.state}`)}
        </p>
      ))}
      {!late && !submitted && (canApplyLate || overdue) && can("doc.create") && (
        <p role="note" className={cn("rounded-md border p-3 text-sm", overdue ? "border-destructive/50 bg-destructive/5" : "border-warning/60 bg-warning-soft")}>
          {overdue ? t("banner.overdue") : t("banner.canApply", { date: fmtDate(lim.applyBy, locale) })}{" "}
          {canApplyLate && <Link href={`/vat/return-applications?tab=late&period=${period}`} className="font-medium underline" data-testid="return-apply-late">{t("banner.applyLate")}</Link>}
        </p>
      )}
      {submitted && can("doc.create") && !open.some((a) => a.state !== "amended") && (
        <p className="text-sm text-muted-foreground">{t("banner.amendHint")} <Link href={`/vat/return-applications?tab=amend&amend=${period}`} className="font-medium text-primary underline" data-testid="return-apply-amend">{t("banner.applyAmend")}</Link></p>
      )}
    </div>
  )
}
