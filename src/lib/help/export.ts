/**
 * Knowledge base → standalone HTML (print / "Save as PDF" / download) and Markdown.
 * Pure string functions: no DOM, no React — usable on the server and in the browser.
 */
import type { Article, Block } from "@/content/help/types"
import { parseInline, plainInline, sectionId } from "./inline"
import { CREDIT, creditText } from "@/lib/brand"

export interface ExportLabels {
  contents: string
  tip: string
  note: string
  warning: string
  /** "Generated from DiziVAT on {date}" — already formatted. */
  generated: string
  /** "Online version" */
  source: string
  /** Localised labels for the copyright line ("Email", "Mobile"). */
  email: string
  mobile: string
  category: (c: string) => string
}

export interface ExportCtx {
  locale: string
  /** Absolute app root including the base path, e.g. https://x.github.io/dizivat */
  root: string
  /** Static demo URLs end in "/". */
  trailingSlash: boolean
  /** Slugs included in this document — help: links to them become in-document anchors. */
  inDoc: Set<string>
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function articleUrl(ctx: Pick<ExportCtx, "root" | "locale" | "trailingSlash">, slug: string, hash = "") {
  return `${ctx.root}/${ctx.locale}/help/${slug}${ctx.trailingSlash ? "/" : ""}${hash}`
}

function resolveHref(href: string, ctx: ExportCtx) {
  if (href.startsWith("help:")) {
    const [slug, hash] = href.slice(5).split("#")
    if (ctx.inDoc.has(slug)) return `#${hash ? `${slug}--${hash}` : slug}`
    return articleUrl(ctx, slug, hash ? `#${hash}` : "")
  }
  if (href.startsWith("/")) {
    const [path, q] = href.split("?")
    const p = path === "/" ? "" : path
    return `${ctx.root}/${ctx.locale}${p}${ctx.trailingSlash ? "/" : ""}${q ? `?${q}` : ""}`
  }
  return href
}

const assetUrl = (src: string, ctx: ExportCtx) => (src.startsWith("/") ? ctx.root + src : src)

/* ------------------------------------------------------------------ HTML */

function htmlInline(src: string, ctx: ExportCtx) {
  return parseInline(src).map((t) => {
    switch (t.k) {
      case "b": return `<strong>${esc(t.v)}</strong>`
      case "i": return `<em>${esc(t.v)}</em>`
      case "code": return `<code>${esc(t.v)}</code>`
      case "kbd": return t.v.split("+").map((k) => `<kbd>${esc(k)}</kbd>`).join("+")
      case "link": return `<a href="${esc(resolveHref(t.href, ctx))}">${esc(t.v)}</a>`
      default: return esc(t.v)
    }
  }).join("")
}

function htmlBlocks(slug: string, body: Block[], ctx: ExportCtx, labels: ExportLabels, hTag: "h2" | "h3") {
  let n = 0
  return body.map((b) => {
    switch (b.t) {
      case "h": n++; return `<${hTag} id="${slug}--${sectionId(n)}">${esc(b.text)}</${hTag}>`
      case "p": return `<p>${htmlInline(b.text, ctx)}</p>`
      case "steps": return `<ol class="steps">${b.items.map((i) => `<li>${htmlInline(i, ctx)}</li>`).join("")}</ol>`
      case "list": return `<ul>${b.items.map((i) => `<li>${htmlInline(i, ctx)}</li>`).join("")}</ul>`
      case "tip": case "note": case "warning":
        return `<div class="callout ${b.t}"><strong>${esc(labels[b.t])}:</strong> ${htmlInline(b.text, ctx)}</div>`
      case "table":
        return `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${htmlInline(c, ctx)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      case "dl": return `<dl>${b.items.map(([d, v]) => `<dt>${htmlInline(d, ctx)}</dt><dd>${htmlInline(v, ctx)}</dd>`).join("")}</dl>`
      case "img": return `<figure><img src="${esc(assetUrl(b.src, ctx))}" alt="${esc(b.alt)}" />${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`
    }
  }).join("\n")
}

const CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: var(--kb-font); color: #0f1b2d; line-height: 1.6; font-size: 11pt; margin: 0 auto; max-width: 820px; padding: 28px 24px 48px; }
header.doc { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #1d5fd1; padding-bottom: 10px; margin-bottom: 20px; }
header.doc .mark { width: 28px; height: 28px; flex: none; }
header.doc .brand { font-weight: 700; font-size: 13pt; }
header.doc .meta { margin-left: auto; font-size: 9pt; color: #51607a; text-align: right; }
h1 { font-size: 22pt; line-height: 1.25; margin: 0 0 6px; }
h2 { font-size: 15pt; margin: 26px 0 8px; page-break-after: avoid; break-after: avoid; }
h3 { font-size: 12.5pt; margin: 20px 0 6px; page-break-after: avoid; break-after: avoid; }
.summary { color: #3b4a63; font-size: 12pt; margin: 0 0 18px; }
p, li, dd { orphans: 3; widows: 3; }
a { color: #1d5fd1; }
code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: .92em; background: #eef2f8; border-radius: 4px; padding: 0 4px; }
kbd { font-family: inherit; font-size: .85em; border: 1px solid #b8c3d6; border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: #f7f9fc; }
ol.steps { counter-reset: step; list-style: none; padding-left: 0; }
ol.steps > li { counter-increment: step; position: relative; padding-left: 34px; margin: 8px 0; }
ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 22px; height: 22px; border-radius: 50%; background: #1d5fd1; color: #fff; font-size: 9pt; font-weight: 700; display: grid; place-items: center; }
.callout { border-left: 4px solid #1d5fd1; background: #eef4ff; padding: 8px 12px; border-radius: 4px; margin: 12px 0; break-inside: avoid; }
.callout.tip { border-color: #047857; background: #e9f7f0; }
.callout.warning { border-color: #b45309; background: #fdf3e4; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; break-inside: auto; }
th, td { border: 1px solid #cfd8e6; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #eef2f8; }
tr { break-inside: avoid; }
dl dt { font-weight: 600; margin-top: 8px; }
dl dd { margin: 2px 0 0 0; color: #26344d; }
figure { margin: 14px 0; break-inside: avoid; }
figure img { max-width: 100%; border: 1px solid #cfd8e6; border-radius: 6px; }
figcaption { font-size: 9pt; color: #51607a; margin-top: 4px; }
article + article { break-before: page; page-break-before: always; }
.cover { min-height: 60vh; display: flex; flex-direction: column; justify-content: center; break-after: page; page-break-after: always; }
.cover h1 { font-size: 30pt; }
.toc { break-after: page; page-break-after: always; }
.toc h2 { margin-top: 0; }
.toc ol { padding-left: 18px; }
.toc > ol > li { margin-top: 10px; font-weight: 600; }
.toc > ol > li li { font-weight: 400; margin: 2px 0; }
.credit { font-size: 9pt; color: #51607a; margin-top: 32px; border-top: 1px solid #cfd8e6; padding-top: 8px; text-align: center; }
.src { font-size: 9pt; color: #51607a; margin-top: 28px; border-top: 1px solid #cfd8e6; padding-top: 8px; word-break: break-all; }
@media print { body { max-width: none; padding: 0; } a { text-decoration: none; } }
`

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1d5fd1"/><path d="M8.5 8.5h6.6c4.7 0 8 3.1 8 7.5s-3.3 7.5-8 7.5H8.5v-15Zm3.1 2.9v9.2h3.4c2.9 0 4.9-1.9 4.9-4.6s-2-4.6-4.9-4.6h-3.4Z" fill="#fff"/><circle cx="25.5" cy="23" r="2" fill="#fff"/></svg>`

export interface HtmlDocOptions {
  title: string
  subtitle?: string
  articles: Article[]
  ctx: ExportCtx
  labels: ExportLabels
  /** Extra CSS (the app's @font-face rules) and the font stack to use. */
  fontCss?: string
  fontStack?: string
  manual?: boolean
}

export function htmlDocument(o: HtmlDocOptions) {
  const { ctx, labels } = o
  const stack = o.fontStack || `"Noto Sans Bengali", "Hind Siliguri", "Nirmala UI", Vrinda, system-ui, "Segoe UI", Roboto, Arial, sans-serif`
  const head = `<!doctype html><html lang="${ctx.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title><meta name="generator" content="DiziVAT"><meta name="copyright" content="${esc(creditText(labels))}"><style>${o.fontCss ?? ""}\n:root{--kb-font:${stack}}${CSS}</style></head><body>`
  const brand = `<header class="doc">${MARK}<span class="brand">DiziVAT</span><span class="meta">${esc(labels.generated)}</span></header>`
  const credit = `<footer class="credit">© ${esc(CREDIT.owner)} (<a href="${CREDIT.url}">${esc(CREDIT.web)}</a>), ${esc(labels.email)}: <a href="mailto:${CREDIT.email}">${CREDIT.email}</a>, ${esc(labels.mobile)}: <a href="tel:${CREDIT.mobile}">${CREDIT.mobile}</a></footer>`
  const art = (a: Article, single: boolean) => {
    const h = single ? "h1" : "h2"
    return `<article id="${a.slug}"><${h}>${esc(a.title)}</${h}><p class="summary">${htmlInline(a.summary, ctx)}</p>${htmlBlocks(a.slug, a.body, ctx, labels, single ? "h2" : "h3")}${single ? `<p class="src">${esc(labels.source)}: <a href="${esc(articleUrl(ctx, a.slug))}">${esc(articleUrl(ctx, a.slug))}</a></p>` : ""}</article>`
  }
  if (!o.manual) return `${head}${brand}${o.articles.map((a) => art(a, true)).join("\n")}${credit}</body></html>`

  const cats: string[] = []
  for (const a of o.articles) if (!cats.includes(a.category)) cats.push(a.category)
  const toc = `<nav class="toc"><h2>${esc(labels.contents)}</h2><ol>${cats.map((c) => `<li>${esc(labels.category(c))}<ol>${o.articles.filter((a) => a.category === c).map((a) => `<li><a href="#${a.slug}">${esc(a.title)}</a></li>`).join("")}</ol></li>`).join("")}</ol></nav>`
  const cover = `<section class="cover">${brand}<h1>${esc(o.title)}</h1>${o.subtitle ? `<p class="summary">${esc(o.subtitle)}</p>` : ""}<p class="src">${esc(labels.source)}: <a href="${esc(`${ctx.root}/${ctx.locale}/help${ctx.trailingSlash ? "/" : ""}`)}">${esc(`${ctx.root}/${ctx.locale}/help${ctx.trailingSlash ? "/" : ""}`)}</a></p></section>`
  return `${head}${cover}${toc}${o.articles.map((a) => art(a, false)).join("\n")}${credit}</body></html>`
}

/* -------------------------------------------------------------- Markdown */

function mdInline(src: string, ctx: ExportCtx) {
  return parseInline(src).map((t) => {
    switch (t.k) {
      case "b": return `**${t.v}**`
      case "i": return `*${t.v}*`
      case "code": return `\`${t.v}\``
      case "kbd": return `<kbd>${t.v}</kbd>`
      case "link": return `[${t.v}](${resolveHref(t.href, ctx)})`
      default: return t.v.replace(/([\\*_[\]])/g, "\\$1")
    }
  }).join("")
}

const cell = (s: string) => s.replace(/\|/g, "\\|")

function mdBlocks(slug: string, body: Block[], ctx: ExportCtx, labels: ExportLabels, hashes: string, anchors: boolean) {
  let n = 0
  return body.map((b) => {
    switch (b.t) {
      case "h": n++; return `${anchors ? `<a id="${slug}--${sectionId(n)}"></a>\n` : ""}${hashes} ${b.text}`
      case "p": return mdInline(b.text, ctx)
      case "steps": return b.items.map((i, k) => `${k + 1}. ${mdInline(i, ctx)}`).join("\n")
      case "list": return b.items.map((i) => `- ${mdInline(i, ctx)}`).join("\n")
      case "tip": case "note": case "warning": return `> **${labels[b.t]}:** ${mdInline(b.text, ctx)}`
      case "table": return [`| ${b.head.map(cell).join(" | ")} |`, `| ${b.head.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.map((c) => cell(mdInline(c, ctx))).join(" | ")} |`)].join("\n")
      case "dl": return b.items.map(([d, v]) => `**${plainInline(d)}**  \n${mdInline(v, ctx)}`).join("\n\n")
      case "img": return `![${b.alt}](${assetUrl(b.src, ctx)})${b.caption ? `\n*${b.caption}*` : ""}`
    }
  }).join("\n\n")
}

export function articleMarkdown(a: Article, ctx: ExportCtx, labels: ExportLabels) {
  return `# ${a.title}\n\n*${plainInline(a.summary)}*\n\n${mdBlocks(a.slug, a.body, ctx, labels, "##", false)}\n\n---\n${labels.generated} · ${labels.source}: ${articleUrl(ctx, a.slug)}\n\n${creditText(labels)}\n`
}

export function manualMarkdown(title: string, subtitle: string, articles: Article[], ctx: ExportCtx, labels: ExportLabels) {
  const cats: string[] = []
  for (const a of articles) if (!cats.includes(a.category)) cats.push(a.category)
  const toc = cats.map((c) => `- **${labels.category(c)}**\n${articles.filter((a) => a.category === c).map((a) => `  - [${a.title}](#${a.slug})`).join("\n")}`).join("\n")
  const parts = cats.map((c) => `# ${labels.category(c)}\n\n${articles.filter((a) => a.category === c).map((a) => `<a id="${a.slug}"></a>\n## ${a.title}\n\n*${plainInline(a.summary)}*\n\n${mdBlocks(a.slug, a.body, ctx, labels, "###", true)}`).join("\n\n---\n\n")}`).join("\n\n")
  return `# ${title}\n\n${subtitle}\n\n${labels.generated}\n\n## ${labels.contents}\n\n${toc}\n\n${parts}\n\n---\n\n${creditText(labels)}\n`
}

/** Minutes to read at ~200 words (or ~1,000 characters of Bangla) per minute. */
export function readingMinutes(a: Pick<Article, "summary" | "body">) {
  const text = [a.summary, ...a.body.flatMap((b) => ("text" in b ? [b.text] : "items" in b ? b.items.flat() : "rows" in b ? [...b.head, ...b.rows.flat()] : []))].map(plainInline).join(" ")
  return Math.max(1, Math.round(text.split(/\s+/).length / 180))
}
