/**
 * R6.5 mock API (RMG) — our own UDs / UP with their bond settlement, and duty-drawback claims (DEDO / Mushak-22).
 * Both families' rules are this file's own functions now, shared with the PostgreSQL build through the compat
 * bundle, so the two runtimes' responses, error codes and audit events cannot drift.
 */
import { TODAY } from "@/lib/company"
import { ACTION_FROM, claimLines, claimList, claimRow, claimTotals, claimableCheck, type ClaimAction } from "@/lib/drawback"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { bondUdInput, claimActionInput, claimInput, settleInput } from "@/lib/schemas"
import { bondUdRegister, bondUdRow, normUd, settleCheck, udStatement } from "@/lib/settlement"
import type {
  AuditChange, Bom, BondUd, BondUdGarment, BondUdInput, BondUdRegister, BondUdRow, DrawbackClaim, DrawbackClaimList, DrawbackClaimRow, DrawbackRow, HistoryEntry, Item, Purchase, Sale,
} from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import { deny, json, problem, ruleResponse, withAuth, zodProblem, type RuleProblem } from "./_lib"
import { bondRegisterOf } from "./_r64"

type Ctx = { params: Promise<{ id: string }> }
const src = () => bondSrc()
const findUd = async (p: Ctx["params"]) => { const { id } = await p; return db.bondUds.find((u) => u.id === id || normUd(u.no) === normUd(decodeURIComponent(id))) }
const findClaim = async (p: Ctx["params"]) => { const { id } = await p; return db.drawbackClaims.find((c) => c.id === id || c.no === id) }
const push = (doc: { history?: HistoryEntry[]; updatedAt?: string }, by: string, action: HistoryEntry["action"], note?: string) => {
  const at = new Date().toISOString()
  doc.history = [...(doc.history ?? []), { at, by, action, note }]
  doc.updatedAt = at
  return at
}

/* ── own UDs / UP — the rules, shared with the PostgreSQL build ──────────────────────────────────────────── */

/** What the own-UD rules read: the imports that come in under a permit, the exports that ship against it, the
 *  input–output coefficient their consumption is measured with, the SKUs an input or a garment has to be, and the
 *  permits themselves. */
export interface BondUdSource { purchases: Purchase[]; sales: Sale[]; boms: Bom[]; items: Item[]; bondUds: BondUd[] }
/** The mock's own array is the default; the API hands the rules the rows instead. */
const bondSrc = (): BondUdSource => ({ purchases: db.purchases, sales: db.sales, boms: db.boms, items: db.items, bondUds: db.bondUds })

/** The id the next own UD takes — the mock's own counter, which the API keeps in the snapshot with the rest of `db.seq`. */
export const newBondUdId = (stamp: string) => `bu${++db.seq.bondUd}-${stamp}`

/** What a write hands back: the UD as it stands, what the register shows, and what the audit trail should say. */
export type BondUdWrite = RuleProblem | {
  ud: BondUd; row: BondUdRow
  action: "created" | "edited" | "approved"; ref: string; changes?: AuditChange[]; note?: string
}

export type BondUdParsed = ReturnType<typeof bondUdInput.parse>
export type SettleParsed = ReturnType<typeof settleInput.parse>

/** Items must exist: inputs are raw materials / consumables / packing, garments are finished goods. */
export function bondUdLines(d: BondUdParsed, src: BondUdSource): { errors?: Record<string, string[]>; inputs?: BondUdInput[]; garments?: BondUdGarment[] } {
  const errors: Record<string, string[]> = {}
  const inputs = d.inputs.map((l, i) => {
    const it = src.items.find((x) => x.id === l.itemId)
    if (!it || it.group === "Finished Goods") { errors[`inputs.${i}.itemId`] = ["unknownInput"]; return null }
    return { itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty }
  })
  const garments = d.garments.map((l, i) => {
    const it = src.items.find((x) => x.id === l.itemId)
    if (!it || it.group !== "Finished Goods") { errors[`garments.${i}.itemId`] = ["unknownGarment"]; return null }
    return { itemId: it.id, name: it.name, uom: it.unit, qty: l.qty }
  })
  if (Object.keys(errors).length) return { errors }
  return { inputs: inputs as BondUdInput[], garments: garments as BondUdGarment[] }
}

/** Does any document quote the number — a Bill of Entry that is not cancelled, an export, or another UD's settlement carrying a balance to it? */
export const bondUdInUse = (no: string, src: BondUdSource = db) =>
  src.purchases.some((p) => p.process !== "Cancelled" && normUd(p.boe?.udNo) === normUd(no)) || src.sales.some((s) => s.process !== "Cancelled" && normUd(s.export?.ownUdNo) === normUd(no))
  || src.bondUds.some((u) => u.settlement?.lines.some((l) => normUd(l.carryTo) === normUd(no)))

/**
 * Creating one: the number in capitals and unique among our permits, its inputs and garments priced from the SKUs'
 * own names and units, and the history entry that opens it. Pushed into `src`, which is the mock's array or, in the
 * API, the rows that carry the collection.
 */
export function bondUdCreate(d: BondUdParsed, user: User, today: string, src: BondUdSource = db, stamp = Date.now().toString(36)): BondUdWrite {
  const no = normUd(d.no)
  if (src.bondUds.some((u) => normUd(u.no) === no)) return { status: 422, title: "Validation failed", errors: { no: ["duplicate"] } }
  const l = bondUdLines(d, src)
  if (l.errors) return { status: 422, title: "Validation failed", errors: l.errors }
  const at = new Date().toISOString()
  const ud: BondUd = {
    id: newBondUdId(stamp), no, kind: d.kind, issuer: d.issuer, date: d.date, expiry: d.expiry, masterLcNo: d.masterLcNo,
    masterLcValue: d.masterLcValue, currency: d.currency, buyer: d.buyer || undefined, note: d.note || undefined, inputs: l.inputs!, garments: l.garments!,
    createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  src.bondUds.push(ud)
  return { ud, row: bondUdRow(ud, src, today), action: "created", ref: ud.no }
}

/**
 * Editing one — its number cannot change once a document quotes it. The caller has already refused a settled UD.
 */
export function bondUdUpdate(u: BondUd, d: BondUdParsed, user: User, today: string, src: BondUdSource = db): BondUdWrite {
  const no = normUd(d.no)
  if (no !== u.no && src.bondUds.some((x) => x.id !== u.id && normUd(x.no) === no)) return { status: 422, title: "Validation failed", errors: { no: ["duplicate"] } }
  if (no !== u.no && bondUdInUse(u.no, src)) return { status: 422, title: "Validation failed", errors: { no: ["udInUse"] } }
  const l = bondUdLines(d, src)
  if (l.errors) return { status: 422, title: "Validation failed", errors: l.errors }
  const before = structuredClone(u)
  Object.assign(u, { no, kind: d.kind, issuer: d.issuer, date: d.date, expiry: d.expiry, masterLcNo: d.masterLcNo, masterLcValue: d.masterLcValue, currency: d.currency, buyer: d.buyer || undefined, note: d.note || undefined, inputs: l.inputs!, garments: l.garments! })
  const changes = diff(before, u, ["no", "kind", "issuer", "date", "expiry", "masterLcNo", "masterLcValue", "buyer", "note"])
  push(u, user.name, "edited")
  return { ud: u, row: bondUdRow(u, src, today), action: "edited", ref: u.no, changes }
}

/**
 * Recording the Bond Commissionerate's settlement: every left-over balance disposed of in full — cleared on duty
 * and / or carried to another open UD of ours that lists the input — and the statement frozen with the answer. The
 * caller has already refused a UD that was settled before.
 */
export function bondUdSettle(u: BondUd, d: SettleParsed, user: User, today: string, src: BondUdSource = db): BondUdWrite {
  const c = settleCheck(bondUdRow(u, src, today), udStatement(u, src).lines, d, src.bondUds, today)
  if (c.errors) return { status: 422, title: "Validation failed", errors: c.errors }
  const at = new Date().toISOString()
  u.settlement = { date: d.date, bondRef: d.bondRef, paymentRef: d.paymentRef || undefined, note: d.note || undefined, lines: c.lines!, dutyPaid: c.dutyPaid!, by: user.name, at }
  push(u, user.name, "approved", `Settled — ${d.bondRef}`)
  return { ud: u, row: bondUdRow(u, src, today), action: "approved", ref: u.no, note: `Settled — ${d.bondRef}${c.dutyPaid ? ` · duty ৳ ${c.dutyPaid.toFixed(2)}` : ""}` }
}

/** The register's CSV: one row per statement line, the settlement's disposal beside the balance it disposed of. */
export const bondUdCsvColumns = [
  { key: "no", label: "UD / UP No" }, { key: "kind", label: "Type" }, { key: "issuer", label: "Issued by" }, { key: "date", label: "Date" }, { key: "expiry", label: "Expiry" },
  { key: "masterLcNo", label: "Export LC / contract" }, { key: "shippedPct", label: "Shipped %" }, { key: "udState", label: "UD status" },
  { key: "name", label: "Input" }, { key: "uom", label: "Unit" }, { key: "permitted", label: "UD quantity" }, { key: "broughtForward", label: "Brought forward" },
  { key: "imported", label: "Imported under bond" }, { key: "consumed", label: "Consumed in exports" }, { key: "fromOtherStock", label: "Met from other stock" },
  { key: "balance", label: "Balance" }, { key: "excessImport", label: "Imported beyond UD" }, { key: "dutyOnBalance", label: "Duty on balance" },
  { key: "settledOn", label: "Settled on" }, { key: "dutyPaidQty", label: "Cleared on duty" }, { key: "dutyPaid", label: "Duty paid" }, { key: "carryQty", label: "Carried forward" }, { key: "carryTo", label: "Carried to" },
]
export const bondUdCsvRows = (reg: BondUdRegister) => reg.rows.flatMap((u) => u.lines.map((l) => {
  const sl = u.settlement?.lines.find((x) => x.itemId === l.itemId)
  return { ...l, no: u.no, kind: u.kind, issuer: u.issuer, date: u.date, expiry: u.expiry, masterLcNo: u.masterLcNo, shippedPct: u.shippedPct, udState: u.state,
    settledOn: u.settlement?.date ?? "", dutyPaidQty: sl?.dutyPaidQty ?? "", carryQty: sl?.carryQty ?? "", carryTo: sl?.carryTo ?? "", dutyPaid: sl?.dutyPaid ?? "" }
}))

/* ── own UDs / UP — the mock's routes ───────────────────────────────────────────────────────────────────── */

/** GET /vat/bond-uds — register (?state=, ?format=csv: one row per statement line). */
export const bondUdsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const reg = bondUdRegister(src(), TODAY)
  const state = sp.get("state")
  if (state) reg.rows = reg.rows.filter((r) => r.state === state)
  if (sp.get("format") === "csv") return csvResponse(toCSV(bondUdCsvRows(reg), bondUdCsvColumns), `ud-settlement-${TODAY}.csv`)
  await delay(80)
  return json(reg)
})

/** POST /vat/bond-uds — new own UD / UP. */
export const bondUdsPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = bondUdInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = bondUdCreate(parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ actor: user, entity: "bondUd", entityId: w.ud.id, ref: w.ref, action: "created" })
  return json(w.row, { status: 201 })
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
  const w = bondUdUpdate(u, parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ actor: user, entity: "bondUd", entityId: w.ud.id, ref: w.ref, action: "edited", changes: w.changes })
  return json(w.row)
})

/** POST /vat/bond-uds/:id/settle — record the Bond Commissionerate's settlement (statement frozen). */
export const bondUdSettleRoute = withAuth<Ctx>("doc.approve", async (req, { params }, user) => {
  const u = await findUd(params)
  if (!u) return problem(404, "UD not found")
  if (u.settlement) return problem(409, `${u.no} was settled on ${u.settlement.date}.`)
  const parsed = settleInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = bondUdSettle(u, parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ actor: user, entity: "bondUd", entityId: w.ud.id, ref: w.ref, action: "approved", note: w.note })
  return json(w.row)
})

/* ── drawback claims — the rules, shared with the PostgreSQL build ───────────────────────────────────────── */

/** What the claim rules read: the drawback view's rows (the exports a claim can take, frozen into its lines),
 *  the claims themselves (an export cannot be claimed twice), and the sales (each line's export proceeds). */
export interface ClaimSource { rows: DrawbackRow[]; claims: DrawbackClaim[]; sales: Sale[] }
/** The mock's own arrays are the default; the API hands the rules the rows instead. */
const claimSrc = (claims: DrawbackClaim[] = db.drawbackClaims): ClaimSource => ({ rows: bondRegisterOf().drawback.rows, claims, sales: db.sales })

export type ClaimParsed = ReturnType<typeof claimInput.parse>
export type ClaimActionParsed = ReturnType<typeof claimActionInput.parse>

/** The id and the number the next claim takes — the mock's own counter, which the API keeps in the snapshot with the rest of `db.seq`. */
export const newClaimTag = (stamp: string) => {
  const n = ++db.seq.claim
  return { id: `dc${n}-${stamp}`, no: `DBK-${TODAY.slice(5, 7)}${TODAY.slice(2, 4)}${String(n).padStart(4, "0")}` }
}

/** What a write hands back: the claim as it stands, what the register shows, and what the audit trail should say. */
export type ClaimWrite = RuleProblem | {
  claim: DrawbackClaim; row: DrawbackClaimRow
  action: HistoryEntry["action"]; ref: string; at: string; note?: string
}

/** Which permission each action step needs — the applicant files; the other three are the office's. */
export const CLAIM_ACTION_PERM: Record<ClaimAction, "doc.create" | "doc.approve"> = { file: "doc.create", sanction: "doc.approve", pay: "doc.approve", reject: "doc.approve" }

/**
 * Creating one: every export must still be claimable — on the drawback view, inside its six-month window, not on
 * an active claim — and the amounts are frozen at creation. Pushed into `src`, which is the mock's array or, in
 * the API, the rows that carry the collection.
 */
export function claimCreate(d: ClaimParsed, user: User, today: string, src: ClaimSource = claimSrc(), stamp = Date.now().toString(36)): ClaimWrite {
  const bad = claimableCheck(d.saleIds, src.rows, src.claims)
  if (bad) return { status: 422, title: "Validation failed", errors: bad }
  const lines = claimLines(d.saleIds.map((id) => src.rows.find((r) => r.saleId === id)!))
  const at = new Date().toISOString()
  const tag = newClaimTag(stamp)
  const claim: DrawbackClaim = {
    id: tag.id, no: tag.no, status: "draft", method: "actual", lines, ...claimTotals(lines),
    note: d.note || undefined, createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  src.claims.push(claim)
  return { claim, row: claimRow(claim, today, src.sales), action: "created", ref: claim.no, at, note: `${lines.length} export(s) · ৳ ${claim.claimed.toFixed(2)}` }
}

/** Removing a draft — only a draft (the number lives on in the audit trail either way). */
export function claimRemove(c: DrawbackClaim, today: string, src: ClaimSource = claimSrc()): ClaimWrite {
  if (c.status !== "draft") return { status: 409, title: `Only a draft claim can be deleted — ${c.no} is ${c.status}.` }
  return { claim: c, row: claimRow(c, today, src.sales), action: "deleted", ref: c.no, at: new Date().toISOString() }
}

/**
 * One action step — {action, date, ref?, amount?, reason?}. file: draft → filed (date inside every export's
 * 6-month window); sanction: filed → sanctioned (amount ≤ claimed, reason when less); pay: sanctioned → paid
 * (amount ≤ sanctioned, default the sanction); reject: filed → rejected (reason). The permission and the
 * from-state are the caller's to check first, the way the mock's route did.
 */
export function claimAct(c: DrawbackClaim, d: ClaimActionParsed, user: User, today: string, src: ClaimSource = claimSrc()): ClaimWrite {
  const errors: Record<string, string[]> = {}
  if (d.date > today) errors.date = ["afterToday"]
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
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const action: HistoryEntry["action"] = d.action === "file" ? "submitted" : d.action === "reject" ? "cancelled" : d.action === "pay" ? "edited" : "approved"
  const at = push(c, user.name, action, note)
  return { claim: c, row: claimRow(c, today, src.sales), action, ref: c.no, at, note }
}

/** The register's CSV: one row per export, the claim's own state beside the export's. */
export const claimCsvColumns = [
  { key: "no", label: "Claim" }, { key: "status", label: "Status" }, { key: "invoiceNo", label: "Export invoice" }, { key: "exportDate", label: "Export date" }, { key: "billNo", label: "Bill of export" },
  { key: "customerName", label: "Buyer / exporter" }, { key: "cd", label: "CD" }, { key: "rd", label: "RD" }, { key: "total", label: "Export total" }, { key: "deadline", label: "Claim by" },
  { key: "claimed", label: "Claimed" }, { key: "filedOn", label: "Filed on" }, { key: "dedoRef", label: "DEDO ref" }, { key: "sanctioned", label: "Sanctioned" }, { key: "paid", label: "Refunded" }, { key: "paidOn", label: "Refunded on" },
]
export const claimCsvRows = (list: DrawbackClaimList) => list.rows.flatMap((c) => c.lines.map((l) => ({ ...l, no: c.no, status: c.status, claimed: c.claimed, filedOn: c.filedOn ?? "", dedoRef: c.dedoRef ?? "", sanctioned: c.sanctioned ?? "", paid: c.paid ?? "", paidOn: c.paidOn ?? "" })))

/* ── drawback claims — the mock's routes ────────────────────────────────────────────────────────────────── */

/** GET /vat/drawback-claims — ?status=, ?format=csv (one row per export). */
export const claimsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const list = claimList(db.drawbackClaims, TODAY, sp.get("status") || undefined, db.sales)
  if (sp.get("format") === "csv") return csvResponse(toCSV(claimCsvRows(list), claimCsvColumns), `drawback-claims-${TODAY}.csv`)
  await delay(80)
  return json(list)
})

/** POST /vat/drawback-claims — draft claim over open exports from the drawback view. */
export const claimsPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = claimInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = claimCreate(parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "drawbackClaim", entityId: w.claim.id, ref: w.ref, action: "created", note: w.note })
  return json(w.row, { status: 201 })
})

export const claimGet = withAuth<Ctx>(null, async (_req, { params }) => {
  const c = await findClaim(params)
  return c ? json(claimRow(c, TODAY, db.sales)) : problem(404, "Claim not found")
})

/** DELETE /vat/drawback-claims/:id — drafts only (the number lives on in the audit trail). */
export const claimDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const c = await findClaim(params)
  if (!c) return problem(404, "Claim not found")
  const w = claimRemove(c, TODAY)
  if ("status" in w) return ruleResponse(w)
  db.drawbackClaims.splice(db.drawbackClaims.indexOf(c), 1)
  recordAudit({ actor: user, entity: "drawbackClaim", entityId: c.id, ref: w.ref, action: "deleted" })
  return json({ ok: true, id: c.id })
})

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
  if (CLAIM_ACTION_PERM[d.action] === "doc.approve") { const no = deny(user, "doc.approve"); if (no) return no }
  if (!ACTION_FROM[d.action].includes(c.status)) return problem(409, `Cannot ${d.action} a ${c.status} claim (${c.no}).`)
  const w = claimAct(c, d, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "drawbackClaim", entityId: c.id, ref: w.ref, action: w.action, note: w.note })
  return json(w.row)
})
