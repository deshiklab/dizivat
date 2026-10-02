import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { udInput } from "@/lib/schemas"
import type { UdRecord } from "@/lib/types"
import { json, problem, withAuth, zodProblem } from "../../_lib"
import { udCheck, udRegister } from "../../_r62"

/**
 * R6.2 (RMG): UD / UP register — each exporter customer's Utilization Declarations with the quantities already
 * supplied against them (deemed-export invoices), plus the bond licence watch-list. ?customer=, ?format=csv
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const reg = udRegister(TODAY, sp.get("customer") || undefined)
  if (sp.get("format") === "csv") {
    const rows = reg.rows.flatMap((u) => u.lines.map((l) => ({ ...l, no: u.no, kind: u.kind, date: u.date, expiry: u.expiry, customer: u.customerName, bin: u.customerBin, masterLcNo: u.masterLcNo, state: u.state })))
    return csvResponse(toCSV(rows, [
      { key: "no", label: "UD / UP No" }, { key: "kind", label: "Type" }, { key: "date", label: "Date" }, { key: "expiry", label: "Expiry" },
      { key: "customer", label: "Exporter" }, { key: "bin", label: "BIN" }, { key: "masterLcNo", label: "Export LC / contract" },
      { key: "name", label: "Item" }, { key: "hsCode", label: "HS code" }, { key: "uom", label: "Unit" }, { key: "qty", label: "UD quantity" },
      { key: "used", label: "Supplied" }, { key: "remaining", label: "Remaining" }, { key: "pct", label: "Used %" }, { key: "state", label: "Status" },
    ]), `ud-register-${TODAY}.csv`)
  }
  await delay(100)
  return json(reg)
})

export const POST = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = udInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const c = udCheck(d)
  if (c.errors) return problem(422, "Validation failed", c.errors)
  const at = new Date().toISOString()
  const ud: UdRecord = {
    id: `ud${++db.seq.ud}-${Date.now().toString(36)}`, no: d.no.trim().toUpperCase(), kind: d.kind, date: d.date, expiry: d.expiry,
    customerId: c.customer!.id, customerName: c.customer!.name, customerBin: c.customer!.bin, masterLcNo: d.masterLcNo, buyer: d.buyer || undefined,
    lines: c.lines!, status: d.status, note: d.note || undefined, masterLcValue: d.masterLcValue, currency: d.currency, createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  db.uds.push(ud)
  recordAudit({ actor: user, entity: "ud", entityId: ud.id, ref: `${ud.no} · ${ud.customerName}`, action: "created" })
  return json(ud, { status: 201 })
})
