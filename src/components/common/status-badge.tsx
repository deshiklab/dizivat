"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const tone = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-muted text-muted-foreground",
} as const
export type Tone = keyof typeof tone

/** Colour is never the only signal: every badge carries an icon or text (WCAG 1.4.1). */
export function Pill({ tone: t = "neutral", children, className, icon: Icon }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: React.ElementType }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap", tone[t], className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  )
}

export function ProcessBadge({ value }: { value: "Created" | "Approved" | "Cancelled" }) {
  const t = useTranslations("process")
  const map = { Created: ["warning", CircleDashed], Approved: ["success", CheckCircle2], Cancelled: ["danger", XCircle] } as const
  const [tn, icon] = map[value]
  return <Pill tone={tn} icon={icon}>{t(value)}</Pill>
}

export function ModeBadge({ value }: { value: string }) {
  const t = useTranslations("mode")
  const tn: Tone = value === "Foreign" ? "info" : value === "Non-registered" ? "neutral" : "success"
  const key = value === "Non-registered" ? "NonRegistered" : value
  return <Pill tone={tn} className="rounded-md">{t(key)}</Pill>
}
