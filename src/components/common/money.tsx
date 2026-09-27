"use client"
import { useLocale } from "next-intl"
import { fmtMoney, fmtNum } from "@/lib/format"
import { cn } from "@/lib/utils"

export function Money({ value, className, muted0 = true }: { value: number; className?: string; muted0?: boolean }) {
  const locale = useLocale()
  return <span className={cn("tabular whitespace-nowrap", muted0 && !value && "text-muted-foreground", className)}>{fmtMoney(value, locale)}</span>
}
export function Num({ value, digits = 2, className }: { value: number; digits?: number; className?: string }) {
  const locale = useLocale()
  return <span className={cn("tabular whitespace-nowrap", className)}>{fmtNum(value, locale, digits)}</span>
}
