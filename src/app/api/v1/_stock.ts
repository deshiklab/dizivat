import type { z } from "zod"
import { branchLabels, branchName, db, resolveBranch, stockShortfall } from "@/lib/mock/db"
import { auditStore, diff, recordAudit } from "@/lib/mock/audit"
import { stockLine } from "@/lib/mock/seed-stock"
import { csvResponse, delay, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { cancelInput, damageInput, transferInput } from "@/lib/schemas"
import type { AuditChange, Damage, HistoryEntry, StockDoc, StockDocKind, Transfer } from "@/lib/types"
import { deny, json, problem, withAuth, zodProblem } from "./_lib"

type Ctx = { params: Promise<{ id: string }> }
type TransferData = z.output<typeof transferInput>
type DamageData = z.output<typeof damageInput>

const LABEL: Record<StockDocKind, string> = { transfer: "Stock transfer", damage: "Damage entry" }
const PREFIX: Record<StockDocKind, "TR" | "DM"> = { transfer: "TR", damage: "DM" }
const list = (k: StockDocKind): StockDoc[] => (k === "transfer" ? db.transfers : db.damages)
const find = (k: StockDocKind, id: string) => list(k).find((d) => d.id === id || d.no === id)
const round2 = (n: number) => Math.round(n * 100) / 100
/** Branch whose stock the document consumes on approval. */
const source = (d: StockDoc) => (d.kind === "transfer" ? d.fromBranchId : d.branchId)

function nextNo(k: StockDocKind, date: string) {
  const key = `${PREFIX[k]}-${date.slice(5, 7)}${date.slice(2, 4)}`
  // deleted drafts live on in the audit trail, so their numbers are skipped too
  const used = [...list(k).map((d) => d.no), ...auditStore.events.filter((e) => e.entity === k).map((e) => e.ref)]
  const n = used.reduce((m, no) => (no.startsWith(key) ? Math.max(m, Number(no.slice(key.length)) || 0) : m), 0) + 1
  return `${key}${String(n).padStart(4, "0")}`
}

/** Appends to the document's own history and the global audit trail. */
function addHistory(d: StockDoc, by: string, action: HistoryEntry["action"], note?: string, changes?: AuditChange[]) {
  const at = new Date().toISOString()
  d.history = [...(d.history ?? []), { at, by, action, note }]
  d.updatedAt = at
  recordAudit({ at, actor: by, entity: d.kind, entityId: d.id, ref: d.no, action, note, changes })
}

/** Lines → priced stock lines (quantities rounded to the unit's precision), or field errors. */
function buildLines(lines: { itemId: string; qty: number }[]) {
  const errors: Record<string, string[]> = {}
  const out = lines.map((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId && x.active)
    if (!it) { errors[`lines.${i}.itemId`] = ["unknown"]; return null }
    const dec = db.units.find((u) => u.code === it.unit)?.decimals ?? 2
    const qty = Math.round(l.qty * 10 ** dec) / 10 ** dec
    if (qty <= 0) errors[`lines.${i}.qty`] = ["positive"]
    return stockLine(it, qty)
  })
  return Object.keys(errors).length ? { errors } : { lines: out.filter((l) => l !== null) }
}

/** Validated input → document fields, or a 422 problem. */
function build(k: StockDocKind, body: unknown) {
  if (k === "transfer") {
    const parsed = transferInput.safeParse(body)
    if (!parsed.success) return { error: zodProblem(parsed.error) }
    const d: TransferData = parsed.data
    const errors: Record<string, string[]> = {}
    if (!resolveBranch(d.fromBranchId)) errors.fromBranchId = ["unknownBranch"]
    if (!resolveBranch(d.toBranchId)) errors.toBranchId = ["unknownBranch"]
    const b = buildLines(d.lines)
    if ("errors" in b) Object.assign(errors, b.errors)
    if (Object.keys(errors).length || !("lines" in b)) return { error: problem(422, "Validation failed", errors) }
    const lines = b.lines!
    return {
      process: d.process,
      fields: {
        date: d.date, fromBranchId: d.fromBranchId, fromBranch: branchName(d.fromBranchId), toBranchId: d.toBranchId, toBranch: branchName(d.toBranchId),
        vehicle: d.vehicle || undefined, note: d.note || undefined, lines,
        totalQty: round2(lines.reduce((a, l) => a + l.qty, 0)), totalValue: round2(lines.reduce((a, l) => a + l.value, 0)),
      } satisfies Partial<Transfer>,
    }
  }
  const parsed = damageInput.safeParse(body)
  if (!parsed.success) return { error: zodProblem(parsed.error) }
  const d: DamageData = parsed.data
  const errors: Record<string, string[]> = {}
  if (!resolveBranch(d.branchId)) errors.branchId = ["unknownBranch"]
  const b = buildLines(d.lines)
  if ("errors" in b) Object.assign(errors, b.errors)
  if (Object.keys(errors).length || !("lines" in b)) return { error: problem(422, "Validation failed", errors) }
  const lines = b.lines!
  return {
    process: d.process,
    fields: {
      date: d.date, branchId: d.branchId, branch: branchName(d.branchId), reason: d.reason, note: d.note || undefined, lines,
      totalQty: round2(lines.reduce((a, l) => a + l.qty, 0)), totalValue: round2(lines.reduce((a, l) => a + l.value, 0)),
    } satisfies Partial<Damage>,
  }
}

/** Damage writes off company stock (Item.damage); a transfer only moves it between branches. */
function post(d: StockDoc, sign: 1 | -1) {
  if (d.kind !== "damage") return
  for (const l of d.lines) { const it = db.items.find((i) => i.id === l.itemId); if (it) it.damage = round2(it.damage + sign * l.qty) }
}

/** Approve: the source branch must hold the quantity. Returns a problem or null. */
function approve(d: StockDoc, by: string, status: 409 | 422 = 409) {
  const short = stockShortfall(d.lines, source(d))
  if (short) return problem(status, `Insufficient stock — ${short.detail}`, short.errors)
  d.process = "Approved"
  post(d, 1)
  addHistory(d, by, "approved")
  return null
}

const FIELDS = ["date", "fromBranch", "toBranch", "branch", "reason", "vehicle", "note", "totalValue"]
function docDiff(a: StockDoc, b: StockDoc) {
  const out = diff(a, b, FIELDS)
  const sig = (d: StockDoc) => d.lines.map((l) => `${l.name} × ${l.qty} ${l.uom}`).join("; ")
  if (sig(a) !== sig(b)) out.push({ field: "lines", from: sig(a), to: sig(b) })
  return out
}

const specFor = (k: StockDocKind): QuerySpec<StockDoc> => ({
  search: (d: StockDoc) => `${d.no} ${d.note ?? ""} ${d.lines.map((l) => `${l.name} ${l.sku}`).join(" ")} ${d.kind === "transfer" ? `${d.fromBranch} ${d.toBranch} ${d.vehicle ?? ""}` : d.branch}`,
  dateField: "date" as const,
  facets: k === "transfer"
    ? { process: (d: StockDoc) => d.process, fromBranch: (d: StockDoc) => (d as Transfer).fromBranchId, toBranch: (d: StockDoc) => (d as Transfer).toBranchId }
    : { process: (d: StockDoc) => d.process, branch: (d: StockDoc) => (d as Damage).branchId, reason: (d: StockDoc) => (d as Damage).reason },
  totals: ["totalValue"],
})

/** GET list (filters, facets, CSV) and POST create for /transfers and /damage. */
export function stockListRoutes(k: StockDocKind) {
  const spec = specFor(k)
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "createdAt.desc")
    const r = runQuery(list(k), sp, spec)
    if (sp.get("format") === "csv") {
      const lines = r.all.flatMap((d) => d.lines.map((l) => ({ d, l })))
      return csvResponse(toCSV(lines, [
        { key: "date", label: "Date", get: (x) => x.d.date }, { key: "no", label: k === "transfer" ? "Transfer No" : "Entry No", get: (x) => x.d.no },
        ...(k === "transfer"
          ? [{ key: "from", label: "From", get: (x: { d: StockDoc }) => (x.d as Transfer).fromBranch }, { key: "to", label: "To", get: (x: { d: StockDoc }) => (x.d as Transfer).toBranch }]
          : [{ key: "branch", label: "Branch", get: (x: { d: StockDoc }) => (x.d as Damage).branch }, { key: "reason", label: "Reason", get: (x: { d: StockDoc }) => (x.d as Damage).reason }]),
        { key: "sku", label: "SKU", get: (x) => x.l.sku }, { key: "item", label: "Item", get: (x) => x.l.name }, { key: "qty", label: "Qty", get: (x) => x.l.qty },
        { key: "uom", label: "Unit", get: (x) => x.l.uom }, { key: "cost", label: "Unit cost", get: (x) => x.l.cost }, { key: "value", label: "Value", get: (x) => x.l.value },
        { key: "process", label: "Process", get: (x) => x.d.process }, { key: "note", label: "Note", get: (x) => x.d.note ?? "" },
      ]), `${k === "transfer" ? "stock-transfers" : "damage-entries"}-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    const b = branchLabels()
    return json({ ...page, facetLabels: k === "transfer" ? { fromBranch: b, toBranch: b } : { branch: b } })
  })

  const POST = withAuth("doc.create", async (req, _ctx, user) => {
    const r = build(k, await req.json().catch(() => ({})))
    if (r.error) return r.error
    if (r.process === "Approved") { const no = deny(user, "doc.approve"); if (no) return no }
    db.seq[k] += 1
    const base = { id: `${k === "transfer" ? "t" : "d"}${db.seq[k]}`, no: nextNo(k, r.fields!.date), process: "Created" as const, issuedBy: user.name, createdAt: new Date().toISOString(), history: [] }
    const doc = (k === "transfer" ? { kind: "transfer", ...base, ...r.fields } : { kind: "damage", ...base, ...r.fields }) as StockDoc
    if (r.process === "Approved") {
      const short = stockShortfall(doc.lines, source(doc))
      if (short) { db.seq[k] -= 1; return problem(422, `Insufficient stock — ${short.detail}`, short.errors) }
    }
    addHistory(doc, user.name, "created")
    if (r.process === "Approved") approve(doc, user.name)
    list(k).push(doc)
    return json(doc, { status: 201 })
  })
  return { GET, POST }
}

/** GET one, PUT (drafts), PATCH approve/cancel, DELETE (drafts) for /transfers/{id} and /damage/{id}. */
export function stockDocRoutes(k: StockDocKind) {
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    await delay(100)
    const d = find(k, id)
    return d ? json(d) : problem(404, `${LABEL[k]} not found`)
  })

  const PUT = withAuth<Ctx>("doc.edit", async (req, { params }, user) => {
    const { id } = await params
    const d = find(k, id)
    if (!d) return problem(404, `${LABEL[k]} not found`)
    if (d.process !== "Created") return problem(409, `Only drafts can be edited — ${d.no} is ${d.process}.`)
    const r = build(k, await req.json().catch(() => ({})))
    if (r.error) return r.error
    if (r.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      const probe = { ...d, ...r.fields } as StockDoc
      const short = stockShortfall(probe.lines, source(probe))
      if (short) return problem(422, `Insufficient stock — ${short.detail}`, short.errors)
    }
    const before = structuredClone(d)
    Object.assign(d, r.fields)
    addHistory(d, user.name, "edited", undefined, docDiff(before, d))
    if (r.process === "Approved") approve(d, user.name)
    return json(d)
  })

  const PATCH = withAuth<Ctx>(null, async (req, { params }, user) => {
    const { id } = await params
    const d = find(k, id)
    if (!d) return problem(404, `${LABEL[k]} not found`)
    const body = (await req.json().catch(() => ({}))) as { process?: string; reason?: string }
    if (body.process === "Approved") {
      const no = deny(user, "doc.approve"); if (no) return no
      if (d.process !== "Created") return problem(409, `Cannot approve — ${d.no} is ${d.process}.`)
      return approve(d, user.name) ?? json(d)
    }
    if (body.process === "Cancelled") {
      const no = deny(user, "doc.cancel"); if (no) return no
      if (d.process === "Cancelled") return problem(409, `${d.no} is already cancelled.`)
      const r = cancelInput.safeParse({ reason: body.reason ?? "" })
      if (!r.success) return zodProblem(r.error)
      if (d.process === "Approved") {
        // Reversing a transfer takes the goods back out of the receiving branch — they must still be there
        if (d.kind === "transfer") {
          const short = stockShortfall(d.lines, d.toBranchId)
          if (short) return problem(409, `Goods from this transfer have already been used at ${d.toBranch} — ${short.detail}`)
        }
        post(d, -1)
      }
      d.process = "Cancelled"
      d.cancelReason = r.data.reason
      addHistory(d, user.name, "cancelled", r.data.reason)
      return json(d)
    }
    return problem(400, "process must be Approved or Cancelled")
  })

  /** Drafts only; the number is not reused (the audit trail keeps the record). */
  const DELETE = withAuth<Ctx>("doc.delete", async (_req, { params }, user) => {
    const { id } = await params
    const arr = list(k)
    const i = arr.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, `${LABEL[k]} not found`)
    if (arr[i].process !== "Created") return problem(409, `Only drafts can be deleted — cancel ${arr[i].no} instead.`)
    const [d] = arr.splice(i, 1)
    addHistory(d, user.name, "deleted")
    return json({ ok: true })
  })

  return { GET, PUT, PATCH, DELETE }
}
