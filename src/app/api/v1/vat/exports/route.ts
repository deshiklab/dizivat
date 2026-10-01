import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { exportCompliance, registerFrom } from "@/lib/rmg"
import { round2 } from "@/lib/vat"
import type { ExportRegister, ExportRegisterRow } from "@/lib/types"
import { json, withAuth } from "../../_lib"

/**
 * R6 (RMG): export & deemed-export register — every zero-rated export invoice in the date range with its shipping /
 * back-to-back LC documents and the NBR conditions it meets (deemed exports: clarification of 09-10-2025).
 * Cancelled invoices are excluded. ?from&to (YYYY-MM-DD), ?kind=direct|deemed, ?risk=1 (incomplete only), ?format=csv.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || registerFrom(TODAY), to = sp.get("to") || TODAY
  const kind = sp.get("kind"), risk = sp.get("risk") === "1"
  const all: ExportRegisterRow[] = db.sales
    .filter((s) => s.export && s.process !== "Cancelled" && s.issueDate >= from && s.issueDate <= to)
    .map((s) => {
      const e = s.export!
      const buyer = db.customers.find((c) => c.id === s.customerId)
      const c = exportCompliance(s, buyer)!
      return {
        id: s.id, date: s.issueDate, invoiceNo: s.invoiceNo, customer: s.customerName, bin: s.customerBin, kind: c.kind, process: s.process,
        lcNo: e.lcNo, lcDate: e.lcDate, udNo: e.udNo, expNo: e.expNo, billNo: e.billNo || undefined, country: e.country || undefined,
        currency: e.currency, fcValue: e.fcValue, exchangeRate: e.exchangeRate, value: s.subtotal, complete: c.complete, missing: c.missing,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo))
  const sum = (rows: ExportRegisterRow[]) => ({ count: rows.length, value: round2(rows.reduce((t, r) => t + r.value, 0)) })
  const totals = { direct: sum(all.filter((r) => r.kind === "direct")), deemed: sum(all.filter((r) => r.kind === "deemed")), atRisk: sum(all.filter((r) => !r.complete)) }
  const rows = all.filter((r) => (!kind || r.kind === kind) && (!risk || !r.complete))
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(rows, [
      { key: "date", label: "Date" }, { key: "invoiceNo", label: "Invoice (Mushak 6.3)" }, { key: "kind", label: "Type" },
      { key: "customer", label: "Customer" }, { key: "bin", label: "BIN" }, { key: "lcNo", label: "LC / BBLC No" }, { key: "lcDate", label: "LC date" },
      { key: "udNo", label: "UD / UP No" }, { key: "expNo", label: "EXP No" }, { key: "billNo", label: "Bill of Export" }, { key: "country", label: "Destination" },
      { key: "currency", label: "Currency" }, { key: "fcValue", label: "FC value" }, { key: "exchangeRate", label: "Rate" }, { key: "value", label: "Value (BDT)" },
      { key: "complete", label: "Zero-rating conditions", get: (r) => (r.complete ? "Complete" : "At risk") }, { key: "missing", label: "Missing", get: (r) => r.missing.join(" | ") },
    ]), `export-register-${from}-${to}.csv`)
  }
  await delay(120)
  return json({ from, to, rows, totals } satisfies ExportRegister)
})
