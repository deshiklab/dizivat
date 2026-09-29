import { notFound } from "next/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { ArrowLeft, ArrowRight, CalendarDays, Clock, MonitorSmartphone } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { PageHeader } from "@/components/common/page-header"
import { loadHelp } from "@/content/help"
import { HELP_UPDATED, SLUGS } from "@/content/help/registry"
import { plainInline } from "@/lib/help/inline"
import { readingMinutes } from "@/lib/help/export"
import { NAV } from "@/lib/nav"
import { fmtDate, fmtNum } from "@/lib/format"
import { ArticleBody, Rich } from "@/features/help/article-body"
import { ArticleActions } from "@/features/help/article-actions"

/** Every article is known at build time — pre-rendered in both builds; unknown slugs are 404s. */
export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }))
}
export const dynamicParams = false

type Params = Promise<{ locale: string; slug: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { locale, slug } = await params
  const a = (await loadHelp(locale)).find((x) => x.slug === slug)
  return a ? { title: a.title, description: plainInline(a.summary) } : {}
}

export default async function Page({ params }: { params: Params }) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const articles = await loadHelp(locale)
  const i = articles.findIndex((x) => x.slug === slug)
  if (i < 0) notFound()
  const a = articles[i]
  const t = await getTranslations({ locale, namespace: "help" })
  const tn = await getTranslations({ locale, namespace: "nav" })
  const prev = articles[i - 1]
  const next = articles[i + 1]
  const headings = a.body.filter((b) => b.t === "h")
  const navItems = NAV.flatMap((g) => g.items)
  const screens = a.routes.flatMap((r) => {
    if (r === "/") return [{ href: r, label: tn("dashboard") }]
    if (r === "/help") return [{ href: r, label: t("title") }]
    const it = navItems.find((n) => n.href === r)
    return it ? [{ href: r, label: tn(it.key) }] : []
  })
  const related = a.related.map((s) => articles.find((x) => x.slug === s)).filter((x) => !!x)
  const cat = t(`cat.${a.category}` as "cat.sales")

  return (
    <>
      <PageHeader
        title={a.title}
        description={<Rich text={a.summary} />}
        crumbs={[{ label: t("backToKb"), href: "/help" }, { label: cat, href: `/help?topic=${a.category}` }, { label: a.title }]}
        actions={<ArticleActions slug={a.slug} title={a.title} summary={plainInline(a.summary)} />}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <article className="min-w-0 max-w-3xl" aria-label={a.title} data-kb-article={a.slug}>
          <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground">{cat}</span>
            <span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden="true" /> {t("updated", { date: fmtDate(HELP_UPDATED, locale) })}</span>
            <span className="flex items-center gap-1"><Clock className="size-3.5" aria-hidden="true" /> {t("readTime", { min: fmtNum(readingMinutes(a), locale) })}</span>
          </p>
          <ArticleBody body={a.body} labels={{ tip: t("tip"), note: t("note"), warning: t("warning") }} anchorLabel={t("anchor")} />
          <nav aria-label={`${t("prev")} / ${t("next")}`} className="no-print mt-10 grid gap-3 border-t pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={`/help/${prev.slug}`} className="group rounded-lg border p-3 hover:border-primary/50">
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" /> {t("prev")}</span>
                <span className="font-medium">{prev.title}</span>
              </Link>
            ) : <span />}
            {next && (
              <Link href={`/help/${next.slug}`} className="group rounded-lg border p-3 text-right hover:border-primary/50">
                <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">{t("next")} <ArrowRight className="size-3.5" aria-hidden="true" /></span>
                <span className="font-medium">{next.title}</span>
              </Link>
            )}
          </nav>
        </article>
        <aside className="no-print grid content-start gap-6 text-sm lg:sticky lg:top-20 lg:self-start">
          {headings.length > 1 && (
            <nav aria-labelledby="kb-toc">
              <h2 id="kb-toc" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("onThisPage")}</h2>
              <ol className="grid gap-1.5 border-l pl-3">
                {headings.map((h, k) => <li key={k}><a href={`#sec-${k + 1}`} className="text-muted-foreground hover:text-foreground">{h.text}</a></li>)}
              </ol>
            </nav>
          )}
          {screens.length > 0 && (
            <section aria-labelledby="kb-screens">
              <h2 id="kb-screens" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("screens")}</h2>
              <ul className="grid gap-1.5">
                {screens.map((s) => <li key={s.href}><Link href={s.href} className="flex items-center gap-1.5 text-primary hover:underline"><MonitorSmartphone className="size-3.5 shrink-0" aria-hidden="true" /> {s.label}</Link></li>)}
              </ul>
            </section>
          )}
          {related.length > 0 && (
            <section aria-labelledby="kb-related">
              <h2 id="kb-related" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("related")}</h2>
              <ul className="grid gap-1.5">
                {related.map((r) => <li key={r.slug}><Link href={`/help/${r.slug}`} className="text-primary hover:underline">{r.title}</Link></li>)}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  )
}
