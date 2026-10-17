import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { EXPORT_CSV_COLUMNS, exportRegisterOf, exportRegisterRows, registerFrom } from "@/lib/rmg"
import { json, withAuth } from "../../_lib"

/**
 * R6 (RMG): export & deemed-export register — every zero-rated export invoice in the date range with its shipping /
 * back-to-back LC documents and the NBR conditions it meets (deemed exports: clarification of 09-10-2025).
 * Cancelled invoices are excluded. ?from&to (YYYY-MM-DD), ?kind=direct|deemed, ?risk=1 (incomplete only),
 * ?proceeds=open|overdue|partial|realised (R6.2), ?format=csv.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || registerFrom(TODAY), to = sp.get("to") || TODAY
  const { rows: all, totals } = exportRegisterOf({ sales: db.sales, customers: db.customers, uds: db.uds }, from, to, TODAY)
  const rows = exportRegisterRows(all, { kind: sp.get("kind") ?? undefined, risk: sp.get("risk") === "1", proceeds: sp.get("proceeds") ?? undefined })
  if (sp.get("format") === "csv") return csvResponse(toCSV(rows, EXPORT_CSV_COLUMNS), `export-register-${from}-${to}.csv`)
  await delay(120)
  return json({ from, to, rows, totals })
})
