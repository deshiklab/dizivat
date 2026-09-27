"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Shows a one-time temporary password exactly once (after invite or reset). It is never retrievable again —
 * the admin passes it to the user, who must change it at first sign-in.
 */
export function TempPasswordDialog({ value, onClose }: { value: { username: string; password: string } | null; onClose: () => void }) {
  const t = useTranslations("users")
  // keep content during the close animation (open={!!value} alone would blank it)
  const [shown, setShown] = React.useState(value)
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => { if (value) { setShown(value); setOpen(true); setCopied(false) } }, [value])
  const copy = async () => {
    if (!shown) return
    try { await navigator.clipboard.writeText(shown.password); setCopied(true) } catch { /* clipboard blocked: the text is selectable */ }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-primary" aria-hidden /> {t("tempTitle")}</DialogTitle>
          <DialogDescription>{t("tempBody", { username: shown?.username ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
          <code className="flex-1 select-all font-mono text-lg tracking-wide" data-testid="temp-password">{shown?.password}</code>
          <Button type="button" variant="outline" size="sm" onClick={copy} aria-live="polite">
            {copied ? <><Check /> {t("copied")}</> : <><Copy /> {t("copy")}</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("tempHint")}</p>
        <DialogFooter>
          <Button onClick={() => { setOpen(false); onClose() }}>{t("tempDone")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
