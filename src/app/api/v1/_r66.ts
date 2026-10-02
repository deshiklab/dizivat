/**
 * R6.6 mock API — export proceeds matched from the bank's PRC file (RMG), and the Mushak 9.3 (late filing) / 9.4
 * (amended return) applications (NBR enlistment). The PostgreSQL build runs the same handlers through the compat layer.
 */
import { TODAY } from "@/lib/company"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { csvResponse, delay, toCSV } from "@/lib/mock/query"
import { matchPrc, postCheck, proceedsOverview, sampleBankFile, openExports } from "@/lib/proceeds"
import { periodLabel, periodOf } from "@/lib/r4"
import { AMEND_YEARS, amendEffect, amendmentRow, applyCorrections, fieldsOf, lateFilingRow, lateLimits, latestComputation, noteValue } from "@/lib/return-apps"
import { addMonths } from "@/lib/sd-export"
import { amendActionInput, amendmentInput, lateActionInput, lateFilingInput, prcMatchInput, prcPostInput, prcReverseInput } from "@/lib/schemas"
import type { HistoryEntry, LateFiling, PrcBatch, Realisation, ReturnAmendment, VatAdjustment } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { deny, json, problem, withAuth, zodProblem } from "./_lib"
import { FIRST_RETURN } from "@/lib/mock/seed-r4"
import { nextNo } from "./_r4"

type Ctx = { params: Promise<{ id: string }> }
const invalid = (errors: Record<string, string[]>) => problem(422, "Validation failed", errors)
const push = (doc: { history?: HistoryEntry[]; updatedAt?: string }, by: string, action: HistoryEntry["action"], note?: string) => {
  const at = new Date().toISOString()
  doc.history = [...(doc.history ?? []), { at, by, action, note }]
  doc.updatedAt = at
  return at
}
const mmyy = () => `${TODAY.slice(5, 7)}${TODAY.slice(2, 4)}`
const CURRENT = periodOf(TODAY)

/* ── export proceeds (PRC file) ───────────────────────────────────────────────────────────────────────────── */

/** GET /vat/proceeds — open exports with ageing, realised this FY, batches (?format=csv: the open list). */
export const proceedsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const o = proceedsOverview(db.sales, db.prcBatches, TODAY)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(o.open, [
      { key: "invoiceNo", label: "Invoice" }, { key: "date", label: "Invoice date" }, { key: "customer", label: "Buyer / exporter" }, { key: "lcNo", label: "LC / BB-LC" },
      { key: "expNo", label: "EXP No" }, { key: "currency", label: "Currency" }, { key: "fcValue", label: "FC value" }, { key: "outstandingFc", label: "Outstanding (FC)" },
      { key: "due", label: "Realise by" }, { key: "daysLeft", label: "Days left" }, { key: "state", label: "State" },
    ]), `export-proceeds-open-${TODAY}.csv`)
  }
  await delay(80)
  return json(o)
})

/** GET /vat/proceeds/sample — a demonstration bank file built from today's open exports. */
export const proceedsSample = withAuth(null, async () => csvResponse(sampleBankFile(db.sales, TODAY), `bank-prc-sample-${TODAY}.csv`))

/** POST /vat/proceeds/match — propose allocations for the rows of a bank file (nothing is saved). */
export const proceedsMatch = withAuth("doc.edit", async (req) => {
  const parsed = prcMatchInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  await delay(120)
  return json(matchPrc(parsed.data.rows, db.sales, TODAY))
})

/** GET /vat/proceeds/batches — posted / reversed bank-file batches, newest first. */
export const batchesGet = withAuth(null, async () => {
  await delay(60)
  return json({ rows: [...db.prcBatches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) })
})

/** POST /vat/proceeds/batches — post the confirmed allocations as realisations (one batch per file). */
export const batchesPost = withAuth("doc.edit", async (req, _ctx, user) => {
  const parsed = prcPostInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const bad = postCheck(d.rows, db.sales, TODAY)
  if (bad) return invalid(bad)
  const at = new Date().toISOString()
  const id = `pb${++db.seq.prcBatch}-${Date.now().toString(36)}`
  const no = `PB-${mmyy()}${String(db.seq.prcBatch).padStart(4, "0")}`
  const open = new Map(openExports(db.sales, TODAY).map((o) => [o.saleId, o]))
  const lines: PrcBatch["lines"] = []
  d.rows.filter((r) => r.allocations.length).forEach((r) => {
    const prc = r.prcNo.trim().toUpperCase(), currency = r.currency.toUpperCase()
    const allocations = r.allocations.map((a, j) => {
      const sale = db.sales.find((s) => s.id === a.saleId)!
      const fc = round2(a.fcAmount)
      const rz: Realisation = { id: `prc-${sale.id}-${id}-${r.line}-${j}`, date: r.date, bank: r.bank || "—", prcNo: prc, fcAmount: fc, rate: r.rate, bdt: round2(fc * r.rate), note: `Bank file ${d.fileName} · line ${r.line}`, by: user.name, at, batchId: id }
      ;(sale.export!.realisations ??= []).push(rz)
      ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds realised: ${currency} ${fc} (PRC ${prc}, batch ${no})` })
      recordAudit({ at, actor: user, entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "realised", note: `${currency} ${fc} @ ${r.rate} · PRC ${prc} · ${no}` })
      return { saleId: sale.id, invoiceNo: sale.invoiceNo, customer: open.get(sale.id)?.customer ?? sale.customerName, fcAmount: fc, basis: a.basis, realisationId: rz.id }
    })
    lines.push({ line: r.line, prcNo: prc, date: r.date, bank: r.bank || "—", currency, fcAmount: r.fcAmount, rate: r.rate, bdt: round2(allocations.reduce((a, x) => a + x.fcAmount, 0) * r.rate),
      expNo: r.expNo || undefined, lcNo: r.lcNo || undefined, invoiceRef: r.invoiceRef || undefined, remitter: r.remitter || undefined, allocations })
  })
  const cur = new Map<string, number>()
  for (const l of lines) cur.set(l.currency, round2((cur.get(l.currency) ?? 0) + l.allocations.reduce((a, x) => a + x.fcAmount, 0)))
  const batch: PrcBatch = {
    id, no, fileName: d.fileName, status: "posted", lines, skipped: d.skipped + d.rows.filter((r) => !r.allocations.length).length,
    invoices: new Set(lines.flatMap((l) => l.allocations.map((a) => a.saleId))).size, fcTotals: [...cur].map(([currency, fc]) => ({ currency, fc })),
    bdt: round2(lines.reduce((a, l) => a + l.bdt, 0)), createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created", note: `${lines.length} PRC(s) posted from the bank file` }],
  }
  db.prcBatches.push(batch)
  recordAudit({ at, actor: user, entity: "prcBatch", entityId: id, ref: `${no} · ${d.fileName}`, action: "imported", note: `${lines.length} PRC(s) → ${batch.invoices} invoice(s) · ৳ ${batch.bdt.toFixed(2)}` })
  return json(batch, { status: 201 })
})

const findBatch = async (p: Ctx["params"]) => { const { id } = await p; return db.prcBatches.find((b) => b.id === id || b.no === id) }
export const batchGet = withAuth<Ctx>(null, async (_req, { params }) => {
  const b = await findBatch(params)
  return b ? json(b) : problem(404, "Batch not found")
})

/** POST /vat/proceeds/batches/:id/reverse — remove every realisation the batch posted (approvers). */
export const batchReverse = withAuth<Ctx>("doc.approve", async (req, { params }, user) => {
  const b = await findBatch(params)
  if (!b) return problem(404, "Batch not found")
  if (b.status === "reversed") return problem(409, `${b.no} was reversed on ${b.reversedOn}.`)
  const parsed = prcReverseInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.date > TODAY) return invalid({ date: ["afterToday"] })
  if (d.date < b.createdAt.slice(0, 10) && d.date < (b.lines[0]?.date ?? d.date)) return invalid({ date: ["beforePosted"] })
  const at = new Date().toISOString()
  let removed = 0
  for (const l of b.lines) for (const a of l.allocations) {
    const sale = db.sales.find((s) => s.id === a.saleId)
    const list = sale?.export?.realisations
    const i = list?.findIndex((r) => r.id === a.realisationId) ?? -1
    if (!sale || !list || i < 0) continue
    list.splice(i, 1)
    removed++
    ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds entry removed: PRC ${l.prcNo} (batch ${b.no} reversed)` })
    recordAudit({ at, actor: user, entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "deleted", note: `Realisation PRC ${l.prcNo} (${l.currency} ${a.fcAmount}) removed — ${b.no} reversed` })
  }
  b.status = "reversed"; b.reversedOn = d.date; b.reverseReason = d.reason
  push(b, user.name, "cancelled", `Reversed — ${d.reason}`)
  recordAudit({ at, actor: user, entity: "prcBatch", entityId: b.id, ref: `${b.no} · ${b.fileName}`, action: "cancelled", note: `${removed} realisation(s) removed — ${d.reason}` })
  return json(b)
})

/* ── Mushak 9.3 — late filing ─────────────────────────────────────────────────────────────────────────────── */

const retOf = (period: string) => db.returns.find((r) => r.period === period)
const lfRow = (lf: LateFiling) => lateFilingRow(lf, retOf(lf.period), db.vatSettings, TODAY)
const findLf = async (p: Ctx["params"]) => { const { id } = await p; return db.lateFilings.find((x) => x.id === id || x.no === id) }
const lfRef = (lf: LateFiling) => `${lf.no} · 9.3 · ${periodLabel(lf.period)}`

/** Period / requested-date checks shared by create and edit. */
function lfCheck(d: ReturnType<typeof lateFilingInput.parse>, selfId?: string): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {}
  if (d.period < FIRST_RETURN || d.period > CURRENT) errors.period = ["outOfRange"]
  else if (retOf(d.period)?.status === "submitted") errors.period = ["alreadySubmitted"]
  else if (db.lateFilings.some((x) => x.id !== selfId && x.period === d.period && x.status !== "rejected")) errors.period = ["duplicate"]
  if (!errors.period) {
    const lim = lateLimits(d.period, db.vatSettings)
    if (d.requestedDate <= lim.due) errors.requestedDate = ["notAfterDue"]
    else if (d.requestedDate > lim.maxDate) errors.requestedDate = ["beyondMonth"]
  }
  return Object.keys(errors).length ? errors : null
}

/** GET /vat/late-filings — ?status= (draft|filed|approved|deemed|rejected), ?format=csv. */
export const lateGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const status = sp.get("status")
  const rows = db.lateFilings.map(lfRow).filter((r) => !status || r.state === status).sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.no < b.no ? 1 : -1))
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(rows, [
      { key: "no", label: "Application" }, { key: "period", label: "Tax period", get: (r) => periodLabel(r.period) }, { key: "due", label: "Due date" },
      { key: "requestedDate", label: "Requested to" }, { key: "state", label: "Status" }, { key: "filedOn", label: "Filed on" }, { key: "filedRef", label: "Reference" },
      { key: "decidedOn", label: "Decided on" }, { key: "effectiveDate", label: "Return allowed to" }, { key: "reasonKind", label: "Reason" }, { key: "reason", label: "Details" },
    ]), `mushak-9.3-${TODAY}.csv`)
  }
  await delay(60)
  return json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, allowed: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, rejected: rows.filter((r) => r.state === "rejected").length } })
})

export const latePost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = lateFilingInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const bad = lfCheck(d)
  if (bad) return invalid(bad)
  const at = new Date().toISOString()
  db.seq.lateFiling++
  const lf: LateFiling = {
    id: `lf${db.seq.lateFiling}-${Date.now().toString(36)}`, no: `LF-${mmyy()}${String(db.seq.lateFiling).padStart(4, "0")}`, period: d.period, reasonKind: d.reasonKind,
    reason: d.reason, requestedDate: d.requestedDate, status: "draft", createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  db.lateFilings.push(lf)
  recordAudit({ at, actor: user, entity: "lateFiling", entityId: lf.id, ref: lfRef(lf), action: "created" })
  return json(lfRow(lf), { status: 201 })
})

export const lateOne = withAuth<Ctx>(null, async (_req, { params }) => {
  const lf = await findLf(params)
  return lf ? json(lfRow(lf)) : problem(404, "Application not found")
})

export const latePut = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  if (lf.status !== "draft") return problem(409, `Only a draft application can be changed — ${lf.no} is ${lf.status}.`)
  const parsed = lateFilingInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const bad = lfCheck(parsed.data, lf.id)
  if (bad) return invalid(bad)
  const before = structuredClone(lf)
  Object.assign(lf, parsed.data)
  const at = push(lf, user.name, "edited")
  recordAudit({ at, actor: user, entity: "lateFiling", entityId: lf.id, ref: lfRef(lf), action: "edited", changes: diff(before, lf, ["period", "reasonKind", "reason", "requestedDate"]) })
  return json(lfRow(lf))
})

export const lateDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  if (lf.status !== "draft") return problem(409, `Only a draft application can be deleted — ${lf.no} is ${lf.status}.`)
  db.lateFilings.splice(db.lateFilings.indexOf(lf), 1)
  recordAudit({ actor: user, entity: "lateFiling", entityId: lf.id, ref: lfRef(lf), action: "deleted" })
  return json({ ok: true, id: lf.id })
})

/**
 * POST /vat/late-filings/:id/action — {action, date, ref?, grantedDate?, reason?}
 *  file (draft → filed): on or before 7 days after the period ends, return not submitted;
 *  approve (filed / deemed → approved): granted date after the due date, at most the date asked for;
 *  reject (filed → rejected, reason; not once deemed approved).
 */
export const lateAction = withAuth<Ctx>("doc.create", async (req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  const parsed = lateActionInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.action !== "file") { const no = deny(user, "doc.approve"); if (no) return no }
  const row = lfRow(lf)
  const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"] }[d.action]
  if (!from.includes(row.state)) return problem(409, row.state === "deemed" && d.action === "reject" ? `${lf.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 7 days.` : `Cannot ${d.action} a ${row.state} application (${lf.no}).`)
  const errors: Record<string, string[]> = {}
  if (d.date > TODAY) errors.date = ["afterToday"]
  let note = ""
  if (d.action === "file") {
    if (!errors.date && d.date > row.applyBy) errors.date = ["afterApplyBy"]
    if (retOf(lf.period)?.status === "submitted") errors.period = ["alreadySubmitted"]
    if (!Object.keys(errors).length) { lf.status = "filed"; lf.filedOn = d.date; lf.filedRef = d.ref || undefined; note = `Filed${d.ref ? ` — ${d.ref}` : ""}` }
  } else {
    if (!errors.date && lf.filedOn && d.date < lf.filedOn) errors.date = ["beforePrevious"]
    if (d.action === "approve") {
      const granted = d.grantedDate ?? lf.requestedDate
      if (granted <= row.due) errors.grantedDate = ["notAfterDue"]
      else if (granted > lf.requestedDate) errors.grantedDate = ["aboveRequested"]
      if (!Object.keys(errors).length) { lf.status = "approved"; lf.decidedOn = d.date; lf.commissionerRef = d.ref || undefined; lf.grantedDate = granted; note = `Allowed to ${granted}${d.ref ? ` — ${d.ref}` : ""}` }
    } else {
      if (!d.reason) errors.reason = ["required"]
      if (!Object.keys(errors).length) { lf.status = "rejected"; lf.decidedOn = d.date; lf.commissionerRef = d.ref || undefined; lf.rejectReason = d.reason; note = `Refused — ${d.reason}` }
    }
  }
  if (Object.keys(errors).length) return invalid(errors)
  const action: HistoryEntry["action"] = d.action === "file" ? "submitted" : d.action === "approve" ? "approved" : "cancelled"
  const at = push(lf, user.name, action, note)
  recordAudit({ at, actor: user, entity: "lateFiling", entityId: lf.id, ref: lfRef(lf), action, note })
  return json(lfRow(lf))
})

/* ── Mushak 9.4 — amended return ──────────────────────────────────────────────────────────────────────────── */

const amRef = (a: ReturnAmendment) => `${a.no} · 9.4 · ${periodLabel(a.period)}`
const amRow = (a: ReturnAmendment) => amendmentRow(a, retOf(a.period)!, db.returnAmendments, db.vatSettings, TODAY)
const findAm = async (p: Ctx["params"]) => { const { id } = await p; return db.returnAmendments.find((x) => x.id === id || x.no === id) }

type AmData = ReturnType<typeof amendmentInput.parse>
/** Period, deadline and correction checks; returns the corrections with their "as filed" values. */
function amCheck(d: AmData, self?: ReturnAmendment): { errors?: Record<string, string[]>; corrections?: ReturnAmendment["corrections"]; revision?: number } {
  const errors: Record<string, string[]> = {}
  const ret = retOf(d.period)
  if (!ret || ret.status !== "submitted" || !ret.snapshot) return { errors: { period: ["notSubmitted"] } }
  if (TODAY > addMonths(ret.submissionDate!, AMEND_YEARS * 12)) return { errors: { period: ["tooLate"] } }
  if (db.returnAmendments.some((x) => x.id !== self?.id && x.period === d.period && x.status !== "rejected" && x.status !== "amended")) return { errors: { period: ["duplicate"] } }
  const base = latestComputation(ret, db.returnAmendments)!
  const seen = new Set<string>()
  const corrections = d.corrections.map((c, i) => {
    const k = `corrections.${i}`
    if (!fieldsOf(c.note).includes(c.field)) errors[`${k}.note`] = ["notAmendable"]
    else if (seen.has(`${c.note}|${c.field}`)) errors[`${k}.note`] = ["duplicate"]
    seen.add(`${c.note}|${c.field}`)
    const from = noteValue(base.computation, c.note, c.field)
    if (!errors[`${k}.note`] && Math.abs(round2(c.to) - from) < 0.005) errors[`${k}.to`] = ["unchanged"]
    return { note: c.note, field: c.field, from, to: round2(c.to), explanation: c.explanation }
  })
  if (Object.keys(errors).length) return { errors }
  return { corrections, revision: self?.revision ?? base.revision }
}

/** GET /vat/return-amendments — ?status=, ?format=csv (one row per correction). */
export const amendGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const status = sp.get("status")
  const rows = db.returnAmendments.filter((a) => retOf(a.period)).map(amRow).filter((r) => !status || r.state === status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  if (sp.get("format") === "csv") {
    const flat = rows.flatMap((r) => r.corrections.map((c) => ({ ...c, no: r.no, period: periodLabel(r.period), state: r.state, reasonKind: r.reasonKind, deltaVat: r.effect.deltaVat, deltaSd: r.effect.deltaSd, toPay: r.effect.toPay, filedOn: r.filedOn ?? "", filedRef: r.filedRef ?? "" })))
    return csvResponse(toCSV(flat, [
      { key: "no", label: "Application" }, { key: "period", label: "Tax period" }, { key: "state", label: "Status" }, { key: "reasonKind", label: "Reason" },
      { key: "note", label: "9.1 note" }, { key: "field", label: "Column" }, { key: "from", label: "As filed" }, { key: "to", label: "Corrected" }, { key: "explanation", label: "Explanation" },
      { key: "deltaVat", label: "Net VAT change" }, { key: "deltaSd", label: "Net SD change" }, { key: "toPay", label: "To pay (incl. interest)" }, { key: "filedOn", label: "Filed on" }, { key: "filedRef", label: "Reference" },
    ]), `mushak-9.4-${TODAY}.csv`)
  }
  await delay(60)
  return json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, toFile: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, amended: rows.filter((r) => r.state === "amended").length, paid: round2(rows.reduce((a, r) => a + (r.amended?.payment?.amount ?? 0), 0)) } })
})

export const amendPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = amendmentInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const c = amCheck(d)
  if (c.errors) return invalid(c.errors)
  const at = new Date().toISOString()
  db.seq.amendment++
  const a: ReturnAmendment = {
    id: `am${db.seq.amendment}-${Date.now().toString(36)}`, no: `AM-${mmyy()}${String(db.seq.amendment).padStart(4, "0")}`, period: d.period, reasonKind: d.reasonKind,
    description: d.description, corrections: c.corrections!, noAudit: d.noAudit, revision: c.revision!, status: "draft", createdBy: user.name, createdAt: at,
    history: [{ at, by: user.name, action: "created" }],
  }
  db.returnAmendments.push(a)
  recordAudit({ at, actor: user, entity: "returnAmendment", entityId: a.id, ref: amRef(a), action: "created", note: `${a.corrections.length} correction(s)` })
  return json(amRow(a), { status: 201 })
})

export const amendOne = withAuth<Ctx>(null, async (_req, { params }) => {
  const a = await findAm(params)
  return a && retOf(a.period) ? json(amRow(a)) : problem(404, "Application not found")
})

export const amendPut = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const a = await findAm(params)
  if (!a) return problem(404, "Application not found")
  if (a.status !== "draft") return problem(409, `Only a draft application can be changed — ${a.no} is ${a.status}.`)
  const parsed = amendmentInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const c = amCheck(parsed.data, a.period === parsed.data.period ? a : undefined)
  if (c.errors) return invalid(c.errors)
  const before = structuredClone(a)
  Object.assign(a, { period: parsed.data.period, reasonKind: parsed.data.reasonKind, description: parsed.data.description, noAudit: parsed.data.noAudit, corrections: c.corrections!, revision: c.revision! })
  const at = push(a, user.name, "edited")
  recordAudit({ at, actor: user, entity: "returnAmendment", entityId: a.id, ref: amRef(a), action: "edited", changes: diff(before, a, ["period", "reasonKind", "description"]) })
  return json(amRow(a))
})

export const amendDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const a = await findAm(params)
  if (!a) return problem(404, "Application not found")
  if (a.status !== "draft") return problem(409, `Only a draft application can be deleted — ${a.no} is ${a.status}.`)
  db.returnAmendments.splice(db.returnAmendments.indexOf(a), 1)
  recordAudit({ actor: user, entity: "returnAmendment", entityId: a.id, ref: amRef(a), action: "deleted" })
  return json({ ok: true, id: a.id })
})

/**
 * POST /vat/return-amendments/:id/action — {action, date, ref?, reason?, adjustPeriod?, challanNo?, challanDate?, amount?}
 *  file (draft → filed): no earlier than the return's submission, within 4 years of it;
 *  approve (filed / deemed → approved): a decrease needs the tax period of the decreasing adjustment (later than the
 *    amended period, not yet submitted; default the current period);
 *  reject (filed → rejected, reason; not once a decrease is deemed approved);
 *  amend (approved / deemed → amended): files the amended return — an increase needs the treasury deposit of the
 *    difference + interest to the deposit date; a decrease posts the decreasing adjustment(s) in the allowed period.
 */
export const amendAction = withAuth<Ctx>("doc.create", async (req, { params }, user) => {
  const a = await findAm(params)
  const ret = a && retOf(a.period)
  if (!a || !ret) return problem(404, "Application not found")
  const parsed = amendActionInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (d.action !== "file") { const no = deny(user, "doc.approve"); if (no) return no }
  const row = amRow(a)
  const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"], amend: ["approved", "deemed"] }[d.action]
  if (!from.includes(row.state)) return problem(409, row.state === "deemed" && d.action === "reject" ? `${a.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 30 days.` : `Cannot ${d.action} a ${row.state} application (${a.no}).`)
  const errors: Record<string, string[]> = {}
  if (d.date > TODAY) errors.date = ["afterToday"]
  const dec = row.effect.direction === "decrease"
  const adjustOk = (p: string) => p > a.period && p <= CURRENT && retOf(p)?.status !== "submitted"
  let note = ""
  if (d.action === "file") {
    if (!errors.date && d.date < row.original.submissionDate) errors.date = ["beforeReturn"]
    else if (!errors.date && d.date > row.applyBy) errors.date = ["tooLate"]
    if (!Object.keys(errors).length) { a.status = "filed"; a.filedOn = d.date; a.filedRef = d.ref || undefined; note = `Filed${d.ref ? ` — ${d.ref}` : ""}` }
  } else if (d.action === "approve") {
    if (!errors.date && a.filedOn && d.date < a.filedOn) errors.date = ["beforePrevious"]
    const adj = d.adjustPeriod ?? CURRENT
    if (dec && !adjustOk(adj)) errors.adjustPeriod = ["adjustPeriod"]
    if (!Object.keys(errors).length) {
      a.status = "approved"; a.decidedOn = d.date; a.commissionerRef = d.ref || undefined; a.adjustPeriod = dec ? adj : undefined
      note = `Permitted${d.ref ? ` — ${d.ref}` : ""}${dec ? ` · decreasing adjustment in ${periodLabel(adj)}` : ""}`
    }
  } else if (d.action === "reject") {
    if (!errors.date && a.filedOn && d.date < a.filedOn) errors.date = ["beforePrevious"]
    if (!d.reason) errors.reason = ["required"]
    if (!Object.keys(errors).length) { a.status = "rejected"; a.decidedOn = d.date; a.commissionerRef = d.ref || undefined; a.rejectReason = d.reason; note = `Refused — ${d.reason}` }
  } else {
    // amended return
    const prev = a.decidedOn ?? row.deemedOn ?? a.filedOn
    if (!errors.date && prev && d.date < prev) errors.date = ["beforePrevious"]
    const base = latestComputation(ret, db.returnAmendments, a.revision)!.computation
    const corrected = applyCorrections(base, a.corrections)
    let payment: NonNullable<ReturnAmendment["amended"]>["payment"]
    let effect = row.effect
    const adj = a.adjustPeriod ?? d.adjustPeriod ?? CURRENT
    if (row.effect.direction === "increase") {
      const paidOn = d.challanDate ?? d.date
      effect = amendEffect(base, corrected, { period: a.period, settings: db.vatSettings, submittedOn: ret.submissionDate!, paidOn })
      if (!d.challanNo) errors.challanNo = ["required"]
      if (paidOn > TODAY) errors.challanDate = ["afterToday"]
      else if (prev && paidOn < prev) errors.challanDate = ["beforePrevious"]
      if (!d.amount) errors.amount = ["required"]
      else if (d.amount < effect.toPay - 0.005) errors.amount = ["belowDue"]
      payment = { challanNo: d.challanNo, date: paidOn, amount: round2(d.amount ?? 0) }
    } else if (dec && !adjustOk(adj)) errors.adjustPeriod = ["adjustPeriod"]
    if (!Object.keys(errors).length) {
      const at = new Date().toISOString()
      const up = effect.direction === "increase"
      const computation = applyCorrections(base, a.corrections, up ? { interestVat: effect.interestVat, interestSd: effect.interestSd, paidVat: round2(Math.max(0, effect.deltaVat) + effect.interestVat), paidSd: round2(Math.max(0, effect.deltaSd) + effect.interestSd) } : undefined)
      const adjustmentIds: string[] = []
      if (effect.direction === "decrease") {
        for (const [kind, amount] of [["otherDecrease", effect.decreaseVat], ["sdDecrease", effect.decreaseSd]] as const) {
          if (amount <= 0.004) continue
          db.seq.adjustment++
          const no = nextNo("VA", "adjustment", db.adjustments, d.date)
          const va: VatAdjustment = {
            id: `va${db.seq.adjustment}`, no, kind, note: kind === "otherDecrease" ? 32 : 39, issueDate: d.date, taxPeriod: adj, amount: round2(amount),
            description: `Amended return ${periodLabel(a.period)} (Mushak 9.4 ${a.no}) — net ${kind === "otherDecrease" ? "VAT" : "SD"} over-declared`, reference: a.commissionerRef ?? a.no,
            process: "Approved", issuedBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created", note: `From ${a.no}` }, { at, by: user.name, action: "approved", note: `Allowed by the Commissioner (s.66)` }],
          }
          db.adjustments.push(va)
          adjustmentIds.push(va.id)
          recordAudit({ at, actor: user, entity: "adjustment", entityId: va.id, ref: no, action: "approved", note: `${a.no} · ${periodLabel(adj)} · ৳ ${va.amount.toFixed(2)}` })
        }
        a.adjustPeriod = adj
      }
      const ackNo = d.ref || `NBR-91A-${a.period.replace("-", "")}-${String(4_000_000 + db.returnAmendments.length * 1_337 + a.revision).padStart(7, "0")}`
      a.status = "amended"
      a.amended = { date: d.date, ackNo, ...(payment ? { payment } : {}), ...(adjustmentIds.length ? { adjustmentIds } : {}), effect, computation }
      note = `Amended return filed — ${ackNo}${payment ? ` · ৳ ${payment.amount.toFixed(2)} deposited (challan ${payment.challanNo})` : ""}${adjustmentIds.length ? ` · decreasing adjustment in ${periodLabel(adj)}` : ""}`
    }
  }
  if (Object.keys(errors).length) return invalid(errors)
  const action: HistoryEntry["action"] = d.action === "file" ? "submitted" : d.action === "approve" ? "approved" : d.action === "reject" ? "cancelled" : "edited"
  const at = push(a, user.name, action, note)
  recordAudit({ at, actor: user, entity: "returnAmendment", entityId: a.id, ref: amRef(a), action, note })
  return json(amRow(a))
})
