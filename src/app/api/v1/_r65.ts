/**
 * R6.5 mock API (RMG) — our own UDs / UP with their bond settlement, and duty-drawback claims (DEDO / Mushak-22).
 * The PostgreSQL build runs the same handlers through the compat layer.
 */
import { TODAY } from "@/lib/company"
import { ACTION_FROM, claimLines, claimList, claimRow, claimTotals, claimableCheck, type ClaimAction } from "@/lib/drawback"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { bondUdInput, claimActionInput, claimInput, settleInput } from "@/lib/schemas"
import { bondUdRegister, bondUdRow, normUd, settleCheck, udStatement } from "@/lib/settlement"
import type { BondUd, DrawbackClaim, HistoryEntry } from "@/lib/types"
import { deny, json, problem, withAuth, zodProblem } from "./_lib"
import { bondRegisterOf } from "./_r64"

type Ctx = { params: Promise<{ id: string }> }
const invalid = (errors: Record<string, string[]>) => problem(422, "Validation failed", errors)
const src = () => ({ purchases: db.purchases, sales: db.sales, boms: db.boms, bondUds: db.bondUds })
const findUd = async (p: Ctx["params"]) => { const { id } = await p; return db.bondUds.find((u) => u.id === id || normUd(u.no) === normUd(decodeURIComponent(id))) }
const findClaim = async (p: Ctx["params"]) => { const { id } = await p; return db.drawbackClaims.find((c) => c.id === id || c.no === id) }
const push = (doc: { history?: HistoryEntry[]; updatedAt?: string }, by: string, action: HistoryEntry["action"], note?: string) => {
  const at = new Date().toISOString()
  doc.history = [...(doc.history ?? []), { at, by, action, note }]
  doc.updatedAt = at
  return at
}

/* ── own UDs / UP ─────────────────────────────────────────────────────────────────────────────────────────── */

type UdData = ReturnType<typeof bondUdInput.parse>
/** Items must exist: inputs are raw materials / consumables / packing, garments are finished goods. */
function udLines(d: UdData): { errors?: Record<string, string[]>; inputs?: BondUd["inputs"]; garments?: BondUd["garments"] } {
  const errors: Record<string, string[]> = {}
  const inputs = d.inputs.map((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId)
    if (!it || it.group === "Finished Goods") { errors[`inputs.${i}.itemId`] = ["unknownInput"]; return null }
    return { itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty }
  })
  const garments = d.garments.map((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId)
    if (!it || it.group !== "Finished Goods") { errors[`garments.${i}.itemId`] = ["unknownGarment"]; return null }
    return { itemId: it.id, name: it.name, uom: it.unit, qty: l.qty }
  })
  if (Object.keys(errors).length) return { errors }
  return { inputs: inputs as BondUd["inputs"], garments: garments as BondUd["garments"] }
}
const udLinked = (no: string) =>
  db.purchases.some((p) => p.process !== "Cancelled" && normUd(p.boe?.udNo) === normUd(no)) || db.sales.some((s) => s.process !== "Cancelled" && normUd(s.export?.ownUdNo) === normUd(no))
  || db.bondUds.some((u) => u.settlement?.lines.some((l) => normUd(l.carryTo) === normUd(no)))

/** GET /vat/bond-uds — register (?state=, ?format=csv: one row per statement line). */
export const bondUdsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const reg = bondUdRegister(src(), TODAY)
  const state = sp.get("state")
  if (state) reg.rows = reg.rows.filter((r) => r.state === state)
  if (sp.get("format") === "csv") {
    const rows = reg.rows.flatMap((u) => u.lines.map((l) => {
      const sl = u.settlement?.lines.find((x) => x.itemId === l.itemId)
      return { ...l, no: u.no, kind: u.kind, issuer: u.issuer, date: u.date, expiry: u.expiry, masterLcNo: u.masterLcNo, shippedPct: u.shippedPct, udState: u.state,
        settledOn: u.settlement?.date ?? "", dutyPaidQty: sl?.dutyPaidQty ?? "", carryQty: sl?.carryQty ?? "", carryTo: sl?.carryTo ?? "", dutyPaid: sl?.dutyPaid ?? "" }
    }))
    return csvResponse(toCSV(rows, [
      { key: "no", label: "UD / UP No" }, { key: "kind", label: "Type" }, { key: "issuer", label: "Issued by" }, { key: "date", label: "Date" }, { key: "expiry", label: "Expiry" },
      { key: "masterLcNo", label: "Export LC / contract" }, { key: "shippedPct", label: "Shipped %" }, { key: "udState", label: "UD status" },
      { key: "name", label: "Input" }, { key: "uom", label: "Unit" }, { key: "permitted", label: "UD quantity" }, { key: "broughtForward", label: "Brought forward" },
      { key: "imported", label: "Imported under bond" }, { key: "consumed", label: "Consumed in exports" }, { key: "fromOtherStock", label: "Met from other stock" },
      { key: "balance", label: "Balance" }, { key: "excessImport", label: "Imported beyond UD" }, { key: "dutyOnBalance", label: "Duty on balance" },
      { key: "settledOn", label: "Settled on" }, { key: "dutyPaidQty", label: "Cleared on duty" }, { key: "dutyPaid", label: "Duty paid" }, { key: "carryQty", label: "Carried forward" }, { key: "carryTo", label: "Carried to" },
    ]), `ud-settlement-${TODAY}.csv`)
  }
  await delay(80)
  return json(reg)
})

/** POST /vat/bond-uds — new own UD / UP. */
export const bondUdsPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = bondUdInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const no = normUd(d.no)
  if (db.bondUds.some((u) => normUd(u.no) === no)) return invalid({ no: ["duplicate"] })
  const l = udLines(d)
  if (l.errors) return invalid(l.errors)
  const at = new Date().toISOString()
  const ud: BondUd = {
    id: `bu${++db.seq.bondUd}-${Date.now().toString(36)}`, no, kind: d.kind, issuer: d.issuer, date: d.date, expiry: d.expiry, masterLcNo: d.masterLcNo,
    masterLcValue: d.masterLcValue, currency: d.currency, buyer: d.buyer || undefined, note: d.note || undefined, inputs: l.inputs!, garments: l.garments!,
    createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  db.bondUds.push(ud)
  recordAudit({ at, actor: user, entity: "bondUd", entityId: ud.id, ref: ud.no, action: "created" })
  return json(bondUdRow(ud, src(), TODAY), { status: 201 })
})

/** GET /vat/bond-uds/:id — statement, shipments, settlement. */
export const bondUdGet = withAuth<Ctx>(null, async (_req, { params }) => {
  const u = await findUd(params)
  return u ? json(bondUdRow(u, src(), TODAY)) : problem(404, "UD not found")
})

/** PUT /vat/bond-uds/:id — edit an unsettled UD; its number cannot change once documents quote it. */
export const bondUdPut = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const u = await findUd(params)
  if (!u) return problem(404, "UD not found")
  if (u.settlement) return problem(409, "A settled UD cannot be changed.")
  const parsed = bondUdInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const no = normUd(d.no)
  if (no !== u.no && db.bondUds.some((x) => x.id !== u.id && normUd(x.no) === no)) return invalid({ no: ["duplicate"] })
  if (no !== u.no && udLinked(u.no)) return invalid({ no: ["udInUse"] })
  const l = udLines(d)
  if (l.errors) return invalid(l.errors)
  const before = structuredClone(u)
  Object.assign(u, { no, kind: d.kind, issuer: d.issuer, date: d.date, expiry: d.expiry, masterLcNo: d.masterLcNo, masterLcValue: d.masterLcValue, currency: d.currency, buyer: d.buyer || undefined, note: d.note || undefined, inputs: l.inputs!, garments: l.garments! })
  const changes = diff(before, u, ["no", "kind", "issuer", "date", "expiry", "masterLcNo", "masterLcValue", "buyer", "note"])
  const at = push(u, user.name, "edited")
  recordAudit({ at, actor: user, entity: "bondUd", entityId: u.id, ref: u.no, action: "edited", changes })
  return json(bondUdRow(u, src(), TODAY))
})

/** POST /vat/bond-uds/:id/settle — record the Bond Commissionerate's settlement (statement frozen). */
export const bondUdSettle = withAuth<Ctx>("doc.approve", async (req, { params }, user) => {
  const u = await findUd(params)
  if (!u) return problem(404, "UD not found")
  if (u.settlement) return problem(409, `${u.no} was settled on ${u.settlement.date}.`)
  const parsed = settleInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const s = src()
  const c = settleCheck(bondUdRow(u, s, TODAY), udStatement(u, s).lines, d, db.bondUds, TODAY)
  if (c.errors) return invalid(c.errors)
  const at = new Date().toISOString()
  u.settlement = { date: d.date, bondRef: d.bondRef, paymentRef: d.paymentRef || undefined, note: d.note || undefined, lines: c.lines!, dutyPaid: c.dutyPaid!, by: user.name, at }
  push(u, user.name, "approved", `Settled — ${d.bondRef}`)
  recordAudit({ at, actor: user, entity: "bondUd", entityId: u.id, ref: u.no, action: "approved", note: `Settled — ${d.bondRef}${c.dutyPaid ? ` · duty ৳ ${c.dutyPaid.toFixed(2)}` : ""}` })
  return json(bondUdRow(u, s, TODAY))
})

/* ── drawback claims ─────────────────────────────────────────────────────────────────────────────────────── */

/** Next DBK-MMYY#### (MMYY of today; the counter runs across months and is never reused). */
const nextClaimNo = () => `DBK-${TODAY.slice(5, 7)}${TODAY.slice(2, 4)}${String(++db.seq.claim).padStart(4, "0")}`

/** GET /vat/drawback-claims — ?status=, ?format=csv (one row per export). */
export const claimsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const list = claimList(db.drawbackClaims, TODAY, sp.get("status") || undefined)
  if (sp.get("format") === "csv") {
    const rows = list.rows.flatMap((c) => c.lines.map((l) => ({ ...l, no: c.no, status: c.status, claimed: c.claimed, filedOn: c.filedOn ?? "", dedoRef: c.dedoRef ?? "", sanctioned: c.sanctioned ?? "", paid: c.paid ?? "", paidOn: c.paidOn ?? "" })))
    return csvResponse(toCSV(rows, [
      { key: "no", label: "Claim" }, { key: "status", label: "Status" }, { key: "invoiceNo", label: "Export invoice" }, { key: "exportDate", label: "Export date" }, { key: "billNo", label: "Bill of export" },
      { key: "customerName", label: "Buyer / exporter" }, { key: "cd", label: "CD" }, { key: "rd", label: "RD" }, { key: "total", label: "Export total" }, { key: "deadline", label: "Claim by" },
      { key: "claimed", label: "Claimed" }, { key: "filedOn", label: "Filed on" }, { key: "dedoRef", label: "DEDO ref" }, { key: "sanctioned", label: "Sanctioned" }, { key: "paid", label: "Refunded" }, { key: "paidOn", label: "Refunded on" },
    ]), `drawback-claims-${TODAY}.csv`)
  }
  await delay(80)
  return json(list)
})

/** POST /vat/drawback-claims — draft claim over open exports from the drawback view. */
export const claimsPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = claimInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const rows = bondRegisterOf().drawback.rows
  const bad = claimableCheck(d.saleIds, rows, db.drawbackClaims)
  if (bad) return invalid(bad)
  const lines = claimLines(d.saleIds.map((id) => rows.find((r) => r.saleId === id)!))
  const at = new Date().toISOString()
  const claim: DrawbackClaim = {
    id: `dc${db.seq.claim + 1}-${Date.now().toString(36)}`, no: nextClaimNo(), status: "draft", method: "actual", lines, ...claimTotals(lines),
    note: d.note || undefined, createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  db.drawbackClaims.push(claim)
  recordAudit({ at, actor: user, entity: "drawbackClaim", entityId: claim.id, ref: claim.no, action: "created", note: `${lines.length} export(s) · ৳ ${claim.claimed.toFixed(2)}` })
  return json(claimRow(claim, TODAY), { status: 201 })
})

export const claimGet = withAuth<Ctx>(null, async (_req, { params }) => {
  const c = await findClaim(params)
  return c ? json(claimRow(c, TODAY)) : problem(404, "Claim not found")
})

/** DELETE /vat/drawback-claims/:id — drafts only (the number lives on in the audit trail). */
export const claimDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const c = await findClaim(params)
  if (!c) return problem(404, "Claim not found")
  if (c.status !== "draft") return problem(409, `Only a draft claim can be deleted — ${c.no} is ${c.status}.`)
  db.drawbackClaims.splice(db.drawbackClaims.indexOf(c), 1)
  recordAudit({ actor: user, entity: "drawbackClaim", entityId: c.id, ref: c.no, action: "deleted" })
  return json({ ok: true, id: c.id })
})

const ACTION_PERM: Record<ClaimAction, "doc.create" | "doc.approve"> = { file: "doc.create", sanction: "doc.approve", pay: "doc.approve", reject: "doc.approve" }

/**
 * POST /vat/drawback-claims/:id/action — {action, date, ref?, amount?, reason?}
 *  file: draft → filed (date inside every export's 6-month window); sanction: filed → sanctioned (amount ≤ claimed,
 *  reason when less); pay: sanctioned → paid (amount ≤ sanctioned, default the sanction); reject: filed → rejected (reason).
 */
export const claimAction = withAuth<Ctx>("doc.create", async (req, { params }, user) => {
  const c = await findClaim(params)
  if (!c) return problem(404, "Claim not found")
  const parsed = claimActionInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (ACTION_PERM[d.action] === "doc.approve") { const no = deny(user, "doc.approve"); if (no) return no }
  if (!ACTION_FROM[d.action].includes(c.status)) return problem(409, `Cannot ${d.action} a ${c.status} claim (${c.no}).`)
  const errors: Record<string, string[]> = {}
  if (d.date > TODAY) errors.date = ["afterToday"]
  // filing is bounded by the exports' windows (below); later steps cannot precede the previous one
  const prev = d.action === "sanction" || d.action === "reject" ? c.filedOn : d.action === "pay" ? c.sanctionedOn : undefined
  if (!errors.date && prev && d.date < prev) errors.date = ["beforePrevious"]
  let note = ""
  if (d.action === "file") {
    c.lines.forEach((l, i) => { if (d.date > l.deadline) errors[`lines.${i}`] = ["lapsed"] })
    if (!Object.keys(errors).length) { c.status = "filed"; c.filedOn = d.date; c.dedoRef = d.ref || undefined; note = `Filed with DEDO${d.ref ? ` — ${d.ref}` : ""}` }
  } else if (d.action === "sanction") {
    const amount = d.amount ?? c.claimed
    if (amount > c.claimed + 0.005) errors.amount = ["aboveClaimed"]
    else if (amount < c.claimed - 0.005 && !d.reason) errors.reason = ["required"]
    if (!Object.keys(errors).length) {
      c.status = "sanctioned"; c.sanctionedOn = d.date; c.sanctioned = Math.round(amount * 100) / 100; c.disallowedReason = amount < c.claimed - 0.005 ? d.reason : undefined
      if (d.ref) c.dedoRef = c.dedoRef ?? d.ref
      note = `Sanctioned ৳ ${c.sanctioned.toFixed(2)}${c.disallowedReason ? ` — ${c.disallowedReason}` : ""}`
    }
  } else if (d.action === "pay") {
    const amount = d.amount ?? c.sanctioned ?? 0
    if (amount > (c.sanctioned ?? 0) + 0.005) errors.amount = ["aboveSanctioned"]
    if (!Object.keys(errors).length) { c.status = "paid"; c.paidOn = d.date; c.paid = Math.round(amount * 100) / 100; c.payRef = d.ref || undefined; note = `Refund received ৳ ${c.paid.toFixed(2)}${d.ref ? ` — ${d.ref}` : ""}` }
  } else {
    if (!d.reason) errors.reason = ["required"]
    if (!Object.keys(errors).length) { c.status = "rejected"; c.rejectedOn = d.date; c.rejectReason = d.reason; note = d.reason }
  }
  if (Object.keys(errors).length) return invalid(errors)
  const action: HistoryEntry["action"] = d.action === "file" ? "submitted" : d.action === "reject" ? "cancelled" : d.action === "pay" ? "edited" : "approved"
  const at = push(c, user.name, action, note)
  recordAudit({ at, actor: user, entity: "drawbackClaim", entityId: c.id, ref: c.no, action, note })
  return json(claimRow(c, TODAY))
})
