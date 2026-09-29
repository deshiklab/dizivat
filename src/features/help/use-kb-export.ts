"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { fmtDate } from "@/lib/format"
import { TODAY } from "@/lib/company"
import type { ExportLabels } from "@/lib/help/export"
import type { ExportFormat, ExportRequest } from "./exporter"

/** Print / PDF / download for one article (slug) or the whole manual (null). Loads the exporter on first use. */
export function useKbExport(slug: string | null) {
  const t = useTranslations("help")
  const locale = useLocale()
  const [busy, setBusy] = React.useState(false)

  const request = (): ExportRequest => {
    const labels: ExportLabels = {
      contents: t("contents"), tip: t("tip"), note: t("note"), warning: t("warning"),
      generated: t("generated", { date: fmtDate(TODAY, locale) }), source: t("source"),
      category: (c) => t(`cat.${c}` as "cat.sales"),
    }
    return { locale, slug, labels, manualTitle: t("manualTitle"), manualSubtitle: t("manualSubtitle") }
  }

  const run = async (fn: (m: typeof import("./exporter"), req: ExportRequest) => Promise<void> | void) => {
    if (busy) return
    setBusy(true)
    try { await fn(await import("./exporter"), request()) }
    catch { toast.error(t("exportFailed")) }
    finally { setBusy(false) }
  }

  const print = () => run(async (m, req) => { const d = await m.buildHtml(req); m.printHtml(d.html, d.title) })
  const pdf = () => run(async (m, req) => { toast.info(t("pdfHint")); const d = await m.buildHtml(req); m.printHtml(d.html, d.title) })
  const download = (fmt: ExportFormat) => run(async (m, req) => {
    const name = m.fileName(req, fmt)
    if (fmt === "html") m.saveFile(name, (await m.buildHtml(req)).html, "text/html")
    else m.saveFile(name, await m.buildMarkdown(req), "text/markdown")
    toast.success(t("downloaded", { file: name }))
  })
  return { busy, print, pdf, download }
}
