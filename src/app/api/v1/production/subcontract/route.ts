import { TODAY } from "@/lib/company"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { registerFrom } from "@/lib/rmg"
import { json, problem, withAuth } from "../../_lib"
import { subconRegister, SUBCON_OVERDUE_DAYS } from "../../_r62"

/**
 * R6.2 (RMG): subcontracting register — contractual production batches (inputs sent to a contractor under Mushak 6.4),
 * what is still at the contractor and for how long. ?from&to, ?status=, ?days= (overdue threshold, default 30), ?format=csv
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || registerFrom(TODAY), to = sp.get("to") || TODAY
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return problem(422, "Validation failed", { [/^\d{4}-\d{2}-\d{2}$/.test(from) ? "to" : "from"]: ["date"] })
  if (to < from) return problem(422, "Validation failed", { to: ["toBeforeFrom"] })
  const days = Math.min(365, Math.max(1, Number(sp.get("days")) || SUBCON_OVERDUE_DAYS))
  const reg = subconRegister(from, to, TODAY, days)
  const status = sp.get("status")
  const rows = status ? reg.rows.filter((r) => r.status === status) : reg.rows
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(rows, [
      { key: "no", label: "Batch No" }, { key: "issueDate", label: "Sent" }, { key: "receiveDate", label: "Returned" }, { key: "vendorName", label: "Contractor" },
      { key: "vendorBin", label: "BIN" }, { key: "process", label: "Process" }, { key: "issued", label: "Qty sent" }, { key: "received", label: "Qty returned" },
      { key: "damaged", label: "Wastage" }, { key: "pending", label: "Pending" }, { key: "days", label: "Days" }, { key: "materialValue", label: "Material value" },
      { key: "value", label: "Finished value" }, { key: "status", label: "Status" },
    ]), `subcontract-register-${from}-${to}.csv`)
  }
  await delay(100)
  return json({ ...reg, rows })
})
