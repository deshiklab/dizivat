import { addHistory, db, nextDocId, nextNo, postStock, stockShortfall } from "@/lib/mock/db"
import { buildSaleFields, unknownItems } from "@/lib/mock/build"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { saleInput } from "@/lib/schemas"
import type { Sale } from "@/lib/types"
import { deny, json, problem, withAuth, zodProblem } from "../_lib"

const spec = {
  search: (s: Sale) => `${s.invoiceNo} ${s.challanNo} ${s.customerName} ${s.customerBin}`,
  dateField: "issueDate" as const,
  facets: { process: (s: Sale) => s.process, mode: (s: Sale) => s.mode, customer: (s: Sale) => s.customerId, method: (s: Sale) => s.method, payment: (s: Sale) => (s.due <= 0 ? "paid" : s.paid > 0 ? "partial" : "unpaid") },
  totals: ["subtotal", "sd", "vat", "discount", "netTotal", "paid", "due"] as (keyof Sale)[],
}

export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
  const r = runQuery(db.sales, sp, spec)
  if (sp.get("format") === "csv") {
    const rows = sp.get("ids") ? r.all.filter((s) => sp.get("ids")!.split(",").includes(s.id)) : r.all
    return csvResponse(
      toCSV(rows, [
        { key: "issueDate", label: "Issue Date" }, { key: "invoiceNo", label: "Invoice No" }, { key: "challanNo", label: "Challan No" },
        { key: "customerName", label: "Customer" }, { key: "customerBin", label: "BIN" }, { key: "mode", label: "Mode" }, { key: "method", label: "Method" },
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
  return json({ ...page, facetLabels: { customer: customerNames } })
})

export const POST = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = saleInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
  const cust = db.customers.find((c) => c.id === d.customerId && c.active !== false)
  if (!cust) return problem(422, "Validation failed", { customerId: ["unknown"] })
  const bad = unknownItems(d.lines, "Finished Goods")
  if (bad) return problem(422, "Validation failed", bad)
  const fields = buildSaleFields(d, cust)
  if (d.process === "Approved") {
    const short = stockShortfall(fields.lines)
    if (short) return problem(422, `Insufficient stock — ${short.detail}`, short.errors)
  }
  const sale: Sale = {
    ...fields,
    id: nextDocId("s", [...db.sales, ...db.trash.filter((t) => t.kind === "sale").map((t) => t.doc)]),
    invoiceNo: nextNo("S", d.issueDate),
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
