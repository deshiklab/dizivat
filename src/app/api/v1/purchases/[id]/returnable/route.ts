import { db } from "@/lib/mock/db"
import { json, problem, withAuth } from "../../../_lib"
import { returnable } from "../../../_r2"

type Ctx = { params: Promise<{ id: string }> }

/** Per item: purchased, already returned (non-cancelled debit notes) and still returnable. `?exclude=<dn id>` when editing a draft. */
export const GET = withAuth<Ctx>(null, async (req, { params }) => {
  const { id } = await params
  const p = db.purchases.find((x) => x.id === id || x.invoiceNo === id)
  if (!p || p.category === "service") return problem(404, "Purchase not found")
  return json({ purchase: { id: p.id, invoiceNo: p.invoiceNo, process: p.process, issueDate: p.issueDate }, lines: returnable(p, new URL(req.url).searchParams.get("exclude") ?? undefined) })
})
