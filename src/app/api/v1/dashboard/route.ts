import { TODAY } from "@/lib/company"
import { db, withStock } from "@/lib/mock/db"
import { delay } from "@/lib/mock/query"
import type { DashboardData } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { json, withAuth } from "../_lib"

const ym = (d: string) => d.slice(0, 7)
const sum = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((a, r) => a + f(r), 0))

export const GET = withAuth(null, async () => {
  await delay(250)
  const cur = ym(TODAY)
  const [y, m] = cur.split("-").map(Number)
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`
  // Only approved (issued) documents count toward VAT, receivables and Mushak 9.1 — drafts are not yet issued.
  const live = db.sales.filter((s) => s.process === "Approved")
  const livePur = db.purchases.filter((p) => p.process === "Approved")
  const liveDn = db.debitNotes.filter((n) => n.process === "Approved")
  const inMonth = <T extends { issueDate: string }>(rows: T[], k: string) => rows.filter((r) => ym(r.issueDate) === k)

  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  const kpi = (k: string) => {
    const s = inMonth(live, k), p = inMonth(livePur, k), dn = inMonth(liveDn, k)
    // Debit notes (6.8) give back input tax and reduce purchases in the month they are issued
    const outputVat = sum(s, (x) => x.vat), inputVat = round2(sum(p, (x) => x.rebate) - sum(dn, (x) => x.rebate))
    return { sales: sum(s, (x) => x.netTotal), outputVat, inputVat, netPayable: round2(outputVat - inputVat), purchases: round2(sum(p, (x) => x.netTotal) - sum(dn, (x) => x.total)) }
  }
  const c = kpi(cur), pv = kpi(prev)

  const byCustomer = new Map<string, { name: string; amount: number; count: number }>()
  const fyStart = m >= 7 ? `${y}-07-01` : `${y - 1}-07-01`
  for (const s of live.filter((s) => s.issueDate >= fyStart)) {
    const e = byCustomer.get(s.customerId) ?? { name: s.customerName, amount: 0, count: 0 }
    e.amount += s.netTotal; e.count++
    byCustomer.set(s.customerId, e)
  }
  const mix = new Map<string, number>()
  for (const s of live.filter((s) => s.issueDate >= fyStart)) for (const l of s.lines) {
    const it = db.items.find((i) => i.id === l.itemId)
    const key = it?.masterItem ?? l.name
    mix.set(key, (mix.get(key) ?? 0) + l.subtotal)
  }

  const end = new Date(y, m, 0).getDate()
  const due = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-15`
  const data: DashboardData = {
    period: { label: cur, start: `${cur}-01`, end: `${cur}-${end}`, returnDue: due, daysLeft: Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5) },
    kpis: {
      sales: c.sales, salesPrev: pv.sales, outputVat: c.outputVat, outputVatPrev: pv.outputVat,
      inputVat: c.inputVat, inputVatPrev: pv.inputVat, netPayable: c.netPayable, netPayablePrev: pv.netPayable,
      purchases: c.purchases, purchasesPrev: pv.purchases,
      receivable: sum(live, (s) => s.due), payable: sum(livePur, (p) => p.due),
      pendingApproval: db.sales.filter((s) => s.process === "Created").length + db.purchases.filter((p) => p.process === "Created").length + db.debitNotes.filter((n) => n.process === "Created").length,
    },
    monthly: months.map((k) => { const x = kpi(k); return { month: k, sales: x.sales, purchases: x.purchases, outputVat: x.outputVat, inputVat: x.inputVat } }),
    topCustomers: [...byCustomer.values()].sort((a, b) => b.amount - a.amount).slice(0, 5).map((x) => ({ ...x, amount: round2(x.amount) })),
    mix: [...mix.entries()].map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value).slice(0, 5),
    recentSales: [...db.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    lowStock: db.items.map(withStock).filter((i) => i.remain < i.reorderLevel).sort((a, b) => a.remain / a.reorderLevel - b.remain / b.reorderLevel).slice(0, 5),
    deadlines: [
      { id: "tr6", title: "treasuryDeposit", due: `${due.slice(0, 8)}14`, status: "due", href: "/vat/tr-6" },
      { id: "r91", title: "return91", due, status: "due", href: "/vat/return-9-1" },
      { id: "vds", title: "vdsCertificates", due, status: "due", href: "/vat/vds" },
      { id: "r91prev", title: "return91Prev", due: `${cur}-15`, status: "done", href: "/vat/return-9-1" },
    ],
  }
  return json(data)
})
