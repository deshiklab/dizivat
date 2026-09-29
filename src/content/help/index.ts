import type { Article, ArticleText } from "./types"
import { SLUGS, categoryOf, relatedOf, routesOf, type Slug } from "./registry"

export type HelpTexts = Record<Slug, ArticleText>

export const assemble = (texts: HelpTexts): Article[] =>
  SLUGS.map((slug) => ({ slug, category: categoryOf(slug), routes: routesOf(slug), related: relatedOf(slug), ...texts[slug] }))

/** All articles of one language, in registry order. Code-split per language (the browser only loads it on demand). */
export async function loadHelp(locale: string): Promise<Article[]> {
  const texts = locale === "bn" ? (await import("./bn")).BN : (await import("./en")).EN
  return assemble(texts)
}
