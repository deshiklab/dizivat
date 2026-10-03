import { addHistory, branchLabels, db, nextDocId, nextNo, postStock, stockShortfall } from "@/lib/mock/db"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import type { Sale } from "@/lib/types"
import { deny, json, problem, ruleResponse, withAuth } from "../_lib"
import { lotShortfall, parseSale } from "../_r3"

const spec = {
  search: (s: Sale) => `${s.invoiceNo} ${s.challanNo} ${s.customerName} ${s.customerBin} ${s.export ? `${s.export.lcNo} ${s.export.billNo}` : ""}`,
  dateField: "issueDate" as const,
  facets: { process: (s: Sale) => s.process, trade: (s: Sale) => (s.export ? (s.export.deemed ? "deemed" : "export") : "local"), mode: (s: Sale) => s.mode, customer: (s: Sale) => s.customerId, method: (s: Sale) => s.method, payment: (s: Sale) => (s.due <= 0 ? "paid" : s.paid > 0 ? "partial" : "unpaid"), branch: (s: Sale) => s.branchId },
  totals: ["subtotal", "sd", "vat", "discount", "netTotal", "paid", "due"] as (keyof Sale)[],
}

export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
  // R3: goods (default, incl. exports) and service sales are separate lists; ?category=service | all; ?trade=export,deemed = exports
  const cat = sp.get("category") ?? "goods"
  sp.delete("category")
  const src = cat === "all" ? db.sales : db.sales.filter((s) => (s.category ?? "goods") === cat)
  const r = runQuery(src, sp, spec)
  if (sp.get("format") === "csv") {
    const rows = sp.get("ids") ? r.all.filter((s) => sp.get("ids")!.split(",").includes(s.id)) : r.all
    return csvResponse(
      toCSV(rows, [
        { key: "issueDate", label: "Issue Date" }, { key: "invoiceNo", label: "Invoice No" }, { key: "challanNo", label: "Challan No" },
        { key: "customerName", label: "Customer" }, { key: "branchName", label: "Branch" }, { key: "customerBin", label: "BIN" }, { key: "mode", label: "Mode" }, { key: "method", label: "Method" },
        { key: "export", label: "Export", get: (s: Sale) => (s.export ? (s.export.deemed ? "Deemed" : "Direct") : "") }, { key: "lcNo", label: "LC No", get: (s: Sale) => s.export?.lcNo ?? "" },
        { key: "subtotal", label: "SubTotal" }, { key: "sd", label: "SD" }, { key: "vat", label: "VAT" }, { key: "discount", label: "Discount" },
        { key: "netTotal", label: "NetTotal" }, { key: "paid", label: "Received" }, { key: "due", label: "Due" }, { key: "process", label: "Process" },
      ]),
      `sales-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  // facet labels for customers
  const customerNames = Object.fromEntries(db.customers.map((c) => [c.id, c.name]))
  return json({ ...page, facetLabels: { customer: customerNames, branch: branchLabels() } })
})

export const POST = withAuth("doc.create", async (req, _ctx, user) => {
  const r = parseSale(await req.json().catch(() => ({})))
  if ("status" in r) return ruleResponse(r)
  const { data: d, fields } = r
  if (d.process === "Approved") {
    const no = deny(user, "doc.approve"); if (no) return no
    const short = stockShortfall(fields.lines, fields.branchId) ?? lotShortfall(fields.lines)
    if (short) return problem(422, `Insufficient stock — ${short.detail}`, short.errors)
  }
  const sale: Sale = {
    ...fields,
    id: nextDocId("s", [...db.sales, ...db.trash.filter((t) => t.kind === "sale").map((t) => t.doc)]),
    invoiceNo: nextNo(d.category === "service" ? "SS" : "S", d.issueDate),
    challanNo: String(Math.max(...db.sales.map((s) => Number(s.challanNo) || 0)) + 1),
    createdAt: new Date().toISOString(),
    process: "Created",
    history: [],
  }
  addHistory(sale, user.name, "created")
  if (d.process === "Approved") { sale.process = "Approved"; postStock("sale", sale.lines, 1); addHistory(sale, user.name, "approved") }
  db.sales.push(sale)
  return json(sale, { status: 201 })
})
