import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { PageHeader } from "@/components/common/page-header"
import { loadHelp } from "@/content/help"
import { CATEGORIES } from "@/content/help/registry"
import { plainInline } from "@/lib/help/inline"
import { HelpHome, type HelpIndexEntry } from "@/features/help/help-home"
import { ManualActions } from "@/features/help/article-actions"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "help" })
  return { title: t("title"), description: t("description") }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "help" })
  const articles = await loadHelp(locale)
  // Search index: titles, summaries, keywords, section headings and glossary/table terms — not whole bodies.
  const index: HelpIndexEntry[] = articles.map((a) => ({
    slug: a.slug, category: a.category, title: a.title, summary: plainInline(a.summary),
    terms: [
      a.slug.replace(/-/g, " "), ...a.keywords,
      ...a.body.flatMap((b) => (b.t === "h" ? [b.text] : b.t === "dl" ? b.items.map(([d]) => plainInline(d)) : b.t === "table" ? b.rows.map((r) => plainInline(r[0])) : [])),
    ].join(" · "),
  }))
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<ManualActions />} />
      <Suspense>
        <HelpHome index={index} categories={[...CATEGORIES]} starters={["welcome", "navigation", "sales-invoices"]} />
      </Suspense>
    </>
  )
}
