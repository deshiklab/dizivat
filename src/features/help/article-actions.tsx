"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { ChevronDown, Download, FileCode2, FileText, Link2, Mail, MessageCircle, Printer, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { appUrl } from "@/lib/base-path"
import { useKbExport } from "./use-kb-export"

/** Print · PDF · Share · Download for one article. */
export function ArticleActions({ slug, title, summary }: { slug: string; title: string; summary: string }) {
  const t = useTranslations("help")
  const locale = useLocale()
  const { busy, print, pdf, download } = useKbExport(slug)
  const [canShare, setCanShare] = React.useState(false)
  React.useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), [])

  const url = () => window.location.origin + appUrl(`/${locale}/help/${slug}`)
  const copy = async () => {
    try { await navigator.clipboard.writeText(url()); toast.success(t("linkCopied")) }
    catch { toast.error(t("copyFailed")) }
  }
  const nativeShare = () => navigator.share({ title: `${title} · DiziVAT`, text: summary, url: url() }).catch(() => {})
  const text = t("shareText", { title })
  const mailto = () => `mailto:?subject=${encodeURIComponent(t("emailSubject", { title }))}&body=${encodeURIComponent(`${text}\n\n${summary}\n\n${url()}`)}`
  const wa = () => `https://wa.me/?text=${encodeURIComponent(`${text}: ${url()}`)}`

  return (
    <div className="no-print flex flex-wrap items-center gap-2" aria-busy={busy}>
      <Button variant="outline" size="sm" onClick={print} disabled={busy}><Printer /> {t("print")}</Button>
      <Button variant="outline" size="sm" onClick={pdf} disabled={busy} title={t("pdfHint")}><FileText /> {t("pdf")}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><Share2 /> {t("share")} <ChevronDown className="opacity-60" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canShare && <DropdownMenuItem onClick={nativeShare}><Share2 /> {t("shareNative")}</DropdownMenuItem>}
          <DropdownMenuItem onClick={copy}><Link2 /> {t("copyLink")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { window.location.href = mailto() }}><Mail /> {t("email")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(wa(), "_blank", "noopener")}><MessageCircle /> {t("whatsapp")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" disabled={busy} />}><Download /> {busy ? t("preparing") : t("download")} <ChevronDown className="opacity-70" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={pdf}><FileText /> {t("downloadPdf")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("html")}><FileCode2 /> {t("downloadHtml")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("md")}><FileText /> {t("downloadMd")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** The whole manual: print, PDF, HTML, Markdown. */
export function ManualActions() {
  const t = useTranslations("help")
  const { busy, print, pdf, download } = useKbExport(null)
  return (
    <div className="no-print flex flex-wrap items-center gap-2" aria-busy={busy}>
      <Button variant="outline" size="sm" onClick={print} disabled={busy}><Printer /> {t("printManual")}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" disabled={busy} />}><Download /> {busy ? t("preparing") : t("manual")} <ChevronDown className="opacity-70" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={pdf}><FileText /> {t("manualPdf")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => download("html")}><FileCode2 /> {t("manualHtml")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => download("md")}><FileText /> {t("manualMd")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
