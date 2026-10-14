/**
 * R5.4 — the two derived endpoints: the branch split (`/stock`) and one item's stock ledger (`/items/{id}/ledger`).
 * Neither stores anything of its own: they add up every movement document — purchases, sales, the two note kinds,
 * transfers, damage entries, opening entries and production batches — and every one of those families has a table of
 * its own now, so both runtimes can derive the same numbers from the same code. The Next.js mock passes its in-memory
 * copies as the `MovementSource`; the PostgreSQL API passes the same documents read back from its tables.
 *
 * Everything the responses are made of lives here so the two cannot drift: the register's spec (search, facets,
 * totals), the rows with their valuation at cost and at sale price, the per-branch valuation, the CSV columns (one
 * column per stock-holding branch), and the ledger's assembly — which rows a `?branch=` shows (transfers only appear
 * then, because company-wide they net to zero), the running balance, the totals and the closing quantity.
 */
import { z } from "zod"
import { TODAY } from "@/lib/company"
import { company } from "@/lib/mock/company"
import { db, branchSplit, mainBranchId, stockBranches, withStock, type MovementSource } from "@/lib/mock/db"
import { runQuery, type QuerySpec } from "@/lib/mock/query"
import { computeReturn } from "@/lib/mock/vat-return"
import { periodOf, returnDue } from "@/lib/r4"
import { taxPeriods } from "./_r4"
import type { Branch, DashboardData, Item, ItemLedger, LedgerEntry, MushakBook, Party, Purchase, Sale, SearchHit, StockRow } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { ledgerRows, sortRows, buildBook } from "./_ledger"
import { mushak610, vdsEligible, type ReturnSource, type VatSource } from "./_r4"
import type { RuleProblem } from "./_lib"

/* ── /stock: every item with its quantity at each stock-holding branch ───── */

/** The row's own stock status: out, below its re-order level, or fine. */
export const stockStatus = (r: StockRow) => (r.remain <= 0 ? "out" : r.remain < r.reorderLevel ? "low" : "ok")

export const branchSpec: QuerySpec<StockRow> = {
  search: (r) => `${r.name} ${r.sku} ${r.hsCode}`,
  facets: { group: (r) => r.group, stock: stockStatus, unit: (r) => r.unit },
  totals: ["value", "saleValue"] as (keyof StockRow)[],
}

/** One row per item: the counters' `remain`, the quantity at each branch, and both valuations (never negative). */
export function branchRows(src: MovementSource): StockRow[] {
  const split = branchSplit(src)
  return src.items.map((it) => {
    const s = withStock(it)
    const byBranch = split.get(it.id) ?? {}
    return { ...s, byBranch, value: Math.round(Math.max(0, s.remain) * it.costPrice), saleValue: Math.round(Math.max(0, s.remain) * it.salePrice) }
  })
}

/** One column per stock-holding branch, then the total, the unit cost, the value and the re-order level. */
export const branchCsvColumns = (branches: Branch[]) => [
  { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "group", label: "Group" }, { key: "unit", label: "Unit" },
  ...branches.map((b) => ({ key: b.id, label: b.name, get: (x: StockRow) => x.byBranch[b.id] ?? 0 })),
  { key: "remain", label: "Total" }, { key: "costPrice", label: "Unit cost" }, { key: "value", label: "Value at cost" }, { key: "reorderLevel", label: "Re-order level" },
]

/**
 * The register: the page (`runQuery` over the rows), the stock-holding branches and the value each holds. `branch=<id>`
 * keeps the items held there, and the defaults the route relies on are applied here — `sort=sku.asc` when the caller
 * gave none — so both runtimes answer the same request the same way. `branchValue` is over every matching row, not
 * just the page, as it always was.
 */
export function stockRegister(sp: URLSearchParams, src: MovementSource = db) {
  if (!sp.get("sort")) sp.set("sort", "sku.asc")
  const branches = stockBranches()
  const holdAt = sp.get("branch")
  const rows = branchRows(src).filter((r) => !holdAt || (r.byBranch[holdAt] ?? 0) > 0)
  const r = runQuery(rows, sp, branchSpec)
  const branchValue = Object.fromEntries(branches.map((b) => [b.id, Math.round(r.all.reduce((a, x) => a + Math.max(0, x.byBranch[b.id] ?? 0) * x.costPrice, 0))]))
  return { r, branches, branchValue }
}

/* ── /items/{id}/ledger: one item's movement register ────────────────────── */

/**
 * The ledger body: the rows sorted by date and type with a running balance, the totals and the closing quantity, the
 * item with its `remain`, the stock-holding branches and the item's quantity at each. `branchId` restricts it to one
 * branch — where the transfers in and out appear, because company-wide they net to zero — and is echoed back. The
 * value, tax, challan and party details a Mushak book needs stay on the rows `ledgerRows` returns; the ledger entries
 * the API answers with do not carry them.
 */
export function itemLedger(it: Item, branchId?: string, src: MovementSource = db): ItemLedger {
  const main = mainBranchId()
  const rows = ledgerRows(it, src)
  const shown = rows.filter((r) => (branchId ? (r.at ?? main) === branchId : !r.transfer))
  sortRows(shown)
  let bal = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const entries: LedgerEntry[] = shown.map(({ at, transfer, value, sd, vat, challan, refDate, partyAddress, partyBin, ...r }) => { bal = round2(bal + r.in - r.out); return { ...r, balance: bal } })
  return {
    item: withStock(it),
    entries,
    totals: { in: round2(shown.reduce((a, r) => a + r.in, 0)), out: round2(shown.reduce((a, r) => a + r.out, 0)) },
    closing: bal,
    branchId,
    branches: stockBranches().map((b) => ({ id: b.id, name: b.name })),
    byBranch: branchSplit(src).get(it.id) ?? {},
  }
}

/* ── /mushak/[form]: the Mushak books (6.1, 6.2, 6.2.1) and 6.10 ─────────── */

/** A CSV column: the row's key, or a `get` for a value the row does not carry. */
export type CsvColumn = { key: string; label: string; get?: (r: never) => unknown }

/** The company block every Mushak form prints. */
export type BookHead = Pick<MushakBook["company"], "name" | "address" | "bin">
/** What a book's answer is made of: the book itself, and the export the register offers beside it. */
export type BookAnswer = RuleProblem | { book: MushakBook; rows: MushakBook["rows"]; csvName: string; columns: CsvColumn[] }
export type Book610Answer = RuleProblem | {
  book: ReturnType<typeof mushak610>
  /** the two parts in one list, which is what the CSV prints */
  rows: ({ part: string } & ReturnType<typeof mushak610>["purchases"][number])[]
  csvName: string; columns: CsvColumn[]
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** The default range both books offer: the financial year to date. */
export const BOOK_FROM = "2026-07-01"

/** The range rule every Mushak book shares (6.1, 6.2, 6.2.1 and 6.10): two dates, in order, neither missing. */
function bookRange(q: { from?: string | null; to?: string | null }) {
  const from = q.from?.trim() || BOOK_FROM, to = q.to?.trim() || TODAY
  const errors: Record<string, string[]> = {}
  if (!ISO_DATE.test(from)) errors.from = ["required"]
  if (!ISO_DATE.test(to)) errors.to = ["required"]
  if (!errors.from && !errors.to && from > to) errors.to = ["toBeforeFrom"]
  return { from, to, errors }
}

/** One book's CSV columns — the same rows, named for the form they belong to. */
export const mushakCsvColumns = (form: string): CsvColumn[] => [
  { key: "sl", label: "SL" }, { key: "date", label: "Date" }, { key: "openQty", label: "Opening qty" }, { key: "openValue", label: "Opening value" },
  { key: "ref", label: form === "6.1" ? "Challan / BoE / Ref" : form === "6.2.1" ? "Challan / Invoice / Ref" : "Invoice / Ref" }, { key: "refDate", label: "Ref date" },
  { key: "party", label: form === "6.1" ? "Seller" : form === "6.2.1" ? "Seller / Buyer" : "Buyer" }, { key: "partyAddress", label: "Address" }, { key: "partyBin", label: "BIN/NID" }, { key: "description", label: "Description" },
  { key: "inQty", label: form === "6.1" || form === "6.2.1" ? "Purchased qty" : "Produced qty" }, { key: "inValue", label: "Value (excl. SD & VAT)" }, { key: "sd", label: "SD" }, { key: "vat", label: "VAT" },
  { key: "outQty", label: form === "6.1" ? "Used / out qty" : "Sold / out qty" }, { key: "outValue", label: "Out value" }, { key: "closeQty", label: "Closing qty" }, { key: "closeValue", label: "Closing value" },
]

/** 6.10's: one list of purchases and sales above the limit, with the part each belongs to. */
export const mushak610CsvColumns: CsvColumn[] = [
  { key: "part", label: "Part" }, { key: "sl", label: "SL" }, { key: "no", label: "Invoice No" }, { key: "challanNo", label: "Challan No" }, { key: "date", label: "Date" },
  { key: "party", label: "Name" }, { key: "address", label: "Address" }, { key: "bin", label: "BIN" }, { key: "value", label: "Value" }, { key: "vat", label: "VAT" }, { key: "total", label: "Total" },
]

/**
 * Mushak 6.1 (inputs), 6.2 (finished goods) and 6.2.1 (traded goods, R6.2) — one item's book over a range: every
 * movement that touched it, with the running balance, valued the way the form values it. 6.2.1 is 6.2's book for
 * any item that is bought and sold, so the two share a builder; the form only decides who may ask and what the
 * columns are called.
 */
export function mushakBook(form: string, q: { item?: string | null; from?: string | null; to?: string | null },
  head: BookHead = company, src: MovementSource = db): BookAnswer {
  if (form !== "6.1" && form !== "6.2" && form !== "6.2.1")
    return { status: 404, title: form === "9.1" ? "Mushak 9.1 lives under /vat/returns/{period}" : `Mushak ${form} is not available` }
  const { from, to, errors } = bookRange(q)
  const it = src.items.find((i) => i.id === q.item)
  if (!it) errors.item = ["required"]
  // 6.2.1 (R6.2) — purchase-sales book of traded goods: any item that is bought and sold
  else if (form !== "6.2.1" && (form === "6.2") !== (it.group === "Finished Goods"))
    errors.item = [form === "6.2" ? "finishedGoodsOnly" : "inputsOnly"]
  if (Object.keys(errors).length || !it) return { status: 422, title: "Validation failed", errors }
  const built = buildBook(form === "6.2.1" ? "6.2" : form, it, from, to, src)
  const book: MushakBook = { ...built, form: form as MushakBook["form"], item: withStock(it), company: head }
  return { book, rows: built.rows, csvName: `mushak-${form}-${it.sku}-${from}-${to}.csv`, columns: mushakCsvColumns(form) }
}

/**
 * Mushak 6.10 — the purchases and the sales above Tk 2 lakh in the range, both parts with their totals
 * (the legacy build crashed on a missing `totalPurchase`, D-05).
 */
export function mushak610Book(q: { from?: string | null; to?: string | null },
  src: VatSource = db, head: BookHead = company): Book610Answer {
  const { from, to, errors } = bookRange(q)
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const book = mushak610(from, to, src, head)
  const rows = [...book.purchases.map((x) => ({ ...x, part: "Purchase" })), ...book.sales.map((x) => ({ ...x, part: "Sale" }))]
  return { book, rows, csvName: `mushak-6.10-${from}-${to}.csv`, columns: mushak610CsvColumns }
}

/* ── /dashboard: the KPIs, the charts and the deadlines ─────────────────── */

/**
 * What the dashboard adds up: every movement document, and everything the Mushak 9.1's own computation reads —
 * the parties, the invoices, the deposits, the certificates and the adjustments — because its deadlines are the
 * return's shortfall, the certificates still to issue and the two returns themselves.
 */
export type DashboardSource = MovementSource & ReturnSource

/**
 * The home screen: this month against last, twelve months of the same, the year's best customers and product mix,
 * the six newest invoices, the five items closest to their re-order level, and the four statutory deadlines —
 * the deposit, the certificates to issue and the two returns — each marked done, due or overdue.
 *
 * Only approved documents count toward VAT, receivables and the Mushak 9.1: a draft is not yet issued.
 */
export function dashboardAnswer(src: DashboardSource = db): DashboardData {
  const ym = (d: string) => d.slice(0, 7)
  const sum = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((a, r) => a + f(r), 0))
  const cur = ym(TODAY)
  const [y, m] = cur.split("-").map(Number)
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`
  const live = src.sales.filter((s) => s.process === "Approved")
  const livePur = src.purchases.filter((p) => p.process === "Approved")
  const liveDn = src.debitNotes.filter((n) => n.process === "Approved")
  const liveCn = src.creditNotes.filter((n) => n.process === "Approved")
  const inMonth = <T extends { issueDate: string }>(rows: T[], k: string) => rows.filter((r) => ym(r.issueDate) === k)

  const months: string[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  const kpi = (k: string) => {
    const s = inMonth(live, k), p = inMonth(livePur, k), dn = inMonth(liveDn, k), cn = inMonth(liveCn, k)
    // Debit notes (6.8) give back input tax and reduce purchases in the month they are issued
    // Credit notes (6.7) reduce output VAT and sales in the month they are issued
    const outputVat = round2(sum(s, (x) => x.vat) - sum(cn, (x) => x.vat)), inputVat = round2(sum(p, (x) => x.rebate) - sum(dn, (x) => x.rebate))
    return { sales: round2(sum(s, (x) => x.netTotal) - sum(cn, (x) => x.total)), outputVat, inputVat, netPayable: round2(outputVat - inputVat), purchases: round2(sum(p, (x) => x.netTotal) - sum(dn, (x) => x.total)) }
  }
  const c = kpi(cur), pv = kpi(prev)

  const byCustomer = new Map<string, { name: string; amount: number; count: number }>()
  const fyStart = m >= 7 ? `${y}-07-01` : `${y - 1}-07-01`
  for (const s of live.filter((s) => s.issueDate >= fyStart)) {
    const e = byCustomer.get(s.customerId) ?? { name: s.customerName, amount: 0, count: 0 }
    e.amount += s.netTotal; e.count++
    byCustomer.set(s.customerId, e)
  }
  // R7.3: the spend side of the same fiscal year — vendors mirror customers, purchases mirror sales
  const byVendor = new Map<string, { name: string; amount: number; count: number }>()
  for (const p of livePur.filter((p) => p.issueDate >= fyStart)) {
    const e = byVendor.get(p.vendorId) ?? { name: p.vendorName, amount: 0, count: 0 }
    e.amount += p.netTotal; e.count++
    byVendor.set(p.vendorId, e)
  }
  // R7.3: the TR-6 deposits counted toward a tax period (the 9.1's own note-58 view of a month)
  const dep = (k: string) => round2(sum(src.treasury.filter((t) => t.process === "Approved" && t.taxPeriod === k), (t) => t.amount))
  const mix = new Map<string, number>()
  for (const s of live.filter((s) => s.issueDate >= fyStart)) for (const l of s.lines) {
    const it = src.items.find((i) => i.id === l.itemId)
    const key = it?.masterItem ?? l.name
    mix.set(key, (mix.get(key) ?? 0) + l.subtotal)
  }

  const end = new Date(y, m, 0).getDate()
  const due = returnDue(cur, src.vatSettings)
  const deadlines = dashboardDeadlines(cur, prev, src)
  return {
    period: { label: cur, start: `${cur}-01`, end: `${cur}-${end}`, returnDue: due, daysLeft: Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5) },
    kpis: {
      sales: c.sales, salesPrev: pv.sales, outputVat: c.outputVat, outputVatPrev: pv.outputVat,
      inputVat: c.inputVat, inputVatPrev: pv.inputVat, netPayable: c.netPayable, netPayablePrev: pv.netPayable,
      purchases: c.purchases, purchasesPrev: pv.purchases,
      receivable: sum(live, (s) => s.due), payable: sum(livePur, (p) => p.due),
      pendingApproval: src.sales.filter((s) => s.process === "Created").length + src.purchases.filter((p) => p.process === "Created").length + src.debitNotes.filter((n) => n.process === "Created").length
        + src.creditNotes.filter((n) => n.process === "Created").length + src.batches.filter((b) => b.process === "Created").length,
    },
    monthly: months.map((k) => { const x = kpi(k); return { month: k, sales: x.sales, purchases: x.purchases, outputVat: x.outputVat, inputVat: x.inputVat, netPayable: x.netPayable, deposited: dep(k) } }),
    topCustomers: [...byCustomer.values()].sort((a, b) => b.amount - a.amount).slice(0, 5).map((x) => ({ ...x, amount: round2(x.amount) })),
    topVendors: [...byVendor.values()].sort((a, b) => b.amount - a.amount).slice(0, 5).map((x) => ({ ...x, amount: round2(x.amount) })),
    // R7.3: the filing strip — the last 12 tax periods exactly as /vat/periods serves them
    periods: taxPeriods(src).slice(0, 12),
    mix: [...mix.entries()].map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value).slice(0, 5),
    // Ordered by the `createdAt` string, as the demo data set wrote it: the seed stamps some invoices `…T14:19:00+06:00`
    // and others `toISOString()`, so the two shapes do not sort together, and the sales table (R5.3) renders every
    // instant as UTC — two invoices of 24-09-2026 change places between the two runtimes. Kept as the mock has it:
    // the same six invoices are there, and the demo must not move.
    recentSales: [...src.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    lowStock: src.items.map(withStock).filter((i) => i.remain < i.reorderLevel).sort((a, b) => a.remain / a.reorderLevel - b.remain / b.reorderLevel).slice(0, 5),
    deadlines,
  }
}

/** Live compliance deadlines: this period's deposit, VDS certificates and return, plus last period's return. */
function dashboardDeadlines(cur: string, prev: string, src: DashboardSource): DashboardData["deadlines"] {
  const ret = (p: string) => src.returns.find((r) => r.period === p)
  const r = ret(cur), rp = ret(prev)
  const c = computeReturn(src, cur, r?.manual)
  const due = returnDue(cur, src.vatSettings), duePrev = returnDue(prev, src.vatSettings)
  const toIssue = vdsEligible("purchase", undefined, src).filter((e) => periodOf(e.date) === cur && e.remaining > 0.004).length
  const past = (d: string) => TODAY > d
  const st = (done: boolean, d: string) => (done ? "done" : past(d) ? "overdue" : "due") as "done" | "due" | "overdue"
  const short = Math.ceil(c.shortVat)
  return [
    { id: "r91prev", title: "return91Prev", due: duePrev, status: st(rp?.status === "submitted", duePrev), href: `/vat/return-9-1?period=${prev}` },
    { id: "tr6", title: "treasuryDeposit", due, status: st(r?.status === "submitted" || short <= 0, due), href: short > 0 ? `/vat/tr-6?new=1&period=${cur}&head=vat&amount=${short}` : `/vat/tr-6?period=${cur}` },
    { id: "vds", title: "vdsCertificates", due, status: st(toIssue === 0, due), href: "/vat/vds?vdsMode=purchase" },
    { id: "r91", title: "return91", due, status: st(r?.status === "submitted", due), href: `/vat/return-9-1?period=${cur}` },
  ]
}

/* ── /notifications/read ────────────────────────────────────────────────── */

/** What marking notifications read may be given: either the lot, or up to a hundred ids. */
export const notifReadInput = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string()).min(1).max(100) })])

/* ── /search: one query across the record types ─────────────────────────── */

/** What the ⌘K palette searches: the two invoice registers, the SKUs and both party books. */
export type SearchSource = { sales: Sale[]; purchases: Purchase[]; items: Item[]; customers: Party[]; vendors: Party[] }

/**
 * Global search: the newest five of each kind that match, twenty in all. A query shorter than two characters
 * answers nothing — the palette asks on every keystroke, and one letter would match half the company.
 */
export function searchAnswer(q: string, src: SearchSource = db): SearchHit[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < 2) return []
  const hits: SearchHit[] = []
  const has = (s: string) => s.toLowerCase().includes(needle)
  const room = (type: SearchHit["type"]) => hits.filter((h) => h.type === type).length < 5
  for (const s of [...src.sales].reverse()) if (has(`${s.invoiceNo} ${s.challanNo} ${s.customerName}`) && room("sale"))
    hits.push({ type: "sale", id: s.id, title: `${s.invoiceNo} · Challan ${s.challanNo}`, subtitle: `${s.customerName} · ${s.issueDate}`, href: `/sales/${s.id}` })
  for (const p of [...src.purchases].reverse()) if (has(`${p.invoiceNo} ${p.challanNo} ${p.vendorName}`) && room("purchase"))
    hits.push({ type: "purchase", id: p.id, title: `${p.invoiceNo} · Challan ${p.challanNo}`, subtitle: `${p.vendorName} · ${p.issueDate}`, href: `/purchases/${p.id}` })
  for (const i of src.items) if (has(`${i.name} ${i.hsCode} ${i.sku}`) && room("item"))
    hits.push({ type: "item", id: i.id, title: i.name, subtitle: `${i.sku} · HS ${i.hsCode} · ${i.group}`, href: `/inventory/items?ledger=${i.id}` })
  for (const c of src.customers) if (has(`${c.name} ${c.bin}`) && room("customer"))
    hits.push({ type: "customer", id: c.id, title: c.name, subtitle: `BIN ${c.bin}`, href: `/master/customers?edit=${c.id}` })
  for (const v of src.vendors) if (has(`${v.name} ${v.bin}`) && room("vendor"))
    hits.push({ type: "vendor", id: v.id, title: v.name, subtitle: `${v.mode} · ${v.bin}`, href: `/master/vendors?edit=${v.id}` })
  return hits.slice(0, 20)
}
