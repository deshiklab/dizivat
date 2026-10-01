"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCheck, Info, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Combobox } from "@/components/common/combobox"
import { Money } from "@/components/common/money"
import { useCan, useMe } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtNum } from "@/lib/format"
import { batchInput } from "@/lib/schemas"
import { round2, round4 } from "@/lib/vat"
import type { Batch, BatchMode, BomRow, SubconProcess } from "@/lib/types"
import { SUBCON_PROCESSES } from "@/lib/rmg"
import { useR3Refresh } from "@/features/r3/use-r3-actions"
import { MiniTable } from "./parts"
import type { BatchVariant } from "./batch-list"

interface LineValues { itemId: string; workOrderId: string; issueQty: number; receiveQty: number; damageQty: number; unitCost?: number }
interface FormValues {
  mode: BatchMode; issueDate: string; receiveDate: string; vendorId: string; address: string; remark: string
  jobProcess: SubconProcess
  issuedBy: string; designation: string; process: "Created" | "Approved"; lines: LineValues[]
  consumption: { itemId: string; qty: number }[]
}
const NONE = "_none"

/**
 * New / edit-draft production batch. In-house batches issue inputs and receive finished goods in one step; contractual
 * batches send inputs to the contractor (Mushak 6.4) and receive later; opening batches bring forward goods in process.
 * Inputs are consumed at the BOM coefficients (or actual quantities when the consumption method is "actual").
 */
export function BatchForm({ open, onOpenChange, variant, doc, workOrderId, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; variant: BatchVariant; doc?: Batch | null; workOrderId?: string | null; onSaved?: (b: Batch) => void
}) {
  const t = useTranslations("batch")
  const tr = useTranslations("subcon")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const me = useMe()
  const refresh = useR3Refresh()
  const opening = variant === "opening"
  const cfg = useQuery({ queryKey: ["productionConfig"], queryFn: api.production.config, enabled: open })
  const items = useQuery({ queryKey: ["stock", "all"], queryFn: () => api.stock.list({ size: 500 }), enabled: open })
  const bomsQ = useQuery({ queryKey: ["boms", { status: "active" }], queryFn: () => api.production.boms.list({ status: "active", size: 500 }), enabled: open })
  const wosQ = useQuery({ queryKey: ["workOrders", { process: "Approved" }], queryFn: () => api.production.workOrders.list({ process: "Approved", size: 500 }), enabled: open && !opening })
  const vendorsQ = useQuery({ queryKey: ["vendors", "options"], queryFn: () => api.vendors.options(), enabled: open && !opening })
  const woPrefill = useQuery({ queryKey: ["workOrder", workOrderId], queryFn: () => api.production.workOrders.get(workOrderId!), enabled: open && !!workOrderId && !doc })
  const rows = items.data?.data ?? []
  const main = items.data?.branches.find((b) => b.category === "factory")?.id ?? ""
  const item = (id?: string) => rows.find((r) => r.id === id)
  const boms = bomsQ.data?.data ?? []
  const bomOf = (id?: string): BomRow | undefined => boms.find((b) => b.itemId === id)
  const wos = (wosQ.data?.data ?? []).filter((w) => w.status === "open" || w.status === "partial" || doc?.lines.some((l) => l.workOrderId === w.id))
  const vendors = (vendorsQ.data ?? []).filter((v) => v.mode !== "Foreign")
  const procedure = cfg.data?.procedure ?? "directStock"
  const actual = cfg.data?.consumption === "actual"

  const blank = React.useCallback((): FormValues => ({
    mode: opening ? "opening" : "inHouse", issueDate: TODAY, receiveDate: opening ? TODAY : "", vendorId: "", address: "", remark: "", jobProcess: "manufacture",
    issuedBy: me.user.name, designation: me.user.designation, process: "Created",
    lines: [{ itemId: "", workOrderId: "", issueQty: 0, receiveQty: 0, damageQty: 0 }], consumption: [],
  }), [opening, me.user.name, me.user.designation])
  const resolver = zodResolver(batchInput as never) as unknown as Resolver<FormValues>
  const form = useForm<FormValues>({ resolver, defaultValues: blank(), mode: "onTouched" })
  const { register, control, handleSubmit, reset, setError, setValue, formState: { errors } } = form
  const lines = useFieldArray({ control, name: "lines" })
  React.useEffect(() => {
    if (!open) return
    if (doc) {
      reset({
        mode: doc.mode, issueDate: doc.issueDate, receiveDate: doc.receiveDate ?? "", vendorId: doc.vendorId ?? "", address: doc.address ?? "", remark: doc.remark ?? "", jobProcess: doc.jobProcess ?? "manufacture",
        issuedBy: doc.issuedBy, designation: doc.designation, process: "Created",
        lines: doc.lines.map((l) => ({ itemId: l.itemId, workOrderId: l.workOrderId ?? "", issueQty: l.issueQty, receiveQty: l.receiveQty, damageQty: l.damageQty, unitCost: doc.mode === "opening" ? l.unitCost : undefined })),
        consumption: doc.consumption.map((c) => ({ itemId: c.itemId, qty: c.qty })),
      })
    } else if (workOrderId && woPrefill.data) {
      const w = woPrefill.data
      reset({ ...blank(), remark: w.requisitionNo ? t("fromRequisition", { no: w.requisitionNo }) : "", lines: w.lines.filter((l) => l.remaining > 0).map((l) => ({ itemId: l.itemId, workOrderId: w.id, issueQty: l.remaining, receiveQty: l.remaining, damageQty: 0 })) })
    } else reset(blank())
  }, [open, doc, workOrderId, woPrefill.data, reset, blank, t])

  const w = useWatch({ control })
  const mode = w.mode ?? "inHouse"
  const contractual = mode === "contractual"
  const lineVals = (w.lines ?? []) as Partial<LineValues>[]

  // standard consumption = BOM gross qty × issue qty, merged per input
  const standard = React.useMemo(() => {
    const m = new Map<string, { itemId: string; name: string; uom: string; qty: number; price: number }>()
    if (mode === "opening") return []
    for (const l of lineVals) {
      const b = bomOf(l.itemId)
      if (!b || !(Number(l.issueQty) > 0)) continue
      for (const i of b.inputs) {
        const cur = m.get(i.itemId) ?? { itemId: i.itemId, name: i.name, uom: i.uom, qty: 0, price: i.price }
        cur.qty = round4(cur.qty + i.grossQty * Number(l.issueQty))
        m.set(i.itemId, cur)
      }
    }
    return [...m.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lineVals), mode, boms])
  const actualQty = (id: string) => w.consumption?.find((c) => c?.itemId === id)?.qty
  const used = standard.map((s) => ({ ...s, qty: actual && actualQty(s.itemId) != null && Number.isFinite(Number(actualQty(s.itemId))) ? Number(actualQty(s.itemId)) : round2(s.qty) }))
  const onHand = (id: string) => item(id)?.byBranch[main] ?? 0
  const short = used.filter((u) => u.qty > onHand(u.itemId) + 1e-9)
  const materialValue = round2(used.reduce((a, u) => a + u.qty * u.price, 0))
  const outputValue = round2(lineVals.reduce((a, l) => a + (contractual ? 0 : Number(l.receiveQty) || 0) * (mode === "opening" ? Number(l.unitCost ?? bomOf(l.itemId)?.unitCost ?? item(l.itemId)?.costPrice ?? 0) : bomOf(l.itemId)?.unitCost ?? 0), 0))

  const fgOptions = rows.filter((r) => r.group === "Finished Goods" && r.active).map((r) => {
    const b = bomOf(r.id)
    return { value: r.id, label: r.name, description: `${r.sku} · ${b ? t("bomOption", { v: b.version, cost: fmtNum(b.unitCost, locale, 2) }) : t("noBomShort")}`, keywords: [r.sku, r.hsCode], disabled: mode !== "opening" && !b }
  })

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        ...v,
        lines: v.lines.map((l) => ({ ...l, workOrderId: l.workOrderId === NONE ? "" : l.workOrderId, receiveQty: contractual ? 0 : l.receiveQty || 0, damageQty: contractual ? 0 : l.damageQty || 0, unitCost: v.mode === "opening" ? l.unitCost : undefined })),
        consumption: actual && v.mode !== "opening" ? used.map((u) => ({ itemId: u.itemId, qty: u.qty })) : undefined,
      }
      return doc ? api.production.batches.update(doc.id, body) : api.production.batches.create(body)
    },
    onSuccess: (d) => { refresh("batch", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      // field errors show inline — a toast would cover the sheet footer
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) Object.entries(e.errors).forEach(([k, v]) => setError(k as never, { message: v[0] }))
      else toast.error(e.message)
    },
  })
  const submit = (process: FormValues["process"]) => { setValue("process", process); return handleSubmit((v) => save.mutate({ ...v, process }))() }
  const title = doc ? t("editTitle", { no: doc.no }) : opening ? t("opening.newTitle") : t("newTitle")

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <form onSubmit={(e) => { e.preventDefault(); submit("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{t(opening ? "opening.newSub" : "newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            {!opening && (
              <fieldset className="grid gap-2 sm:col-span-2" disabled={!!doc}>
                <legend className="mb-1.5 text-sm font-medium">{t("field.mode")}<span className="text-destructive" aria-hidden> *</span></legend>
                <Controller control={control} name="mode" render={({ field }) => (
                  <RadioGroup disabled={!!doc} value={field.value} onValueChange={(v) => field.onChange(v as BatchMode)} className="grid gap-2 sm:grid-cols-2">
                    {(["inHouse", "contractual"] as const).map((m) => (
                      <label key={m} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5 has-disabled:cursor-not-allowed has-disabled:opacity-70">
                        <RadioGroupItem value={m} className="mt-0.5" />
                        <span className="grid gap-0.5"><span className="text-sm font-medium">{t(`mode.${m}`)}</span><span className="text-xs text-muted-foreground">{t(`modeHint.${m}`)}</span></span>
                      </label>
                    ))}
                  </RadioGroup>
                )} />
              </fieldset>
            )}
            {contractual && (
              <>
                <Field id="vendorId" label={t("field.vendor")} required error={errors.vendorId?.message}>
                  {(a) => <Controller control={control} name="vendorId" render={({ field }) => (
                    <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value}
                      onChange={(v) => { field.onChange(v); const x = vendors.find((p) => p.id === v); if (x && !w.address) setValue("address", `${x.name}, ${x.address}`) }}
                      options={vendors.map((v) => ({ value: v.id, label: v.name, description: `${v.bin} · ${v.address}`, keywords: [v.bin] }))}
                      placeholder={t("pickVendor")} searchPlaceholder={t("searchVendor")} empty={t("noVendors")} />
                  )} />}
                </Field>
                <Field id="address" label={t("field.address")} error={errors.address?.message} hint={t("hint.address")}>{(a) => <Input {...a} {...register("address")} />}</Field>
                <Field id="jobProcess" label={tr("process")} hint={tr("processHint")}>
                  {(a) => <Controller control={control} name="jobProcess" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v as SubconProcess)} items={SUBCON_PROCESSES.map((p) => ({ value: p, label: tr(`proc.${p}`) }))}>
                      <SelectTrigger id={a.id} aria-describedby={a["aria-describedby"]} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{SUBCON_PROCESSES.map((p) => <SelectItem key={p} value={p}>{tr(`proc.${p}`)}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />}
                </Field>
              </>
            )}
            <Field id="issueDate" label={t("field.issueDate")} required error={errors.issueDate?.message}>{(a) => <Input type="date" max={TODAY} {...a} {...register("issueDate")} />}</Field>
            {!contractual && <Field id="receiveDate" label={t("field.receiveDate")} error={errors.receiveDate?.message} hint={t("hint.receiveDate")}>{(a) => <Input type="date" min={w.issueDate} max={TODAY} {...a} {...register("receiveDate")} />}</Field>}
            <Field id="issuedBy" label={t("field.issuedBy")} required error={errors.issuedBy?.message}>{(a) => <Input autoComplete="name" {...a} {...register("issuedBy")} />}</Field>
            <Field id="designation" label={t("field.designation")} required error={errors.designation?.message}>{(a) => <Input autoComplete="organization-title" {...a} {...register("designation")} />}</Field>
            <Field id="remark" label={t("field.remark")} error={errors.remark?.message} className="sm:col-span-2">{(a) => <Textarea rows={2} {...a} {...register("remark")} />}</Field>

            {!opening && procedure === "workOrder" && (
              <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-xs sm:col-span-2"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("woRequired")}</p>
            )}

            <fieldset className="grid gap-3 sm:col-span-2">
              <legend className="mb-1 text-sm font-semibold">{t("outputTitle")}</legend>
              {lines.fields.map((f, i) => {
                const l = lineVals[i] ?? {}
                const it = item(l.itemId)
                const b = bomOf(l.itemId)
                const err = errors.lines?.[i]
                const woOpts = wos.filter((x) => x.lines.some((y) => y.itemId === l.itemId))
                const woLine = wos.find((x) => x.id === l.workOrderId)?.lines.find((y) => y.itemId === l.itemId)
                const over = !contractual && (Number(l.receiveQty) || 0) + (Number(l.damageQty) || 0) > (Number(l.issueQty) || 0) + 1e-9
                const woItems = [...(procedure === "workOrder" ? [] : [{ value: NONE, label: t("noWorkOrder") }]), ...woOpts.map((x) => ({ value: x.id, label: x.no }))]
                return (
                  <div key={f.id} className={`grid gap-2 rounded-md border p-3 sm:items-start ${opening ? "sm:grid-cols-[1fr_7rem_7rem_7rem_8rem_auto]" : contractual ? "sm:grid-cols-[minmax(0,1fr)_12rem_8rem_auto]" : "sm:grid-cols-[minmax(0,1fr)_10rem_7rem_7rem_7rem_auto]"}`}>
                    <Field id={`lines.${i}.itemId`} label={t("field.itemN", { n: i + 1 })} required error={err?.itemId?.message} className="min-w-0">
                      {(a) => <Controller control={control} name={`lines.${i}.itemId`} render={({ field }) => (
                        <Combobox id={a.id} describedBy={a["aria-describedby"]} invalid={!!a["aria-invalid"]} value={field.value}
                          onChange={(v) => { field.onChange(v); setValue(`lines.${i}.workOrderId`, "") }}
                          options={fgOptions} placeholder={t("pickItem")} searchPlaceholder={t("searchItem")} empty={t("noItems")} />
                      )} />}
                    </Field>
                    {!opening && (
                      <Field id={`lines.${i}.workOrderId`} label={t("field.workOrder")} required={procedure === "workOrder"} error={err?.workOrderId?.message} className="min-w-0">
                        {(a) => <Controller control={control} name={`lines.${i}.workOrderId`} render={({ field }) => (
                          <Select value={field.value || (procedure === "workOrder" ? "" : NONE)} onValueChange={(v) => field.onChange(v === NONE ? "" : v)} items={woItems} disabled={!l.itemId}>
                            <SelectTrigger id={a.id} className="w-full min-w-0 overflow-hidden" aria-invalid={a["aria-invalid"]} aria-describedby={a["aria-describedby"]}><SelectValue className="truncate" placeholder={t("pickWorkOrder")} /></SelectTrigger>
                            <SelectContent>{woItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                          </Select>
                        )} />}
                      </Field>
                    )}
                    <Field id={`lines.${i}.issueQty`} label={it ? `${t("field.issueQty")} (${it.unit})` : t("field.issueQty")} required error={err?.issueQty?.message}>
                      {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} {...register(`lines.${i}.issueQty`, { valueAsNumber: true })} />}
                    </Field>
                    {!contractual && (
                      <>
                        <Field id={`lines.${i}.receiveQty`} label={t("field.receiveQty")} error={err?.receiveQty?.message}>
                          {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} aria-invalid={over || a["aria-invalid"]} {...register(`lines.${i}.receiveQty`, { valueAsNumber: true })} />}
                        </Field>
                        <Field id={`lines.${i}.damageQty`} label={t("field.damageQty")} error={err?.damageQty?.message}>
                          {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" {...a} aria-invalid={over || a["aria-invalid"]} {...register(`lines.${i}.damageQty`, { valueAsNumber: true })} />}
                        </Field>
                      </>
                    )}
                    {opening && (
                      <Field id={`lines.${i}.unitCost`} label={t("field.unitCost")} error={err?.unitCost?.message} hint={b ? t("hint.unitCost", { cost: fmtNum(b.unitCost, locale, 2) }) : undefined}>
                        {(a) => <Input type="number" inputMode="decimal" step="any" min={0} className="tabular" placeholder={b ? String(b.unitCost) : undefined} {...a} {...register(`lines.${i}.unitCost`, { setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)) })} />}
                      </Field>
                    )}
                    <div className="flex items-end sm:pt-6">
                      <Button type="button" variant="ghost" size="icon" aria-label={t("removeLine", { n: i + 1 })} disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}><Trash2 /></Button>
                    </div>
                    {it && (
                      <p className={`text-xs sm:col-span-full ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                        {over ? <><AlertTriangle className="mr-1 inline size-3.5" aria-hidden />{t("overIssue")}</> : <>
                          {b ? t("lineBom", { v: b.version, cost: fmtNum(b.unitCost, locale, 2) }) : mode === "opening" ? t("noBomOpening") : ""}
                          {woLine ? ` · ${t("woRemaining", { qty: fmtNum(woLine.remaining, locale, 2), unit: it.unit })}` : ""}
                          {` · ${t("fgStock", { qty: fmtNum(it.remain, locale, 2), unit: it.unit })}`}
                        </>}
                      </p>
                    )}
                  </div>
                )
              })}
              {typeof errors.lines?.message === "string" && <p role="alert" className="text-xs font-medium text-destructive">{errors.lines.message}</p>}
              <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={lines.fields.length >= 50} onClick={() => lines.append({ itemId: "", workOrderId: "", issueQty: 0, receiveQty: 0, damageQty: 0 })}><Plus /> {t("addLine")}</Button>
            </fieldset>

            {mode !== "opening" && (
              <section className="grid gap-2 sm:col-span-2" aria-live="polite">
                <h3 className="text-sm font-semibold">{t(actual ? "consumptionActual" : "consumptionTitle")}</h3>
                {used.length ? (
                  <MiniTable caption={t("consumptionTitle")} minWidth={620} head={[{ label: t("col.input") }, { label: t("col.standard"), right: true }, { label: t("col.qty"), right: true }, { label: t("col.onHand"), right: true }, { label: t("col.value"), right: true }]}>
                    {used.map((u, i) => {
                      const s = standard[i]
                      const lack = u.qty > onHand(u.itemId) + 1e-9
                      return (
                        <tr key={u.itemId} className="border-b last:border-0">
                          <td className="px-3 py-2">{u.name}{lack && <span className="block text-xs font-medium text-destructive">{t("shortBy", { qty: fmtNum(u.qty - onHand(u.itemId), locale, 3), unit: u.uom })}</span>}</td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">{fmtNum(s.qty, locale, 3)}</td>
                          <td className="px-3 py-2 text-right">
                            {actual ? (
                              <Input type="number" inputMode="decimal" step="any" min={0} className="ml-auto w-28 text-right tabular" aria-label={t("actualFor", { item: u.name })} value={Number.isFinite(u.qty) ? u.qty : ""}
                                onChange={(e) => {
                                  const next = [...(w.consumption ?? []).filter((c) => c?.itemId !== u.itemId), { itemId: u.itemId, qty: e.target.valueAsNumber }]
                                  setValue("consumption", next as FormValues["consumption"])
                                }} />
                            ) : <span className="tabular">{fmtNum(u.qty, locale, 3)} {u.uom}</span>}
                          </td>
                          <td className={`px-3 py-2 text-right tabular ${lack ? "text-destructive" : ""}`}>{fmtNum(onHand(u.itemId), locale, 3)}</td>
                          <td className="px-3 py-2 text-right"><Money value={round2(u.qty * u.price)} /></td>
                        </tr>
                      )
                    })}
                  </MiniTable>
                ) : <p className="text-sm text-muted-foreground">{t("consumptionEmpty")}</p>}
                <p className="text-xs text-muted-foreground">{t(actual ? "consumptionActualHint" : "consumptionHint")} <Link href="/production/config" className="underline">{t("configLink")}</Link></p>
                {short.length > 0 && <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-xs"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> {t("shortNote")}</p>}
              </section>
            )}

            <section className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm sm:col-span-2" data-testid="batch-totals">
              {mode !== "opening" && <span>{t("col.material")}: <Money value={materialValue} className="font-semibold" /></span>}
              {!contractual && <span>{t("receiveValue")}: <Money value={outputValue} className="font-semibold" /></span>}
            </section>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || short.length > 0} onClick={() => submit("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
