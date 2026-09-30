// Compare en vs bn KB structure: same slugs, same block kinds per article, same links.
import { createJiti } from "jiti"
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } })
const files = process.argv.slice(2)
let bad = 0
for (const f of files) {
  const en = (await jiti.import(`../src/content/help/en/${f}.ts`)).default
  let bn
  try { bn = (await jiti.import(`../src/content/help/bn/${f}.ts`)).default } catch (e) { console.log(f, "bn missing"); bad++; continue }
  for (const slug of new Set([...Object.keys(en), ...Object.keys(bn)])) {
    const a = en[slug], b = bn[slug]
    if (!a || !b) { console.log(slug, "slug only in", a ? "en" : "bn"); bad++; continue }
    const kinds = (x) => x.body.map((bl) => bl.t).join(",")
    if (kinds(a) !== kinds(b)) { console.log(slug, "blocks differ\n en:", kinds(a), "\n bn:", kinds(b)); bad++ }
    const links = (x) => [...JSON.stringify(x.body).matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]).sort().join(" ")
    if (links(a) !== links(b)) { console.log(slug, "links differ\n en:", links(a), "\n bn:", links(b)); bad++ }
    const cnt = (x) => JSON.stringify(x.body.map((bl) => (bl.items ?? bl.rows ?? []).length))
    if (cnt(a) !== cnt(b)) { console.log(slug, "item counts differ", cnt(a), cnt(b)); bad++ }
  }
}
console.log(bad ? `${bad} problems` : "ok")
process.exit(bad ? 1 : 0)
