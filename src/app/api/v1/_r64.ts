/**
 * R6.4 mock API (RMG) — bond consumption register (Customs Act s.114) with BoE ageing against the bonding period,
 * and the duty-drawback view. Read-only; the PostgreSQL build runs the same code through the compat layer.
 */
import { bondRegister } from "@/lib/bond"
import { COMPANY, TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { bondRows } from "@/lib/rmg"
import type { BondRegister } from "@/lib/types"
import { json, problem, withAuth } from "./_lib"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const validDay = (d: string) => DAY_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

/** The register for a date range (default: from go-live to today); the company's own bond licence leads. */
export function bondRegisterOf(from?: string, to?: string): BondRegister {
  const p = db.vatSettings.profile
  const licence = bondRows({ name: COMPANY.name, licenceNo: p?.bondLicenseNo ?? "", expiry: p?.bondLicenseExpiry ?? "" }, [], TODAY)[0]
  const stock = (id: string) => {
    const i = db.items.find((x) => x.id === id)
    return i ? i.opening + i.purchased + i.prodReceive - i.prodIssue - i.sold - i.damage : 0
  }
  return bondRegister(db, { today: TODAY, from, to, licence, stock })
}

/**
 * GET /vat/bond — ?from=&to= (YYYY-MM-DD, to ≤ today; physical stock is compared only when the range ends today),
 * ?format=csv&view=register|lots|drawback
 */
export const bondRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || undefined
  const to = sp.get("to") || undefined
  const errors: Record<string, string[]> = {}
  if (from && !validDay(from)) errors.from = ["date"]
  if (to && (!validDay(to) || to > TODAY)) errors.to = [validDay(to) ? "afterToday" : "date"]
  if (!errors.from && !errors.to && from && to && from > to) errors.to = ["beforeFrom"]
  if (Object.keys(errors).length) return problem(422, "Validation failed", errors)
  const reg = bondRegisterOf(from, to)
  if (sp.get("format") === "csv") {
    const view = sp.get("view") ?? "register"
    const stamp = reg.to
    if (view === "lots") {
      return csvResponse(toCSV(reg.lots.map((l) => ({ ...l })), [
        { key: "boeNo", label: "Bill of Entry" }, { key: "boeDate", label: "BoE date" }, { key: "docNo", label: "Document" }, { key: "source", label: "Source" },
        { key: "name", label: "Item" }, { key: "uom", label: "Unit" }, { key: "qty", label: "Bonded qty" }, { key: "consumed", label: "Consumed in exports" },
        { key: "balance", label: "Balance" }, { key: "dutyForegone", label: "Duty foregone" }, { key: "dutyOnBalance", label: "Duty on balance" },
        { key: "dueDate", label: "Bonding period ends" }, { key: "extendedDue", label: "Latest with extension" }, { key: "daysLeft", label: "Days left" }, { key: "state", label: "Status" },
      ]), `bond-boe-${stamp}.csv`)
    }
    if (view === "drawback") {
      const rows = reg.drawback.rows.flatMap((r) => r.inputs.map((i) => ({ ...i, invoiceNo: r.invoiceNo, exportDate: r.exportDate, billNo: r.billNo, customer: r.customerName, deadline: r.deadline, state: r.state })))
      return csvResponse(toCSV(rows, [
        { key: "invoiceNo", label: "Export invoice" }, { key: "exportDate", label: "Export date" }, { key: "billNo", label: "Bill of export" }, { key: "customer", label: "Buyer / exporter" },
        { key: "purchaseNo", label: "Import" }, { key: "boeNo", label: "Bill of Entry" }, { key: "name", label: "Input" }, { key: "uom", label: "Unit" }, { key: "qty", label: "Qty consumed" },
        { key: "cd", label: "CD" }, { key: "rd", label: "RD" }, { key: "deadline", label: "Claim by" }, { key: "state", label: "Status" },
      ]), `duty-drawback-${stamp}.csv`)
    }
    return csvResponse(toCSV(reg.rows.map((r) => ({ ...r, physical: r.physical ?? "" })), [
      { key: "name", label: "Input" }, { key: "hsCode", label: "HS code" }, { key: "uom", label: "Unit" }, { key: "opening", label: "Bonded opening" },
      { key: "bondedIn", label: "Bonded receipts" }, { key: "bondedUsed", label: "Bonded used in exports" }, { key: "closing", label: "Bonded closing" },
      { key: "dutyPaidIn", label: "Duty-paid receipts" }, { key: "localIn", label: "Local receipts" }, { key: "exportUse", label: "Export consumption" },
      { key: "unsourced", label: "Unsourced" }, { key: "physical", label: "Physical stock" }, { key: "shortfall", label: "Shortfall" },
      { key: "dutyOnBalance", label: "Duty on bonded balance" }, { key: "dutyAtRisk", label: "Duty at risk" }, { key: "state", label: "Status" },
    ]), `bond-register-${stamp}.csv`)
  }
  await delay(80)
  return json(reg)
})
