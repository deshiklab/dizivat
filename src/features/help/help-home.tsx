"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { parseAsString, useQueryState } from "nuqs"
import { ArrowRight, BookOpen, Search, X } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface HelpIndexEntry { slug: string; category: string; title: string; summary: string; terms: string }

const BN_DIGITS = "০১২৩৪৫৬৭৮৯"
/** Case-, script-digit- and punctuation-insensitive form used on both sides of the match. */
export const norm = (s: string) =>
  s.normalize("NFC").toLowerCase().replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).replace(/[“”"'’(),:;!?]/g, " ")

function score(e: HelpIndexEntry & { _t: string; _k: string; _s: string }, tokens: string[]) {
  let total = 0
  for (const tok of tokens) {
    const s = (e._t.includes(tok) ? 6 : 0) + (e._k.includes(tok) ? 3 : 0) + (e._s.includes(tok) ? 1 : 0)
    if (!s) return 0
    total += s
  }
  return total
}

export function HelpHome({ index, categories, starters }: { index: HelpIndexEntry[]; categories: string[]; starters: string[] }) {
  const t = useTranslations("help")
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""))
  const [topic, setTopic] = useQueryState("topic", parseAsString.withDefault(""))
  const prepared = React.useMemo(() => index.map((e) => ({ ...e, _t: norm(e.title), _k: norm(e.terms), _s: norm(e.summary) })), [index])
  const tokens = norm(q).split(/\s+/).filter(Boolean)
  const searching = tokens.length > 0
  const hits = searching
    ? prepared.map((e) => ({ e, s: score(e, tokens) })).filter((x) => x.s > 0 && (!topic || x.e.category === topic)).sort((a, b) => b.s - a.s).map((x) => x.e)
    : prepared.filter((e) => !topic || e.category === topic)
  const shownCats = categories.filter((c) => !topic || c === topic)

  const card = (e: HelpIndexEntry) => (
    <li key={e.slug}>
      <Link href={`/help/${e.slug}`} className="group flex h-full flex-col gap-1 rounded-lg border bg-surface p-4 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring">
        <span className="flex items-start justify-between gap-2 font-medium text-foreground">{e.title}<ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{e.summary}</span>
      </Link>
    </li>
  )

  return (
    <div className="grid gap-6">
      <div className="rounded-xl border bg-surface p-4 md:p-6">
        <label htmlFor="kb-search" className="sr-only">{t("searchLabel")}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="kb-search" type="search" value={q} onChange={(ev) => setQ(ev.target.value || null)} placeholder={t("searchPlaceholder")} className="h-12 pr-10 pl-11 text-base" autoComplete="off" />
          {q && <Button variant="ghost" size="icon" className="absolute top-1/2 right-1.5 -translate-y-1/2" aria-label={t("clear")} onClick={() => setQ(null)}><X /></Button>}
        </div>
        <div role="group" aria-label={t("filterTopics")} className="mt-3 flex flex-wrap gap-2">
          {["", ...categories].map((c) => (
            <button key={c || "all"} type="button" aria-pressed={topic === c} onClick={() => setTopic(c || null)}
              className={cn("rounded-full border px-3 py-1 text-sm transition-colors pointer-coarse:py-2", topic === c ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")}>
              {c ? t(`cat.${c}` as "cat.sales") : t("allTopics")}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm text-muted-foreground", !searching && "sr-only")}>{t("results", { count: hits.length })}</p>

      {searching ? (
        hits.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{hits.map(card)}</ul> : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium">{t("noResults", { q })}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("noResultsHint")}</p>
          </div>
        )
      ) : (
        <>
          {!topic && (
            <section aria-labelledby="kb-start" className="rounded-xl border border-primary/30 bg-accent/50 p-4 md:p-5">
              <h2 id="kb-start" className="flex items-center gap-2 font-semibold"><BookOpen className="size-4" aria-hidden="true" /> {t("startHere")}</h2>
              <p className="text-sm text-muted-foreground">{t("startHereDesc")}</p>
              <ul className="mt-3 grid gap-3 md:grid-cols-3">{starters.map((s) => prepared.find((e) => e.slug === s)).filter((e) => !!e).map(card)}</ul>
            </section>
          )}
          {shownCats.map((c) => {
            const list = hits.filter((e) => e.category === c)
            return (
              <section key={c} aria-labelledby={`kb-cat-${c}`} className="grid gap-3">
                <div>
                  <h2 id={`kb-cat-${c}`} className="text-lg font-semibold">{t(`cat.${c}` as "cat.sales")} <span className="text-sm font-normal text-muted-foreground">· {t("articlesIn", { count: list.length })}</span></h2>
                  <p className="text-sm text-muted-foreground">{t(`catDesc.${c}` as "catDesc.sales")}</p>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map(card)}</ul>
              </section>
            )
          })}
        </>
      )}
      <p className="text-center text-sm text-muted-foreground">{t("helpful")}</p>
    </div>
  )
}
