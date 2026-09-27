import { db } from "@/lib/mock/db"
import type { SearchHit } from "@/lib/types"
import { json, withAuth } from "../_lib"

/** Global search for the ⌘K palette — one endpoint across record types. */
export const GET = withAuth(null, (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase()
  if (q.length < 2) return json([])
  const hits: SearchHit[] = []
  const has = (s: string) => s.toLowerCase().includes(q)
  for (const s of [...db.sales].reverse()) if (has(`${s.invoiceNo} ${s.challanNo} ${s.customerName}`) && hits.filter((h) => h.type === "sale").length < 5)
    hits.push({ type: "sale", id: s.id, title: `${s.invoiceNo} · Challan ${s.challanNo}`, subtitle: `${s.customerName} · ${s.issueDate}`, href: `/sales/${s.id}` })
  for (const p of [...db.purchases].reverse()) if (has(`${p.invoiceNo} ${p.challanNo} ${p.vendorName}`) && hits.filter((h) => h.type === "purchase").length < 5)
    hits.push({ type: "purchase", id: p.id, title: `${p.invoiceNo} · ${p.challanNo}`, subtitle: `${p.vendorName} · ${p.issueDate}`, href: `/purchases/${p.id}` })
  for (const i of db.items) if (has(`${i.name} ${i.hsCode} ${i.sku}`) && hits.filter((h) => h.type === "item").length < 5)
    hits.push({ type: "item", id: i.id, title: i.name, subtitle: `${i.sku} · HS ${i.hsCode} · ${i.group}`, href: `/inventory/items?ledger=${i.id}` })
  for (const c of db.customers) if (has(`${c.name} ${c.bin}`) && hits.filter((h) => h.type === "customer").length < 5)
    hits.push({ type: "customer", id: c.id, title: c.name, subtitle: `BIN ${c.bin}`, href: `/master/customers?edit=${c.id}` })
  for (const v of db.vendors) if (has(`${v.name} ${v.bin}`) && hits.filter((h) => h.type === "vendor").length < 5)
    hits.push({ type: "vendor", id: v.id, title: v.name, subtitle: `${v.mode} · ${v.bin}`, href: `/master/vendors?edit=${v.id}` })
  return json(hits.slice(0, 20))
})
