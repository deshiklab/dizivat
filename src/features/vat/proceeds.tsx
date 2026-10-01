"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Banknote, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/common/field"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { PROCEEDS_DAYS, proceedsOf } from "@/lib/rmg"
import { realisationInput } from "@/lib/schemas"
import type { ProceedsState, Sale } from "@/lib/types"

type In = z.input<typeof realisationInput>
type Out = z.output<typeof realisationInput>
export const PROCEEDS_TONE: Record<ProceedsState, Tone> = { realised: "success", partial: "info", outstanding: "neutral", overdue: "danger", na: "neutral" }

export interface RealiseTarget { saleId: string; invoiceNo: string; invoiceDate: string; currency: string; outstandingFc: number; rate?: number }

/** Record export proceeds realised through the bank (PRC) against one export invoice. */
export function RealiseDialog({ target, onOpenChange }: { target: RealiseTarget | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("proceeds")
  const tc = useTranslations("common")
  const locale = useLocale()
  const qc = useQueryClient()
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(realisationInput), mode: "onTouched" })
  const { register, handleSubmit, reset, setError, watch, formState: { errors } } = form
  React.useEffect(() => {
    if (target) reset({ date: TODAY, bank: "", prcNo: "", fcAmount: target.outstandingFc, rate: target.rate ?? 0, note: "" })
  }, [target, reset])
  const fc = Number(watch("fcAmount")) || 0, rate = Number(watch("rate")) || 0
  const save = useMutation({
    mutationFn: (v: Out) => api.vat.realise(target!.saleId, v),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["vat", "exports"] })
      qc.setQueryData(["sale", s.id], s)
      qc.invalidateQueries({ queryKey: ["sales"] })
      toast.success(t("saved", { no: s.invoiceNo }))
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message === "notRealisable" ? t("notRealisable") : e.message)
    },
  })
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Banknote className="size-5 text-primary" aria-hidden /> {t("title")}</DialogTitle>
            <DialogDescription>{target ? t("sub", { no: target.invoiceNo, amount: `${target.currency} ${fmtNum(target.outstandingFc, locale, 2)}` }) : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="prc-date" label={t("date")} required error={errors.date?.message}>{(a) => <Input type="date" min={target?.invoiceDate} max={TODAY} {...a} {...register("date")} />}</Field>
            <Field id="prc-no" label={t("prcNo")} required error={errors.prcNo?.message}>{(a) => <Input autoComplete="off" className="uppercase tabular" {...a} {...register("prcNo")} />}</Field>
            <Field id="prc-bank" label={t("bank")} required error={errors.bank?.message} className="sm:col-span-2">{(a) => <Input autoComplete="off" {...a} {...register("bank")} />}</Field>
            <Field id="prc-fc" label={t("fcAmount", { cur: target?.currency ?? "" })} required error={errors.fcAmount?.message}>{(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" {...a} {...register("fcAmount", { valueAsNumber: true })} />}</Field>
            <Field id="prc-rate" label={t("rate")} required error={errors.rate?.message}>{(a) => <Input type="number" inputMode="decimal" step="0.0001" min={0} className="text-right tabular" {...a} {...register("rate", { valueAsNumber: true })} />}</Field>
            <p className="text-sm sm:col-span-2" aria-live="polite">{t("bdt")}: <strong className="tabular">Tk {fmtNum(Math.round(fc * rate * 100) / 100, locale, 2)}</strong></p>
            <Field id="prc-note" label={t("note")} error={errors.note?.message} className="sm:col-span-2">{(a) => <Input autoComplete="off" {...a} {...register("note")} />}</Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {t("record")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Invoice view: export proceeds realised so far, what is outstanding and the 120-day due date. */
export function ProceedsCard({ s }: { s: Sale }) {
  const t = useTranslations("proceeds")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [target, setTarget] = React.useState<RealiseTarget | null>(null)
  const e = s.export
  const remove = useMutation({
    mutationFn: (rid: string) => api.vat.unrealise(s.id, rid),
    onSuccess: (x) => { qc.setQueryData(["sale", x.id], x); qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["vat", "exports"] }); toast.success(t("removed")) },
    onError: (err) => toast.error(err.message),
  })
  if (!e || s.process === "Cancelled") return null
  const p = proceedsOf(e, s.issueDate, TODAY)
  if (p.state === "na") return null
  const list = e.realisations ?? []
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Banknote className="size-4" aria-hidden /> {t("cardTitle")}</span><Pill tone={PROCEEDS_TONE[p.state]}>{t(`state.${p.state}`)}</Pill></CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <div><dt className="text-xs text-muted-foreground">{t("realised")}</dt><dd className="tabular">{e.currency} {fmtNum(p.realisedFc, locale, 2)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t("outstanding")}</dt><dd className="font-medium tabular">{e.currency} {fmtNum(p.outstandingFc, locale, 2)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted-foreground">{t("due", { days: PROCEEDS_DAYS })}</dt><dd className={p.state === "overdue" ? "font-medium text-destructive tabular" : "tabular"}>{p.due ? fmtDate(p.due, locale) : "—"}</dd></div>
        </dl>
        {list.length > 0 && (
          <ul className="grid gap-2">
            {list.map((r) => (
              <li key={r.id} className="grid gap-0.5 rounded-md border p-2">
                <span className="flex items-center justify-between gap-2"><span className="font-medium tabular">{r.prcNo}</span><span className="tabular">{e.currency} {fmtNum(r.fcAmount, locale, 2)}</span></span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{fmtDate(r.date, locale)} · {r.bank} · @ {fmtNum(r.rate, locale, 2)} = Tk {fmtNum(r.bdt, locale, 2)}</span>
                  {can("doc.approve") && <Button variant="ghost" size="icon-sm" aria-label={t("removeOne", { no: r.prcNo })} disabled={remove.isPending}
                    onClick={async () => { if (await confirm({ title: t("removeTitle", { no: r.prcNo }), description: t("removeBody"), confirm: t("remove"), cancel: tc("cancel"), destructive: true })) remove.mutate(r.id) }}><Trash2 /></Button>}
                </span>
                {r.note && <span className="text-xs">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {s.process === "Approved" && p.outstandingFc > 0 && can("doc.edit") && (
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setTarget({ saleId: s.id, invoiceNo: s.invoiceNo, invoiceDate: s.issueDate, currency: e.currency!, outstandingFc: p.outstandingFc, rate: e.exchangeRate })}><Plus /> {t("record")}</Button>
        )}
      </CardContent>
      <RealiseDialog target={target} onOpenChange={(o) => !o && setTarget(null)} />
    </Card>
  )
}
