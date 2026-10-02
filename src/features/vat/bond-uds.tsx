"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, BadgeCheck, ClipboardCheck, Download, FileText, Loader2, Pencil, Plus, Printer, Stamp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { PdfButton } from "@/components/common/pdf-button"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { UdSettlementStatement } from "@/features/vat/ud-settlement-statement"
import { ProceedsList } from "@/features/vat/prc-matching"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtHs, fmtMoney, fmtNum } from "@/lib/format"
import { bondUdInput } from "@/lib/schemas"
import type { BondUdRow, BondUdState } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATE_TONE: Record<BondUdState, Tone> = { inProgress: "info", ready: "warning", settled: "success" }
const qty = (n: number, locale: string) => fmtNum(n, locale, 3)
const udHref = (u: { id: string }) => `/vat/bond-consumption/uds/${u.id}`

/** Shipment progress — completion is good news, so one neutral colour (unlike the UD usage bar). */
function ShipBar({ pct, label }: { pct: number; label: string }) {
  const v = Math.max(0, Math.min(100, pct))
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  )
}

/** "UD settlement" tab of the bond page: our own UDs / UP and where each stands. */
export function BondUdsTab() {
  const t = useTranslations("budr")
  const locale = useLocale()
  const can = useCan()
  const [form, setForm] = React.useState<BondUdRow | "new" | null>(null)
  const q = useQuery({ queryKey: ["bondUds"], queryFn: () => api.vat.bondUds.register() })
  const d = q.data
  if (q.isLoading) return <Skeleton className="h-72" />
  if (q.error || !d) return <EmptyState title={t("error")} hint={q.error?.message} />
  return (
    <div className="grid gap-3">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn("rounded-md border bg-card p-3", d.totals.ready ? "border-warning/60" : "")} data-testid="bud-ready"><dt className="text-xs text-muted-foreground">{t("tot.ready")}</dt><dd className="mt-1 text-lg font-semibold tabular">{fmtNum(d.totals.ready, locale)}</dd></div>
        <div className="rounded-md border bg-card p-3"><dt className="text-xs text-muted-foreground">{t("tot.inProgress")}</dt><dd className="mt-1 text-lg font-semibold tabular">{fmtNum(d.totals.inProgress, locale)}</dd></div>
        <div className="rounded-md border bg-card p-3"><dt className="text-xs text-muted-foreground">{t("tot.dutyOnBalance")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.totals.dutyOnBalance} /></dd></div>
        <div className="rounded-md border bg-card p-3"><dt className="text-xs text-muted-foreground">{t("tot.dutyPaid", { n: d.totals.settled })}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.totals.dutyPaid} /></dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" render={<a href={api.vat.bondUds.csvUrl()} download={`ud-settlement-${TODAY}.csv`} />}><Download /> {t("csv")}</Button>
          {can("doc.create") && <Button size="sm" onClick={() => setForm("new")} data-testid="bud-new"><Plus /> {t("new")}</Button>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("table")}>
        <table className="w-full min-w-[1000px] text-sm">
          <caption className="sr-only">{t("table")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.ud")}</th>
            <th scope="col" className="w-[22%] px-3 py-2 font-medium">{t("col.shipped")}</th>
            <th scope="col" className="w-[30%] px-3 py-2 font-medium">{t("col.inputs")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.duty")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
          </tr></thead>
          <tbody>
            {d.rows.length ? d.rows.map((u) => (
              <tr key={u.id} className="border-b align-top last:border-0" data-testid={`bud-row-${u.id}`}>
                <td className="px-3 py-2">
                  <Link href={udHref(u)} className="font-medium text-primary tabular underline underline-offset-2">{u.no}</Link>
                  <span className="block text-xs text-muted-foreground">{t(`issuer.${u.issuer}`)} · {u.masterLcNo}</span>
                  <span className={cn("block text-xs", !u.settlement && u.daysLeft < 0 ? "text-warning" : "text-muted-foreground")}>{t("expiry", { date: fmtDate(u.expiry, locale) })}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs tabular">{u.garmentsProgress.map((g) => `${qty(g.shipped, locale)} / ${qty(g.ordered, locale)} ${g.uom}`).join(" · ")}</span>
                  <ShipBar pct={u.shippedPct} label={t("col.shipped")} />
                </td>
                <td className="px-3 py-2 text-xs">
                  <ul className="grid gap-0.5">
                    {u.lines.map((l) => (
                      <li key={l.itemId}><span className="font-medium">{l.name}</span> · <span className="tabular">{t("lineSummary", { imp: qty(l.available, locale), used: qty(l.consumed, locale), bal: qty(l.balance, locale), uom: l.uom })}</span>
                        {l.excessImport > 0 && <span className="block font-medium text-warning">{t("excess", { qty: qty(l.excessImport, locale), uom: l.uom })}</span>}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2 text-right">{u.settlement ? <span className="text-xs text-muted-foreground">{t("paid")} <Money value={u.settlement.dutyPaid} muted0={false} /></span> : <Money value={u.dutyOnBalance} />}</td>
                <td className="px-3 py-2">
                  <Pill tone={STATE_TONE[u.state]}>{t(`state.${u.state}`)}</Pill>
                  {u.settlement && <span className="mt-1 block text-xs text-muted-foreground tabular">{fmtDate(u.settlement.date, locale)}</span>}
                  {u.warnings.filter((w) => w !== "expired").map((w) => <span key={w} className="mt-1 flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3" aria-hidden /> {t(`warn.${w}`)}</span>)}
                </td>
              </tr>
            )) : <tr><td colSpan={5} className="px-3 py-10"><EmptyState icon={ClipboardCheck} title={t("empty")} hint={t("emptyHint")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      <BondUdFormSheet value={form} onOpenChange={(o) => !o && setForm(null)} />
    </div>
  )
}

/** /vat/bond-consumption/uds/[id] — statement, shipments, settlement and the printable settlement statement. */
export function BondUdDetailPage({ id }: { id: string }) {
  const t = useTranslations("budr")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState("statement")
  const [edit, setEdit] = React.useState<BondUdRow | null>(null)
  const [settle, setSettle] = React.useState(false)
  const q = useQuery({ queryKey: ["bondUds", "one", id], queryFn: () => api.vat.bondUds.get(id) })
  const u = q.data
  const back = <Button variant="outline" render={<Link href="/vat/bond-consumption?tab=uds" />}><ArrowLeft /> {t("back")}</Button>
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !u) return <EmptyState title={t("notFound")} action={back} />
  const s = u.settlement
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/vat/bond-consumption?tab=uds" }, { label: u.no }]}
        title={<span className="flex flex-wrap items-center gap-2">{u.no} <Pill tone={STATE_TONE[u.state]}>{t(`state.${u.state}`)}</Pill></span>}
        description={t("detailSub", { kind: t(`kind.${u.kind}`), issuer: t(`issuer.${u.issuer}`), lc: u.masterLcNo, buyer: u.buyer ?? "—" })}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setTab("statement"); setTimeout(() => window.print(), 200) }}><Printer /> {tc("print")}</Button>
          <PdfButton filename={`UD-settlement_${u.no}`} prepare={() => setTab("statement")} />
          {!s && can("doc.edit") && <Button variant="outline" size="sm" onClick={() => setEdit(u)}><Pencil /> {t("edit")}</Button>}
          {u.state === "ready" && can("doc.approve") && <Button size="sm" onClick={() => setSettle(true)} data-testid="bud-settle"><Stamp /> {t("settle")}</Button>}
        </>}
      />
      <div className="no-print mb-4 grid gap-3">
        {u.state === "inProgress" && <p role="note" className="rounded-md border bg-card p-3 text-sm text-muted-foreground">{t("notReady", { pct: fmtNum(u.shippedPct, locale, 1), date: fmtDate(u.expiry, locale) })}</p>}
        {u.warnings.length > 0 && (
          <ul className="grid gap-1 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm" aria-label={t("warnings")} data-testid="bud-warnings">
            {u.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {t(`warnLong.${w}`, { drafts: u.drafts, date: fmtDate(u.expiry, locale), pending: u.proceeds?.pending ?? 0, overdue: u.proceeds?.overdue ?? 0 })}</li>)}
          </ul>
        )}
        <section aria-labelledby="bud-ship-h" className="grid gap-2 rounded-lg border bg-card p-4">
          <h2 id="bud-ship-h" className="text-sm font-semibold">{t("shipments")}</h2>
          {u.garmentsProgress.map((g) => (
            <div key={g.itemId} className="grid gap-1">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{g.name}</span><span className="tabular">{qty(g.shipped, locale)} / {qty(g.ordered, locale)} {g.uom} ({fmtNum(g.pct, locale, 1)} %)</span></div>
              <ShipBar pct={g.pct} label={g.name} />
              {g.exports.length > 0 && <p className="text-xs text-muted-foreground">{g.exports.map((x, i) => <React.Fragment key={x.saleId}>{i > 0 && ", "}<Link href={`/sales/${x.saleId}`} className="text-primary tabular underline underline-offset-2">{x.invoiceNo}</Link> ({fmtDate(x.date, locale)} · {qty(x.qty, locale)}{x.deemed ? ` · ${t("deemed")}` : ""})</React.Fragment>)}</p>}
            </div>
          ))}
        </section>
        {u.proceeds && <ProceedsList p={u.proceeds} note={t("proceedsNote")} />}
        {s && (
          <section aria-labelledby="bud-set-h" className="grid gap-1 rounded-lg border border-success/50 bg-card p-4 text-sm" data-testid="bud-settlement">
            <h2 id="bud-set-h" className="flex items-center gap-2 text-sm font-semibold"><BadgeCheck className="size-4 text-success" aria-hidden /> {t("settledTitle", { date: fmtDate(s.date, locale) })}</h2>
            <p>{t("settledRef", { ref: s.bondRef, by: s.by })}{s.paymentRef ? ` · ${t("paymentRef", { ref: s.paymentRef })}` : ""}</p>
            {s.lines.filter((l) => l.dutyPaidQty > 0 || l.carryQty > 0).map((l) => (
              <p key={l.itemId} className="text-muted-foreground">{l.name}: {l.dutyPaidQty > 0 && t("clearedOnDuty", { qty: qty(l.dutyPaidQty, locale), uom: l.uom, amount: fmtNum(l.dutyPaid, locale, 2) })}{l.dutyPaidQty > 0 && l.carryQty > 0 && " · "}{l.carryQty > 0 && t("carriedTo", { qty: qty(l.carryQty, locale), uom: l.uom, to: l.carryTo ?? "" })}</p>
            ))}
            <p className="font-medium">{t("dutyPaidTotal")} <Money value={s.dutyPaid} muted0={false} /></p>
            {s.note && <p className="text-muted-foreground">{s.note}</p>}
          </section>
        )}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="no-print mb-4">
          <TabsTrigger value="statement"><FileText className="size-4" aria-hidden /> {t("tabStatement")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="statement" className="bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><UdSettlementStatement ud={u} /></TabsContent>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={u.id} /></TabsContent>
      </Tabs>
      <BondUdFormSheet value={edit} onOpenChange={(o) => !o && setEdit(null)} />
      <SettleDialog ud={u} open={settle} onOpenChange={setSettle} />
    </>
  )
}

/** Records the Bond Commissionerate's settlement: every balance cleared on duty and / or carried forward. */
function SettleDialog({ ud, open, onOpenChange }: { ud: BondUdRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("budr")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const leftovers = ud.lines.filter((l) => l.balance > 0)
  const all = useQuery({ queryKey: ["bondUds"], queryFn: () => api.vat.bondUds.register(), enabled: open })
  const blank = React.useCallback(() => ({ date: TODAY, bondRef: "", paymentRef: "", note: "", lines: leftovers.map((l) => ({ itemId: l.itemId, dutyPaidQty: String(l.balance), carryQty: "0", carryTo: "" })) }), [leftovers])
  const [v, setV] = React.useState(blank)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (open) { setV(blank()); setErrors({}) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const errText = (code: string) => (t.has(`err.${code}`) ? t(`err.${code}`) : code)
  const run = useMutation({
    mutationFn: () => api.vat.bondUds.settle(ud.id, { date: v.date, bondRef: v.bondRef, paymentRef: v.paymentRef, note: v.note, lines: v.lines.map((l) => ({ itemId: l.itemId, dutyPaidQty: Number(l.dutyPaidQty) || 0, carryQty: Number(l.carryQty) || 0, carryTo: l.carryTo })) }),
    onSuccess: (r) => {
      qc.setQueryData(["bondUds", "one", ud.id], r); qc.invalidateQueries({ queryKey: ["bondUds"] }); qc.invalidateQueries({ queryKey: ["bond"] })
      toast.success(t("settledToast", { no: r.no })); onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) {
        const m = Object.fromEntries(Object.entries(e.errors).map(([k, x]) => [k, errText(x[0])]))
        setErrors(m)
        if (m.state) toast.error(m.state)
      } else toast.error(e.message)
    },
  })
  const targets = (itemId: string) => (all.data?.rows ?? []).filter((x) => x.id !== ud.id && !x.settlement && x.inputs.some((i) => i.itemId === itemId))
  const duty = leftovers.reduce((a, l, i) => a + (Number(v.lines[i]?.dutyPaidQty) || 0) * l.dutyPerUnit, 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run.mutate() }}>
          <DialogHeader>
            <DialogTitle>{t("settleTitle", { no: ud.no })}</DialogTitle>
            <DialogDescription>{leftovers.length ? t("settleBody") : t("settleBodyNothing")}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
            <Field id="st-date" label={t("f.date")} required error={errors.date}>{(a) => <Input type="date" min={ud.date} max={TODAY} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} {...a} />}</Field>
            <Field id="st-ref" label={t("f.bondRef")} required error={errors.bondRef} hint={t("f.bondRefHint")}>{(a) => <Input autoComplete="off" className="tabular" value={v.bondRef} onChange={(e) => setV({ ...v, bondRef: e.target.value })} {...a} />}</Field>
            {leftovers.map((l, i) => {
              const opts = targets(l.itemId)
              const line = v.lines[i]
              const set = (k: "dutyPaidQty" | "carryQty" | "carryTo", val: string) => setV({ ...v, lines: v.lines.map((x, j) => (j === i ? { ...x, [k]: val } : x)) })
              const ek = (f: string) => errors[`lines.${i}.${f}`]
              return (
                <fieldset key={l.itemId} className="grid gap-2 rounded-md border p-3 sm:col-span-2 sm:grid-cols-3" data-testid={`st-line-${l.itemId}`}>
                  <legend className="px-1 text-sm font-medium">{t("f.lineLegend", { name: l.name, qty: qty(l.balance, locale), uom: l.uom })}</legend>
                  <Field id={`st-dp-${i}`} label={t("f.dutyPaidQty")} error={ek("dutyPaidQty")} hint={t("f.dutyHint", { amount: fmtNum((Number(line?.dutyPaidQty) || 0) * l.dutyPerUnit, locale, 2) })}>
                    {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="text-right tabular" value={line?.dutyPaidQty ?? ""} onChange={(e) => set("dutyPaidQty", e.target.value)} {...a} />}
                  </Field>
                  <Field id={`st-cq-${i}`} label={t("f.carryQty")} error={undefined}>
                    {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="text-right tabular" value={line?.carryQty ?? ""} onChange={(e) => set("carryQty", e.target.value)} {...a} />}
                  </Field>
                  <Field id={`st-ct-${i}`} label={t("f.carryTo")} error={ek("carryTo")} hint={opts.length ? undefined : t("f.noTargets")}>
                    {(a) => (
                      <Select value={line?.carryTo ?? ""} onValueChange={(val) => set("carryTo", (val as string) ?? "")} items={[{ value: "", label: t("f.none") }, ...opts.map((o) => ({ value: o.no, label: o.no }))]}>
                        <SelectTrigger id={a.id} className="w-full" aria-describedby={a["aria-describedby"]} aria-invalid={a["aria-invalid"]}><SelectValue placeholder={t("f.none")} /></SelectTrigger>
                        <SelectContent><SelectItem value="">{t("f.none")}</SelectItem>{opts.map((o) => <SelectItem key={o.id} value={o.no}>{o.no}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </Field>
                </fieldset>
              )
            })}
            {(errors.lines) && <p role="alert" className="text-xs font-medium text-destructive sm:col-span-2">{errors.lines}</p>}
            <Field id="st-pay" label={t("f.paymentRef")} error={errors.paymentRef}>{(a) => <Input autoComplete="off" className="tabular" value={v.paymentRef} onChange={(e) => setV({ ...v, paymentRef: e.target.value })} {...a} />}</Field>
            <div className="grid content-end rounded-md bg-muted/60 p-3 text-sm"><span className="text-xs text-muted-foreground">{t("f.dutyTotal")}</span><span className="font-semibold tabular" data-testid="st-duty">{fmtMoney(duty, locale)}</span></div>
            <Field id="st-note" label={t("f.note")} className="sm:col-span-2">{(a) => <Textarea rows={2} maxLength={300} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} {...a} />}</Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={run.isPending} data-testid="st-submit">{run.isPending && <Loader2 className="animate-spin" />} {t("settle")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type In = z.input<typeof bondUdInput>
type Out = z.output<typeof bondUdInput>
const blankUd = (): In => ({ kind: "UD", issuer: "BGMEA", no: "", date: TODAY, expiry: "", masterLcNo: "", masterLcValue: NaN, currency: "USD", buyer: "", note: "", inputs: [{ itemId: "", qty: 0 }], garments: [{ itemId: "", qty: 0 }] })

/** Create / edit one of our UDs / UP. */
function BondUdFormSheet({ value, onOpenChange }: { value: BondUdRow | "new" | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("budr")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const ud = value && value !== "new" ? value : null
  const items = useQuery({ queryKey: ["items", "book-options"], queryFn: () => api.items.list({ size: 500 }), enabled: !!value, staleTime: 60_000 })
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(bondUdInput), defaultValues: blankUd(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, formState: { errors } } = form
  const inputs = useFieldArray({ control, name: "inputs" })
  const garments = useFieldArray({ control, name: "garments" })
  React.useEffect(() => {
    if (!value) return
    reset(ud ? { kind: ud.kind, issuer: ud.issuer, no: ud.no, date: ud.date, expiry: ud.expiry, masterLcNo: ud.masterLcNo, masterLcValue: ud.masterLcValue ?? NaN, currency: (ud.currency as In["currency"]) ?? "USD", buyer: ud.buyer ?? "", note: ud.note ?? "",
      inputs: ud.inputs.map((l) => ({ itemId: l.itemId, qty: l.qty })), garments: ud.garments.map((g) => ({ itemId: g.itemId, qty: g.qty })) } : blankUd())
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const errText = (m?: string) => (m ? (t.has(`err.${m}`) ? t(`err.${m}`) : m) : undefined)
  const save = useMutation({
    mutationFn: (v: Out) => (ud ? api.vat.bondUds.update(ud.id, v) : api.vat.bondUds.create(v)),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["bondUds"] }); toast.success(ud ? t("saved", { no: r.no }) : t("created", { no: r.no })); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const all = items.data?.data ?? []
  const opt = (i: (typeof all)[number]) => ({ value: i.id, label: i.name, description: `${i.sku} · HS ${fmtHs(i.hsCode)} · ${i.unit}`, keywords: [i.sku, i.hsCode] })
  const inputOptions = all.filter((i) => i.group !== "Finished Goods").map(opt)
  const garmentOptions = all.filter((i) => i.group === "Finished Goods").map(opt)
  /** rendered by a plain call (not as a component) so the inputs are not re-mounted on every render */
  const lines = ({ name, arr, options, legend }: { name: "inputs" | "garments"; arr: typeof inputs; options: ReturnType<typeof opt>[]; legend: string }) => (
    <fieldset className="grid gap-2 sm:col-span-2">
      <legend className="mb-1 text-sm font-medium">{legend}<span className="text-destructive" aria-hidden> *</span></legend>
      {arr.fields.map((f, i) => {
        const le = errors[name]?.[i]
        return (
          <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-start gap-2">
            <Controller control={control} name={`${name}.${i}.itemId`} render={({ field }) => (
              <div className="grid gap-1">
                <Combobox ariaLabel={t("f.lineItem", { what: legend, n: i + 1 })} invalid={!!le?.itemId} value={field.value} onChange={field.onChange} options={options} placeholder={t("f.pickItem")} searchPlaceholder={t("f.searchItem")} empty={tc("noResults")} />
                {le?.itemId?.message && <p role="alert" className="text-xs font-medium text-destructive">{errText(le.itemId.message)}</p>}
              </div>
            )} />
            <div className="grid gap-1">
              <Input type="number" inputMode="decimal" step="any" min={0} aria-label={t("f.lineQty", { what: legend, n: i + 1 })} aria-invalid={!!le?.qty || undefined} className="text-right tabular" {...register(`${name}.${i}.qty`, { valueAsNumber: true })} />
              {le?.qty?.message && <p role="alert" className="text-xs font-medium text-destructive">{errText(le.qty.message)}</p>}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={t("f.removeLine", { what: legend, n: i + 1 })} disabled={arr.fields.length === 1} onClick={() => arr.remove(i)}><Trash2 /></Button>
          </div>
        )
      })}
      {errors[name]?.message && <p role="alert" className="text-xs font-medium text-destructive">{errText(errors[name]?.message)}</p>}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => arr.append({ itemId: "", qty: 0 })}><Plus /> {t("f.addLine")}</Button>
    </fieldset>
  )
  return (
    <Sheet open={!!value} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{ud ? t("editTitle", { no: ud.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("formSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field id="bud-kind" label={t("f.kind")} required>
              {(a) => <Controller control={control} name="kind" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as In["kind"])} items={[{ value: "UD", label: t("kind.UD") }, { value: "UP", label: t("kind.UP") }]}>
                  <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="UD">{t("kind.UD")}</SelectItem><SelectItem value="UP">{t("kind.UP")}</SelectItem></SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="bud-issuer" label={t("f.issuer")} required>
              {(a) => <Controller control={control} name="issuer" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as In["issuer"])} items={(["BGMEA", "BKMEA", "Customs"] as const).map((x) => ({ value: x, label: t(`issuer.${x}`) }))}>
                  <SelectTrigger id={a.id} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["BGMEA", "BKMEA", "Customs"] as const).map((x) => <SelectItem key={x} value={x}>{t(`issuer.${x}`)}</SelectItem>)}</SelectContent>
                </Select>
              )} />}
            </Field>
            <Field id="bud-no" label={t("f.no")} required error={errText(errors.no?.message)}>{(a) => <Input autoComplete="off" className="uppercase tabular" {...a} {...register("no")} />}</Field>
            <Field id="bud-lc" label={t("f.masterLc")} required error={errText(errors.masterLcNo?.message)}>{(a) => <Input autoComplete="off" className="tabular" {...a} {...register("masterLcNo")} />}</Field>
            <Field id="bud-date" label={t("f.udDate")} required error={errText(errors.date?.message)}>{(a) => <Input type="date" max={TODAY} {...a} {...register("date")} />}</Field>
            <Field id="bud-expiry" label={t("f.expiry")} required error={errText(errors.expiry?.message)}>{(a) => <Input type="date" {...a} {...register("expiry")} />}</Field>
            <Field id="bud-buyer" label={t("f.buyer")} error={errText(errors.buyer?.message)}>{(a) => <Input autoComplete="off" {...a} {...register("buyer")} />}</Field>
            <Field id="bud-value" label={t("f.lcValue")} error={errText(errors.masterLcValue?.message)}>{(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("masterLcValue", { valueAsNumber: true })} />}</Field>
            {lines({ name: "garments", arr: garments as unknown as typeof inputs, options: garmentOptions, legend: t("f.garments") })}
            {lines({ name: "inputs", arr: inputs, options: inputOptions, legend: t("f.inputs") })}
            <Field id="bud-note" label={t("f.note")} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("note")} />}</Field>
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending} data-testid="bud-save">{save.isPending && <Loader2 className="animate-spin" />} {tc("save")}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
