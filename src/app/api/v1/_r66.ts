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
import type { z } from "zod"
import type { AuditAction, AuditChange, AuditEntity, HistoryEntry, LateFiling, PrcBatch, Realisation, ReturnAmendment, Sale, VatAdjustment, VatReturn, VatSettings } from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import { round2 } from "@/lib/vat"
import { deny, json, problem, ruleResponse, withAuth, zodProblem, type RuleProblem } from "./_lib"
import { FIRST_RETURN } from "@/lib/mock/seed-r4"
import { nextNo } from "./_r4"

type Ctx = { params: Promise<{ id: string }> }
const push = (doc: { history?: HistoryEntry[]; updatedAt?: string }, by: string, action: HistoryEntry["action"], note?: string) => {
  const at = new Date().toISOString()
  doc.history = [...(doc.history ?? []), { at, by, action, note }]
  doc.updatedAt = at
  return at
}
const mmyy = () => `${TODAY.slice(5, 7)}${TODAY.slice(2, 4)}`
const CURRENT = periodOf(TODAY)

/* ── export proceeds (PRC file) ───────────────────────────────────────────────────────────────────────────── */

/**
 * What the proceeds rules read and write: the invoices (their proceeds entries and history) and the batches
 * themselves. The mock's own arrays are the default; the API hands the rules the rows instead.
 */
export interface PrcSource { sales: Sale[]; prcBatches: PrcBatch[] }
const prcSrc = (): PrcSource => ({ sales: db.sales, prcBatches: db.prcBatches })
/** What a posted batch changed, for the caller to record: the audit trail entries the mock's route wrote itself. */
export type PrcAudit = { entity: AuditEntity; entityId: string; ref: string; action: AuditAction; note: string }
/** The next batch's id and number — the counter runs across months and is never reused. */
export const newPrcBatchTag = (stamp: string) => { const n = ++db.seq.prcBatch; return { id: `pb${n}-${stamp}`, no: `PB-${mmyy()}${String(n).padStart(4, "0")}` } }

/** POST /vat/proceeds/batches — the confirmed allocations become proceeds entries on the invoices and a batch row. */
export function prcBatchCreate(d: z.infer<typeof prcPostInput>, user: User, src: PrcSource, at: string, stamp: string): { batch: PrcBatch; touched: Sale[]; at: string; audit: PrcAudit[] } | RuleProblem {
  const bad = postCheck(d.rows, src.sales, TODAY)
  if (bad) return { status: 422, title: "Validation failed", errors: bad }
  const { id, no } = newPrcBatchTag(stamp)
  const open = new Map(openExports(src.sales, TODAY).map((o) => [o.saleId, o]))
  const lines: PrcBatch["lines"] = []
  const audit: PrcAudit[] = []
  const touched = new Map<string, Sale>()
  d.rows.filter((r) => r.allocations.length).forEach((r) => {
    const prc = r.prcNo.trim().toUpperCase(), currency = r.currency.toUpperCase()
    const allocations = r.allocations.map((a, j) => {
      const sale = src.sales.find((s) => s.id === a.saleId)!
      const fc = round2(a.fcAmount)
      const rz: Realisation = { id: `prc-${sale.id}-${id}-${r.line}-${j}`, date: r.date, bank: r.bank || "—", prcNo: prc, fcAmount: fc, rate: r.rate, bdt: round2(fc * r.rate), note: `Bank file ${d.fileName} · line ${r.line}`, by: user.name, at, batchId: id }
      ;(sale.export!.realisations ??= []).push(rz)
      ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds realised: ${currency} ${fc} (PRC ${prc}, batch ${no})` })
      touched.set(sale.id, sale)
      audit.push({ entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "realised", note: `${currency} ${fc} @ ${r.rate} · PRC ${prc} · ${no}` })
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
  src.prcBatches.push(batch)
  audit.push({ entity: "prcBatch", entityId: id, ref: `${no} · ${d.fileName}`, action: "imported", note: `${lines.length} PRC(s) → ${batch.invoices} invoice(s) · ৳ ${batch.bdt.toFixed(2)}` })
  return { batch, touched: [...touched.values()], at, audit }
}

/** POST /vat/proceeds/batches/:id/reverse — remove every proceeds entry the batch posted. */
export function prcBatchReverse(b: PrcBatch, d: z.infer<typeof prcReverseInput>, user: User, src: PrcSource, at: string): { batch: PrcBatch; touched: Sale[]; removed: number; at: string; audit: PrcAudit[] } | RuleProblem {
  if (d.date > TODAY) return { status: 422, title: "Validation failed", errors: { date: ["afterToday"] } }
  if (d.date < b.createdAt.slice(0, 10) && d.date < (b.lines[0]?.date ?? d.date)) return { status: 422, title: "Validation failed", errors: { date: ["beforePosted"] } }
  let removed = 0
  const touched = new Map<string, Sale>()
  const audit: PrcAudit[] = []
  for (const l of b.lines) for (const a of l.allocations) {
    const sale = src.sales.find((s) => s.id === a.saleId)
    const list = sale?.export?.realisations
    const i = list?.findIndex((r) => r.id === a.realisationId) ?? -1
    if (!sale || !list || i < 0) continue
    list.splice(i, 1)
    removed++
    ;(sale.history ??= []).push({ at, by: user.name, action: "edited", note: `Proceeds entry removed: PRC ${l.prcNo} (batch ${b.no} reversed)` })
    touched.set(sale.id, sale)
    audit.push({ entity: "sale", entityId: sale.id, ref: sale.invoiceNo, action: "deleted", note: `Realisation PRC ${l.prcNo} (${l.currency} ${a.fcAmount}) removed — ${b.no} reversed` })
  }
  b.status = "reversed"; b.reversedOn = d.date; b.reverseReason = d.reason
  push(b, user.name, "cancelled", `Reversed — ${d.reason}`)
  audit.push({ entity: "prcBatch", entityId: b.id, ref: `${b.no} · ${b.fileName}`, action: "cancelled", note: `${removed} realisation(s) removed — ${d.reason}` })
  return { batch: b, touched: [...touched.values()], removed, at, audit }
}

/** The open list's CSV columns (the register prints the same lot). */
export const proceedsOpenCsvColumns = [
  { key: "invoiceNo", label: "Invoice" }, { key: "date", label: "Invoice date" }, { key: "customer", label: "Buyer / exporter" }, { key: "lcNo", label: "LC / BB-LC" },
  { key: "expNo", label: "EXP No" }, { key: "currency", label: "Currency" }, { key: "fcValue", label: "FC value" }, { key: "outstandingFc", label: "Outstanding (FC)" },
  { key: "due", label: "Realise by" }, { key: "daysLeft", label: "Days left" }, { key: "state", label: "State" },
]

/** GET /vat/proceeds — open exports with ageing, realised this FY, batches (?format=csv: the open list). */
export const proceedsGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const o = proceedsOverview(db.sales, db.prcBatches, TODAY)
  if (sp.get("format") === "csv") return csvResponse(toCSV(o.open, proceedsOpenCsvColumns), `export-proceeds-open-${TODAY}.csv`)
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
  const w = prcBatchCreate(parsed.data, user, prcSrc(), new Date().toISOString(), Date.now().toString(36))
  if ("status" in w) return ruleResponse(w)
  for (const a of w.audit) recordAudit({ at: w.at, actor: user, ...a })
  return json(w.batch, { status: 201 })
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
  const w = prcBatchReverse(b, parsed.data, user, prcSrc(), new Date().toISOString())
  if ("status" in w) return ruleResponse(w)
  for (const a of w.audit) recordAudit({ at: w.at, actor: user, ...a })
  return json(w.batch)
})

/* ── Mushak 9.3 — late filing ─────────────────────────────────────────────────────────────────────────────── */

/* ── Mushak 9.3 / 9.4 — shared rules ──────────────────────────────────────────────────────────────────────── */

/**
 * What the 9.3 rules read: the returns (their due dates and submissions), the applications themselves and the
 * settings that carry the holidays. The mock's own arrays are the default; the API hands the rules the rows instead.
 */
export interface LateSource { returns: VatReturn[]; lateFilings: LateFiling[]; vatSettings: VatSettings }
/** The same for 9.4, plus the adjustments a decrease posts and the returns it re-files. */
export interface AmendSource { returns: VatReturn[]; returnAmendments: ReturnAmendment[]; adjustments: VatAdjustment[]; vatSettings: VatSettings }
const lateSrc = (): LateSource => ({ returns: db.returns, lateFilings: db.lateFilings, vatSettings: db.vatSettings })
const amendSrc = (): AmendSource => ({ returns: db.returns, returnAmendments: db.returnAmendments, adjustments: db.adjustments, vatSettings: db.vatSettings })
const srcRet = (src: LateSource | AmendSource, period: string) => src.returns.find((r) => r.period === period)

/** The audit trail keeps the application's number and period as its reference. */
export const lfRef = (lf: LateFiling) => `${lf.no} · 9.3 · ${periodLabel(lf.period)}`
export const amRef = (a: ReturnAmendment) => `${a.no} · 9.4 · ${periodLabel(a.period)}`

/** What a write hands back: the application as it stands, what the register shows, and what the audit trail says. */
export type LfWrite = RuleProblem | {
  lf: LateFiling; row: ReturnType<typeof lateFilingRow>; at: string
  action: "created" | "edited" | "submitted" | "approved" | "cancelled"; ref: string; changes?: AuditChange[]; note?: string
}
export type AmWrite = RuleProblem | {
  a: ReturnAmendment; row: ReturnType<typeof amendmentRow>; at: string
  action: "created" | "edited" | "submitted" | "approved" | "cancelled"; ref: string; changes?: AuditChange[]; note?: string
  /** the decreasing adjustments an amend step posts (s.55 read with s.66) — the caller stores and audits them */
  adjustments?: VatAdjustment[]
}
export type LfData = ReturnType<typeof lateFilingInput.parse>
export type LateActionData = ReturnType<typeof lateActionInput.parse>
export type AmData = ReturnType<typeof amendmentInput.parse>
export type AmendActionData = ReturnType<typeof amendActionInput.parse>

/** Next LF-MMYY#### / AM-MMYY#### and the id that goes with it (MMYY of today; the counter runs across months and
 *  is never reused, and a deleted draft retires its id rather than freeing it). */
export const newLateFilingTag = (stamp: string) => { const n = ++db.seq.lateFiling; return { id: `lf${n}-${stamp}`, no: `LF-${mmyy()}${String(n).padStart(4, "0")}` } }
export const newAmendmentTag = (stamp: string) => { const n = ++db.seq.amendment; return { id: `am${n}-${stamp}`, no: `AM-${mmyy()}${String(n).padStart(4, "0")}` } }

/** Period / requested-date checks shared by create and edit. */
export function lfCheck(d: LfData, src: LateSource, selfId?: string): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {}
  if (d.period < FIRST_RETURN || d.period > CURRENT) errors.period = ["outOfRange"]
  else if (srcRet(src, d.period)?.status === "submitted") errors.period = ["alreadySubmitted"]
  else if (src.lateFilings.some((x) => x.id !== selfId && x.period === d.period && x.status !== "rejected")) errors.period = ["duplicate"]
  if (!errors.period) {
    const lim = lateLimits(d.period, src.vatSettings)
    if (d.requestedDate <= lim.due) errors.requestedDate = ["notAfterDue"]
    else if (d.requestedDate > lim.maxDate) errors.requestedDate = ["beyondMonth"]
  }
  return Object.keys(errors).length ? errors : null
}

/**
 * Creating one: the period and the requested date have to pass, then the draft opens. Pushed into `src`, which is
 * the mock's array or, in the API, the rows that carry the collection.
 */
export function lfCreate(d: LfData, user: User, today: string, src: LateSource = lateSrc(), stamp = Date.now().toString(36)): LfWrite {
  const bad = lfCheck(d, src)
  if (bad) return { status: 422, title: "Validation failed", errors: bad }
  const at = new Date().toISOString()
  const { id, no } = newLateFilingTag(stamp)
  const lf: LateFiling = {
    id, no, period: d.period, reasonKind: d.reasonKind, reason: d.reason, requestedDate: d.requestedDate, status: "draft",
    createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  src.lateFilings.push(lf)
  return { lf, row: lateFilingRow(lf, srcRet(src, lf.period), src.vatSettings, today), at, action: "created", ref: lfRef(lf) }
}

/** Editing one — the same checks against the world as it stands now. The caller has already refused a filed one. */
export function lfUpdate(lf: LateFiling, d: LfData, user: User, today: string, src: LateSource = lateSrc()): LfWrite {
  const bad = lfCheck(d, src, lf.id)
  if (bad) return { status: 422, title: "Validation failed", errors: bad }
  const before = structuredClone(lf)
  Object.assign(lf, d)
  const at = push(lf, user.name, "edited")
  return { lf, row: lateFilingRow(lf, srcRet(src, lf.period), src.vatSettings, today), at, action: "edited", ref: lfRef(lf),
    changes: diff(before, lf, ["period", "reasonKind", "reason", "requestedDate"]) }
}

/** Deleting a draft: it leaves the collection, its id retiring with it. The caller has already refused a filed one. */
export function lfRemove(lf: LateFiling, src: LateSource = lateSrc()) {
  const i = src.lateFilings.indexOf(lf)
  if (i >= 0) src.lateFilings.splice(i, 1)
}

/**
 * Acting on one —
 *  file (draft → filed): on or before 7 days after the period ends, return not submitted;
 *  approve (filed / deemed → approved): granted date after the due date, at most the date asked for;
 *  reject (filed → rejected, reason; not once deemed approved).
 * The caller has already checked the permission and the from-state.
 */
export function lfAction(lf: LateFiling, d: LateActionData, user: User, today: string, src: LateSource = lateSrc()): LfWrite {
  const row = lateFilingRow(lf, srcRet(src, lf.period), src.vatSettings, today)
  const errors: Record<string, string[]> = {}
  if (d.date > today) errors.date = ["afterToday"]
  let note = ""
  if (d.action === "file") {
    if (!errors.date && d.date > row.applyBy) errors.date = ["afterApplyBy"]
    if (srcRet(src, lf.period)?.status === "submitted") errors.period = ["alreadySubmitted"]
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
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const action = d.action === "file" ? "submitted" : d.action === "approve" ? "approved" : "cancelled" as const
  const at = push(lf, user.name, action, note)
  return { lf, row: lateFilingRow(lf, srcRet(src, lf.period), src.vatSettings, today), at, action, ref: lfRef(lf), note }
}

/** Period, deadline and correction checks; returns the corrections with their "as filed" values. */
export function amCheck(d: AmData, src: AmendSource, self?: ReturnAmendment): { errors?: Record<string, string[]>; corrections?: ReturnAmendment["corrections"]; revision?: number } {
  const errors: Record<string, string[]> = {}
  const ret = srcRet(src, d.period)
  if (!ret || ret.status !== "submitted" || !ret.snapshot) return { errors: { period: ["notSubmitted"] } }
  if (TODAY > addMonths(ret.submissionDate!, AMEND_YEARS * 12)) return { errors: { period: ["tooLate"] } }
  if (src.returnAmendments.some((x) => x.id !== self?.id && x.period === d.period && x.status !== "rejected" && x.status !== "amended")) return { errors: { period: ["duplicate"] } }
  const base = latestComputation(ret, src.returnAmendments)!
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

/** Creating one: the period and every correction have to pass, then the draft opens with its "as filed" values.
 *  Pushed into `src`, which is the mock's array or, in the API, the rows that carry the collection. */
export function amCreate(d: AmData, user: User, today: string, src: AmendSource = amendSrc(), stamp = Date.now().toString(36)): AmWrite {
  const c = amCheck(d, src)
  if (c.errors) return { status: 422, title: "Validation failed", errors: c.errors }
  const at = new Date().toISOString()
  const { id, no } = newAmendmentTag(stamp)
  const a: ReturnAmendment = {
    id, no, period: d.period, reasonKind: d.reasonKind, description: d.description, corrections: c.corrections!, noAudit: d.noAudit,
    revision: c.revision!, status: "draft", createdBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created" }],
  }
  src.returnAmendments.push(a)
  return { a, row: amendmentRow(a, srcRet(src, a.period)!, src.returnAmendments, src.vatSettings, today), at, action: "created", ref: amRef(a), note: `${a.corrections.length} correction(s)` }
}

/** Editing one — the same checks against the world as it stands now, against its own revision when the period
 *  stays. The caller has already refused a filed one. */
export function amUpdate(a: ReturnAmendment, d: AmData, user: User, today: string, src: AmendSource = amendSrc()): AmWrite {
  const c = amCheck(d, src, a.period === d.period ? a : undefined)
  if (c.errors) return { status: 422, title: "Validation failed", errors: c.errors }
  const before = structuredClone(a)
  Object.assign(a, { period: d.period, reasonKind: d.reasonKind, description: d.description, noAudit: d.noAudit, corrections: c.corrections!, revision: c.revision! })
  const at = push(a, user.name, "edited")
  return { a, row: amendmentRow(a, srcRet(src, a.period)!, src.returnAmendments, src.vatSettings, today), at, action: "edited", ref: amRef(a),
    changes: diff(before, a, ["period", "reasonKind", "description"]) }
}

/** Deleting a draft: it leaves the collection, its id retiring with it. The caller has already refused a filed one. */
export function amRemove(a: ReturnAmendment, src: AmendSource = amendSrc()) {
  const i = src.returnAmendments.indexOf(a)
  if (i >= 0) src.returnAmendments.splice(i, 1)
}

/**
 * Acting on one —
 *  file (draft → filed): no earlier than the return's submission, within 4 years of it;
 *  approve (filed / deemed → approved): a decrease needs the tax period of the decreasing adjustment;
 *  reject (filed → rejected, reason; not once a decrease is deemed approved);
 *  amend (approved / deemed → amended): files the amended return — an increase needs the treasury deposit of the
 *    difference + interest; a decrease posts the decreasing adjustment(s) in the allowed period, returned in the
 *    write for the caller to store (they land in `src.adjustments` here, which is the mock's array).
 * The caller has already checked the permission and the from-state.
 */
export function amAction(a: ReturnAmendment, d: AmendActionData, user: User, today: string, src: AmendSource = amendSrc()): AmWrite {
  const ret = srcRet(src, a.period)!
  const row = amendmentRow(a, ret, src.returnAmendments, src.vatSettings, today)
  const errors: Record<string, string[]> = {}
  if (d.date > today) errors.date = ["afterToday"]
  const dec = row.effect.direction === "decrease"
  const adjustOk = (p: string) => p > a.period && p <= CURRENT && srcRet(src, p)?.status !== "submitted"
  let note = ""
  let payment: NonNullable<ReturnAmendment["amended"]>["payment"]
  let effect = row.effect
  const adjustments: VatAdjustment[] = []
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
    const base = latestComputation(ret, src.returnAmendments, a.revision)!.computation
    const corrected = applyCorrections(base, a.corrections)
    const adj = a.adjustPeriod ?? d.adjustPeriod ?? CURRENT
    if (row.effect.direction === "increase") {
      const paidOn = d.challanDate ?? d.date
      effect = amendEffect(base, corrected, { period: a.period, settings: src.vatSettings, submittedOn: ret.submissionDate!, paidOn })
      if (!d.challanNo) errors.challanNo = ["required"]
      if (paidOn > today) errors.challanDate = ["afterToday"]
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
          const no = nextNo("VA", "adjustment", src.adjustments, d.date)
          const va: VatAdjustment = {
            id: `va${db.seq.adjustment}`, no, kind, note: kind === "otherDecrease" ? 32 : 39, issueDate: d.date, taxPeriod: adj, amount: round2(amount),
            description: `Amended return ${periodLabel(a.period)} (Mushak 9.4 ${a.no}) — net ${kind === "otherDecrease" ? "VAT" : "SD"} over-declared`, reference: a.commissionerRef ?? a.no,
            process: "Approved", issuedBy: user.name, createdAt: at, history: [{ at, by: user.name, action: "created", note: `From ${a.no}` }, { at, by: user.name, action: "approved", note: `Allowed by the Commissioner (s.66)` }],
          }
          src.adjustments.push(va)
          adjustmentIds.push(va.id)
        }
        a.adjustPeriod = adj
      }
      const ackNo = d.ref || `NBR-91A-${a.period.replace("-", "")}-${String(4_000_000 + src.returnAmendments.length * 1_337 + a.revision).padStart(7, "0")}`
      a.status = "amended"
      a.amended = { date: d.date, ackNo, ...(payment ? { payment } : {}), ...(adjustmentIds.length ? { adjustmentIds } : {}), effect, computation }
      note = `Amended return filed — ${ackNo}${payment ? ` · ৳ ${payment.amount.toFixed(2)} deposited (challan ${payment.challanNo})` : ""}${adjustmentIds.length ? ` · decreasing adjustment in ${periodLabel(adj)}` : ""}`
      adjustments.push(...src.adjustments.filter((x) => adjustmentIds.includes(x.id)))
    }
  }
  if (Object.keys(errors).length) return { status: 422, title: "Validation failed", errors }
  const action = d.action === "file" ? "submitted" : d.action === "approve" ? "approved" : d.action === "reject" ? "cancelled" : "edited" as const
  const at = push(a, user.name, action, note)
  return { a, row: amendmentRow(a, ret, src.returnAmendments, src.vatSettings, today), at, action, ref: amRef(a), note, ...(adjustments.length ? { adjustments } : {}) }
}

/** The 9.3 register's CSV columns and rows — shared with the PostgreSQL build's controller. */
export const lfCsvColumns = [
  { key: "no", label: "Application" }, { key: "period", label: "Tax period", get: (r: { period: string }) => periodLabel(r.period) }, { key: "due", label: "Due date" },
  { key: "requestedDate", label: "Requested to" }, { key: "state", label: "Status" }, { key: "filedOn", label: "Filed on" }, { key: "filedRef", label: "Reference" },
  { key: "decidedOn", label: "Decided on" }, { key: "effectiveDate", label: "Return allowed to" }, { key: "reasonKind", label: "Reason" }, { key: "reason", label: "Details" },
]
export const lfCsvRows = (rows: ReturnType<typeof lateFilingRow>[]) => rows

/** The 9.4 register's CSV: one row per correction, the application's own fields repeated beside each. */
export const amCsvColumns = [
  { key: "no", label: "Application" }, { key: "period", label: "Tax period" }, { key: "state", label: "Status" }, { key: "reasonKind", label: "Reason" },
  { key: "note", label: "9.1 note" }, { key: "field", label: "Column" }, { key: "from", label: "As filed" }, { key: "to", label: "Corrected" }, { key: "explanation", label: "Explanation" },
  { key: "deltaVat", label: "Net VAT change" }, { key: "deltaSd", label: "Net SD change" }, { key: "toPay", label: "To pay (incl. interest)" }, { key: "filedOn", label: "Filed on" }, { key: "filedRef", label: "Reference" },
]
export const amCsvRows = (rows: ReturnType<typeof amendmentRow>[]) => rows.flatMap((r) => r.corrections.map((c) => ({ ...c, no: r.no, period: periodLabel(r.period), state: r.state, reasonKind: r.reasonKind, deltaVat: r.effect.deltaVat, deltaSd: r.effect.deltaSd, toPay: r.effect.toPay, filedOn: r.filedOn ?? "", filedRef: r.filedRef ?? "" })))

/* ── Mushak 9.3 / 9.4 — the mock's routes ────────────────────────────────────────────────────────────────── */

const findLf = async (p: Ctx["params"]) => { const { id } = await p; return db.lateFilings.find((x) => x.id === id || x.no === id) }
const findAm = async (p: Ctx["params"]) => { const { id } = await p; return db.returnAmendments.find((x) => x.id === id || x.no === id) }
/** file is the applicant's own step; the Commissioner's three need the approval permission. */
const amDecides = (d: { action: string }) => d.action !== "file"

/** GET /vat/late-filings — ?status= (draft|filed|approved|deemed|rejected), ?format=csv. */
export const lateGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const status = sp.get("status")
  const rows = db.lateFilings.map((lf) => lateFilingRow(lf, db.returns.find((r) => r.period === lf.period), db.vatSettings, TODAY))
    .filter((r) => !status || r.state === status).sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.no < b.no ? 1 : -1))
  if (sp.get("format") === "csv") return csvResponse(toCSV(lfCsvRows(rows), lfCsvColumns), `mushak-9.3-${TODAY}.csv`)
  await delay(60)
  return json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, allowed: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, rejected: rows.filter((r) => r.state === "rejected").length } })
})

/** POST /vat/late-filings — new draft application. */
export const latePost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = lateFilingInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = lfCreate(parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "lateFiling", entityId: w.lf.id, ref: w.ref, action: "created" })
  return json(w.row, { status: 201 })
})

/** GET /vat/late-filings/:id — one application. */
export const lateOne = withAuth<Ctx>(null, async (_req, { params }) => {
  const lf = await findLf(params)
  return lf ? json(lateFilingRow(lf, db.returns.find((r) => r.period === lf.period), db.vatSettings, TODAY)) : problem(404, "Application not found")
})

/** PUT /vat/late-filings/:id — edit a draft (the 409 comes before the body is parsed, as the contract pins). */
export const latePut = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  if (lf.status !== "draft") return problem(409, `Only a draft application can be changed — ${lf.no} is ${lf.status}.`)
  const parsed = lateFilingInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = lfUpdate(lf, parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "lateFiling", entityId: w.lf.id, ref: w.ref, action: "edited", changes: w.changes })
  return json(w.row)
})

/** DELETE /vat/late-filings/:id — remove a draft. */
export const lateDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  if (lf.status !== "draft") return problem(409, `Only a draft application can be deleted — ${lf.no} is ${lf.status}.`)
  lfRemove(lf)
  recordAudit({ actor: user, entity: "lateFiling", entityId: lf.id, ref: lfRef(lf), action: "deleted" })
  return json({ ok: true, id: lf.id })
})

/**
 * POST /vat/late-filings/:id/action — {action, date, ref?, grantedDate?, reason?}; the from-state is refused
 * before the rules run (a deemed approval cannot be rejected, with its own message).
 */
export const lateAction = withAuth<Ctx>("doc.create", async (req, { params }, user) => {
  const lf = await findLf(params)
  if (!lf) return problem(404, "Application not found")
  const parsed = lateActionInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (amDecides(d)) { const no = deny(user, "doc.approve"); if (no) return no }
  const row = lateFilingRow(lf, db.returns.find((r) => r.period === lf.period), db.vatSettings, TODAY)
  const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"] }[d.action]
  if (!from.includes(row.state)) return problem(409, row.state === "deemed" && d.action === "reject" ? `${lf.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 7 days.` : `Cannot ${d.action} a ${row.state} application (${lf.no}).`)
  const w = lfAction(lf, d, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "lateFiling", entityId: w.lf.id, ref: w.ref, action: w.action, note: w.note })
  return json(w.row)
})

/** GET /vat/return-amendments — ?status=, ?format=csv (one row per correction). */
export const amendGet = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const status = sp.get("status")
  const rows = db.returnAmendments.filter((a) => db.returns.some((r) => r.period === a.period))
    .map((a) => amendmentRow(a, db.returns.find((r) => r.period === a.period)!, db.returnAmendments, db.vatSettings, TODAY))
    .filter((r) => !status || r.state === status)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  if (sp.get("format") === "csv") return csvResponse(toCSV(amCsvRows(rows), amCsvColumns), `mushak-9.4-${TODAY}.csv`)
  await delay(60)
  return json({ rows, totals: { pending: rows.filter((r) => r.state === "filed").length, toFile: rows.filter((r) => r.state === "approved" || r.state === "deemed").length, amended: rows.filter((r) => r.state === "amended").length, paid: round2(rows.reduce((a, r) => a + (r.amended?.payment?.amount ?? 0), 0)) } })
})

/** POST /vat/return-amendments — new draft application with its corrections. */
export const amendPost = withAuth("doc.create", async (req, _ctx, user) => {
  const parsed = amendmentInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = amCreate(parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "returnAmendment", entityId: w.a.id, ref: w.ref, action: "created", note: w.note })
  return json(w.row, { status: 201 })
})

/** GET /vat/return-amendments/:id — one application. */
export const amendOne = withAuth<Ctx>(null, async (_req, { params }) => {
  const a = await findAm(params)
  return a && db.returns.some((r) => r.period === a.period) ? json(amendmentRow(a, db.returns.find((r) => r.period === a.period)!, db.returnAmendments, db.vatSettings, TODAY)) : problem(404, "Application not found")
})

/** PUT /vat/return-amendments/:id — edit a draft (the 409 comes before the body is parsed, as the contract pins). */
export const amendPut = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const a = await findAm(params)
  if (!a) return problem(404, "Application not found")
  if (a.status !== "draft") return problem(409, `Only a draft application can be changed — ${a.no} is ${a.status}.`)
  const parsed = amendmentInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const w = amUpdate(a, parsed.data, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  recordAudit({ at: w.at, actor: user, entity: "returnAmendment", entityId: w.a.id, ref: w.ref, action: "edited", changes: w.changes })
  return json(w.row)
})

/** DELETE /vat/return-amendments/:id — remove a draft. */
export const amendDelete = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
  const a = await findAm(params)
  if (!a) return problem(404, "Application not found")
  if (a.status !== "draft") return problem(409, `Only a draft application can be deleted — ${a.no} is ${a.status}.`)
  amRemove(a)
  recordAudit({ actor: user, entity: "returnAmendment", entityId: a.id, ref: amRef(a), action: "deleted" })
  return json({ ok: true, id: a.id })
})

/**
 * POST /vat/return-amendments/:id/action — {action, date, ref?, reason?, adjustPeriod?, challanNo?, challanDate?,
 *  amount?}; the from-state is refused before the rules run (a deemed approval cannot be rejected, with its own
 *  message). An amend step that decreases the tax posts the decreasing adjustments — they are audited here and
 *  stored by the PostgreSQL build beside the application row itself.
 */
export const amendAction = withAuth<Ctx>("doc.create", async (req, { params }, user) => {
  const a = await findAm(params)
  const ret = a && db.returns.find((r) => r.period === a.period)
  if (!a || !ret) return problem(404, "Application not found")
  const parsed = amendActionInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  if (amDecides(d)) { const no = deny(user, "doc.approve"); if (no) return no }
  const row = amendmentRow(a, ret, db.returnAmendments, db.vatSettings, TODAY)
  const from = { file: ["draft"], approve: ["filed", "deemed"], reject: ["filed"], amend: ["approved", "deemed"] }[d.action]
  if (!from.includes(row.state)) return problem(409, row.state === "deemed" && d.action === "reject" ? `${a.no} was deemed approved on ${row.deemedOn} — the Commissioner did not decide within 30 days.` : `Cannot ${d.action} a ${row.state} application (${a.no}).`)
  const w = amAction(a, d, user, TODAY)
  if ("status" in w) return ruleResponse(w)
  for (const va of w.adjustments ?? []) recordAudit({ at: w.at, actor: user, entity: "adjustment", entityId: va.id, ref: va.no, action: "approved", note: `${a.no} · ${periodLabel(va.taxPeriod)} · ৳ ${va.amount.toFixed(2)}` })
  recordAudit({ at: w.at, actor: user, entity: "returnAmendment", entityId: w.a.id, ref: w.ref, action: w.action, note: w.note })
  return json(w.row)
})
