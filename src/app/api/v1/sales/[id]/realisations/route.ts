import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { recordAudit } from "@/lib/mock/audit"
import { proceedsOf } from "@/lib/rmg"
import { realisationInput } from "@/lib/schemas"
import type { Realisation } from "@/lib/types"
import { json, problem, withAuth, zodProblem } from "../../../_lib"

type Ctx = { params: Promise<{ id: string }> }

/**
 * R6.2 (RMG): export proceeds realised through the bank (PRC). Only approved export invoices with an FC value;
 * the total realised may not exceed the invoice FC value (+0.5 % rounding); the date must fall between the invoice
 * date and today. Returns the updated sale.
 */
export const POST = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const { id } = await params
  const sale = db.sales.find((x) => x.id === id)
  if (!sale) return problem(404, "Sale not found")
  const e = sale.export
  if (!e || sale.process !== "Approved" || !e.fcValue || !e.currency || e.currency === "BDT") return problem(409, "notRealisable")
  const parsed = realisationInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const errors: Record<string, string[]> = {}
  if (d.date < sale.issueDate) errors.date = ["beforeInvoice"]
  else if (d.date > TODAY) errors.date = ["future"]
  const p = proceedsOf(e, sale.issueDate, TODAY)
  if (d.fcAmount > p.outstandingFc + Math.max(0.01, e.fcValue * 0.005)) errors.fcAmount = ["exceedsOutstanding"]
  const prc = d.prcNo.trim().toUpperCase()
  if (db.sales.some((x) => x.export?.realisations?.some((r) => r.prcNo.toUpperCase() === prc))) errors.prcNo = ["duplicate"]
  if (Object.keys(errors).length) return problem(422, "Validation failed", errors)
  const at = new Date().toISOString()
  const r: Realisation = { id: `prc-${sale.id}-${Date.now().toString(36)}`, date: d.date, bank: d.bank, prcNo: prc, fcAmount: d.fcAmount, rate: d.rate, bdt: Math.round(d.fcAmount * d.rate * 100) / 100, note: d.note || undefined, by: user.name, at }
  ;(e.realisations ??= []).push(r)
  ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds realised: ${e.currency} ${d.fcAmount} (PRC ${prc})` })
  recordAudit({ actor: user, entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "realised", note: `${e.currency} ${d.fcAmount} @ ${d.rate} · PRC ${prc} · ${d.bank}` })
  return json(sale, { status: 201 })
})

/** DELETE ?rid= — remove a realisation entered by mistake (approvers / admin). */
export const DELETE = withAuth<Ctx>("doc.approve", async (req, { params }, user) => {
  const { id } = await params
  const sale = db.sales.find((x) => x.id === id)
  const rid = new URL(req.url).searchParams.get("rid")
  const list = sale?.export?.realisations
  const i = list?.findIndex((r) => r.id === rid) ?? -1
  if (!sale || !list || i < 0) return problem(404, "Realisation not found")
  const [r] = list.splice(i, 1)
  const at = new Date().toISOString()
  ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds entry removed: PRC ${r.prcNo}` })
  recordAudit({ actor: user, entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "deleted", note: `Realisation PRC ${r.prcNo} (${sale.export!.currency} ${r.fcAmount}) removed` })
  return json(sale)
})
