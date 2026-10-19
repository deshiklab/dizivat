"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Field } from "@/components/common/field"
import { Money } from "@/components/common/money"
import { useCan } from "@/components/auth/me-provider"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { round2 } from "@/lib/vat"
import { useR4Refresh } from "@/features/r4/r4-actions"
import type { FixedAsset } from "@/lib/types"

/**
 * New / edit-draft fixed asset (AS-): what it is, the class whose NBR rate it depreciates by, when it was
 * commissioned and what it cost. The depreciation itself is never typed — it runs from these four facts.
 * A capital purchase that bought the asset can be referenced for the audit trail; the record is otherwise
 * its own document.
 */
export function AssetForm({ open, onOpenChange, doc, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: FixedAsset | null; onSaved?: (d: FixedAsset) => void
}) {
  const t = useTranslations("assets")
  const tc = useTranslations("common")
  const can = useCan()
  const refresh = useR4Refresh()
  const classes = useQuery({ queryKey: ["assetClasses"], queryFn: () => api.accounting.assetClasses.list(), enabled: open })
  const config = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config(), enabled: open })

  const [name, setName] = React.useState("")
  const [classId, setClassId] = React.useState("")
  const [date, setDate] = React.useState(TODAY)
  const [cost, setCost] = React.useState("")
  const [salvage, setSalvage] = React.useState("")
  const [inputVat, setInputVat] = React.useState("")
  const [creditable, setCreditable] = React.useState(true)
  const [memo, setMemo] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    if (doc) {
      setName(doc.name); setClassId(doc.classId); setDate(doc.date)
      setCost(String(doc.cost)); setSalvage(doc.salvage ? String(doc.salvage) : "")
      setInputVat(doc.inputVat ? String(doc.inputVat) : ""); setCreditable(doc.creditable); setMemo(doc.memo ?? "")
    } else { setName(""); setClassId(""); setDate(TODAY); setCost(""); setSalvage(""); setInputVat(""); setCreditable(true); setMemo("") }
  }, [open, doc])

  const rate = classes.data?.find((c) => c.id === classId)?.rate
  const monthly = rate !== undefined && cost ? round2((Number(cost) || 0) * rate / 100 / 12) : undefined
  const valid = name.trim().length >= 3 && !!classId && !!date && (Number(cost) || 0) >= 1 && (Number(salvage) || 0) < (Number(cost) || 0)

  const [pending, setPending] = React.useState(false)
  const save = (process: "Created" | "Approved") => {
    const body = {
      name: name.trim(), classId, date, cost: round2(Number(cost) || 0), salvage: round2(Number(salvage) || 0),
      inputVat: round2(Number(inputVat) || 0), creditable, ...(memo.trim() ? { memo: memo.trim() } : {}), process,
    }
    setPending(true)
    const r = doc ? api.accounting.assets.update(doc.id, body) : api.accounting.assets.create(body)
    r.then((d) => { refresh("asset", d); toast.success(t(process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) { setErrors(e.errors); toast.error(e.message) }
        else toast.error(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setPending(false))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); if (valid) save("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="fa-name" label={t("field.name")} required error={errors.name?.[0]}>
                {(a) => <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} {...a} />}
              </Field>
              <Field id="fa-class" label={t("field.class")} required error={errors.classId?.[0]}>
                {(a) => (
                  <Select value={classId} onValueChange={(v) => setClassId(v ?? "")} items={(classes.data ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} · ${c.rate}%` }))}>
                    <SelectTrigger className="w-full" {...a}><SelectValue placeholder={t("pickClass")} /></SelectTrigger>
                    <SelectContent>{(classes.data ?? []).filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.rate}%</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </Field>
              <Field id="fa-date" label={t("field.date")} required error={errors.date?.[0]} hint={config.data?.closedUpTo ? t("closedHint", { date: config.data.closedUpTo }) : undefined}>
                {(a) => <Input type="date" max={TODAY} min={config.data?.closedUpTo ?? undefined} value={date} onChange={(e) => setDate(e.target.value)} {...a} />}
              </Field>
              <Field id="fa-cost" label={t("field.cost")} required error={errors.cost?.[0]}>
                {(a) => <Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={cost} onChange={(e) => setCost(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} {...a} />}
              </Field>
              <Field id="fa-salvage" label={t("field.salvage")} error={errors.salvage?.[0]} hint={t("salvageHint")}>
                {(a) => <Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={salvage} onChange={(e) => setSalvage(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} {...a} />}
              </Field>
              <Field id="fa-vat" label={t("field.inputVat")} error={errors.inputVat?.[0]} hint={t("vatHint")}>
                {(a) => <Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={inputVat} onChange={(e) => setInputVat(e.target.value)} onWheel={(e) => (e.target as HTMLInputElement).blur()} {...a} />}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={creditable} onChange={(e) => setCreditable(e.target.checked)} />
              {t("creditableLabel")}
            </label>
            {monthly !== undefined && monthly > 0 && (
              <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                {t("monthlyPreview", { rate: rate ?? 0 })} <Money value={monthly} className="font-medium text-foreground" />
              </p>
            )}
            <Field id="fa-memo" label={t("field.memo")} error={errors.memo?.[0]}>
              {(a) => <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("memoPlaceholder")} {...a} />}
            </Field>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={pending || !valid}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={pending || !valid} onClick={() => save("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
