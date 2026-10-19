"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCheck, Loader2, Plus, Save, Scale, Trash2 } from "lucide-react"
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
import type { ManualJournalEntry } from "@/lib/types"
import { useR4Refresh } from "@/features/r4/r4-actions"

interface LineValues { account: string; debit: string; credit: string }

const blankLine = (): LineValues => ({ account: "", debit: "", credit: "" })

/**
 * New / edit-draft manual journal entry (JE-): the lines must balance to the poisha and name open chart
 * accounts — the balance meter refuses to save what doesn't. This is the only form that writes the ledger
 * directly; everything else the books hold was derived from a document.
 */
export function JournalForm({ open, onOpenChange, doc, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; doc?: ManualJournalEntry | null; onSaved?: (d: ManualJournalEntry) => void
}) {
  const t = useTranslations("journal")
  const tc = useTranslations("common")
  const can = useCan()
  const refresh = useR4Refresh()
  const chart = useQuery({ queryKey: ["chart"], queryFn: () => api.accounting.chart.list(), enabled: open })
  const config = useQuery({ queryKey: ["accounting-config"], queryFn: () => api.accounting.config(), enabled: open })

  const [date, setDate] = React.useState(TODAY)
  const [memo, setMemo] = React.useState("")
  const [lines, setLines] = React.useState<LineValues[]>([blankLine(), blankLine()])
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})
  React.useEffect(() => {
    if (!open) return
    setErrors({})
    if (doc) {
      setDate(doc.date)
      setMemo(doc.memo)
      setLines([...doc.lines.map((l) => ({ account: l.account, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "" })), ...(!doc.lines.length ? [] : doc.lines.length < 2 ? [blankLine()] : [])])
    } else { setDate(TODAY); setMemo(""); setLines([blankLine(), blankLine()]) }
  }, [open, doc])

  const setLine = (i: number, patch: Partial<LineValues>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const num = (v: string) => round2(Number(v) || 0)
  const debit = round2(lines.reduce((s, l) => s + num(l.debit), 0))
  const credit = round2(lines.reduce((s, l) => s + num(l.credit), 0))
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0
  const filled = lines.filter((l) => l.account && (num(l.debit) > 0 || num(l.credit) > 0))

  const save = useMutation({
    mutationFn: (process: "Created" | "Approved") => {
      const body = {
        date, memo,
        lines: lines.filter((l) => l.account && (num(l.debit) > 0 || num(l.credit) > 0)).map((l) => ({ account: l.account, debit: num(l.debit), credit: num(l.credit) })),
        process,
      }
      return doc ? api.accounting.journal.update(doc.id, body) : api.accounting.journal.create(body)
    },
    onSuccess: (d) => { refresh("journal", d); toast.success(t(d.process === "Approved" ? "approved" : "saved", { no: d.no })); onSaved?.(d); onOpenChange(false) },
    onError: (e) => {
      if (e instanceof ApiError && e.errors && Object.keys(e.errors).length) { setErrors(e.errors); toast.error(e.message) }
      else toast.error(e.message)
    },
  })


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <form onSubmit={(e) => { e.preventDefault(); if (balanced) save.mutate("Created") }} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{doc ? t("editTitle", { no: doc.no }) : t("newTitle")}</SheetTitle>
            <SheetDescription>{t("newSub")}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="je-date" label={t("field.date")} required error={errors.date?.[0]} hint={config.data?.closedUpTo ? t("closedHint", { date: config.data.closedUpTo }) : undefined}>
                {(a) => <Input type="date" max={TODAY} min={config.data?.closedUpTo ?? undefined} value={date} onChange={(e) => setDate(e.target.value)} {...a} />}
              </Field>
              <Field id="je-memo" label={t("field.memo")} required error={errors.memo?.[0]}>
                {(a) => <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t("memoPlaceholder")} {...a} />}
              </Field>
            </div>
            <Field id="je-lines" label={t("field.lines")} required error={errors.lines?.[0]}>
              {() => (
                <div className="overflow-x-auto rounded-md border" aria-describedby="je-lines">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t("field.lines")}</caption>
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th scope="col" className="p-2 font-medium">{t("field.account")}</th>
                        <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.debit")}</th>
                        <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.credit")}</th>
                        <th scope="col" className="w-10 p-2"><span className="sr-only">{tc("actions")}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-1.5">
                            <Select value={l.account} onValueChange={(v) => setLine(i, { account: v ?? "" })} items={(chart.data ?? []).filter((a) => a.active).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))}>
                              <SelectTrigger className="w-full" aria-label={t("field.account")}><SelectValue placeholder={t("pickAccount")} /></SelectTrigger>
                              <SelectContent>{(chart.data ?? []).filter((a) => a.active).map((a) => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="p-1.5"><Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={l.debit} aria-label={t("col.debit")} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} onWheel={(e) => (e.target as HTMLInputElement).blur()} /></td>
                          <td className="p-1.5"><Input inputMode="decimal" type="number" step="0.01" min={0} className="text-right tabular" value={l.credit} aria-label={t("col.credit")} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} onWheel={(e) => (e.target as HTMLInputElement).blur()} /></td>
                          <td className="p-1.5">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeLine")} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/50 font-medium">
                        <td className="p-2">
                          <Button type="button" variant="ghost" size="sm" disabled={lines.length >= 60} onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus /> {t("addLine")}</Button>
                        </td>
                        <td className="p-2 text-right tabular"><Money value={debit} /></td>
                        <td className="p-2 text-right tabular"><Money value={credit} /></td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Field>
            <div className={`flex items-center justify-between gap-3 rounded-md border p-3 text-sm ${balanced ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"}`} aria-live="polite">
              <span className="inline-flex items-center gap-1.5 font-medium"><Scale className="size-3.5" aria-hidden /> {balanced ? t("balanced") : t("unbalanced")}</span>
              <span className="tabular text-muted-foreground">{t("difference")}: <Money value={Math.abs(round2(debit - credit))} /></span>
            </div>
          </div>
          <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={can("doc.approve") ? "outline" : "default"} disabled={save.isPending || !balanced || filled.length < 2 || memo.trim().length < 3}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t("saveDraft")}</Button>
            {can("doc.approve") && <Button type="button" disabled={save.isPending || !balanced || filled.length < 2 || memo.trim().length < 3} onClick={() => save.mutate("Approved")}><CheckCheck /> {t("saveApprove")}</Button>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
