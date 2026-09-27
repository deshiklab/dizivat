"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/** Label + control + hint + error, wired with aria-describedby / aria-invalid. */
export function Field({ id, label, required, error, hint, className, children }: {
  id: string; label: string; required?: boolean; error?: string; hint?: string; className?: string
  children: (a: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean }) => React.ReactNode
}) {
  const tv = useTranslations("validation")
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="text-sm">
        {label}{required && <span className="text-destructive" aria-hidden> *</span>}
      </Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, "aria-required": required || undefined })}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs font-medium text-destructive" role="alert">{tv.has(error) ? tv(error) : error}</p>}
    </div>
  )
}

export function useUnsavedGuard(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])
}
