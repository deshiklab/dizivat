// Knowledge-base lint: slug parity (registry / en / bn), block parity en↔bn, valid help: and app links, NFC Bangla.
// `satisfies HelpTexts` on spread objects catches missing articles but not unknown ones — this closes the gap.
import { createJiti } from "jiti"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } })
const { REGISTRY, SLUGS } = await jiti.import(join(root, "src/content/help/registry.ts"))
const { EN } = await jiti.import(join(root, "src/content/help/en/index.ts"))
const { BN } = await jiti.import(join(root, "src/content/help/bn/index.ts"))
const { parseInline } = await jiti.import(join(root, "src/lib/help/inline.ts"))

const problems = []
const bad = (m) => problems.push(m)

// Static app routes from the file system (dynamic segments and the catch-all are not valid link targets).
const appDir = join(root, "src/app/[locale]/(app)")
const routes = new Set(["/login"])
;(function walk(dir, prefix) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { if (!e.startsWith("[")) walk(p, `${prefix}/${e}`) }
    else if (/^page(\.server)?\.tsx$/.test(e)) routes.add(prefix || "/")
  }
})(appDir, "")

const slugs = new Set(SLUGS)
for (const [name, kb] of [["en", EN], ["bn", BN]]) {
  for (const s of SLUGS) if (!kb[s]) bad(`${name}: missing article ${s}`)
  for (const s of Object.keys(kb)) if (!slugs.has(s)) bad(`${name}: unknown article ${s}`)
}
for (const [s, m] of Object.entries(REGISTRY)) {
  for (const r of m.related ?? []) if (!slugs.has(r)) bad(`registry ${s}: unknown related ${r}`)
  for (const r of m.routes ?? []) if (!routes.has(r)) bad(`registry ${s}: route ${r} has no page`)
}

const texts = (a) => [a.title, a.summary, ...a.body.flatMap((b) => [b.text, b.caption, ...(b.items ?? []).flat(), ...(b.head ?? []), ...(b.rows ?? []).flat()])].filter(Boolean)
const headings = (a) => a.body.filter((b) => b.t === "h").length
let links = 0
for (const [name, kb] of [["en", EN], ["bn", BN]]) {
  for (const s of SLUGS) {
    const a = kb[s]
    if (!a) continue
    for (const t of texts(a)) {
      if (name === "bn" && t.normalize("NFC") !== t) bad(`bn ${s}: text not NFC`)
      const leftover = parseInline(t).filter((x) => x.k === "text").map((x) => x.v).join("")
      if (/[*`]|\{\{|\}\}/.test(leftover)) bad(`${name} ${s}: stray markup in “${t.slice(0, 60)}…”`)
      if ((t.match(/\{\{/g) ?? []).length !== (t.match(/\}\}/g) ?? []).length) bad(`${name} ${s}: unbalanced {{ }}`)
      for (const [, href] of t.matchAll(/\]\(([^)\s]+)\)/g)) {
        links++
        if (href.startsWith("help:")) {
          const [target, hash] = href.slice(5).split("#")
          if (!slugs.has(target)) { bad(`${name} ${s}: unknown help link ${href}`); continue }
          if (hash) {
            const n = /^sec-(\d+)$/.exec(hash)?.[1]
            if (!n || +n < 1 || +n > headings(kb[target])) bad(`${name} ${s}: bad anchor ${href}`)
          }
        } else if (href.startsWith("/")) {
          const path = href.split(/[?#]/)[0]
          if (!routes.has(path)) bad(`${name} ${s}: link ${href} has no page`)
        } else bad(`${name} ${s}: unsupported link ${href}`)
      }
    }
  }
}
// en ↔ bn parity: same block kinds, item/row counts and link targets.
for (const s of SLUGS) {
  const a = EN[s], b = BN[s]
  if (!a || !b) continue
  const shape = (x) => x.body.map((bl) => `${bl.t}:${(bl.items ?? bl.rows ?? []).length}`).join(",")
  if (shape(a) !== shape(b)) bad(`${s}: en/bn block shape differs`)
  const ls = (x) => texts(x).flatMap((t) => [...t.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])).sort().join(" ")
  if (ls(a) !== ls(b)) bad(`${s}: en/bn link targets differ`)
}

if (problems.length) { console.log(problems.join("\n")); console.log(`KB lint: ${problems.length} problem(s)`); process.exit(1) }
console.log(`KB lint OK — ${SLUGS.length} articles × 2 languages, ${links} links, ${routes.size} routes`)
