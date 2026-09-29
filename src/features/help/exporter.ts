/**
 * Browser side of print / share / download. Imported dynamically on first use, so article text and the
 * exporters never weigh on the page's initial JavaScript.
 */
import { loadHelp } from "@/content/help"
import { articleMarkdown, htmlDocument, manualMarkdown, type ExportCtx, type ExportLabels } from "@/lib/help/export"
import { BASE_PATH, STATIC_DEMO } from "@/lib/base-path"

export type ExportFormat = "html" | "md"
export interface ExportRequest {
  locale: string
  /** null = the whole manual */
  slug: string | null
  labels: ExportLabels
  manualTitle: string
  manualSubtitle: string
}

const root = () => window.location.origin + BASE_PATH

/** The app's own web fonts (Inter + Noto Sans Bengali), with absolute URLs, so printed Bangla matches the screen. */
function appFonts() {
  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList
    try { list = sheet.cssRules } catch { continue }
    const base = sheet.href ?? window.location.href
    for (const r of Array.from(list)) {
      if (r instanceof CSSFontFaceRule) rules.push(r.cssText.replace(/url\((["']?)([^)"']+)\1\)/g, (_m, _q, u: string) => `url("${new URL(u, base).href}")`))
    }
  }
  const css = getComputedStyle(document.documentElement)
  const vars = [css.getPropertyValue("--font-inter"), css.getPropertyValue("--font-bengali")].map((v) => v.trim()).filter(Boolean)
  const stack = [...vars, `"Noto Sans Bengali", "Nirmala UI", Vrinda, system-ui, "Segoe UI", Roboto, Arial, sans-serif`].join(", ")
  return { css: rules.join("\n"), stack }
}

async function prepare(req: ExportRequest) {
  const all = await loadHelp(req.locale)
  const articles = req.slug ? all.filter((a) => a.slug === req.slug) : all
  if (!articles.length) throw new Error(`unknown article ${req.slug}`)
  const ctx: ExportCtx = { locale: req.locale, root: root(), trailingSlash: STATIC_DEMO, inDoc: new Set(articles.map((a) => a.slug)) }
  return { articles, ctx }
}

export async function buildHtml(req: ExportRequest) {
  const { articles, ctx } = await prepare(req)
  const fonts = appFonts()
  const html = htmlDocument({
    title: req.slug ? `${articles[0].title} · DiziVAT` : req.manualTitle,
    subtitle: req.manualSubtitle, articles, ctx, labels: req.labels, manual: !req.slug, fontCss: fonts.css, fontStack: fonts.stack,
  })
  return { html, title: req.slug ? articles[0].title : req.manualTitle }
}

export async function buildMarkdown(req: ExportRequest) {
  const { articles, ctx } = await prepare(req)
  return req.slug ? articleMarkdown(articles[0], ctx, req.labels) : manualMarkdown(req.manualTitle, req.manualSubtitle, articles, ctx, req.labels)
}

export const fileName = (req: Pick<ExportRequest, "slug" | "locale">, ext: ExportFormat) =>
  `DiziVAT-${req.slug ?? "User-Guide"}-${req.locale}.${ext}`

export function saveFile(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = Object.assign(document.createElement("a"), { href: url, download: name, rel: "noopener" })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Print a standalone document from a hidden frame: clean A4 layout, no app chrome, works for one page or 100. */
export function printHtml(html: string, title: string) {
  document.getElementById("kb-print-frame")?.remove()
  const frame = Object.assign(document.createElement("iframe"), { id: "kb-print-frame", title, srcdoc: html })
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" })
  frame.onload = async () => {
    const w = frame.contentWindow
    if (!w) return
    try { await w.document.fonts?.ready } catch { /* print anyway */ }
    document.documentElement.dataset.kbPrinted = title
    w.focus()
    w.print()
  }
  document.body.appendChild(frame)
}
