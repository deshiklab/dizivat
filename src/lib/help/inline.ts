/** Tokeniser for the knowledge base's inline mini-markup (see content/help/types.ts). */
export type Inline =
  | { k: "text"; v: string }
  | { k: "b"; v: string }
  | { k: "i"; v: string }
  | { k: "code"; v: string }
  | { k: "kbd"; v: string }
  | { k: "link"; v: string; href: string }

// **bold** | `code` | {{Kbd+Keys}} | [text](href) | *italic* (single asterisks, not touching a word or another asterisk)
const RE = /\*\*([^*]+)\*\*|`([^`]+)`|\{\{([^}]+)\}\}|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\p{L}\p{N}])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\p{L}\p{N}])/gu

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of src.matchAll(RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ k: "text", v: src.slice(last, i) })
    if (m[1] !== undefined) out.push({ k: "b", v: m[1] })
    else if (m[2] !== undefined) out.push({ k: "code", v: m[2] })
    else if (m[3] !== undefined) out.push({ k: "kbd", v: m[3] })
    else if (m[6] !== undefined) out.push({ k: "i", v: m[6] })
    else out.push({ k: "link", v: m[4], href: m[5] })
    last = i + m[0].length
  }
  if (last < src.length) out.push({ k: "text", v: src.slice(last) })
  return out
}

/** Markup-free text (search index, meta descriptions, reading time). */
export const plainInline = (src: string) => parseInline(src).map((t) => t.v).join("")

/** Ids for an article's section headings, in order: sec-1, sec-2 … (script-neutral, so Bangla works too). */
export const sectionId = (n: number) => `sec-${n}`
