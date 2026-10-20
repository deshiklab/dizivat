import { TODAY } from "@/lib/company"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { json, ruleResponse, withAuth } from "../../_lib"
import { SUBCON_CSV_COLUMNS, subconCsvName, subconParams, subconRegister, subconRows } from "../../_r62"

/**
 * R6.2 (RMG): subcontracting register — contractual production batches (inputs sent to a contractor under Mushak 6.4),
 * what is still at the contractor and for how long. ?from&to, ?status=, ?days= (overdue threshold, default 30), ?format=csv
 *
 * R5.5: the range, the threshold, the rows and the CSV columns are `_r62`'s own rules, and the batches they walk are
 * a table — so the API's native register (api/src/modules/derived.ts) answers from the rows with the same rules.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const r = subconParams(sp, TODAY)
  if ("status" in r) return ruleResponse(r)
  const reg = subconRegister(r.from, r.to, TODAY, r.days)
  const rows = subconRows(reg, r.only)
  if (sp.get("format") === "csv") return csvResponse(toCSV(rows, SUBCON_CSV_COLUMNS), subconCsvName(r.from, r.to))
  await delay(100)
  return json({ ...reg, rows })
})
