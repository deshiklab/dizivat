"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

type ButtonProps = React.ComponentProps<typeof Button>

/**
 * Downloads the on-screen printable form (the `.print-area` element by default) as an A4 PDF.
 * `prepare` runs first — e.g. switch to the tab that renders the form. The exporter is lazy-loaded on click.
 */
export function PdfButton({
  filename, title, prepare, target = ".print-area", landscape, variant = "outline", size = "sm", className, label,
}: {
  /** Without extension; unsafe characters are replaced. */
  filename: string
  title?: string
  prepare?: () => unknown
  target?: string
  landscape?: boolean
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
  className?: string
  label?: React.ReactNode
}) {
  const tc = useTranslations("common")
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    const id = toast.loading(tc("pdfBusy"))
    try {
      await prepare?.()
      const el = await waitForVisible(target)
      const { exportPdf } = await import("@/lib/pdf/export")
      const file = `${safeFileName(filename)}.pdf`
      await exportPdf(el, { filename: file, title: title ?? filename, landscape })
      toast.success(tc("pdfDone", { file }), { id })
    } catch (e) {
      console.error("PDF export failed", e)
      toast.error(tc("pdfFailed"), { id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={run} disabled={busy} aria-busy={busy} data-testid="pdf-download" title={tc("pdfHint")}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />} {label ?? tc("pdf")}
    </Button>
  )
}

export function safeFileName(s: string): string {
  return s.normalize("NFC").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 120) || "document"
}

/** The last visible match — sheets render above pages, and hidden tabs aren't laid out. */
async function waitForVisible(selector: string, timeoutMs = 5000): Promise<HTMLElement> {
  const t0 = performance.now()
  for (;;) {
    const all = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => el.getClientRects().length > 0)
    if (all.length) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) // let the tab finish rendering
      return all[all.length - 1]
    }
    if (performance.now() - t0 > timeoutMs) throw new Error(`No printable element for ${selector}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
