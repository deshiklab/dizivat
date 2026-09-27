import { addHistory, db, nextDocId, nextNo, postStock } from "@/lib/mock/db"
import { buildPurchaseFields, unknownItems } from "@/lib/mock/build"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { purchaseInput } from "@/lib/schemas"
import type { Purchase } from "@/lib/types"
import { deny, json, problem, withAuth, zodProblem } from "../_lib"

const spec = {
  search: (p: Purchase) => `${p.invoiceNo} ${p.challanNo} ${p.vendorName} ${p.vendorBin}`,
  dateField: "issueDate" as const,
  facets: { process: (p: Purchase) => p.process, mode: (p: Purchase) => p.mode, vendor: (p: Purchase) => p.vendorId, payment: (p: Purchase) => (p.due <= 0 ? "paid" : p.paid > 0 ? "partial" : "unpaid") },
  totals: ["subtotal", "vat", "tti", "rebate", "netTotal", "paid", "due"] as (keyof Purchase)[],
}

export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
  const r = runQuery(db.purchases, sp, spec)
  if (sp.get("format") === "csv") {
    const rows = sp.get("ids") ? r.all.filter((s) => sp.get("ids")!.split(",").includes(s.id)) : r.all
    return csvResponse(
      toCSV(rows, [
        { key: "issueDate", label: "Issue Date" }, { key: "invoiceNo", label: "Purchase No" }, { key: "challanNo", label: "Challan / BoE" },
        { key: "vendorName", label: "Vendor" }, { key: "vendorBin", label: "BIN/NID" }, { key: "mode", label: "Mode" },
        { key: "subtotal", label: "SubTotal" }, { key: "vat", label: "VAT" }, { key: "tti", label: "TTI" }, { key: "rebate", label: "Rebate" },
        { key: "netTotal", label: "Total" }, { key: "paid", label: "Paid" }, { key: "due", label: "Due" }, { key: "process", label: "Process" },
      ]),
      `purchases-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }
  await delay()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json({ ...page, facetLabels: { vendor: Object.fromEntries(db.vendors.map((v) => [v.id, v.name])) } })
})

export const POST = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = purchaseInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
  const v = db.vendors.find((x) => x.id === d.vendorId && x.active !== false)
  if (!v) return problem(422, "Validation failed", { vendorId: ["unknown"] })
  const bad = unknownItems(d.lines, "buyable")
  if (bad) return problem(422, "Validation failed", bad)
  const p: Purchase = {
    ...buildPurchaseFields(d, v),
    id: nextDocId("p", [...db.purchases, ...db.trash.filter((t) => t.kind === "purchase").map((t) => t.doc)]),
    invoiceNo: nextNo("P", d.issueDate),
    createdAt: new Date().toISOString(),
    process: "Created",
    history: [],
  }
  addHistory(p, user.name, "created")
  // Stock is received on approval only (drafts do not move stock)
  if (d.process === "Approved") { p.process = "Approved"; postStock("purchase", p.lines, 1); addHistory(p, user.name, "approved") }
  db.purchases.push(p)
  return json(p, { status: 201 })
})
