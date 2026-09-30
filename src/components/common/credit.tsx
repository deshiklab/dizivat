"use client"

import { useTranslations } from "next-intl"
import { CREDIT } from "@/lib/brand"
import { cn } from "@/lib/utils"

/**
 * Copyright / credit line: © BITSCOL (www.bitscol.com), Email: sales@bitscol.com, Mobile: +8801711853769.
 * The owner, web address, e-mail and phone are proper nouns and stay as-is in both languages; only the labels translate.
 */
export function Credit({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const t = useTranslations("copyright")
  const a = cn("underline-offset-2 hover:underline focus-visible:underline", linkClassName)
  return (
    <p className={cn("text-xs", className)} data-testid="credit">
      © {CREDIT.owner} (<a href={CREDIT.url} target="_blank" rel="noopener noreferrer" className={a}>{CREDIT.web}</a>),{" "}
      {t("email")}: <a href={`mailto:${CREDIT.email}`} className={a}>{CREDIT.email}</a>,{" "}
      {t("mobile")}: <a href={`tel:${CREDIT.mobile}`} className={cn(a, "tabular")}>{CREDIT.mobile}</a>
    </p>
  )
}
