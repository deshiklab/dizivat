import { Info, Lightbulb, TriangleAlert } from "lucide-react"
import { Link } from "@/i18n/navigation"
import type { Block } from "@/content/help/types"
import { parseInline, sectionId } from "@/lib/help/inline"
import { BASE_PATH } from "@/lib/base-path"
import { cn } from "@/lib/utils"

/** Inline mini-markup → React. Internal links stay client-side navigations. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) => {
        switch (t.k) {
          case "b": return <strong key={i} className="font-semibold text-foreground">{t.v}</strong>
          case "i": return <em key={i}>{t.v}</em>
          case "code": return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{t.v}</code>
          case "kbd": return <span key={i} className="whitespace-nowrap">{t.v.split("+").map((k, j) => <span key={j}>{j > 0 && "+"}<kbd className="rounded border border-b-2 bg-muted px-1.5 font-sans text-[0.8em]">{k}</kbd></span>)}</span>
          case "link": {
            const cls = "font-medium text-primary underline underline-offset-2 hover:no-underline"
            if (t.href.startsWith("help:")) {
              const [slug, hash] = t.href.slice(5).split("#")
              return <Link key={i} href={`/help/${slug}${hash ? `#${hash}` : ""}`} className={cls}>{t.v}</Link>
            }
            if (t.href.startsWith("/")) return <Link key={i} href={t.href} className={cls}>{t.v}</Link>
            return <a key={i} href={t.href} className={cls} target="_blank" rel="noreferrer">{t.v}</a>
          }
          default: return <span key={i}>{t.v}</span>
        }
      })}
    </>
  )
}

const CALLOUT = {
  tip: { icon: Lightbulb, cls: "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30" },
  note: { icon: Info, cls: "border-primary/40 bg-accent" },
  warning: { icon: TriangleAlert, cls: "border-amber-600/50 bg-amber-50 dark:bg-amber-950/30" },
} as const

/** Renders an article body. Server component: no article text ships as JavaScript. */
export function ArticleBody({ body, labels, anchorLabel }: { body: Block[]; labels: Record<"tip" | "note" | "warning", string>; anchorLabel: string }) {
  let n = 0
  return (
    <div className="kb-body grid gap-4 text-[0.95rem] leading-7 text-foreground/90">
      {body.map((b, i) => {
        switch (b.t) {
          case "h": {
            n++
            const id = sectionId(n)
            return (
              <h2 key={i} id={id} className="group mt-4 scroll-mt-24 text-lg font-semibold tracking-tight text-foreground">
                {b.text}
                <a href={`#${id}`} aria-label={`${anchorLabel}: ${b.text}`} className="ml-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 no-print">#</a>
              </h2>
            )
          }
          case "p": return <p key={i}><Rich text={b.text} /></p>
          case "steps":
            return (
              <ol key={i} className="grid gap-2.5">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-3">
                    <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{j + 1}</span>
                    <span className="min-w-0"><Rich text={it} /></span>
                  </li>
                ))}
              </ol>
            )
          case "list": return <ul key={i} className="ml-5 grid list-disc gap-1.5 marker:text-muted-foreground">{b.items.map((it, j) => <li key={j}><Rich text={it} /></li>)}</ul>
          case "tip": case "note": case "warning": {
            const c = CALLOUT[b.t]
            return (
              <div key={i} role="note" className={cn("flex gap-3 rounded-md border-l-4 px-4 py-3", c.cls)}>
                <c.icon className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <p><strong className="font-semibold">{labels[b.t]}:</strong> <Rich text={b.text} /></p>
              </div>
            )
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={b.head.join(", ")}>
                <table className="w-full text-sm">
                  <thead className="bg-muted/60"><tr>{b.head.map((h, j) => <th key={j} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t align-top">{r.map((c, k) => <td key={k} className="px-3 py-2"><Rich text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            )
          case "dl":
            return (
              <dl key={i} className="grid gap-3">
                {b.items.map(([d, v], j) => (
                  <div key={j} className="rounded-md border bg-surface px-4 py-3">
                    <dt className="font-semibold text-foreground"><Rich text={d} /></dt>
                    <dd className="mt-1 text-foreground/85"><Rich text={v} /></dd>
                  </div>
                ))}
              </dl>
            )
          case "img":
            return (
              <figure key={i} className="grid gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- static export, pre-sized WebP */}
                <img src={BASE_PATH + b.src} alt={b.alt} loading="lazy" decoding="async" width={1280} height={800} className="h-auto w-full rounded-lg border shadow-sm" />
                {b.caption && <figcaption className="text-xs text-muted-foreground">{b.caption}</figcaption>}
              </figure>
            )
        }
      })}
    </div>
  )
}
