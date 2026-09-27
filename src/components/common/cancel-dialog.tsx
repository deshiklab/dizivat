"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

const MIN = 10, MAX = 300
const PRESETS = ["wrongParty", "wrongQty", "returned", "duplicate"] as const

/**
 * Cancellation needs a reason (kept in the audit trail and shown on the document).
 * Replaces the bare confirm() of Sprint 1 — NBR auditors ask why an issued invoice was cancelled.
 */
export function CancelDialog({ open, onOpenChange, docNo, approved, pending, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; docNo: string; approved: boolean; pending: boolean; onConfirm: (reason: string) => void
}) {
  const t = useTranslations("cancel")
  const [reason, setReason] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  React.useEffect(() => { if (open) { setReason(""); setTouched(false) } }, [open])
  const len = reason.trim().length
  const invalid = len < MIN
  const submit = (e: React.FormEvent) => { e.preventDefault(); setTouched(true); if (!invalid) onConfirm(reason.trim()) }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("title", { no: docNo })}</AlertDialogTitle>
            <AlertDialogDescription>{approved ? t("bodyApproved") : t("bodyDraft")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground" id="cancel-presets">{t("common")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="cancel-presets">
              {PRESETS.map((p) => (
                <Button key={p} type="button" size="xs" variant={reason === t(`preset.${p}`) ? "secondary" : "outline"} onClick={() => { setReason(t(`preset.${p}`)); setTouched(true) }}>
                  {t(`presetShort.${p}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">{t("reason")} <span className="text-destructive" aria-hidden>*</span></Label>
            <Textarea id="cancel-reason" rows={3} maxLength={MAX} value={reason} autoFocus
              onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)}
              aria-invalid={touched && invalid ? true : undefined} aria-describedby="cancel-reason-hint" />
            <div id="cancel-reason-hint" className="flex justify-between gap-2 text-xs">
              {touched && invalid
                ? <span className="font-medium text-destructive" role="alert">{t("min", { n: MIN })}</span>
                : <span className="text-muted-foreground">{t("hint")}</span>}
              <span className="tabular text-muted-foreground">{len}/{MAX}</span>
            </div>
          </div>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("keep")}</Button>
            <Button type="submit" variant="destructive" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <XCircle />} {t("confirm")}</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
