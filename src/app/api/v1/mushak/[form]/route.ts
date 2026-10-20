import { company } from "@/lib/mock/company"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { json, problem, withAuth } from "../../_lib"
import { mushak610Book, mushakBook } from "../../_derived"

type Ctx = { params: Promise<{ form: string }> }

/** GET /mushak/6.1|6.2|6.2.1?item=&from=&to= (&format=csv). 6.1 = inputs (not finished goods), 6.2 = finished goods. */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { form } = await params
  const sp = new URL(req.url).searchParams
  const q = { item: sp.get("item"), from: sp.get("from"), to: sp.get("to") }
  const a = form === "6.10" ? mushak610Book(q) : mushakBook(form, q, company)
  if ("status" in a) return problem(a.status, a.title, a.errors)
  if (sp.get("format") === "csv") return csvResponse(toCSV(a.rows as never[], a.columns as never[]), a.csvName)
  await delay(120)
  return json(a.book)
})
