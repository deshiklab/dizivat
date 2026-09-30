/**
 * Client-side PDF export for the printable statutory forms (Mushak 6.3, 6.7, 6.8, 6.4, 4.3, 6.6, 6.10, 9.1, TR-6 …).
 *
 * Why client-side: the forms are already laid out as A4 HTML for print. Rasterising that exact DOM keeps the PDF
 * pixel-identical to Print (Bangla shaping, oklch colours, web fonts), needs no headless Chromium on the 512 MB
 * server, and works on the static GitHub Pages demo too. The trade-off is an image PDF (text is not selectable).
 *
 * Pipeline: clone the form into an off-screen A4-width host (light theme, print-only bits stripped) → find page
 * cuts that never slice through a line of text (preferring table-row and block boundaries) → rasterise each page
 * slice with modern-screenshot (SVG foreignObject, so the browser itself renders it) → JPEG → a minimal PDF 1.4.
 *
 * This module is only ever loaded with `import()` from PdfButton, so it costs nothing on first paint.
 */
import { domToCanvas } from "modern-screenshot"

export interface PdfOptions {
  filename: string
  title: string
  landscape?: boolean
  /** Target raster resolution on paper. 240 dpi keeps 7 pt table text crisp at ~150–300 KB per page. */
  dpi?: number
}

const PT_PER_MM = 72 / 25.4
const PX_PER_MM = 96 / 25.4
const MARGIN_MM = 12 // same as `@page { margin: 12mm }` in globals.css

export async function exportPdf(source: HTMLElement, opts: PdfOptions): Promise<{ pages: number; bytes: number }> {
  const [pageWmm, pageHmm] = opts.landscape ? [297, 210] : [210, 297]
  const contentWmm = pageWmm - 2 * MARGIN_MM
  const contentHmm = pageHmm - 2 * MARGIN_MM
  const contentWpx = Math.round(contentWmm * PX_PER_MM)

  await document.fonts?.ready
  // An A4-wide iframe, like the printed page: responsive breakpoints resolve against the paper width (not the
  // 1440 px window), and the page's dark-mode class isn't carried over, so the PDF is always the light print look.
  const frame = await paperFrame(contentWpx)
  try {
    const doc = frame.contentDocument!
    const host = doc.createElement("div")
    Object.assign(host.style, { position: "absolute", left: "0", top: "0", width: `${contentWpx}px`, background: "#ffffff", overflow: "hidden" })
    const mover = doc.createElement("div")
    const clone = doc.importNode(source, true) as HTMLElement
    prepareClone(clone)
    mover.appendChild(clone)
    host.appendChild(mover)
    doc.body.appendChild(host)
    await doc.fonts?.ready

    // Wide registers (e.g. Mushak 6.1/6.2) overflow A4: lay them out at their natural width and scale to fit.
    const docW = Math.max(contentWpx, Math.ceil(clone.scrollWidth), widestDescendant(clone))
    if (docW > contentWpx) { host.style.width = `${docW}px`; frame.style.width = `${docW}px` }

    const ptPerPx = (contentWmm * PT_PER_MM) / docW
    const sliceH = (contentHmm * PT_PER_MM) / ptPerPx

    const dpi = opts.dpi ?? 240
    const scale = Math.min(3, Math.max(1.25, (dpi * ptPerPx) / 72))

    // Lay the copy out already magnified (CSS zoom) and capture at 1:1. Scaling the raster instead would enlarge
    // glyph positions that Chrome rounds to whole pixels inside SVG images ("Invo ice"); at zoom they stay sub-pixel.
    Object.assign(clone.style, { width: `${docW}px`, zoom: String(scale) })
    const W = Math.ceil(docW * scale)
    host.style.width = `${W}px`
    // Measure page cuts in the zoomed layout that is actually captured (zoom can shift line boxes by a few px).
    // Rect units differ by engine (zoomed vs. unzoomed), so derive the factor from the clone's own width.
    const rect = clone.getBoundingClientRect()
    const toPx = (docW * scale) / rect.width // rect units → captured px
    const docHz = Math.ceil(rect.height * toPx)
    const cuts = pageCuts(clone, docHz, Math.floor(sliceH * scale), toPx)

    // Render several pages per capture (fewer font/style embeds) while staying under Safari's ~16.7 MP canvas cap.
    const maxChunkH = Math.min(16_000, Math.floor(16_000_000 / W))
    const pages: { jpeg: Uint8Array; w: number; h: number; hPt: number }[] = []
    let i = 0
    while (i < cuts.length - 1) {
      let j = i + 1
      while (j < cuts.length - 1 && cuts[j + 1] - cuts[i] <= maxChunkH) j++
      const y0 = cuts[i]
      const chunkH = Math.max(1, cuts[j] - y0)
      host.style.height = `${chunkH}px`
      mover.style.transform = `translateY(${-y0}px)`
      const chunk = await domToCanvas(host, { width: W, height: chunkH, scale: 1, backgroundColor: "#ffffff", timeout: 20_000 })
      for (let k = i; k < j; k++) {
        const top = cuts[k] - y0
        const h = Math.max(1, Math.min(chunk.height, cuts[k + 1] - y0) - top)
        const pageCanvas = document.createElement("canvas")
        pageCanvas.width = chunk.width
        pageCanvas.height = h
        const ctx = pageCanvas.getContext("2d")!
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, pageCanvas.width, h)
        ctx.drawImage(chunk, 0, top, chunk.width, h, 0, 0, chunk.width, h)
        pages.push({ jpeg: await canvasToJpeg(pageCanvas), w: pageCanvas.width, h, hPt: (contentWmm * PT_PER_MM * h) / chunk.width }) // exact image aspect
      }
      i = j
    }

    const pdf = buildPdf(pages, {
      pageW: pageWmm * PT_PER_MM, pageH: pageHmm * PT_PER_MM, margin: MARGIN_MM * PT_PER_MM, contentW: contentWmm * PT_PER_MM, title: opts.title,
    })
    download(pdf, opts.filename)
    return { pages: pages.length, bytes: pdf.byteLength }
  } finally {
    frame.remove()
  }
}

/** Off-screen same-origin iframe carrying the app's stylesheets, fonts and <html> attributes (minus dark mode). */
async function paperFrame(width: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.tabIndex = -1
  Object.assign(frame.style, { position: "fixed", left: "-100000px", top: "0", width: `${width}px`, height: "1200px", border: "0", visibility: "visible", pointerEvents: "none" })
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>")
  doc.close()
  for (const { name, value } of Array.from(document.documentElement.attributes)) {
    if (name === "style") continue
    doc.documentElement.setAttribute(name, name === "class" ? value.split(/\s+/).filter((c) => c !== "dark").join(" ") : value)
  }
  doc.documentElement.style.colorScheme = "light"
  doc.body.className = document.body.className
  Object.assign(doc.body.style, { margin: "0", background: "#ffffff" })
  const loads: Promise<unknown>[] = []
  document.head.querySelectorAll<HTMLElement>("link[rel='stylesheet'], style").forEach((n) => {
    const copy = doc.importNode(n, true) as HTMLElement
    if (copy.tagName === "LINK") loads.push(new Promise((r) => { (copy as HTMLLinkElement).onload = (copy as HTMLLinkElement).onerror = r }))
    doc.head.appendChild(copy)
  })
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 5000))])
  return frame
}

/** Make the clone look like the printed page: no card chrome, no screen-only controls, no inner scrollbars. */
function prepareClone(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".no-print, .print\\:hidden, .sr-only, [data-pdf-skip]").forEach((n) => n.remove())
  Object.assign(root.style, {
    margin: "0", padding: "0", width: "100%", maxWidth: "none", boxShadow: "none", border: "0", borderRadius: "0",
    background: "#ffffff", transformOrigin: "0 0",
  } satisfies Partial<CSSStyleDeclaration>)
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    if (el !== root && /(^|\s)overflow-(x-|y-)?(auto|scroll|hidden)(\s|$)/.test(el.getAttribute("class") ?? "")) {
      el.style.overflow = "visible"
      el.style.maxHeight = "none"
    }
    if (el.getAttribute("tabindex") !== null) el.removeAttribute("tabindex")
  }
}

function widestDescendant(root: HTMLElement): number {
  const left = root.getBoundingClientRect().left
  let max = 0
  root.querySelectorAll<HTMLElement>("table, pre, img, svg").forEach((el) => { max = Math.max(max, el.getBoundingClientRect().right - left) })
  return Math.ceil(max)
}

/**
 * Page cut positions (px from the top of the clone), always starting at 0 and ending at docH.
 * A cut is "safe" when it doesn't cross a text line, image or `break-inside: avoid` block. Among safe cuts in the
 * lower part of a page we prefer the bottom of a table row / block so rows are never split.
 */
function pageCuts(root: HTMLElement, docH: number, sliceH: number, k: number): number[] {
  const top = root.getBoundingClientRect().top
  const blocked: [number, number][] = []
  const push = (r: DOMRect | DOMRectReadOnly, pad = 1) => { if (r.height > 0) blocked.push([(r.top - top) * k - pad, (r.bottom - top) * k + pad]) }

  const doc = root.ownerDocument
  const win = doc.defaultView ?? window
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue?.trim()) continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) push(r)
  }
  root.querySelectorAll("img, svg, canvas, input, textarea, select").forEach((el) => push(el.getBoundingClientRect()))
  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const bi = win.getComputedStyle(el).breakInside
    if (bi === "avoid" || bi === "avoid-page") { const r = el.getBoundingClientRect(); if (r.height * k < sliceH * 0.8) push(r, 0) }
  })
  blocked.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const b of blocked) {
    const last = merged[merged.length - 1]
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]); else merged.push([b[0], b[1]])
  }
  const isSafe = (y: number) => !merged.some(([a, b]) => y > a && y < b)

  const preferred = new Set<number>()
  root.querySelectorAll("tr, li, p, dl, section, header, footer, table, h1, h2, h3, h4").forEach((el) => {
    preferred.add(Math.round((el.getBoundingClientRect().bottom - top) * k))
  })
  const prefSorted = [...preferred].sort((a, b) => a - b)

  const cuts = [0]
  let start = 0
  while (docH - start > sliceH) {
    const limit = start + sliceH
    let cut = -1
    // 1) the lowest row/block boundary in the bottom 40% of the page that doesn't slice text
    for (let i = prefSorted.length - 1; i >= 0; i--) {
      const y = prefSorted[i]
      if (y > limit) continue
      if (y < start + sliceH * 0.6) break
      if (isSafe(y)) { cut = y; break }
    }
    // 2) otherwise the lowest gap between text lines
    if (cut < 0) {
      if (isSafe(limit)) cut = limit
      else {
        const crossing = merged.find(([a, b]) => limit > a && limit < b)!
        if (crossing[0] > start + sliceH * 0.3) cut = Math.floor(crossing[0])
      }
    }
    // 3) a single block taller than a page: hard cut
    if (cut <= start) cut = limit
    cuts.push(cut)
    start = cut
  }
  // Don't emit a trailing page that only holds bottom padding / a card border.
  const tailHasContent = merged.some(([, b]) => b > start + 2)
  if (cuts.length === 1 || tailHasContent) cuts.push(docH)
  return cuts
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
  if (!blob) throw new Error("Canvas could not be encoded (tainted or too large)")
  return new Uint8Array(await blob.arrayBuffer())
}

/** Minimal PDF 1.4 writer: one DCT (JPEG) image XObject per page, placed inside the print margins. */
export function buildPdf(
  pages: { jpeg: Uint8Array; w: number; h: number; hPt: number }[],
  g: { pageW: number; pageH: number; margin: number; contentW: number; title: string },
): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const write = (d: string | Uint8Array) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); length += b.byteLength }
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
  const obj = (id: number, body: () => void) => { offsets[id] = length; write(`${id} 0 obj\n`); body(); write("\nendobj\n") }

  const n = pages.length
  const pageId = (i: number) => 4 + i * 3
  write("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n") // header + binary marker (non-ASCII bytes)
  obj(1, () => write("<< /Type /Catalog /Pages 2 0 R >>"))
  obj(2, () => write(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`))
  obj(3, () => write(`<< /Title ${pdfText(g.title)} /Producer (DiziVAT) /Creator (DiziVAT) /CreationDate (D:${pdfDate(new Date())}) >>`))
  pages.forEach((p, i) => {
    const id = pageId(i)
    const content = `q ${f(g.contentW)} 0 0 ${f(p.hPt)} ${f(g.margin)} ${f(g.pageH - g.margin - p.hPt)} cm /Im0 Do Q`
    obj(id, () => write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(g.pageW)} ${f(g.pageH)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`))
    obj(id + 1, () => write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(id + 2, () => {
      write(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.byteLength} >>\nstream\n`)
      write(p.jpeg)
      write("\nendstream")
    })
  })
  const size = 4 + n * 3
  const xref = length
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let id = 1; id < size; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  write(table)
  write(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

/** PDF text string as UTF-16BE hex so Bangla titles survive. */
function pdfText(s: string): string {
  let hex = "FEFF"
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase()
  return `<${hex}>`
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function download(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
