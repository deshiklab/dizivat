import { chequeActionRule } from "../../../../_r91"
import { json, problem, withAuth } from "../../../../_lib"
import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { chequeRowsOf } from "@/lib/money-ops"
import { TODAY } from "@/lib/company"
import type { ChequeEvent } from "@/lib/types"

/** A lifecycle action on one cheque (present / clear / bounce): one append-only event, audited. */
export const POST = withAuth("doc.edit", async (req, { params }: { params: Promise<{ id: string }> }, user) => {
  const { id } = await params
  const row = chequeRowsOf(db, TODAY).find((r) => r.id === id || r.no === id)
  const r = chequeActionRule(row, await req.json().catch(() => ({})))
  if ("status" in r) return problem(r.status, r.title, r.errors)
  const event: ChequeEvent = {
    id: `chq${db.seq.cheque + 1}`, chequeId: row!.id, action: r.action, date: r.date, reason: r.reason,
    by: user.name, at: new Date().toISOString(),
  }
  db.seq.cheque += 1
  db.chequeEvents.push(event)
  recordAudit({ actor: user.name, entity: "cheque", entityId: row!.id, ref: row!.no, action: r.action, note: r.reason })
  return json(chequeRowsOf(db, TODAY).find((x) => x.id === row!.id), { status: 201 })
})
