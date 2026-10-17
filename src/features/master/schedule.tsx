"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { CalendarClock, FileSpreadsheet, Inbox, Loader2, Pencil, Play, Plus, Printer, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Field } from "@/components/common/field"
import { Pill } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { RequirePerm } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import { deliveryInput } from "@/lib/schemas"
import { REMINDER_KINDS } from "@/lib/schedule"
import type { DeliveryLogRow, DeliverySchedule, ReminderSettings } from "@/lib/types"

/**
 * R8.3: the statutory reminder settings (which deadlines, how far ahead), the delivery schedules (which report,
 * how often, to whom) and the log of what has been delivered, with the frozen figures each report carried. "Run
 * now" is the same tick a cron line calls once a day — idempotent, so pressing it twice changes nothing.
 */
export function SchedulePage() {
  return <RequirePerm perm="settings.manage" back="/master/company"><Schedule /></RequirePerm>
}

function Schedule() {
  const t = useTranslations("schedule")
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ["schedule", "settings"], queryFn: api.schedule.settings })
  const deliveries = useQuery({ queryKey: ["schedule", "deliveries"], queryFn: api.schedule.deliveries })
  const log = useQuery({ queryKey: ["schedule", "log"], queryFn: () => api.schedule.log({ size: 25 }) })
  const tick = useMutation({
    mutationFn: api.schedule.tick,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["schedule"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["audit"] })
      toast.success(r.fired.length || r.delivered.length ? t("ran", { reminders: r.fired.length, reports: r.delivered.length }) : t("ranNothing"))
    },
    onError: (e) => toast.error(e.message),
  })
  const [viewing, setViewing] = React.useState<DeliveryLogRow | null>(null)

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={<Button disabled={tick.isPending} onClick={() => tick.mutate()} data-testid="run-now">{tick.isPending ? <Loader2 className="animate-spin" /> : <Play />} {t("runNow")}</Button>} />
      {settings.isLoading || deliveries.isLoading ? <Skeleton className="h-96" /> : settings.error ? <EmptyState title={t("error")} hint={settings.error.message} /> : (
        <div className="grid gap-4">
          <ReminderCards initial={settings.data} />
          <DeliverySection rows={deliveries.data?.rows ?? []} />
          <LogSection page={log.data} onView={setViewing} />
          <p className="text-xs text-muted-foreground">{t("runHint")}</p>
          <p className="text-xs text-muted-foreground">{t("cronHint")}</p>
        </div>
      )}
      <DocumentDialog row={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

/* ── the reminder settings ─────────────────────────────────────────────── */

/** Local editable copy of the three deadline cards; one PUT saves them together. */
function ReminderCards({ initial }: { initial?: ReminderSettings }) {
  const t = useTranslations("schedule")
  const qc = useQueryClient()
  const [draft, setDraft] = React.useState<ReminderSettings | null>(null)
  React.useEffect(() => { if (initial && !draft) setDraft(structuredClone(initial)) }, [initial, draft])
  const save = useMutation({
    mutationFn: (v: ReminderSettings) => api.schedule.putSettings(v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedule"] }); qc.invalidateQueries({ queryKey: ["audit"] }); toast.success(t("saved")) },
    onError: (e) => toast.error(e.message),
  })
  if (!draft) return null
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = (kind: (typeof REMINDER_KINDS)[number], patch: Partial<ReminderSettings[typeof kind]>) =>
    setDraft({ ...draft, [kind]: { ...draft[kind], ...patch } })
  const leads = (kind: (typeof REMINDER_KINDS)[number]) => draft[kind].leads.join(", ")
  return (
    <section aria-labelledby="reminders-h" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="reminders-h" className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" aria-hidden /> {t("reminders.title")}</h2>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} data-testid="save-reminders">{save.isPending && <Loader2 className="animate-spin" />} {t("reminders.save")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("reminders.hint")}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {REMINDER_KINDS.map((kind) => (
          <Card key={kind} size="sm" data-testid={`reminder-${kind}`}>
            <CardHeader><CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span>{t(`reminders.kind.${kind}.label`)}</span>
              <Switch checked={draft[kind].enabled} onCheckedChange={(v) => set(kind, { enabled: v })} aria-label={t("reminders.enabled")} />
            </CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <p className="text-xs text-muted-foreground">{t(`reminders.kind.${kind}.hint`)}</p>
              <Label htmlFor={`leads-${kind}`}>{t("reminders.leads")}</Label>
              <Input id={`leads-${kind}`} inputMode="numeric" disabled={!draft[kind].enabled} value={leads(kind)}
                onChange={(e) => set(kind, { leads: e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 1) })}
                aria-invalid={draft[kind].enabled && !draft[kind].leads.length} />
              {!draft[kind].leads.length && draft[kind].enabled && <p className="text-xs text-destructive">{t("reminders.noLeads")}</p>}
              {draft[kind].leads.length > 5 && <p className="text-xs text-destructive">{t("validation.tooMany")}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/* ── the delivery schedules ────────────────────────────────────────────── */

function DeliverySection({ rows }: { rows: DeliverySchedule[] }) {
  const t = useTranslations("schedule")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [editing, setEditing] = React.useState<DeliverySchedule | "new" | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.schedule.deleteDelivery(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["schedule"] }); qc.invalidateQueries({ queryKey: ["audit"] }); toast.success(t("deliveries.deleted")) },
    onError: (e) => toast.error(e.message),
  })
  const users = useQuery({ queryKey: ["users", { size: 100 }], queryFn: () => api.users.list({ size: 100 }) })
  const nameOf = (id: string) => users.data?.data.find((u) => u.id === id)?.name ?? id
  return (
    <section aria-labelledby="deliveries-h" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deliveries-h" className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet className="size-4" aria-hidden /> {t("deliveries.title")}</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")} data-testid="new-delivery"><Plus /> {t("deliveries.add")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("deliveries.hint")}</p>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("deliveries.title")}>
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">{t("deliveries.title")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("deliveries.col.kind")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("deliveries.col.frequency")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("deliveries.col.recipients")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("deliveries.col.next")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("deliveries.col.enabled")}</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">{t("deliveries.col.actions")}</span></th>
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b last:border-0" data-testid={`delivery-${s.id}`}>
                <td className="px-3 py-2 font-medium">{t(`report.${s.kind}`)}{s.note && <span className="block text-xs font-normal text-muted-foreground">{s.note}</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap">{t(`frequency.${s.frequency}`)} · {s.frequency === "monthly" ? fmtNum(s.day, locale) : t(`weekdays.${s.day - 1}`)}</td>
                <td className="px-3 py-2">{s.recipients.map((r) => nameOf(r)).join(", ")}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(s.nextRun, locale)}{s.lastRun && <span className="block text-xs text-muted-foreground">{t("last", { date: fmtDate(s.lastRun, locale) })}</span>}</td>
                <td className="px-3 py-2">{s.enabled ? <Pill tone="success">{t("deliveries.enabled")}</Pill> : <Pill tone="neutral">{t("deliveries.disabled")}</Pill>}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={t("deliveries.edit")}><Pencil /></Button>
                  <Button variant="ghost" size="sm" disabled={remove.isPending}
                    onClick={() => confirm({ title: t("deliveries.deleteOne"), confirm: tc("delete"), cancel: tc("cancel"), destructive: true }).then((ok) => ok && remove.mutate(s.id))}
                    aria-label={tc("delete")}><Trash2 /></Button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{t("deliveries.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <DeliverySheet open={editing !== null} row={editing === "new" ? null : editing} onOpenChange={(o) => !o && setEditing(null)} />
    </section>
  )
}

/** zod's own message keys (required / tooMany / weekday) → the section's validation texts; anything else shows as-is. */
function useValidationText() {
  const t = useTranslations("schedule")
  return React.useCallback((msg: string | undefined) => {
    if (!msg) return undefined
    return ["required", "tooMany", "weekday"].includes(msg) ? t(`validation.${msg}`) : msg
  }, [t])
}

type DeliveryIn = z.input<typeof deliveryInput>

const BLANK: DeliveryIn = { kind: "vatDigest", frequency: "monthly", day: 20, recipients: [], enabled: true, note: "" }

function DeliverySheet({ open, row, onOpenChange }: { open: boolean; row: DeliverySchedule | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("schedule")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ["users", { size: 100 }], queryFn: () => api.users.list({ size: 100 }) })
  const form = useForm<DeliveryIn, unknown, z.output<typeof deliveryInput>>({ resolver: zodResolver(deliveryInput), defaultValues: BLANK, mode: "onTouched" })
  const valid = useValidationText()
  const { register, control, handleSubmit, reset, watch, setError, formState: { errors } } = form
  React.useEffect(() => { if (open) reset(row ? { kind: row.kind, frequency: row.frequency, day: row.day, recipients: row.recipients, enabled: row.enabled, note: row.note ?? "" } : BLANK) }, [open, row, reset])
  const save = useMutation({
    mutationFn: (v: z.output<typeof deliveryInput>) => (row ? api.schedule.putDelivery(row.id, v) : api.schedule.createDelivery(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule"] }); qc.invalidateQueries({ queryKey: ["audit"] })
      toast.success(row ? t("deliveries.updated") : t("deliveries.created"))
      onOpenChange(false)
    },
    onError: (e) => { if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] })); else toast.error(e.message) },
  })
  const frequency = watch("frequency")
  const active = (users.data?.data ?? []).filter((u) => u.active)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{row ? t("deliveries.edit") : t("deliveries.add")}</SheetTitle>
            <SheetDescription>{row ? t(`report.${row.kind}`) : t("deliveries.hint")}</SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 content-start gap-4 overflow-y-auto p-4">
            <Field id="kind" label={t("deliveries.kind")} required error={errors.kind?.message}>
              {(a) => <Controller control={control} name="kind" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!!row} items={(["vatDigest", "receivablesDigest"] as const).map((k) => ({ value: k, label: t(`report.${k}`) }))}>
                  <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{(["vatDigest", "receivablesDigest"] as const).map((k) => <SelectItem key={k} value={k}>{t(`report.${k}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="frequency" label={t("deliveries.col.frequency")} required error={errors.frequency?.message}>
                {(a) => <Controller control={control} name="frequency" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} items={(["monthly", "weekly"] as const).map((f) => ({ value: f, label: t(`frequency.${f}`) }))}>
                    <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                    <SelectContent>{(["monthly", "weekly"] as const).map((f) => <SelectItem key={f} value={f}>{t(`frequency.${f}`)}</SelectItem>)}</SelectContent>
                  </Select>
                )} />}
              </Field>
              <Field id="day" label={frequency === "monthly" ? t("monthlyDay") : t("weekday")} required error={valid(errors.day?.message)}>
                {(a) => <Controller control={control} name="day" render={({ field }) => (
                  frequency === "monthly"
                    ? <Input id={a.id} type="number" min={1} max={28} value={field.value} onChange={(e) => field.onChange(Number(e.target.value))} aria-describedby={a["aria-describedby"]} />
                    : <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))} items={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t(`weekdays.${d - 1}`) }))}>
                      <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]}><SelectValue /></SelectTrigger>
                      <SelectContent>{[1, 2, 3, 4, 5, 6, 7].map((d) => <SelectItem key={d} value={String(d)}>{t(`weekdays.${d - 1}`)}</SelectItem>)}</SelectContent>
                    </Select>
                )} />}
              </Field>
            </div>
            <Field id="recipients" label={t("deliveries.recipients")} required error={errors.recipients?.message && t("deliveries.pickRecipients")}>
              {() => (
                <div className="grid gap-1.5 rounded-md border p-3">
                  {active.map((u) => <Controller key={u.id} control={control} name="recipients" render={({ field }) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={field.value.includes(u.id)} onCheckedChange={(c) => field.onChange(c ? [...field.value, u.id] : field.value.filter((x) => x !== u.id))} />
                      {u.name} <span className="text-xs text-muted-foreground">{u.designation}</span>
                    </label>
                  )} />)}
                  {!active.length && <p className="text-xs text-muted-foreground">{t("deliveries.pickRecipients")}</p>}
                </div>
              )}
            </Field>
            <Field id="note" label={t("deliveries.note")} error={errors.note?.message} className="sm:col-span-2">
              {(a) => <Input maxLength={250} placeholder={t("deliveries.notePh")} {...a} {...register("note")} />}
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <Label htmlFor="enabled">{t("deliveries.enabled")}</Label>
              <Controller control={control} name="enabled" render={({ field }) => <Switch id="enabled" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {tc("save")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/* ── the delivery log ──────────────────────────────────────────────────── */

function LogSection({ page, onView }: { page?: { data: DeliveryLogRow[] }; onView: (r: DeliveryLogRow) => void }) {
  const t = useTranslations("schedule")
  const locale = useLocale()
  const users = useQuery({ queryKey: ["users", { size: 100 }], queryFn: () => api.users.list({ size: 100 }) })
  const nameOf = (id: string) => users.data?.data.find((u) => u.id === id)?.name ?? id
  return (
    <section aria-labelledby="log-h" className="grid gap-3">
      <h2 id="log-h" className="flex items-center gap-2 text-sm font-semibold"><Inbox className="size-4" aria-hidden /> {t("log.title")}</h2>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("log.title")}>
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">{t("log.title")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("log.col.at")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("log.col.kind")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("log.col.period")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("log.col.recipients")}</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">{t("log.col.actions")}</span></th>
          </tr></thead>
          <tbody>
            {(page?.data ?? []).map((l) => (
              <tr key={l.id} data-testid={`log-${l.id}`}>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(l.generatedAt, locale)}</td>
                <td className="px-3 py-2">{t(`report.${l.kind}`)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.kind === "vatDigest" && l.period ? periodLabel(l.period) : fmtDate(l.asOf, locale)}</td>
                <td className="px-3 py-2">{t("log.nRecipients", { n: l.recipients.length })}<span className="block text-xs text-muted-foreground">{l.recipients.map(nameOf).join(", ")}</span></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => onView(l)}><Inbox /> {t("log.view")}</Button>
                </td>
              </tr>
            ))}
            {!page?.data.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{t("log.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ── the delivered document ────────────────────────────────────────────── */

/** The frozen figures a delivered report carried — what the recipients saw when it arrived. */
function DocumentDialog({ row, onClose }: { row: DeliveryLogRow | null; onClose: () => void }) {
  const t = useTranslations("schedule")
  const locale = useLocale()
  const doc = row?.document
  const row_ = (label: string, v: string | number, key?: string) => (
    <div key={key} className="grid grid-cols-2 gap-2 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular">{typeof v === "number" ? fmtNum(v, locale, 2) : v}</span>
    </div>
  )
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {row && doc && (
          <>
            <DialogHeader>
              <DialogTitle>{t("log.document")}</DialogTitle>
              <DialogDescription>{t(`report.${row.kind}`)} · {row.kind === "vatDigest" && row.period ? periodLabel(row.period) : fmtDate(row.asOf, locale)} · {fmtDateTime(row.generatedAt, locale)}</DialogDescription>
            </DialogHeader>
            <div data-testid="delivery-document">
              {doc.kind === "vatDigest" ? (
                <>
                  {row_(t("doc.vatDigest.period"), periodLabel(doc.period), "period")}
                  {row_(t("doc.vatDigest.status"), t(`docStatus.${doc.status}`), "status")}
                  {row_(t("doc.vatDigest.due"), fmtDate(doc.due, locale), "due")}
                  {doc.submittedAt && row_(t("doc.vatDigest.submitted"), fmtDate(doc.submittedAt, locale), "submitted")}
                  {row_(t("doc.vatDigest.outputVat"), doc.outputVat, "output")}
                  {row_(t("doc.vatDigest.inputVat"), doc.inputVat, "input")}
                  {row_(t("doc.vatDigest.netVat"), doc.netVat, "net")}
                  {row_(t("doc.vatDigest.payableVat"), doc.payableVat, "payableVat")}
                  {row_(t("doc.vatDigest.payableSd"), doc.payableSd, "payableSd")}
                  {row_(t("doc.vatDigest.depositedVat"), doc.depositedVat, "deposited")}
                  {row_(t("doc.vatDigest.shortfall"), doc.shortVat, "short")}
                  {row_(t("doc.vatDigest.closingVat"), doc.closingVat, "closing")}
                  {row_(t("doc.vatDigest.deposits"), doc.deposits.count, "deposits")}
                  {row_(t("doc.vatDigest.vdsIssued"), doc.vdsIssued.count, "vds")}
                </>
              ) : (
                <>
                  {row_(t("doc.receivablesDigest.asOf"), fmtDate(doc.asOf, locale), "asOf")}
                  {row_(t("doc.receivablesDigest.invoices"), doc.invoices.count, "count")}
                  {row_(t("doc.receivablesDigest.amount"), doc.invoices.amount, "amount")}
                  {row_(t("doc.receivablesDigest.d0_30"), doc.ageing.d0_30, "d0")}
                  {row_(t("doc.receivablesDigest.d31_60"), doc.ageing.d31_60, "d31")}
                  {row_(t("doc.receivablesDigest.d61_90"), doc.ageing.d61_90, "d61")}
                  {row_(t("doc.receivablesDigest.d90"), doc.ageing.d90, "d90")}
                  {row_(t("doc.receivablesDigest.advances"), doc.advances, "advances")}
                  {doc.top.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("doc.receivablesDigest.top")}</p>
                      {doc.top.map((x) => row_(x.name, x.amount, x.partyId))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" render={<a href={api.schedule.documentUrl(row.id, "csv")} download aria-label={t("log.download")} />}><FileSpreadsheet /> {t("log.download")}</Button>
              <Button variant="outline" size="sm" render={<a href={api.schedule.documentUrl(row.id, "html")} target="_blank" rel="noopener" aria-label={t("log.print")} />}><Printer /> {t("log.print")}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
