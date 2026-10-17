import { TODAY } from "@/lib/company"
import { recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { udInput } from "@/lib/schemas"
import { json, problem, withAuth, zodProblem } from "../../_lib"
import { udCreate, udCsvColumns, udCsvRows, udRegister } from "../../_r62"

/**
 * R6.2 (RMG): UD / UP register — each exporter customer's Utilization Declarations with the quantities already
 * supplied against them (deemed-export invoices), plus the bond licence watch-list. ?customer=, ?format=csv
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const reg = udRegister(TODAY, sp.get("customer") || undefined)
  if (sp.get("format") === "csv") return csvResponse(toCSV(udCsvRows(reg) as never[], udCsvColumns as never[]), `ud-register-${TODAY}.csv`)
  await delay(100)
  return json(reg)
})

/** POST = one new declaration: the exporter, the inputs it may procure, and the export order behind them. */
export const POST = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = udInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = udCreate(parsed.data, user, TODAY)
  if ("status" in w) return problem(w.status, w.title, w.errors)
  recordAudit({ actor: user, entity: "ud", entityId: w.ud.id, ref: w.ref, action: "created" })
  return json(w.ud, { status: 201 })
})
