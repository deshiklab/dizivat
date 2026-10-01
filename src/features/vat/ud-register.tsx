"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { toast } from "sonner"
import { BadgeCheck, CircleAlert, Download, FileCheck2, Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Pill, ProcessBadge, type Tone } from "@/components/common/status-badge"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtHs, fmtNum } from "@/lib/format"
import { UD_WARN_PCT } from "@/lib/rmg"
import { udInput } from "@/lib/schemas"
import type { BondRow, UdRow, UdState } from "@/lib/types"
import { cn } from "@/lib/utils"

type In = z.input<typeof udInput>
type Out = z.output<typeof udInput>

export const UD_TONE: Record<UdState, Tone> = { ok: "success", warn: "warning", exhausted: "info", over: "danger", expired: "danger", closed: "neutral" }
const BOND_TONE: Record<BondRow["state"], Tone> = { valid: "success", expiring: "warning", expired: "danger", missing: "danger" }
const STATES = ["all", "ok", "warn", "exhausted", "over", "expired", "closed"] as const

/** Usage bar: share of a UD line already supplied (amber from 80 %, red above 100 %). */
export function UsageBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(pct, 100))} aria-valuetext={`${fmtNum(pct, "en", 1)} %`} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", pct > 100 ? "bg-destructive" : pct >= UD_WARN_PCT ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

/**
 * R6.2 (RMG) — UD / UP register. A garment exporter's Utilization Declaration (BGMEA / BKMEA) lists the inputs it may
 * procure duty / VAT-free for one export order; our deemed-export invoices must stay inside those quantities, and the
 * exporter's bond licence must be valid. ?tab=uds|bonds, ?view=<id>, ?customer=, ?state=
 */
export function UdRegisterPage() {
  const t = useTranslations("ud")
  const tt = useTranslations("table")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("uds"))
  const [view, setView] = useQueryState("view", parseAsString)
  const [customer, setCustomer] = useQueryState("customer", parseAsString.withDefault(""))
  const [state, setState] = useQueryState("state", parseAsString.withDefault("all"))
  const [edit, setEdit] = React.useState<UdRow | "new" | null>(null)
  const q = useQuery({ queryKey: ["uds", "register"], queryFn: () => api.vat.uds.register(), placeholderData: keepPreviousData })
  const d = q.data
  const exporters = [...new Map((d?.rows ?? []).map((r) => [r.customerId, r.customerName])).entries()]
  const rows = (d?.rows ?? []).filter((r) => (!customer || r.customerId === customer) && (state === "all" || r.state === state))
  const viewing = d?.rows.find((r) => r.id === view) ?? null

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={<>
          <Button variant="outline" render={<a href={api.vat.uds.csvUrl()} download={`ud-register-${TODAY}.csv`} />}><Download /> {tt("exportCsv")}</Button>
          {can("doc.create") && <Button onClick={() => setEdit("new")}><Plus /> {t("new")}</Button>}
        </>} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("error")} hint={q.error.message} /> : d && (
        <Tabs value={tab} onValueChange={(v) => setTab(v === "uds" ? null : (v as string))} className="gap-4">
          <TabsList>
            <TabsTrigger value="uds">{t("tabUds")} <span className="ml-1 text-xs text-muted-foreground tabular">{fmtNum(d.rows.length, locale)}</span></TabsTrigger>
            <TabsTrigger value="bonds">{t("tabBonds")}{d.bonds.some((b) => b.state !== "valid") && <ShieldAlert className="ml-1 size-3.5 text-warning" aria-label={t("bondAttention")} />}</TabsTrigger>
          </TabsList>
          <TabsContent value="uds" className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat icon={BadgeCheck} label={t("totals.active")} value={d.totals.active} />
              <Stat icon={CircleAlert} label={t("totals.warn", { pct: UD_WARN_PCT })} value={d.totals.warn} tone={d.totals.warn ? "warning" : undefined} />
              <Stat icon={ShieldAlert} label={t("totals.over")} value={d.totals.over} tone={d.totals.over ? "danger" : undefined} />
              <Stat icon={FileCheck2} label={t("totals.expired")} value={d.totals.expired} tone={d.totals.expired ? "danger" : undefined} />
            </div>
            <section aria-label={t("filters")} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <label htmlFor="ud-customer" className="text-sm font-medium">{t("exporter")}</label>
                <Select value={customer || "all"} onValueChange={(v) => setCustomer(v === "all" ? null : (v as string))} items={[{ value: "all", label: t("allExporters") }, ...exporters.map(([id, name]) => ({ value: id, label: name }))]}>
                  <SelectTrigger id="ud-customer" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">{t("allExporters")}</SelectItem>{exporters.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="ud-state" className="text-sm font-medium">{t("status")}</label>
                <Select value={state} onValueChange={(v) => setState(v === "all" ? null : (v as string))} items={STATES.map((s) => ({ value: s, label: t(`state.${s}`) }))}>
                  <SelectTrigger id="ud-state" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATES.map((s) => <SelectItem key={s} value={s}>{t(`state.${s}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </section>
            <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("table")}>
              <table className="w-full min-w-[980px] text-sm">
                <caption className="sr-only">{t("table")}</caption>
                <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.no")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.exporter")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.validity")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.lc")}</th>
                  <th scope="col" className="w-[34%] px-3 py-2 font-medium">{t("col.usage")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">{t("col.actions")}</span></th>
                </tr></thead>
                <tbody>
                  {rows.length ? rows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="px-3 py-2"><button type="button" onClick={() => setView(r.id)} className="text-left font-medium text-primary tabular hover:underline">{r.no}</button><span className="block text-xs text-muted-foreground">{r.kind} · {fmtDate(r.date, locale)}</span></td>
                      <td className="px-3 py-2">{r.customerName}<span className="block text-xs text-muted-foreground tabular">BIN {r.customerBin}</span></td>
                      <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(r.expiry, locale)}<span className={cn("block text-xs", r.daysLeft < 0 ? "text-destructive" : r.daysLeft <= 30 ? "text-warning" : "text-muted-foreground")}>{r.daysLeft < 0 ? t("expiredAgo", { n: -r.daysLeft }) : t("daysLeft", { n: r.daysLeft })}</span></td>
                      <td className="px-3 py-2 tabular">{r.masterLcNo}{r.buyer && <span className="block text-xs text-muted-foreground">{r.buyer}</span>}</td>
                      <td className="px-3 py-2">
                        <ul className="grid gap-1.5">
                          {r.lines.map((l) => (
                            <li key={l.itemId} className="grid gap-0.5">
                              <span className="flex justify-between gap-2 text-xs"><span className="truncate">{l.name}</span><span className="shrink-0 tabular">{fmtNum(l.used, locale)} / {fmtNum(l.qty, locale)} {l.uom}</span></span>
                              <UsageBar pct={l.pct} label={t("usageOf", { item: l.name })} />
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-3 py-2"><Pill tone={UD_TONE[r.state]}>{t(`state.${r.state}`)}</Pill><span className="mt-1 block text-xs text-muted-foreground tabular">{t("invoices", { n: r.invoices, count: r.invoices })}</span></td>
                      <td className="px-3 py-2 text-right">{can("doc.edit") && <Button variant="ghost" size="icon-sm" aria-label={t("editOne", { no: r.no })} onClick={() => setEdit(r)}><Pencil /></Button>}</td>
                    </tr>
                  )) : <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{d.rows.length ? t("noMatch") : t("empty")}</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t("note")}</p>
          </TabsContent>
          <TabsContent value="bonds"><BondTable bonds={d.bonds} /></TabsContent>
        </Tabs>
      )}
      <UdSheet ud={viewing} onOpenChange={(o) => !o && setView(null)} onEdit={(u) => { setView(null); setEdit(u) }} />
      <UdFormSheet value={edit} onOpenChange={(o) => !o && setEdit(null)} />
    </>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone?: "warning" | "danger" }) {
  const locale = useLocale()
  return (
    <Card size="sm" className={tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : undefined}>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Icon className={cn("size-4", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden /> {label}</CardTitle></CardHeader>
      <CardContent><span className="text-2xl font-semibold tabular">{fmtNum(value, locale)}</span></CardContent>
    </Card>
  )
}

function BondTable({ bonds }: { bonds: BondRow[] }) {
  const t = useTranslations("ud")
  const locale = useLocale()
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("bondTable")}>
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">{t("bondTable")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("bond.holder")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("bond.licence")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("bond.expiry")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("bond.status")}</th>
          </tr></thead>
          <tbody>
            {bonds.length ? bonds.map((b) => (
              <tr key={`${b.kind}-${b.partyId ?? "own"}`} className="border-b last:border-0">
                <td className="px-3 py-2">
                  {b.kind === "own" ? <Link href="/vat/settings" className="font-medium text-primary hover:underline">{b.name}</Link> : <Link href={`/master/customers?edit=${b.partyId}`} className="font-medium text-primary hover:underline">{b.name}</Link>}
                  <span className="block text-xs text-muted-foreground">{t(`bond.${b.kind}`)}</span>
                </td>
                <td className="px-3 py-2 tabular">{b.licenceNo || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular">{b.expiry ? fmtDate(b.expiry, locale) : "—"}{b.daysLeft != null && <span className={cn("block text-xs", b.daysLeft < 0 ? "text-destructive" : b.state === "expiring" ? "text-warning" : "text-muted-foreground")}>{b.daysLeft < 0 ? t("expiredAgo", { n: -b.daysLeft }) : t("daysLeft", { n: b.daysLeft })}</span>}</td>
                <td className="px-3 py-2"><Pill tone={BOND_TONE[b.state]}>{t(`bond.state.${b.state}`)}</Pill></td>
              </tr>
            )) : <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">{t("bond.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("bond.note")}</p>
    </div>
  )
}

/** Read view of one UD: per-line usage with every invoice that drew on it, and the record's history. */
function UdSheet({ ud, onOpenChange, onEdit }: { ud: UdRow | null; onOpenChange: (o: boolean) => void; onEdit: (u: UdRow) => void }) {
  const t = useTranslations("ud")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const del = useMutation({
    mutationFn: (id: string) => api.vat.uds.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["uds"] }); toast.success(t("deleted")); onOpenChange(false) },
    onError: (e) => toast.error(e instanceof ApiError && e.message === "udInUse" ? t("inUse") : e.message),
  })
  const askDelete = async (u: UdRow) => {
    if (await confirm({ title: t("deleteTitle", { no: u.no }), description: t("deleteBody"), confirm: t("delete"), cancel: tc("cancel"), destructive: true })) del.mutate(u.id)
  }
  return (
    <Sheet open={!!ud} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{ud ? <>{ud.kind} {ud.no} <Pill tone={UD_TONE[ud.state]}>{t(`state.${ud.state}`)}</Pill></> : t("title")}</SheetTitle>
          <SheetDescription>{ud ? `${ud.customerName} · ${fmtDate(ud.date, locale)} – ${fmtDate(ud.expiry, locale)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {ud && (
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t("col.exporter")}</dt><dd>{ud.customerName} <span className="text-xs text-muted-foreground tabular">· BIN {ud.customerBin}</span></dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("col.lc")}</dt><dd className="tabular">{ud.masterLcNo}{ud.buyer ? ` · ${ud.buyer}` : ""}</dd></div>
              {ud.note && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">{t("field.note")}</dt><dd>{ud.note}</dd></div>}
            </dl>
            {ud.lines.map((l) => (
              <section key={l.itemId} className="grid gap-2 rounded-md border p-3" aria-label={l.name}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{l.name} <span className="font-normal text-muted-foreground tabular">· HS {fmtHs(l.hsCode)}</span></h3>
                  <span className="text-sm tabular">{fmtNum(l.used, locale)} / {fmtNum(l.qty, locale)} {l.uom} <span className="text-muted-foreground">({fmtNum(l.pct, locale, 1)} %)</span></span>
                </div>
                <UsageBar pct={l.pct} label={t("usageOf", { item: l.name })} />
                <p className="text-xs text-muted-foreground">{t("remaining", { qty: fmtNum(l.remaining, locale), uom: l.uom })}</p>
                {l.uses.length > 0 && (
                  <ul className="grid gap-1 text-sm">
                    {l.uses.map((u) => (
                      <li key={u.saleId} className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/sales/${u.saleId}`} className="font-medium text-primary tabular hover:underline">{u.invoiceNo}</Link>
                        <span className="text-xs text-muted-foreground">{fmtDate(u.date, locale)}</span>
                        <ProcessBadge value={u.process} />
                        <span className="tabular">{fmtNum(u.qty, locale)} {l.uom}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <RecordHistory entityId={ud.id} compact />
          </div>
        )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {ud && can("doc.delete") && ud.invoices === 0 && <Button variant="outline" disabled={del.isPending} onClick={() => askDelete(ud)}><Trash2 /> {t("delete")}</Button>}
          {ud && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(ud)}><Pencil /> {t("edit")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

const blank = (): In => ({ kind: "UD", no: "", date: TODAY, customerId: "", masterLcNo: "", buyer: "", expiry: "", note: "", status: "active", lines: [{ itemId: "", qty: 0 }] })

/** Create / amend a UD or UP. */
function UdFormSheet({ value, onOpenChange }: { value: UdRow | "new" | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("ud")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const ud = value && value !== "new" ? value : null
  const customers = useQuery({ queryKey: ["customers", "options"], queryFn: () => api.customers.options(), enabled: !!value, staleTime: 60_000 })
  const items = useQuery({ queryKey: ["items", "book-options"], queryFn: () => api.items.list({ size: 500 }), enabled: !!value, staleTime: 60_000 })
  const exporters = (customers.data ?? []).filter((c) => c.exporterType)
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(udInput), defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  const lines = useFieldArray({ control, name: "lines" })
  React.useEffect(() => {
    if (!value) return
    reset(ud ? { kind: ud.kind, no: ud.no, date: ud.date, customerId: ud.customerId, masterLcNo: ud.masterLcNo, buyer: ud.buyer ?? "", expiry: ud.expiry, note: ud.note ?? "", status: ud.status, lines: ud.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) } : blank())
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (v: Out) => (ud ? api.vat.uds.update(ud.id, v) : api.vat.uds.create(v)),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["uds"] }); qc.invalidateQueries({ queryKey: ["vat", "exports"] }); toast.success(ud ? t("saved", { no: r.no }) : t("created", { no: r.no })); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const usedOf = (itemId: string) => ud?.lines.find((l) => l.itemId === itemId)?.used ?? 0
  const itemOptions = (items.data?.data ?? []).map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${fmtHs(i.hsCode)} · ${i.unit}`, keywords: [i.sku, i.hsCode] }))

  return (
    <Sheet open={!!value} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{ud ? t("editTitle", { no: ud.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("formSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="ud-kind" label={t("field.kind")} required>
              {(a) => <Controller control={control} name="kind" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as In["kind"])} items={[{ value: "UD", label: t("kind.UD") }, { value: "UP", label: t("kind.UP") }]}>
                  <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="UD">{t("kind.UD")}</SelectItem><SelectItem value="UP">{t("kind.UP")}</SelectItem></SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="ud-no" label={t("field.no")} required error={errors.no?.message} hint={t("hint.no")}>
              {(a) => <Input autoComplete="off" className="uppercase tabular" {...a} {...register("no")} />}
            </Field>
            <Field id="ud-customer" label={t("field.customer")} required error={errors.customerId?.message} hint={exporters.length ? undefined : t("hint.noExporters")} className="sm:col-span-2">
              {(a) => <Controller control={control} name="customerId" render={({ field }) => (
                <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value} onChange={field.onChange}
                  options={exporters.map((c) => ({ value: c.id, label: c.name, description: `BIN ${c.bin}${c.bondLicenseNo ? ` · ${c.bondLicenseNo}` : ""}`, keywords: [c.bin] }))}
                  placeholder={t("pickExporter")} searchPlaceholder={t("searchExporter")} empty={t("noExporters")} />
              )} />}
            </Field>
            <Field id="ud-date" label={t("field.date")} required error={errors.date?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("date")} />}</Field>
            <Field id="ud-expiry" label={t("field.expiry")} required error={errors.expiry?.message}>{(a) => <Input type="date" {...a} {...register("expiry")} />}</Field>
            <Field id="ud-lc" label={t("field.masterLc")} required error={errors.masterLcNo?.message}>{(a) => <Input autoComplete="off" className="tabular" {...a} {...register("masterLcNo")} />}</Field>
            <Field id="ud-buyer" label={t("field.buyer")} error={errors.buyer?.message}>{(a) => <Input autoComplete="off" {...a} {...register("buyer")} />}</Field>
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">{t("field.lines")}<span className="text-destructive" aria-hidden> *</span></legend>
              {lines.fields.map((f, i) => {
                const le = errors.lines?.[i]
                return (
                  <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-start gap-2">
                    <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                      <div className="grid gap-1">
                        <Combobox ariaLabel={t("lineItem", { n: i + 1 })} invalid={!!le?.itemId} value={field.value} onChange={field.onChange} options={itemOptions} placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={tc("noResults")} />
                        {le?.itemId?.message && <p role="alert" className="text-xs font-medium text-destructive">{t(`err.${le.itemId.message}`)}</p>}
                      </div>
                    )} />
                    <div className="grid gap-1">
                      <Input type="number" inputMode="decimal" step="any" min={0} aria-label={t("lineQty", { n: i + 1 })} aria-invalid={!!le?.qty || undefined} className="text-right tabular" {...register(`lines.${i}.qty`, { valueAsNumber: true })} />
                      {usedOf(form.getValues(`lines.${i}.itemId`)) > 0 && <p className="text-right text-xs text-muted-foreground">{t("usedHint", { qty: fmtNum(usedOf(form.getValues(`lines.${i}.itemId`)), locale) })}</p>}
                      {le?.qty?.message && <p role="alert" className="text-xs font-medium text-destructive">{t(`err.${le.qty.message}`)}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine", { n: i + 1 })} disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}><Trash2 /></Button>
                  </div>
                )
              })}
              {(errors.lines?.message || errors.lines?.root?.message) && <p role="alert" className="text-xs font-medium text-destructive">{t(`err.${errors.lines?.message ?? errors.lines?.root?.message}`)}</p>}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => lines.append({ itemId: "", qty: 0 })}><Plus /> {t("addLine")}</Button>
            </fieldset>
            <Field id="ud-status" label={t("field.status")}>
              {(a) => <Controller control={control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as "active" | "closed")} items={[{ value: "active", label: t("statusActive") }, { value: "closed", label: t("state.closed") }]}>
                  <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">{t("statusActive")}</SelectItem><SelectItem value="closed">{t("state.closed")}</SelectItem></SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="ud-note" label={t("field.note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>
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
