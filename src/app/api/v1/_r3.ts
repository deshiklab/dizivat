import type { z } from "zod"
import { branchLabels, db, mainBranchId, branchName, stockShortfall } from "@/lib/mock/db"
import { auditStore, diff, recordAudit } from "@/lib/mock/audit"
import { buildSaleFields, unknownBranch, unknownItems, unknownSaleServices } from "@/lib/mock/build"
import { consumptionFor, mergeConsumption } from "@/lib/mock/seed-r3"
import { csvResponse, delay, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { batchInput, batchReceiveInput, bomInput, cancelInput, creditNoteInput, productionConfigInput, saleInput, workOrderInput } from "@/lib/schemas"
import type { AuditChange, Batch, BatchLine, Bom, BomRow, BomStatus, Consumption, CreditLine, CreditNote, HistoryEntry, Item, Lot, Party, ProductionConfig, Sale, WorkOrder } from "@/lib/types"
import { calcBom, calcCreditLine, round2, round4 } from "@/lib/vat"
import { deny, invalidRule, json, problem, ruleResponse, withAuth, zodErrors, zodProblem, type RuleProblem } from "./_lib"
import { noteDiff, noteDraftRule, stampBomHistory } from "./_docs"
import { lockedConflictProblem, lockedFieldRule } from "./_r4"

type Ctx = { params: Promise<{ id: string }> }
type Entity = "creditNote" | "bom" | "workOrder" | "batch"
type Doc = CreditNote | Bom | WorkOrder | Batch
const invalid = (errors: Record<string, string[]>) => problem(422, "Validation failed", errors)
const has = (e: Record<string, string[]>) => Object.keys(e).length > 0

/** Next CN-/PB-/PW-MMYY#### — numbers of deleted drafts live on in the audit trail and are skipped. */
function nextNo(prefix: "CN" | "PB" | "PW", entity: Entity, list: { no: string }[], date: string) {
  const key = `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`
  const used = [...list.map((d) => d.no), ...auditStore.events.filter((e) => e.entity === entity).map((e) => e.ref)]
  const n = used.reduce((m, no) => (no.startsWith(key) ? Math.max(m, Number(no.slice(key.length)) || 0) : m), 0) + 1
  return `${key}${String(n).padStart(4, "0")}`
}

function addHistory(entity: Entity, d: Doc, by: string, action: HistoryEntry["action"], note?: string, changes?: AuditChange[]) {
  const at = new Date().toISOString()
  d.history = [...(d.history ?? []), { at, by, action, note }]
  d.updatedAt = at
  recordAudit({ at, actor: by, entity, entityId: d.id, ref: d.no, action, note, changes })
}

/* ── Sales: validation shared by create and edit (goods, service, export, deemed export, lots) ───────── */

export type SaleData = z.output<typeof saleInput>

/**
 * Validates a sales-invoice body for every R3 variant. Foreign customers need export documents (zero-rated);
 * deemed exports (back-to-back LC) go to local customers; service sales use the sale-service list and move no stock.
 */
/** What a sale's lines become once priced: the fields buildSaleFields produces. */
export type SaleFields = ReturnType<typeof buildSaleFields>

/**
 * Validates a sale body (goods, export / deemed export, or service) and prices it. R5.3: returns the rejection as
 * data (`RuleProblem`) instead of a Response, so the API's native sale module raises the same 422/409 from the same
 * rules — the mock's side turns it back into a Response with `ruleResponse`.
 */
export function parseSale(body: unknown, self?: Sale): RuleProblem | { data: SaleData; cust: Party; fields: SaleFields } {
  const parsed = saleInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d = parsed.data
  const cust = db.customers.find((c) => c.id === d.customerId && c.active !== false)
  if (!cust) return invalidRule({ customerId: ["unknown"] })
  const service = d.category === "service"
  if (self && service !== (self.category === "service")) return { status: 409, title: "A goods sale cannot become a service sale (or vice versa)." }
  const bad = (service ? unknownSaleServices(d.lines) : unknownItems(d.lines, "Finished Goods")) ?? unknownBranch(d.branchId)
  if (bad) return invalidRule(bad)
  if (service) {
    if (cust.mode === "Foreign") return invalidRule({ customerId: ["foreignService"] })
    d.export = undefined
  } else {
    if (cust.mode === "Foreign" && !d.export) return invalidRule({ export: ["exportRequired"] })
    if (d.export) {
      if (d.export.deemed && cust.mode === "Foreign") return invalidRule({ "export.deemed": ["deemedLocalOnly"] })
      if (!d.export.deemed && cust.mode !== "Foreign") return invalidRule({ "export.deemed": ["exportForeignOnly"] })
      if (d.export.lcDate > d.issueDate) return invalidRule({ "export.lcDate": ["lcAfterInvoice"] })
      if (!d.export.deemed && d.export.billDate && d.export.billDate < d.issueDate) return invalidRule({ "export.billDate": ["beforeInvoice"] })
      // R6.5: our own UD / UP — must be on file and not settled yet (unless this invoice was already on it)
      const own = d.export.ownUdNo?.trim().toUpperCase()
      if (own) {
        const u = db.bondUds.find((x) => x.no.toUpperCase() === own)
        if (!u) return invalidRule({ "export.ownUdNo": ["unknownUd"] })
        if (u.settlement && self?.export?.ownUdNo?.toUpperCase() !== own) return invalidRule({ "export.ownUdNo": ["settledUd"] })
      }
    }
    const errors: Record<string, string[]> = {}
    d.lines.forEach((l, i) => {
      if (!l.batchId) return
      const b = db.batches.find((x) => x.id === l.batchId && x.process === "Approved")
      if (!b || !b.lines.some((bl) => bl.itemId === l.itemId && bl.receiveQty > 0)) errors[`lines.${i}.batchId`] = ["unknownBatch"]
    })
    if (has(errors)) return invalidRule(errors)
  }
  const lock = lockedFieldRule(d.issueDate, "issueDate"); if (lock) return invalidRule(lock)
  return { data: d, cust, fields: buildSaleFields(d, cust) }
}

/** Finished-goods lots: received quantity per batch line minus approved sales that drew on it. */
export function lots(itemId?: string, excludeSaleId?: string): Lot[] {
  const m = new Map<string, Lot>()
  for (const b of db.batches) {
    if (b.process !== "Approved") continue
    for (const l of b.lines) {
      if (!l.receiveQty || (itemId && l.itemId !== itemId)) continue
      const k = `${b.id}|${l.itemId}`
      const x = m.get(k)
      if (x) x.received = round2(x.received + l.receiveQty)
      else m.set(k, { batchId: b.id, batchNo: b.no, date: b.receiveDate ?? b.issueDate, itemId: l.itemId, received: l.receiveQty, sold: 0, available: 0 })
    }
  }
  for (const s of db.sales) {
    if (s.process !== "Approved" || s.id === excludeSaleId) continue
    for (const l of s.lines) {
      const x = l.batchId ? m.get(`${l.batchId}|${l.itemId}`) : undefined
      if (x) x.sold = round2(x.sold + l.qty)
    }
  }
  return [...m.values()].map((x) => ({ ...x, available: round2(Math.max(0, x.received - x.sold)) })).sort((a, b) => a.date.localeCompare(b.date))
}

/** Lines drawing more from a lot than is left in it → per-line errors (checked when the sale is approved). */
export function lotShortfall(lines: { itemId: string; qty: number; batchId?: string }[], selfId?: string) {
  const want = new Map<string, number>()
  for (const l of lines) if (l.batchId) want.set(`${l.batchId}|${l.itemId}`, (want.get(`${l.batchId}|${l.itemId}`) ?? 0) + l.qty)
  if (!want.size) return null
  const avail = new Map(lots(undefined, selfId).map((x) => [`${x.batchId}|${x.itemId}`, x]))
  const errors: Record<string, string[]> = {}, details: string[] = []
  for (const [k, q] of want) {
    const lot = avail.get(k)
    if ((lot?.available ?? 0) + 1e-9 >= q) continue
    details.push(`${lot?.batchNo ?? k.split("|")[0]}: ${lot?.available ?? 0} left in the lot, ${q} requested`)
    lines.forEach((l, i) => { if (`${l.batchId}|${l.itemId}` === k) errors[`lines.${i}.qty`] = ["exceedsLot"] })
  }
  return details.length ? { detail: details.join("; "), errors } : null
}

/** Customer's open invoices: receivable, due older than 30 days, number of unpaid invoices. */
export function customerCredit(customerId: string, today: string) {
  const cutoff = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 864e5).toISOString().slice(0, 10)
  const open = db.sales.filter((s) => s.customerId === customerId && s.process === "Approved" && s.due > 0)
  return {
    due: round2(open.reduce((a, s) => a + s.due, 0)),
    overdue: round2(open.filter((s) => s.issueDate < cutoff).reduce((a, s) => a + s.due, 0)),
    dueInvoices: open.length,
  }
}

/* ── Credit notes (Mushak 6.7) ─────────────────────────────────────────── */

/** Quantity per line item still returnable on a sale (other non-cancelled credit notes deducted). */
export function creditable(s: Sale, excludeId?: string) {
  const returned = new Map<string, number>()
  for (const n of db.creditNotes) {
    if (n.saleId !== s.id || n.process === "Cancelled" || n.id === excludeId) continue
    for (const l of n.lines) returned.set(l.itemId, round2((returned.get(l.itemId) ?? 0) + l.qty))
  }
  const seen = new Set<string>()
  return s.lines.filter((l) => !seen.has(l.itemId) && seen.add(l.itemId)).map((l) => {
    const soldQty = round2(s.lines.filter((x) => x.itemId === l.itemId).reduce((a, x) => a + x.qty, 0))
    const returnedQty = returned.get(l.itemId) ?? 0
    return { itemId: l.itemId, name: l.name, hsCode: l.hsCode, uom: l.uom, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate, soldQty, returnedQty, remaining: round2(soldQty - returnedQty) }
  })
}

/** What `buildCredit` returns: every field of the note but the identity and the lifecycle the caller adds. */
export type CreditFields = Omit<CreditNote, "id" | "no" | "process" | "createdAt" | "history">

export function buildCredit(body: unknown, excludeId?: string): RuleProblem | { process: "Created" | "Approved"; fields: CreditFields } {
  const parsed = creditNoteInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d = parsed.data
  const s = db.sales.find((x) => x.id === d.saleId)
  if (!s) return invalidRule({ saleId: ["unknown"] })
  if (s.process !== "Approved") return invalidRule({ saleId: ["notApproved"] })
  if (d.issueDate < s.issueDate) return invalidRule({ issueDate: ["beforeSale"] })
  { const lock = lockedFieldRule(d.issueDate, "issueDate"); if (lock) return invalidRule(lock) }
  const avail = creditable(s, excludeId)
  const errors: Record<string, string[]> = {}
  const lines: CreditLine[] = []
  d.lines.forEach((l, i) => {
    if (!l.qty) return
    const r = avail.find((a) => a.itemId === l.itemId)
    if (!r) { errors[`lines.${i}.itemId`] = ["unknown"]; return }
    if (l.qty > r.remaining + 1e-9) { errors[`lines.${i}.qty`] = ["exceedsRemaining"]; return }
    const src = s.lines.find((x) => x.itemId === l.itemId)!
    const c = calcCreditLine(src, l.qty * (src.qty / r.soldQty))
    lines.push({ itemId: r.itemId, name: r.name, hsCode: r.hsCode, uom: r.uom, soldQty: r.soldQty, qty: l.qty, price: src.price, sdRate: src.sdRate, vatRate: src.vatRate, ...c })
  })
  if (has(errors)) return invalidRule(errors)
  if (!lines.length) return invalidRule({ lines: ["atLeastOneLine"] })
  const sum = (k: "subtotal" | "sd" | "vat" | "total") => round2(lines.reduce((a, l) => a + l[k], 0))
  return {
    process: d.process,
    fields: {
      saleId: s.id, saleNo: s.invoiceNo, saleDate: s.issueDate, saleMode: s.mode, challanNo: s.challanNo,
      customerId: s.customerId, customerName: s.customerName, customerBin: s.customerBin, customerAddress: s.customerAddress, branchId: s.branchId, branchName: s.branchName,
      issueDate: d.issueDate, issueTime: d.issueTime, reason: d.reason, note: d.note || undefined, issuedBy: d.issuedBy, designation: d.designation, lines,
      subtotal: sum("subtotal"), sd: sum("sd"), vat: sum("vat"), total: sum("total"),
    } satisfies CreditFields as CreditFields,
  }
}

/** Approved return: goods come back into the selling branch (sold quantity goes down). Service lines move no stock. */
export function postCredit(n: CreditNote, sign: 1 | -1) {
  for (const l of n.lines) { const it = db.items.find((i) => i.id === l.itemId); if (it) it.sold = round2(it.sold - sign * l.qty) }
}
function approveCredit(n: CreditNote, by: string) {
  n.process = "Approved"
  postCredit(n, 1)
  addHistory("creditNote", n, by, "approved")
}

/**
 * A new credit note's identity: the next id in the `cn` series (the counter lives in the state, because a deleted
 * note leaves no row behind) and the next CN-MMYY#### — which the audit trail takes part in, so a deleted draft's
 * number is not reused either. Claimed separately, so a create refused after this point consumes nothing.
 */
export function creditIdentity(issueDate: string) {
  return { id: `cn${db.seq.creditNote + 1}`, no: nextNo("CN", "creditNote", db.creditNotes, issueDate) }
}
export const claimCreditId = () => { db.seq.creditNote += 1 }

/** Approving needs a draft, a sales invoice that is still approved, and an open tax period. */
export function creditApproveRule(n: CreditNote): RuleProblem | undefined {
  if (n.process !== "Created") return { status: 409, title: `Cannot approve — ${n.no} is ${n.process}.` }
  const s = db.sales.find((x) => x.id === n.saleId)
  if (!s || s.process !== "Approved") return { status: 409, title: `Sales invoice ${n.saleNo} is no longer approved.` }
  return lockedConflictProblem(n.issueDate, n.no) ?? undefined
}

/**
 * Cancelling: a note is never cancelled twice, the reason is mandatory, an approved one needs an open period — and
 * the goods it brought back must still be on hand, because they leave the branch again.
 */
export function creditCancelRule(n: CreditNote, reason: string): RuleProblem | { reason: string } {
  if (n.process === "Cancelled") return { status: 409, title: `${n.no} is already cancelled.` }
  const parsed = cancelInput.safeParse({ reason })
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  if (n.process === "Approved") {
    const lock = lockedConflictProblem(n.issueDate, n.no); if (lock) return lock
    const short = stockShortfall(n.lines, n.branchId)
    if (short) return { status: 409, title: `The returned goods have already been used — ${short.detail}`, errors: short.errors }
  }
  return { reason: parsed.data.reason }
}

/** A credit note stays with the invoice it was raised against — moving it means raising a new one. */
export function creditMovedRule(n: CreditNote, saleId: string): RuleProblem | undefined {
  return saleId !== n.saleId
    ? { status: 409, title: "A credit note cannot move to another sales invoice — create a new one." } : undefined
}

/** Only a draft may be deleted; its number lives on in the audit trail. */
export function creditDeleteRule(n: CreditNote): RuleProblem | undefined {
  return n.process !== "Created"
    ? { status: 409, title: `Only drafts can be deleted — cancel ${n.no} instead.` } : undefined
}

export const creditSpec: QuerySpec<CreditNote> = {
  search: (n) => `${n.no} ${n.saleNo} ${n.challanNo} ${n.customerName} ${n.customerBin} ${n.lines.map((l) => l.name).join(" ")}`,
  dateField: "issueDate",
  facets: { process: (n) => n.process, reason: (n) => n.reason, customer: (n) => n.customerId, branch: (n) => n.branchId },
  totals: ["subtotal", "sd", "vat", "total"],
}

/** The register's `?sale=` filter: the notes of one invoice, taken out of the params before the query runs. */
export const creditSourceFilter = (params: URLSearchParams, src: CreditNote[]) => {
  const sale = params.get("sale")
  params.delete("sale")
  return sale ? src.filter((n) => n.saleId === sale) : src
}

export const creditCsvColumns: { key: string; label: string; get?: (n: CreditNote) => unknown }[] = [
  { key: "issueDate", label: "Date" }, { key: "no", label: "Credit Note No" }, { key: "saleNo", label: "Sales Invoice" }, { key: "challanNo", label: "Challan No" },
  { key: "customerName", label: "Customer" }, { key: "customerBin", label: "BIN" }, { key: "reason", label: "Reason" }, { key: "subtotal", label: "Value" },
  { key: "sd", label: "SD" }, { key: "vat", label: "VAT" }, { key: "total", label: "Total" }, { key: "process", label: "Process" },
]

export const creditFacetLabels = () => ({ customer: Object.fromEntries(db.customers.map((c) => [c.id, c.name])), branch: branchLabels() })

export function creditListRoutes() {
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(creditSourceFilter(sp, db.creditNotes), sp, creditSpec)
    if (sp.get("format") === "csv")
      return csvResponse(toCSV(r.all, creditCsvColumns), `credit-notes-${new Date().toISOString().slice(0, 10)}.csv`)
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json({ ...page, facetLabels: creditFacetLabels() })
  })
  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const r = buildCredit(await req.json().catch(() => ({})))
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const n: CreditNote = { ...r.fields!, ...creditIdentity(r.fields!.issueDate), process: "Created", createdAt: new Date().toISOString(), history: [] }
    claimCreditId()
    addHistory("creditNote", n, user.name, "created")
    if (r.process === "Approved") approveCredit(n, user.name)
    db.creditNotes.push(n)
    return json(n, { status: 201 })
  })
  return { GET, POST }
}

export function creditDocRoutes() {
  const find = (id: string) => db.creditNotes.find((n) => n.id === id || n.no === id)
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(100)
    const n = find(id)
    return n ? json(n) : problem(404, "Credit note not found")
  })
  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const n = find(id)
    if (!n) return problem(404, "Credit note not found")
    const draft = noteDraftRule(n); if (draft) return ruleResponse(draft)
    const r = buildCredit(await req.json().catch(() => ({})), n.id)
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const moved = creditMovedRule(n, r.fields.saleId); if (moved) return ruleResponse(moved)
    const before = structuredClone(n)
    Object.assign(n, r.fields)
    addHistory("creditNote", n, user.name, "edited", undefined, noteDiff(before, n))
    if (r.process === "Approved") approveCredit(n, user.name)
    return json(n)
  })
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const n = find(id)
    if (!n) return problem(404, "Credit note not found")
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      const rule = creditApproveRule(n); if (rule) return ruleResponse(rule)
      approveCredit(n, user.name)
      return json(n)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      const r = creditCancelRule(n, body.reason ?? "")
      if ("status" in r) return ruleResponse(r)
      if (n.process === "Approved") postCredit(n, -1) // the returned goods leave again
      n.process = "Cancelled"
      n.cancelReason = r.reason
      addHistory("creditNote", n, user.name, "cancelled", r.reason)
      return json(n)
    }
    return problem(400, "process must be Approved or Cancelled")
  })
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.creditNotes.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Credit note not found")
    const gone = creditDeleteRule(db.creditNotes[i]); if (gone) return ruleResponse(gone)
    const [n] = db.creditNotes.splice(i, 1)
    addHistory("creditNote", n, user.name, "deleted")
    return json({ ok: true })
  })
  return { GET, PUT, PATCH, DELETE }
}

export const creditableRoute = withAuth<Ctx>(null, async (req, { params }) => {
  const { id } = await params
  const s = db.sales.find((x) => x.id === id || x.invoiceNo === id)
  if (!s) return problem(404, "Sales invoice not found")
  return json({ sale: { id: s.id, invoiceNo: s.invoiceNo, process: s.process, issueDate: s.issueDate, customerName: s.customerName, category: s.category ?? "goods" }, lines: creditable(s, new URL(req.url).searchParams.get("exclude") ?? undefined) })
})

/* ── BOM / price declaration (Mushak 4.3) ──────────────────────────────── */

/** What a declaration is built from: the SKUs it declares and prices, and the versions already filed for the item. */
export interface BomSource { items: Item[]; boms: Bom[] }
/** What `buildBom` returns: every field of the declaration but the identity and the lifecycle the caller adds. */
export type BomFields = Omit<Bom, "id" | "process" | "createdAt" | "history">

export const bomStatus = (b: Bom): BomStatus => (b.process === "Cancelled" ? "cancelled" : b.process === "Created" ? "draft" : b.supersededAt ? "superseded" : "active")

/** A declaration as the register prints it: its lifecycle status and the item's current sale price. */
export const bomRow = (b: Bom, items: Item[] = db.items): BomRow =>
  ({ ...b, status: bomStatus(b), salePrice: items.find((i) => i.id === b.itemId)?.salePrice ?? 0 })

/** The declaration in force for an item on a date: highest approved version effective on or before it. */
export function activeBom(itemId: string, date: string, src: Bom[] = db.boms): Bom | undefined {
  return src.filter((b) => b.itemId === itemId && b.process === "Approved" && b.effectiveDate <= date).sort((a, b) => b.version - a.version)[0]
}

/** Every version of a declaration's item, newest first — what the declaration page lists beside it. */
export const bomVersions = (b: Bom, src: BomSource = db): BomRow[] =>
  src.boms.filter((x) => x.itemId === b.itemId).sort((x, y) => y.version - x.version).map((x) => bomRow(x, src.items))

/**
 * Validates a declaration body and prices it (R5.5: as data, so the API's native module answers with the same 422
 * body): an active finished good, inputs that are active, not finished goods and not repeated, cost heads not
 * repeated, and — from version 2 on — an amendment reason and an effective date after the version it replaces.
 * `calcBom` prices it: the material and the wastage of every input, the value added, the declared price and the
 * unit cost a production receipt is valued at.
 */
export function buildBom(body: unknown, self?: Bom, src: BomSource = db): RuleProblem | { process: "Created" | "Approved"; fields: BomFields } {
  const parsed = bomInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d = parsed.data
  const fg = src.items.find((i) => i.id === d.itemId && i.active && i.group === "Finished Goods")
  if (!fg) return invalidRule({ itemId: ["unknown"] })
  if (self && self.itemId !== fg.id) return { status: 409, title: "A declaration cannot move to another item — create a new one." }
  const errors: Record<string, string[]> = {}
  const seen = new Set<string>()
  const inputs = d.inputs.map((x, i) => {
    const it = src.items.find((y) => y.id === x.itemId && y.active && y.group !== "Finished Goods")
    if (!it) errors[`inputs.${i}.itemId`] = ["unknown"]
    else if (seen.has(it.id)) errors[`inputs.${i}.itemId`] = ["duplicate"]
    else seen.add(it.id)
    return { it, ...x }
  })
  const heads = new Set<string>()
  d.costs.forEach((c, i) => { if (heads.has(c.head)) errors[`costs.${i}.head`] = ["duplicate"]; heads.add(c.head) })
  const versions = src.boms.filter((b) => b.itemId === fg.id && b.id !== self?.id)
  const version = self?.version ?? versions.reduce((m, b) => Math.max(m, b.version), 0) + 1
  const prev = versions.filter((b) => b.process === "Approved").sort((a, b) => b.version - a.version)[0]
  if (version > 1 && d.amendmentReason.length < 10) errors.amendmentReason = ["amendmentReason"]
  if (prev && d.effectiveDate <= prev.effectiveDate) errors.effectiveDate = ["afterPrevious"]
  if (d.licenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.licenseDate)) errors.licenseDate = ["required"]
  if (has(errors)) return invalidRule(errors)
  const costs = d.costs.filter((c) => c.amount > 0)
  const c = calcBom(inputs, costs)
  if (c.price <= 0) return invalidRule({ costs: ["pricePositive"] })
  return {
    process: d.process,
    fields: {
      no: `BOM-${fg.sku}-v${version}`, itemId: fg.id, itemName: fg.name, sku: fg.sku, hsCode: fg.hsCode, uom: fg.unit, version,
      effectiveDate: d.effectiveDate, licenseDate: d.licenseDate || undefined, amendmentReason: d.amendmentReason || undefined, note: d.note || undefined,
      inputs: inputs.map((x, i) => ({ itemId: x.it!.id, name: x.it!.name, sku: x.it!.sku, uom: x.it!.unit, qty: round4(x.qty), wastagePct: x.wastagePct, price: x.price, ...c.lines[i] })),
      costs, materialValue: c.materialValue, wastageValue: c.wastageValue, valueAdded: c.valueAdded, price: c.price, unitCost: c.unitCost,
    } satisfies BomFields,
  }
}

/**
 * Approving a version supersedes the one in force (history keeps both). Returns the declarations it superseded, so
 * whoever stores them writes those rows too.
 */
export function approveBom(b: Bom, by: string, src: Bom[] = db.boms, at: string = new Date().toISOString()): Bom[] {
  const superseded = src.filter((o) => o.itemId === b.itemId && o.id !== b.id && o.process === "Approved" && !o.supersededAt)
  for (const o of superseded) o.supersededAt = at
  b.process = "Approved"
  stampBomHistory(b, by, "approved", undefined, at)
  return superseded
}

/** An item keeps one draft declaration at a time — the second one has to be an amendment of the first. */
export const bomDraftTakenRule = (itemId: string, src: Bom[] = db.boms): RuleProblem | undefined =>
  src.some((b) => b.itemId === itemId && b.process === "Created")
    ? { status: 409, title: "This item already has a draft declaration — edit or delete it first." } : undefined

/** Only a draft may be edited — checked before the body is parsed, exactly as the mock checked it. */
export const bomDraftRule = (b: Bom): RuleProblem | undefined =>
  b.process !== "Created" ? { status: 409, title: `Only drafts can be edited — ${b.no} is ${b.process}. Amend it to create a new version.` } : undefined

/** Only a draft may be approved; a superseded or cancelled one is amended into a new version instead. */
export const bomApproveRule = (b: Bom): RuleProblem | undefined =>
  b.process !== "Created" ? { status: 409, title: `Cannot approve — ${b.no} is ${b.process}.` } : undefined

/** Cancelling a draft: the reason is mandatory (the same `cancelInput` a cancelled batch answers with). */
export function bomCancelRule(b: Bom, reason: string): RuleProblem | { reason: string } {
  if (b.process !== "Created") return { status: 409, title: `Only draft declarations can be cancelled — amend ${b.no} instead.` }
  const parsed = cancelInput.safeParse({ reason })
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  return { reason: parsed.data.reason }
}

/** Only a draft may be deleted — a filed declaration stays on record, superseded or cancelled. */
export const bomDeleteRule = (b: Bom): RuleProblem | undefined =>
  b.process !== "Created" ? { status: 409, title: `Only drafts can be deleted — ${b.no} is ${b.process}.` } : undefined

/**
 * A new declaration's id: the next in the `bom` series, claimed separately so a create refused after this point
 * consumes nothing. (Its number is the `BOM-{sku}-v{n}` the rules worked out from the item's other versions.)
 */
export function bomIdentity() { return { id: `bom${db.seq.bom + 1}` } }
export const claimBomId = () => { db.seq.bom += 1 }

/** What an edit of a declaration records in the audit trail. */
export const BOM_DIFF_FIELDS = ["effectiveDate", "licenseDate", "amendmentReason", "materialValue", "valueAdded", "price"]

export function bomDiff(a: Bom, b: Bom) {
  const out = diff(a, b, BOM_DIFF_FIELDS)
  const sig = (x: Bom) => x.inputs.map((i) => `${i.name} ${i.qty} +${i.wastagePct}%`).join("; ")
  if (sig(a) !== sig(b)) out.push({ field: "inputs", from: sig(a), to: sig(b) })
  return out
}

export const bomSpec: QuerySpec<BomRow> = {
  search: (b) => `${b.no} ${b.itemName} ${b.sku} ${b.hsCode} ${b.inputs.map((i) => i.name).join(" ")}`,
  dateField: "effectiveDate",
  facets: { status: (b) => b.status, item: (b) => b.itemId },
  totals: [],
}

/** The register's CSV: the price declarations, one row each. */
export const bomCsvColumns = [
  { key: "no", label: "Declaration" }, { key: "itemName", label: "Item" }, { key: "uom", label: "UoM" }, { key: "version", label: "Version" },
  { key: "licenseDate", label: "Submitted" }, { key: "effectiveDate", label: "Effective" }, { key: "materialValue", label: "Material Value" }, { key: "wastageValue", label: "Wastage Value" },
  { key: "valueAdded", label: "Value Added" }, { key: "price", label: "Declared Price" }, { key: "unitCost", label: "Unit Cost" }, { key: "status", label: "Status" },
]
export const bomCsvName = (date = new Date().toISOString().slice(0, 10)) => `price-declarations-${date}.csv`

/** The register's facet labels: the finished goods a declaration may be filed for. */
export const bomFacetLabels = (items: Item[] = db.items) =>
  ({ item: Object.fromEntries(items.filter((i) => i.group === "Finished Goods").map((i) => [i.id, i.name])) })

export function bomListRoutes() {
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "sku.asc")
    const r = runQuery(db.boms.map((b) => bomRow(b)), sp, bomSpec)
    if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, bomCsvColumns), bomCsvName())
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json({ ...page, facetLabels: bomFacetLabels() })
  })
  const POST = withAuth("master.edit", async (req, _ctx, user) => {
    const body = await req.json().catch(() => ({}))
    const r = buildBom(body)
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const taken = bomDraftTakenRule(r.fields!.itemId)
    if (taken) return ruleResponse(taken)
    const b: Bom = { ...r.fields!, id: bomIdentity().id, process: "Created", createdAt: new Date().toISOString(), history: [] }
    claimBomId()
    addHistory("bom", b, user.name, "created")
    if (r.process === "Approved") approveBom(b, user.name)
    db.boms.push(b)
    return json(bomRow(b), { status: 201 })
  })
  return { GET, POST }
}

export function bomDocRoutes() {
  const find = (id: string) => db.boms.find((b) => b.id === id || b.no === id)
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(100)
    const b = find(id)
    if (!b) return problem(404, "Price declaration not found")
    return json({ ...bomRow(b), versions: bomVersions(b) })
  })
  const PUT = withAuth<Ctx>("master.edit", async (req, { params }, user) => {
    const { id } = await params
    const b = find(id)
    if (!b) return problem(404, "Price declaration not found")
    const draft = bomDraftRule(b)
    if (draft) return ruleResponse(draft)
    const r = buildBom(await req.json().catch(() => ({})), b)
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const before = structuredClone(b)
    Object.assign(b, r.fields)
    const changes = bomDiff(before, b)
    addHistory("bom", b, user.name, "edited", undefined, changes)
    if (r.process === "Approved") approveBom(b, user.name)
    return json(bomRow(b))
  })
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const b = find(id)
    if (!b) return problem(404, "Price declaration not found")
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      const rule = bomApproveRule(b)
      if (rule) return ruleResponse(rule)
      approveBom(b, user.name)
      return json(bomRow(b))
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      const r = bomCancelRule(b, body.reason ?? "")
      if ("status" in r) return ruleResponse(r)
      b.process = "Cancelled"
      b.cancelReason = r.reason
      addHistory("bom", b, user.name, "cancelled", r.reason)
      return json(bomRow(b))
    }
    return problem(400, "process must be Approved or Cancelled")
  })
  const DELETE = withAuth<Ctx>("master.edit", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.boms.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Price declaration not found")
    const rule = bomDeleteRule(db.boms[i])
    if (rule) return ruleResponse(rule)
    const [b] = db.boms.splice(i, 1)
    addHistory("bom", b, user.name, "deleted")
    return json({ ok: true })
  })
  return { GET, PUT, PATCH, DELETE }
}

/* ── Work orders ───────────────────────────────────────────────────────── */

/** Recomputes a work order's progress from approved batches (issued / received / damaged / remaining + status). */
export function refreshWorkOrder(w: WorkOrder) {
  const bl = db.batches.filter((b) => b.process === "Approved").flatMap((b) => b.lines.filter((l) => l.workOrderId === w.id))
  for (const l of w.lines) {
    const mine = bl.filter((x) => x.itemId === l.itemId)
    l.issued = round2(mine.reduce((a, x) => a + x.issueQty, 0))
    l.received = round2(mine.reduce((a, x) => a + x.receiveQty, 0))
    l.damaged = round2(mine.reduce((a, x) => a + x.damageQty, 0))
    l.remaining = round2(Math.max(0, l.qty - l.issued))
  }
  w.status = w.process === "Cancelled" ? "cancelled" : w.process === "Created" ? "draft"
    : w.lines.every((l) => l.received + l.damaged >= l.qty - 1e-9) ? "completed" : w.lines.some((l) => (l.issued ?? 0) > 0) ? "partial" : "open"
  return w
}
/** Quantity of an item still to put into production on a work order (approved AND draft batches count). */
function woOpenQty(w: WorkOrder, itemId: string, excludeBatchId?: string) {
  const l = w.lines.find((x) => x.itemId === itemId)
  if (!l) return 0
  const used = db.batches.filter((b) => b.process !== "Cancelled" && b.id !== excludeBatchId).flatMap((b) => b.lines).filter((x) => x.workOrderId === w.id && x.itemId === itemId).reduce((a, x) => a + x.issueQty, 0)
  return round2(l.qty - used)
}

function buildWorkOrder(body: unknown) {
  const parsed = workOrderInput.safeParse(body)
  if (!parsed.success) return { error: zodProblem(parsed.error) }
  const d = parsed.data
  const errors: Record<string, string[]> = {}
  const seen = new Set<string>()
  d.lines.forEach((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId && x.active && x.group === "Finished Goods")
    if (!it) errors[`lines.${i}.itemId`] = ["unknown"]
    else if (seen.has(it.id)) errors[`lines.${i}.itemId`] = ["duplicate"]
    else if (!activeBom(it.id, d.issueDate)) errors[`lines.${i}.itemId`] = ["noBom"]
    seen.add(l.itemId)
  })
  if (d.dueDate && d.dueDate < d.issueDate) errors.dueDate = ["beforeIssue"]
  if (has(errors)) return { error: invalid(errors) }
  return {
    process: d.process,
    fields: {
      requisitionNo: d.requisitionNo || undefined, issueDate: d.issueDate, dueDate: d.dueDate || undefined, remark: d.remark || undefined,
      lines: d.lines.map((l) => { const it = db.items.find((x) => x.id === l.itemId)!; return { itemId: it.id, name: it.name, sku: it.sku, uom: it.unit, qty: l.qty, issued: 0, received: 0, damaged: 0, remaining: l.qty } }),
    } satisfies Partial<WorkOrder>,
  }
}

const woSpec: QuerySpec<WorkOrder> = {
  search: (w) => `${w.no} ${w.requisitionNo ?? ""} ${w.remark ?? ""} ${w.lines.map((l) => l.name).join(" ")}`,
  dateField: "issueDate",
  facets: { process: (w) => w.process, status: (w) => w.status },
  totals: [],
}

export function workOrderListRoutes() {
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    db.workOrders.forEach(refreshWorkOrder)
    const item = sp.get("item"); sp.delete("item")
    const r = runQuery(item ? db.workOrders.filter((w) => w.lines.some((l) => l.itemId === item)) : db.workOrders, sp, woSpec)
    if (sp.get("format") === "csv") {
      return csvResponse(toCSV(r.all.flatMap((w) => w.lines.map((l) => ({ ...l, no: w.no, issueDate: w.issueDate, dueDate: w.dueDate, requisitionNo: w.requisitionNo, status: w.status }))), [
        { key: "issueDate", label: "Issue Date" }, { key: "no", label: "Work Order" }, { key: "requisitionNo", label: "Requisition No" }, { key: "dueDate", label: "Due" },
        { key: "name", label: "Item" }, { key: "uom", label: "UoM" }, { key: "qty", label: "Ordered" }, { key: "issued", label: "Issued" }, { key: "received", label: "Received" },
        { key: "damaged", label: "Damaged" }, { key: "remaining", label: "Remaining" }, { key: "status", label: "Status" },
      ]), `work-orders-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  })
  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const r = buildWorkOrder(await req.json().catch(() => ({})))
    if (r.error) return r.error
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const w: WorkOrder = { ...r.fields!, id: `wo${db.seq.workOrder + 1}`, no: nextNo("PW", "workOrder", db.workOrders, r.fields!.issueDate), process: "Created", status: "draft", issuedBy: user.name, createdAt: new Date().toISOString(), history: [] }
    db.seq.workOrder += 1
    addHistory("workOrder", w, user.name, "created")
    if (r.process === "Approved") { w.process = "Approved"; addHistory("workOrder", w, user.name, "approved") }
    db.workOrders.push(refreshWorkOrder(w))
    return json(w, { status: 201 })
  })
  return { GET, POST }
}

export function workOrderDocRoutes() {
  const find = (id: string) => db.workOrders.find((w) => w.id === id || w.no === id)
  const batchesOf = (w: WorkOrder) => db.batches.filter((b) => b.lines.some((l) => l.workOrderId === w.id))
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(100)
    const w = find(id)
    if (!w) return problem(404, "Work order not found")
    refreshWorkOrder(w)
    return json({ ...w, batches: batchesOf(w).map((b) => ({ id: b.id, no: b.no, mode: b.mode, issueDate: b.issueDate, process: b.process, totalIssue: b.totalIssue, totalReceive: b.totalReceive })) })
  })
  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const w = find(id)
    if (!w) return problem(404, "Work order not found")
    if (w.process !== "Created") return problem(409, `Only drafts can be edited — ${w.no} is ${w.process}.`)
    const r = buildWorkOrder(await req.json().catch(() => ({})))
    if (r.error) return r.error
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const before = structuredClone(w)
    Object.assign(w, r.fields)
    const changes = diff(before, w, ["requisitionNo", "issueDate", "dueDate", "remark"])
    const sig = (x: WorkOrder) => x.lines.map((l) => `${l.name} × ${l.qty}`).join("; ")
    if (sig(before) !== sig(w)) changes.push({ field: "lines", from: sig(before), to: sig(w) })
    addHistory("workOrder", w, user.name, "edited", undefined, changes)
    if (r.process === "Approved") { w.process = "Approved"; addHistory("workOrder", w, user.name, "approved") }
    return json(refreshWorkOrder(w))
  })
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const w = find(id)
    if (!w) return problem(404, "Work order not found")
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      if (w.process !== "Created") return problem(409, `Cannot approve — ${w.no} is ${w.process}.`)
      w.process = "Approved"
      addHistory("workOrder", w, user.name, "approved")
      return json(refreshWorkOrder(w))
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      if (w.process === "Cancelled") return problem(409, `${w.no} is already cancelled.`)
      const live = batchesOf(w).filter((b) => b.process !== "Cancelled")
      if (live.length) return problem(409, `${w.no} has production batches (${live.map((b) => b.no).join(", ")}) — cancel them first.`)
      const r = cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!r.success) return zodProblem(r.error)
      w.process = "Cancelled"
      w.cancelReason = r.data.reason
      addHistory("workOrder", w, user.name, "cancelled", r.data.reason)
      return json(refreshWorkOrder(w))
    }
    return problem(400, "process must be Approved or Cancelled")
  })
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.workOrders.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Work order not found")
    if (db.workOrders[i].process !== "Created") return problem(409, `Only drafts can be deleted — cancel ${db.workOrders[i].no} instead.`)
    if (batchesOf(db.workOrders[i]).length) return problem(409, `${db.workOrders[i].no} is referenced by production batches.`)
    const [w] = db.workOrders.splice(i, 1)
    addHistory("workOrder", w, user.name, "deleted")
    return json({ ok: true })
  })
  return { GET, PUT, PATCH, DELETE }
}

/* ── Production batches (in-house, contractual / Mushak 6.4, opening) ─────── */

/** What `buildBatch` returns: every field of the batch but the identity and the lifecycle the caller adds. */
export type BatchFields = Omit<Batch, "id" | "no" | "process" | "createdAt" | "history">

/**
 * Validates a batch body and prices it (R5.4: as data, so the API's native batch module answers with the same 422
 * body): the finished goods of every line at the active BOM's unit cost — an opening batch may state its own — and
 * the inputs that BOM consumes for the issued quantity, or, when the production configuration asks for the actual
 * consumption, the quantities the body lists.
 */
export function buildBatch(body: unknown, self?: Batch): RuleProblem | { process: "Created" | "Approved"; fields: BatchFields } {
  const parsed = batchInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d: z.output<typeof batchInput> = parsed.data
  if (self && self.mode !== d.mode) return { status: 409, title: "The batch type cannot change — create a new batch." }
  const cfg = db.productionConfig
  const errors: Record<string, string[]> = {}
  let vendor: Party | undefined
  if (d.mode === "contractual") {
    vendor = db.vendors.find((v) => v.id === d.vendorId && v.active !== false && v.mode !== "Foreign")
    if (!vendor) errors.vendorId = [d.vendorId ? "unknown" : "required"]
  }
  if (d.receiveDate && d.receiveDate < d.issueDate) errors.receiveDate = ["beforeIssue"]
  const lines: BatchLine[] = []
  const std: Consumption[] = []
  const seen = new Set<string>()
  d.lines.forEach((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId && x.active && x.group === "Finished Goods")
    if (!it) { errors[`lines.${i}.itemId`] = ["unknown"]; return }
    const k = `${it.id}|${l.workOrderId}`
    if (seen.has(k)) { errors[`lines.${i}.itemId`] = ["duplicate"]; return }
    seen.add(k)
    const bom = activeBom(it.id, d.issueDate)
    if (d.mode !== "opening" && !bom) { errors[`lines.${i}.itemId`] = ["noBom"]; return }
    const contractual = d.mode === "contractual"
    const receiveQty = contractual ? 0 : l.receiveQty, damageQty = contractual ? 0 : l.damageQty
    if (receiveQty + damageQty > l.issueQty + 1e-9) { errors[`lines.${i}.receiveQty`] = ["exceedsIssue"]; return }
    let wo: WorkOrder | undefined
    if (l.workOrderId) {
      wo = db.workOrders.find((w) => w.id === l.workOrderId && w.process === "Approved" && w.lines.some((x) => x.itemId === it.id))
      if (!wo) { errors[`lines.${i}.workOrderId`] = ["unknown"]; return }
      if (l.issueQty > woOpenQty(wo, it.id, self?.id) + 1e-9) { errors[`lines.${i}.issueQty`] = ["exceedsWorkOrder"]; return }
    } else if (cfg.procedure === "workOrder" && d.mode !== "opening") { errors[`lines.${i}.workOrderId`] = ["required"]; return }
    const unitCost = d.mode === "opening" ? l.unitCost ?? bom?.unitCost ?? it.costPrice : bom!.unitCost
    lines.push({ itemId: it.id, name: it.name, sku: it.sku, uom: it.unit, workOrderId: wo?.id, workOrderNo: wo?.no, issueQty: l.issueQty, receiveQty, damageQty, bomId: bom?.id, bomVersion: bom?.version, unitCost, value: round2(receiveQty * unitCost) })
    if (d.mode !== "opening") std.push(...consumptionFor(bom!, l.issueQty, db.items))
  })
  let consumption = mergeConsumption(std)
  if (d.mode !== "opening" && cfg.consumption === "actual" && d.consumption?.length) {
    consumption = []
    d.consumption.forEach((c, i) => {
      if (!c.qty) return
      const it = db.items.find((x) => x.id === c.itemId && x.active && x.group !== "Finished Goods")
      if (!it) { errors[`consumption.${i}.itemId`] = ["unknown"]; return }
      const q = round2(c.qty)
      consumption.push({ itemId: it.id, name: it.name, sku: it.sku, uom: it.unit, qty: q, price: it.purchasePrice, value: round2(q * it.purchasePrice) })
    })
    consumption = mergeConsumption(consumption)
  }
  if (has(errors)) return invalidRule(errors)
  const receiving = lines.some((l) => l.receiveQty > 0)
  const main = mainBranchId()
  return {
    process: d.process,
    fields: {
      mode: d.mode, issueDate: d.issueDate, receiveDate: d.receiveDate || (receiving ? d.issueDate : undefined),
      vendorId: vendor?.id, vendorName: vendor?.name, vendorBin: vendor?.bin, vendorAddress: vendor?.address,
      jobProcess: d.mode === "contractual" ? d.jobProcess ?? "manufacture" : undefined,
      address: d.mode === "contractual" ? d.address || (vendor ? `${vendor.name}, ${vendor.address}` : undefined) : undefined,
      remark: d.remark || undefined, issuedBy: d.issuedBy, designation: d.designation, lines, consumption,
      totalIssue: round2(lines.reduce((a, l) => a + l.issueQty, 0)), totalReceive: round2(lines.reduce((a, l) => a + l.receiveQty, 0)), totalDamage: round2(lines.reduce((a, l) => a + l.damageQty, 0)),
      materialValue: round2(consumption.reduce((a, c) => a + c.value, 0)), value: round2(lines.reduce((a, l) => a + l.value, 0)),
      branchId: main, branchName: branchName(main),
    } satisfies BatchFields as BatchFields,
  }
}

/** The inputs a batch consumes leave the store (`items.prodIssue`); a cancellation puts them back. */
export function postBatchIssue(b: Batch, sign: 1 | -1) {
  for (const c of b.consumption) { const it = db.items.find((i) => i.id === c.itemId); if (it) it.prodIssue = round2(it.prodIssue + sign * c.qty) }
}
/** The finished goods a batch receives come into the factory (`items.prodReceive`); a cancellation takes them out. */
export function postBatchReceive(b: Batch, sign: 1 | -1) {
  for (const l of b.lines) { const it = db.items.find((i) => i.id === l.itemId); if (it && l.receiveQty) it.prodReceive = round2(it.prodReceive + sign * l.receiveQty) }
}

/**
 * The inputs must be on hand at the factory before a batch is stored as approved — checked while a create or an
 * edit is still being validated, so it answers 422 with no field errors, exactly as the mock answered.
 */
export function batchStockRule(b: Batch): RuleProblem | undefined {
  const short = stockShortfall(b.consumption, b.branchId)
  return short ? { status: 422, title: `Insufficient input stock — ${short.detail}` } : undefined
}

/**
 * Approving: a draft, its inputs on hand — this time naming the consumption lines that are short — and every work
 * order a line draws on still approved.
 */
export function batchApproveRule(b: Batch): RuleProblem | undefined {
  if (b.process !== "Created") return { status: 409, title: `Cannot approve — ${b.no} is ${b.process}.` }
  const short = stockShortfall(b.consumption, b.branchId)
  if (short) {
    return {
      status: 409, title: `Insufficient input stock — ${short.detail}`,
      errors: Object.fromEntries(Object.keys(short.errors).map((k) => [k.replace(/^lines/, "consumption"), short.errors[k]])),
    }
  }
  const closed = b.lines.filter((l) => l.workOrderId && db.workOrders.find((w) => w.id === l.workOrderId)?.process !== "Approved")
  if (closed.length) return { status: 409, title: `Work order ${closed[0].workOrderNo} is no longer approved.` }
  return undefined
}

function approveBatch(b: Batch, by: string) {
  const rule = batchApproveRule(b)
  if (rule) return ruleResponse(rule)
  b.process = "Approved"
  postBatchIssue(b, 1)
  postBatchReceive(b, 1)
  addHistory("batch", b, by, "approved")
  return null
}

/** Only a draft may be edited — checked before the body is parsed, exactly as the mock checked it. */
export function batchDraftRule(b: Batch): RuleProblem | undefined {
  return b.process !== "Created" ? { status: 409, title: `Only drafts can be edited — ${b.no} is ${b.process}.` } : undefined
}

/** Only a draft may be deleted; an approved one is cancelled instead. */
export function batchDeleteRule(b: Batch): RuleProblem | undefined {
  return b.process !== "Created" ? { status: 409, title: `Only drafts can be deleted — cancel ${b.no} instead.` } : undefined
}

/**
 * Cancelling: never twice, a mandatory reason — and an approved batch's finished goods must still be on hand at the
 * factory and no sales invoice may draw on its lots, because cancelling takes the goods back out (and its inputs go
 * back to the store).
 */
export function batchCancelRule(b: Batch, reason: string): RuleProblem | { reason: string } {
  if (b.process === "Cancelled") return { status: 409, title: `${b.no} is already cancelled.` }
  const parsed = cancelInput.safeParse({ reason })
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  if (b.process === "Approved") {
    const received = b.lines.filter((l) => l.receiveQty > 0).map((l) => ({ itemId: l.itemId, qty: l.receiveQty }))
    const short = stockShortfall(received, b.branchId)
    if (short) return { status: 409, title: `Finished goods from this batch have already been sold or moved — ${short.detail}` }
    const sold = lots().filter((x) => x.batchId === b.id && x.sold > 0)
    if (sold.length) return { status: 409, title: `Sales invoices draw on this batch (${sold.map((x) => `${x.sold} sold`).join(", ")}) — cancel them first.` }
  }
  return { reason: parsed.data.reason }
}

/**
 * A new batch's identity: the next id in the `pb` series (the counter lives in the state, because a deleted batch
 * leaves no row behind) and the next PB-MMYY#### — which the audit trail takes part in, so a deleted draft's number
 * is not reused. Claimed separately, so a create refused after this point consumes nothing.
 */
export function batchIdentity(issueDate: string) {
  return { id: `pb${db.seq.batch + 1}`, no: nextNo("PB", "batch", db.batches, issueDate) }
}
export const claimBatchId = () => { db.seq.batch += 1 }

/** What an edit of a batch records in the audit trail. */
export const BATCH_DIFF_FIELDS = ["issueDate", "receiveDate", "vendorName", "remark", "totalIssue", "totalReceive", "totalDamage"]

export function batchDiff(a: Batch, b: Batch) {
  const out = diff(a, b, BATCH_DIFF_FIELDS)
  const sig = (x: Batch) => x.lines.map((l) => `${l.name} ${l.issueQty}/${l.receiveQty}/${l.damageQty}`).join("; ")
  if (sig(a) !== sig(b)) out.push({ field: "lines", from: sig(a), to: sig(b) })
  return out
}

export const batchSpec: QuerySpec<Batch> = {
  search: (b) => `${b.no} ${b.vendorName ?? ""} ${b.remark ?? ""} ${b.lines.map((l) => `${l.name} ${l.workOrderNo ?? ""}`).join(" ")}`,
  dateField: "issueDate",
  facets: { process: (b) => b.process, mode: (b) => b.mode, receipt: (b) => (b.mode === "contractual" && b.process === "Approved" && !b.receivedAt ? "awaiting" : "done") },
  totals: ["totalIssue", "totalReceive", "totalDamage", "materialValue", "value"],
}

/** The register's `?workOrder=` filter: one work order's batches, taken out of the params before the query runs. */
export const batchWorkOrderFilter = (params: URLSearchParams, src: Batch[]) => {
  const wo = params.get("workOrder")
  params.delete("workOrder")
  return wo ? src.filter((b) => b.lines.some((l) => l.workOrderId === wo)) : src
}

export const batchCsvColumns: { key: string; label: string }[] = [
  { key: "issueDate", label: "Issue Date" }, { key: "no", label: "Batch" }, { key: "mode", label: "Mode" }, { key: "vendorName", label: "Contractor" }, { key: "workOrderNo", label: "Work Order" },
  { key: "name", label: "Item" }, { key: "uom", label: "UoM" }, { key: "issueQty", label: "Issue Qty" }, { key: "receiveQty", label: "Receive Qty" }, { key: "damageQty", label: "Damage Qty" },
  { key: "unitCost", label: "Unit Cost" }, { key: "value", label: "Value" }, { key: "receiveDate", label: "Receive Date" }, { key: "process", label: "Process" },
]

/** One CSV row per batch line, carrying the header's own columns. */
export const batchCsvRows = (list: Batch[]) =>
  list.flatMap((b) => b.lines.map((l) => ({ ...l, no: b.no, mode: b.mode, issueDate: b.issueDate, receiveDate: b.receiveDate, vendorName: b.vendorName, process: b.process })))

/** What a contractual receipt sets: the date, each line's returned and damaged quantity, and the new totals. */
export type BatchReceiveFields = {
  receiveDate: string
  lines: { receiveQty: number; damageQty: number; value: number }[]
  totalReceive: number; totalDamage: number; value: number
}

/** A receipt needs a contractual batch (Mushak 6.4) that is approved and has not been received yet. */
export function batchReceiveStateRule(b: Batch): RuleProblem | undefined {
  if (b.mode !== "contractual") return { status: 409, title: `${b.no} is not a contractual batch.` }
  if (b.process !== "Approved") return { status: 409, title: `Approve ${b.no} before receiving goods.` }
  if (b.receivedAt) return { status: 409, title: `${b.no} has already been received.` }
  return undefined
}

/** Validates a receipt body against the batch's own lines: one entry per line, none before the issue date, none over the issued quantity. */
export function buildBatchReceive(b: Batch, body: unknown): RuleProblem | BatchReceiveFields {
  const parsed = batchReceiveInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const d = parsed.data
  if (d.lines.length !== b.lines.length) return invalidRule({ lines: ["lineCount"] })
  const errors: Record<string, string[]> = {}
  if (d.receiveDate < b.issueDate) errors.receiveDate = ["beforeIssue"]
  d.lines.forEach((l, i) => { if (l.receiveQty + l.damageQty > b.lines[i].issueQty + 1e-9) errors[`lines.${i}.receiveQty`] = ["exceedsIssue"] })
  if (has(errors)) return invalidRule(errors)
  const lines = b.lines.map((l, i) => ({ receiveQty: d.lines[i].receiveQty, damageQty: d.lines[i].damageQty, value: round2(d.lines[i].receiveQty * l.unitCost) }))
  return {
    receiveDate: d.receiveDate, lines,
    totalReceive: round2(lines.reduce((a, l) => a + l.receiveQty, 0)),
    totalDamage: round2(lines.reduce((a, l) => a + l.damageQty, 0)),
    value: round2(lines.reduce((a, l) => a + l.value, 0)),
  }
}

/** Writes a receipt onto the batch — the caller stamps the trail and moves `items.prodReceive`. */
export function applyBatchReceive(b: Batch, r: BatchReceiveFields) {
  b.lines.forEach((l, i) => { l.receiveQty = r.lines[i].receiveQty; l.damageQty = r.lines[i].damageQty; l.value = r.lines[i].value })
  b.totalReceive = r.totalReceive
  b.totalDamage = r.totalDamage
  b.value = r.value
  b.receiveDate = r.receiveDate
}

/** The audit change a receipt records. */
export const batchReceiveChanges = (r: BatchReceiveFields): AuditChange[] =>
  [{ field: "totalReceive", from: "0", to: String(r.totalReceive) }]

export function batchListRoutes() {
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(batchWorkOrderFilter(sp, db.batches), sp, batchSpec)
    if (sp.get("format") === "csv") {
      return csvResponse(toCSV(batchCsvRows(r.all), batchCsvColumns), `production-batches-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  })
  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const r = buildBatch(await req.json().catch(() => ({})))
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    const b: Batch = { ...r.fields, ...batchIdentity(r.fields.issueDate), process: "Created", issueTime: new Date().toTimeString().slice(0, 5), createdAt: new Date().toISOString(), history: [] }
    if (r.process === "Approved") { const short = batchStockRule(b); if (short) return ruleResponse(short) }
    claimBatchId()
    addHistory("batch", b, user.name, "created")
    if (r.process === "Approved") approveBatch(b, user.name)
    db.batches.push(b)
    return json(b, { status: 201 })
  })
  return { GET, POST }
}

export function batchDocRoutes() {
  const find = (id: string) => db.batches.find((b) => b.id === id || b.no === id)
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(100)
    const b = find(id)
    return b ? json(b) : problem(404, "Production batch not found")
  })
  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const b = find(id)
    if (!b) return problem(404, "Production batch not found")
    const draft = batchDraftRule(b); if (draft) return ruleResponse(draft)
    const r = buildBatch(await req.json().catch(() => ({})), b)
    if ("status" in r) return ruleResponse(r)
    if (r.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      const short = batchStockRule({ ...b, ...r.fields }); if (short) return ruleResponse(short)
    }
    const before = structuredClone(b)
    Object.assign(b, r.fields)
    addHistory("batch", b, user.name, "edited", undefined, batchDiff(before, b))
    if (r.process === "Approved") approveBatch(b, user.name)
    return json(b)
  })
  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const b = find(id)
    if (!b) return problem(404, "Production batch not found")
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      return approveBatch(b, user.name) ?? json(b)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      const r = batchCancelRule(b, body.reason ?? "")
      if ("status" in r) return ruleResponse(r)
      if (b.process === "Approved") {
        postBatchReceive(b, -1)
        postBatchIssue(b, -1) // inputs go back to the store
      }
      b.process = "Cancelled"
      b.cancelReason = r.reason
      addHistory("batch", b, user.name, "cancelled", r.reason)
      return json(b)
    }
    return problem(400, "process must be Approved or Cancelled")
  })
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.batches.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, "Production batch not found")
    const gone = batchDeleteRule(db.batches[i]); if (gone) return ruleResponse(gone)
    const [b] = db.batches.splice(i, 1)
    addHistory("batch", b, user.name, "deleted")
    return json({ ok: true })
  })
  return { GET, PUT, PATCH, DELETE }
}

/** Contractual batch: finished goods received back from the contract manufacturer (completes Mushak 6.4). */
export const batchReceiveRoute = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
  const { id } = await params
  const b = db.batches.find((x) => x.id === id || x.no === id)
  if (!b) return problem(404, "Production batch not found")
  const state = batchReceiveStateRule(b); if (state) return ruleResponse(state)
  const r = buildBatchReceive(b, await req.json().catch(() => ({})))
  if ("status" in r) return ruleResponse(r)
  applyBatchReceive(b, r)
  b.receivedAt = new Date().toISOString()
  postBatchReceive(b, 1)
  addHistory("batch", b, user.name, "edited", "Finished goods received from the contractor", batchReceiveChanges(r))
  return json(b)
})

/* ── Config + lots ─────────────────────────────────────────────────────── */

/**
 * The production configuration as data (R5.5: so the API's native module answers a bad body with the same 422):
 * the procedure a batch follows and the consumption it records.
 */
export function buildConfig(body: unknown): RuleProblem | { fields: ProductionConfig } {
  const parsed = productionConfigInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  return { fields: parsed.data }
}

/** What an update of the configuration records in the audit trail. */
export const CONFIG_DIFF_FIELDS = ["procedure", "consumption"]
export const configDiff = (before: ProductionConfig, after: ProductionConfig) => diff(before, after, CONFIG_DIFF_FIELDS)

export const configRoutes = {
  GET: withAuth(null, async () => json(db.productionConfig)),
  PUT: withAuth("settings.manage", async (req, _ctx, user) => {
    const r = buildConfig(await req.json().catch(() => ({})))
    if ("status" in r) return ruleResponse(r)
    const before = db.productionConfig
    const at = new Date().toISOString()
    db.productionConfig = { ...r.fields, updatedAt: at, updatedBy: user.name }
    recordAudit({ at, actor: user.name, entity: "productionConfig", ref: "Production configuration", action: "updated", changes: configDiff(before, db.productionConfig) })
    return json(db.productionConfig)
  }),
}

export const lotsRoute = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const item = sp.get("item") ?? undefined
  const all = lots(item, sp.get("exclude") ?? undefined)
  return json(sp.get("all") ? all : all.filter((l) => l.available > 0))
})
