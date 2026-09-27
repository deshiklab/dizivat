import { addHistory, db, postStock, stockShortfall } from "@/lib/mock/db"
import { diff } from "@/lib/mock/audit"
import { buildPurchaseFields, buildSaleFields, unknownItems } from "@/lib/mock/build"
import { delay } from "@/lib/mock/query"
import { cancelInput, purchaseInput, saleInput } from "@/lib/schemas"
import type { Purchase, Sale } from "@/lib/types"
import { deny, json, problem, withAuth, zodProblem } from "./_lib"

type Kind = "sale" | "purchase"
type Doc = Sale | Purchase
type Ctx = { params: Promise<{ id: string }> }

const label = (k: Kind) => (k === "sale" ? "Sales invoice" : "Purchase")
const list = (k: Kind): Doc[] => (k === "sale" ? db.sales : db.purchases)
const find = (k: Kind, id: string) => list(k).find((x) => x.id === id || x.invoiceNo === id)

/**
 * Stock rules:
 *  sale approve → stock out (must be available) · sale cancel (approved) → stock back
 *  purchase approve → stock in · purchase cancel (approved) → stock out (must not already be consumed)
 */
function approve(k: Kind, d: Doc, by: string) {
  if (k === "sale") {
    const short = stockShortfall(d.lines)
    if (short) return problem(409, `Insufficient stock — ${short.detail}`, short.errors)
  }
  d.process = "Approved"
  postStock(k, d.lines, 1)
  addHistory(d, by, "approved")
  return null
}

const DOC_FIELDS = ["customerName", "vendorName", "issueDate", "issueTime", "challanNo", "challanDate", "method", "deliveryAddress", "vehicle", "mode", "narration", "subtotal", "sd", "vat", "discount", "netTotal", "paid"]
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
      const parsed = saleInput.safeParse(body)
      if (!parsed.success) return zodProblem(parsed.error)
      if (parsed.data.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
      const cust = db.customers.find((c) => c.id === parsed.data.customerId && c.active !== false)
      if (!cust) return problem(422, "Validation failed", { customerId: ["unknown"] })
      const bad = unknownItems(parsed.data.lines, "Finished Goods")
      if (bad) return problem(422, "Validation failed", bad)
      const fields = buildSaleFields(parsed.data, cust)
      if (parsed.data.process === "Approved") {
        const short = stockShortfall(fields.lines)
        if (short) return problem(422, `Insufficient stock — ${short.detail}`, short.errors)
      }
      const before = structuredClone(d)
      Object.assign(d, fields)
      addHistory(d, user.name, "edited", undefined, docDiff(before, d))
      if (parsed.data.process === "Approved") approve(k, d, user.name)
    } else {
      const parsed = purchaseInput.safeParse(body)
      if (!parsed.success) return zodProblem(parsed.error)
      if (parsed.data.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
      const v = db.vendors.find((x) => x.id === parsed.data.vendorId && x.active !== false)
      if (!v) return problem(422, "Validation failed", { vendorId: ["unknown"] })
      const bad = unknownItems(parsed.data.lines, "buyable")
      if (bad) return problem(422, "Validation failed", bad)
      const before = structuredClone(d)
      Object.assign(d, buildPurchaseFields(parsed.data, v))
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
      if (d.process !== "Created") return problem(409, `Cannot approve — ${d.invoiceNo} is ${d.process}.`)
      const err = approve(k, d, user.name)
      if (err) return err
      return json(d)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      if (d.process === "Cancelled") return problem(409, `${d.invoiceNo} is already cancelled.`)
      const r = cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!r.success) return zodProblem(r.error)
      if (d.process === "Approved") {
        if (k === "purchase") {
          const short = stockShortfall(d.lines)
          if (short) return problem(409, `Stock from this purchase has already been used — ${short.detail}`)
        }
        postStock(k, d.lines, -1)
      }
      d.process = "Cancelled"
      d.cancelReason = r.data.reason
      addHistory(d, user.name, "cancelled", r.data.reason)
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
    if (arr[i].process !== "Created") return problem(409, `Only drafts can be deleted — cancel ${arr[i].invoiceNo} instead.`)
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
      if (d && d.process === "Created" && !approve(k, d, user.name)) done.push(id)
      else skipped.push(id)
    }
    return json({ done, skipped })
  })
}
