import { addHistory, db, nextDocId, nextNo, postStock, stockShortfall } from "@/lib/mock/db"
import { diff } from "@/lib/mock/audit"
import { buildPurchaseFields, unknownBranch, unknownItems, unknownServices } from "@/lib/mock/build"
import { delay } from "@/lib/mock/query"
import { cancelInput, importInput, purchaseInput } from "@/lib/schemas"
import type { Line, Party, Purchase, Sale } from "@/lib/types"
import { deny, invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { lotShortfall, parseSale } from "./_r3"
import { lockedConflictProblem, lockedFieldRule, settlementsOf } from "./_r4"
import { lockingReturn } from "@/lib/mock/vat-return"
import type { z } from "zod"

type Kind = "sale" | "purchase"

/**
 * Validates a purchase body for any variant (R2). The vendor decides the schema: Foreign → import (Bill of Entry,
 * USD lines, duty rates); `category: "service"` → service-code lines.
 *
 * R5.3: returns the rejection as data (`RuleProblem`) instead of a Response, so the API's native purchase module
 * raises the same 422 from the same rules — the mock's side turns it back into a Response with `ruleResponse`.
 */
export function parsePurchase(body: unknown, self?: Purchase): RuleProblem | { data: z.output<typeof purchaseInput> | z.output<typeof importInput>; vendor: Party } {
  const vid = (body as { vendorId?: unknown } | null)?.vendorId
  const vendor = db.vendors.find((x) => x.id === vid && x.active !== false)
  const isImport = vendor?.mode === "Foreign" && (body as { category?: string }).category !== "service"
  const parsed = isImport ? importInput.safeParse(body) : purchaseInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d = parsed.data
  if (!vendor) return invalidRule({ vendorId: ["unknown"] })
  if (d.category === "service" && vendor.mode === "Foreign") return invalidRule({ vendorId: ["foreignService"] })
  const bad = (d.category === "service" ? unknownServices(d.lines) : unknownItems(d.lines, "buyable")) ?? unknownBranch(d.branchId)
  if (bad) return invalidRule(bad)
  if (isImport && (d as z.output<typeof importInput>).boe.lcDate > d.challanDate) return invalidRule({ "boe.lcDate": ["lcAfterBoe"] })
  // R6.5: bonded imports may name our own UD / UP — on file and not settled yet (unless already on it)
  const boe = isImport ? (d as z.output<typeof importInput>).boe : undefined
  const ud = boe?.bonded ? boe.udNo?.trim().toUpperCase() : ""
  if (ud) {
    const u = db.bondUds.find((x) => x.no.toUpperCase() === ud)
    if (!u) return invalidRule({ "boe.udNo": ["unknownUd"] })
    if (u.settlement && self?.boe?.udNo?.toUpperCase() !== ud) return invalidRule({ "boe.udNo": ["settledUd"] })
  }
  const lock = lockedFieldRule(d.issueDate, "issueDate"); if (lock) return invalidRule(lock)
  return { data: d, vendor }
}
type Doc = Sale | Purchase
type Ctx = { params: Promise<{ id: string }> }

export const docLabel = (k: Kind) => (k === "sale" ? "Sales invoice" : "Purchase")
const label = docLabel
const list = (k: Kind): Doc[] => (k === "sale" ? db.sales : db.purchases)
const find = (k: Kind, id: string) => list(k).find((x) => x.id === id || x.invoiceNo === id)

/** Documents moved to the trash by a delete: they are gone from the list but still occupy their id and number. */
const trashed = (kind: Kind) => db.trash.filter((t) => t.kind === kind).map((t) => t.doc) as Doc[]

/* ── Lifecycle rules (R5.3: these return data, so the API's native sales and purchases raise the same rejections) ── */

/**
 * A new sale's identity: the next id in the `s` series (trashed drafts included, so a deleted number is never
 * reused), the invoice number for its series and month, and the next challan number — which only an approved sale
 * carries. Both runtimes call this so a native create and a mock create agree.
 */
export function saleIdentity(category: string, issueDate: string) {
  const id = nextDocId("s", [...db.sales, ...trashed("sale")])
  return {
    id,
    invoiceNo: nextNo(category === "service" ? "SS" : "S", issueDate),
    challanNo: String(Math.max(0, ...db.sales.filter((s) => s.challanNo).map((s) => Number(s.challanNo))) + 1),
  }
}

/** A new purchase's identity: its id and bill number. Service purchases count in their own `PS` series. */
export function purchaseIdentity(category: string, issueDate: string) {
  return { id: nextDocId("p", [...db.purchases, ...trashed("purchase")]), invoiceNo: nextNo(category === "service" ? "PS" : "P", issueDate) }
}

/**
 * The stock and lot check behind saving or approving a sale. `status` mirrors what the mock returned: 422 when the
 * shortfall is found while saving an approve-on-edit, 409 when approving an existing draft.
 */
export function saleStockRule(lines: Line[], branchId: string, selfId: string, status: 409 | 422 = 409): RuleProblem | undefined {
  const short = stockShortfall(lines, branchId) ?? lotShortfall(lines, selfId)
  return short ? { status, title: `Insufficient stock — ${short.detail}`, errors: short.errors } : undefined
}

/** Only a draft may be edited; everything else has to be cancelled and re-issued. */
export function editDraftRule(d: Doc): RuleProblem | undefined {
  return d.process !== "Created" ? { status: 409, title: `Only drafts can be edited — ${d.invoiceNo} is ${d.process}.` } : undefined
}

/** A goods purchase cannot become a service purchase (or the other way round) once issued. */
export function purchaseCategoryRule(self: Purchase, category: string): RuleProblem | undefined {
  return (category === "service") !== (self.category === "service")
    ? { status: 409, title: "A goods purchase cannot become a service purchase (or vice versa)." } : undefined
}

/**
 * Approving posts the stock movement, so a sale must be coverable first (branch stock, and the finished-goods lot it
 * draws on). Purchases only ever add stock.
 */
export function approveRule(k: Kind, d: Doc): RuleProblem | undefined {
  if (d.process !== "Created") return { status: 409, title: `Cannot approve — ${d.invoiceNo} is ${d.process}.` }
  const lock = lockedConflictProblem(d.issueDate, d.invoiceNo); if (lock) return lock
  return k === "sale" ? saleStockRule(d.lines, d.branchId, d.id) : undefined
}

/**
 * Cancelling an approved document gives the stock back (or takes it away again for a purchase), so it is refused
 * while the period is locked, while a note or a settlement depends on it, or while a purchase's stock is already
 * consumed. The reason is mandatory and validated the same way the mock validated it.
 */
export function cancelRule(k: Kind, d: Doc, reason: string): RuleProblem | undefined {
  if (d.process === "Cancelled") return { status: 409, title: `${d.invoiceNo} is already cancelled.` }
  const r = cancelInput.safeParse({ reason })
  if (!r.success) return invalidRule(zodErrors(r.error))
  const dns = k === "purchase"
    ? db.debitNotes.filter((n) => n.purchaseId === d.id && n.process !== "Cancelled")
    : db.creditNotes.filter((n) => n.saleId === d.id && n.process !== "Cancelled")
  if (dns.length) return { status: 409, title: `${d.invoiceNo} has ${k === "purchase" ? "debit" : "credit"} notes (${dns.map((n) => n.no).join(", ")}) — cancel them first.` }
  if (d.process === "Approved") {
    const lock = lockedConflictProblem(d.issueDate, d.invoiceNo); if (lock) return lock
    const st = settlementsOf(k, d.id)
    if (st.length) return { status: 409, title: `${d.invoiceNo} has ${k === "sale" ? "receipts" : "payments"} / VDS against it (${st.join(", ")}) — cancel them first.` }
    if (k === "purchase") {
      const short = stockShortfall(d.lines, d.branchId)
      if (short) return { status: 409, title: `Stock from this purchase has already been used — ${short.detail}` }
    }
  }
  return undefined
}

/** Only a draft can be deleted; an approved one has to be cancelled so the audit trail survives. */
export function deleteRule(d: Doc): RuleProblem | undefined {
  return d.process !== "Created" ? { status: 409, title: `Only drafts can be deleted — cancel ${d.invoiceNo} instead.` } : undefined
}

/**
 * Stock rules:
 *  sale approve → stock out (must be available) · sale cancel (approved) → stock back
 *  purchase approve → stock in · purchase cancel (approved) → stock out (must not already be consumed)
 */
function approve(k: Kind, d: Doc, by: string) {
  const err = approveRule(k, d)
  if (err) return ruleResponse(err)
  d.process = "Approved"
  postStock(k, d.lines, 1)
  addHistory(d, by, "approved")
  return null
}

const DOC_FIELDS = ["branchName", "customerName", "vendorName", "issueDate", "issueTime", "challanNo", "challanDate", "method", "deliveryAddress", "vehicle", "mode", "narration", "subtotal", "sd", "vat", "discount", "netTotal", "paid"]
/** Header-field diff plus a one-line summary of line changes (count / qty / price). */
function docDiff(a: Doc, b: Doc) {
  const out = diff(a, b, DOC_FIELDS)
  const sig = (d: Doc) => d.lines.map((l) => `${l.name} × ${l.qty} @ ${l.price}`).join("; ")
  if (sig(a) !== sig(b)) out.push({ field: "lines", from: sig(a), to: sig(b) })
  return out
}

export function docRoutes(k: Kind) {
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(120)
    const d = find(k, id)
    return d ? json(d) : problem(404, `${label(k)} not found`)
  })

  /** Edit a draft (full replacement). Optional approve-on-save. */
  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const d = find(k, id)
    if (!d) return problem(404, `${label(k)} not found`)
    if (d.process !== "Created") return problem(409, `Only drafts can be edited — ${d.invoiceNo} is ${d.process}.`)
    const body = await req.json().catch(() => ({}))
    if (k === "sale") {
      const parsed = parseSale(body, d as Sale)
      if ("status" in parsed) return ruleResponse(parsed)
      const fields = parsed.fields
      if (parsed.data.process === "Approved") {
        const no = deny(user, "doc.approve"); if (no) return no
        const short = saleStockRule(fields.lines, fields.branchId, d.id, 422); if (short) return ruleResponse(short)
      }
      const before = structuredClone(d)
      if (!("export" in fields)) delete (d as Sale).export
      Object.assign(d, fields)
      addHistory(d, user.name, "edited", undefined, docDiff(before, d))
      if (parsed.data.process === "Approved") approve(k, d, user.name)
    } else {
      const r = parsePurchase(body, d as Purchase)
      if ("status" in r) return ruleResponse(r)
      if (r.data.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
      const cat = purchaseCategoryRule(d as Purchase, r.data.category); if (cat) return ruleResponse(cat)
      const parsed = r, v = r.vendor
      const before = structuredClone(d)
      const fields = buildPurchaseFields(parsed.data, v)
      if (!("boe" in fields)) delete (d as Purchase).boe
      Object.assign(d, fields)
      addHistory(d, user.name, "edited", undefined, docDiff(before, d))
      if (parsed.data.process === "Approved") approve(k, d, user.name)
    }
    return json(d)
  })

  /** State transitions: approve, or cancel with a mandatory reason. */
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const d = find(k, id)
    if (!d) return problem(404, `${label(k)} not found`)
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      const err = approve(k, d, user.name)
      if (err) return err
      return json(d)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      const rule = cancelRule(k, d, body.reason ?? "")
      if (rule) return ruleResponse(rule)
      if (d.process === "Approved") postStock(k, d.lines, -1)
      const reason = cancelInput.parse({ reason: body.reason ?? "" }).reason
      d.process = "Cancelled"
      d.cancelReason = reason
      addHistory(d, user.name, "cancelled", reason)
      return json(d)
    }
    return problem(400, "process must be Approved or Cancelled")
  })

  /** Delete a draft (moves it to trash so it can be restored — undo). */
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const arr = list(k)
    const i = arr.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, `${label(k)} not found`)
    const gone = deleteRule(arr[i]); if (gone) return ruleResponse(gone)
    const [d] = arr.splice(i, 1)
    addHistory(d, user.name, "deleted")
    db.trash.push(k === "sale" ? { kind: "sale", doc: d as Sale, at: new Date().toISOString() } : { kind: "purchase", doc: d as Purchase, at: new Date().toISOString() })
    return json({ ok: true })
  })

  return { GET, PUT, PATCH, DELETE }
}

export function restoreRoute(k: Kind) {
  return withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.trash.findIndex((t) => t.kind === k && t.doc.id === id)
    if (i < 0) return problem(404, `${label(k)} not found in trash`)
    const [t] = db.trash.splice(i, 1)
    const d = t.doc as Doc
    addHistory(d, user.name, "restored")
    if (k === "sale") db.sales.push(d as Sale)
    else db.purchases.push(d as Purchase)
    return json(d)
  })
}

/** Bulk approve — skips rows that are not drafts or (sales) lack stock, and reports them. */
export function bulkRoute(k: Kind) {
  return withAuth("doc.approve", async (req, _ctx, user) => {
    const { ids, action } = (await req.json().catch(() => ({}))) as { ids?: string[]; action?: string }
    if (!ids?.length || action !== "approve") return problem(400, "ids[] and action=approve required")
    const done: string[] = [], skipped: string[] = []
    for (const id of ids) {
      const d = list(k).find((x) => x.id === id)
      if (d && d.process === "Created" && !lockingReturn(db, d.issueDate) && !approve(k, d, user.name)) done.push(id)
      else skipped.push(id)
    }
    return json({ done, skipped })
  })
}
