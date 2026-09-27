"use client"

import { useLocale, useTranslations } from "next-intl"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmProvider, useConfirm } from "@/components/common/confirm"
import { resetDemo } from "@/lib/demo/boot"

function ResetButton() {
  const t = useTranslations("auth"), tc = useTranslations("common")
  const locale = useLocale()
  const confirm = useConfirm()
  const onClick = async () => {
    if (await confirm({ title: t("resetDemo"), description: t("resetDemoConfirm"), confirm: t("resetDemo"), cancel: tc("cancel"), destructive: true })) resetDemo(locale)
  }
  return <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onClick}><RotateCcw /> {t("resetDemo")}</Button>
}

/** Static GitHub Pages demo: wipes this browser's demo data (the sign-in page has no app shell, hence its own provider). */
export function DemoResetButton() {
  return <ConfirmProvider><ResetButton /></ConfirmProvider>
}
