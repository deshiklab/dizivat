import { TODAY } from "@/lib/company"
import { company } from "@/lib/mock/company"
import { db, withStock } from "@/lib/mock/db"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import type { MushakBook } from "@/lib/types"
import { json, problem, withAuth } from "../../_lib"
import { buildBook } from "../../_ledger"
import { mushak610 } from "../../_r4"

type Ctx = { params: Promise<{ form: string }> }
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** GET /mushak/6.1|6.2?item=&from=&to= (&format=csv). 6.1 = inputs (not finished goods), 6.2 = finished goods. */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { form } = await params
  const sp = new URL(req.url).searchParams
  if (form === "6.10") return m610(sp)
  if (form !== "6.1" && form !== "6.2") return problem(404, form === "9.1" ? "Mushak 9.1 lives under /vat/returns/{period}" : `Mushak ${form} is not available`)
  const it = db.items.find((i) => i.id === sp.get("item"))
  const from = sp.get("from") || "2026-07-01", to = sp.get("to") || TODAY
  const errors: Record<string, string[]> = {}
  if (!it) errors.item = ["required"]
  else if ((form === "6.2") !== (it.group === "Finished Goods")) errors.item = [form === "6.2" ? "finishedGoodsOnly" : "inputsOnly"]
  if (!ISO.test(from)) errors.from = ["required"]
  if (!ISO.test(to)) errors.to = ["required"]
  if (!errors.from && !errors.to && from > to) errors.to = ["toBeforeFrom"]
  if (Object.keys(errors).length || !it) return problem(422, "Validation failed", errors)
  const b = buildBook(form, it, from, to)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(b.rows, [
      { key: "sl", label: "SL" }, { key: "date", label: "Date" }, { key: "openQty", label: "Opening qty" }, { key: "openValue", label: "Opening value" },
      { key: "ref", label: form === "6.1" ? "Challan / BoE / Ref" : "Invoice / Ref" }, { key: "refDate", label: "Ref date" },
      { key: "party", label: form === "6.1" ? "Seller" : "Buyer" }, { key: "partyAddress", label: "Address" }, { key: "partyBin", label: "BIN/NID" }, { key: "description", label: "Description" },
      { key: "inQty", label: form === "6.1" ? "Purchased qty" : "Produced qty" }, { key: "inValue", label: "Value (excl. SD & VAT)" }, { key: "sd", label: "SD" }, { key: "vat", label: "VAT" },
      { key: "outQty", label: form === "6.1" ? "Used / out qty" : "Sold / out qty" }, { key: "outValue", label: "Out value" }, { key: "closeQty", label: "Closing qty" }, { key: "closeValue", label: "Closing value" },
    ]), `mushak-${form}-${it.sku}-${from}-${to}.csv`)
  }
  await delay(120)
  const body: MushakBook = { ...b, item: withStock(it), company: { name: company.name, address: company.address, bin: company.bin } }
  return json(body)
})

/** Mushak 6.10 — purchases and sales above Tk 2 lakh in the period (legacy crashed with "totalPurchase" missing, D-05). */
async function m610(sp: URLSearchParams) {
  const from = sp.get("from") || "2026-07-01", to = sp.get("to") || TODAY
  const errors: Record<string, string[]> = {}
  if (!ISO.test(from)) errors.from = ["required"]
  if (!ISO.test(to)) errors.to = ["required"]
  if (!errors.from && !errors.to && from > to) errors.to = ["toBeforeFrom"]
  if (Object.keys(errors).length) return problem(422, "Validation failed", errors)
  const r = mushak610(from, to)
  if (sp.get("format") === "csv") {
    const rows = [...r.purchases.map((x) => ({ ...x, part: "Purchase" })), ...r.sales.map((x) => ({ ...x, part: "Sale" }))]
    return csvResponse(toCSV(rows, [
      { key: "part", label: "Part" }, { key: "sl", label: "SL" }, { key: "no", label: "Invoice No" }, { key: "challanNo", label: "Challan No" }, { key: "date", label: "Date" },
      { key: "party", label: "Name" }, { key: "address", label: "Address" }, { key: "bin", label: "BIN" }, { key: "value", label: "Value" }, { key: "vat", label: "VAT" }, { key: "total", label: "Total" },
    ]), `mushak-6.10-${from}-${to}.csv`)
  }
  await delay(120)
  return json(r)
}
