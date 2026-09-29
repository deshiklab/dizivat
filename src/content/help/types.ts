/**
 * Knowledge-base content model. Articles are plain data (no JSX) so the same source renders in the app
 * (server components), prints, and exports to standalone HTML and Markdown.
 *
 * Inline mini-markup inside any text: **bold**, `code`, [label](/app/path) or [label](help:slug), {{Ctrl+K}} = key cap.
 */
export type Block =
  | { t: "h"; text: string }
  | { t: "p"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "tip" | "note" | "warning"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "dl"; items: [term: string, definition: string][] }
  | { t: "img"; src: string; alt: string; caption?: string }

export interface ArticleText {
  title: string
  summary: string
  /** Extra search terms (synonyms, form numbers, Bangla/English variants). */
  keywords: string[]
  body: Block[]
}

export interface Article extends ArticleText {
  slug: string
  category: string
  routes: string[]
  related: string[]
}
