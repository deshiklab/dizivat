import { db } from "@/lib/mock/db"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { partyInput } from "@/lib/schemas"
import type { Party, PartyRow } from "@/lib/types"
import { round2 } from "@/lib/vat"
import { json, problem, withAuth, zodProblem } from "./_lib"
import { diff, recordAudit } from "@/lib/mock/audit"
import { TODAY } from "@/lib/company"
import { customerCredit } from "./_r3"

const PARTY_FIELDS = ["name", "bin", "mode", "mobile", "email", "address", "contactPerson", "active"]

type Kind = "customer" | "vendor"
type Ctx = { params: Promise<{ id: string }> }
const coll = (k: Kind) => (k === "customer" ? db.customers : db.vendors)
const docsOf = (k: Kind, id: string) => (k === "customer" ? db.sales.filter((s) => s.customerId === id) : db.purchases.filter((p) => p.vendorId === id))
const label = (k: Kind) => (k === "customer" ? "Customer" : "Vendor")

function toRow(k: Kind, p: Party): PartyRow {
  const docs = docsOf(k, p.id).filter((d) => d.process !== "Cancelled")
  const approved = docs.filter((d) => d.process === "Approved")
  return {
    ...p,
    docs: docs.length,
    turnover: round2(approved.reduce((a, d) => a + d.netTotal, 0)),
    due: round2(approved.reduce((a, d) => a + d.due, 0)),
    lastDate: docs.map((d) => d.issueDate).sort().pop(),
    ...(k === "customer" ? (({ overdue, dueInvoices }) => ({ overdue, dueInvoices }))(customerCredit(p.id, TODAY)) : {}),
  }
}

const spec = {
  search: (p: PartyRow) => `${p.name} ${p.bin} ${p.mobile} ${p.address} ${p.contactPerson ?? ""}`,
  facets: {
    mode: (p: PartyRow) => p.mode,
    status: (p: PartyRow) => (p.active === false ? "inactive" : "active"),
    balance: (p: PartyRow) => (p.due > 0 ? "due" : "clear"),
  },
  totals: ["turnover", "due", "docs"] as (keyof PartyRow)[],
}

/** Business rules shared by create and update. */
function check(k: Kind, d: ReturnType<typeof partyInput.parse>, selfId?: string) {
  const errors: Record<string, string[]> = {}
  if (k === "customer" && d.mode === "Non-registered") errors.mode = ["customerMode"]
  const others = coll(k).filter((p) => p.id !== selfId)
  if (d.bin && others.some((p) => p.bin.replace(/^NID /, "") === d.bin.replace(/^NID /, ""))) errors.bin = ["duplicate"]
  if (others.some((p) => p.name.trim().toLowerCase() === d.name.toLowerCase())) errors.name = ["duplicate"]
  return Object.keys(errors).length ? problem(422, "Validation failed", errors) : null
}
const normalise = (d: ReturnType<typeof partyInput.parse>) => ({
  ...d,
  name: d.name.toUpperCase(), // legacy convention: party names in capitals (as printed on Mushak 6.3)
  bin: d.mode === "Non-registered" && d.bin && !d.bin.startsWith("NID ") ? `NID ${d.bin}` : d.bin,
  country: d.mode === "Foreign" ? d.country : undefined,
})

export function partyCollection(k: Kind) {
  const GET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (sp.get("view") !== "table") {
      // Picker options: active parties only
      const q = (sp.get("q") ?? "").toLowerCase()
      return json(coll(k).filter((p) => p.active !== false && (!q || `${p.name} ${p.bin}`.toLowerCase().includes(q))))
    }
    if (!sp.get("sort")) sp.set("sort", "name.asc")
    const r = runQuery(coll(k).map((p) => toRow(k, p)), sp, spec)
    if (sp.get("format") === "csv") {
      return csvResponse(
        toCSV(r.all, [
          { key: "name", label: "Name" }, { key: "mode", label: "Type" }, { key: "bin", label: k === "customer" ? "BIN / Ref" : "BIN / NID" },
          { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }, { key: "contactPerson", label: "Contact" }, { key: "address", label: "Address" },
          { key: "country", label: "Country" }, { key: "docs", label: k === "customer" ? "Invoices" : "Purchases" },
          { key: "turnover", label: "Turnover" }, { key: "due", label: k === "customer" ? "Receivable" : "Payable" },
          { key: "active", label: "Status", get: (p) => (p.active === false ? "Inactive" : "Active") },
        ]),
        `${k}s-${new Date().toISOString().slice(0, 10)}.csv`
      )
    }
    await delay()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    return json(page)
  })

  const POST = withAuth("master.edit", async (req, _ctx, user) => {
    const parsed = partyInput.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return zodProblem(parsed.error)
    const bad = check(k, parsed.data)
    if (bad) return bad
    const p: Party = { ...normalise(parsed.data), id: `${k[0]}${coll(k).length + db.trash.length + 1}-${Date.now().toString(36)}`, kind: k }
    coll(k).push(p)
    recordAudit({ actor: user, entity: k, entityId: p.id, ref: p.name, action: "created" })
    return json(p, { status: 201 })
  })
  return { GET, POST }
}

export function partyItem(k: Kind) {
  const GET = withAuth<Ctx>(null, async (_req, { params }) => {
    const { id } = await params
    const p = coll(k).find((x) => x.id === id)
    return p ? json(toRow(k, p)) : problem(404, `${label(k)} not found`)
  })

  const PUT = withAuth<Ctx>("master.edit", async (req, { params }, user) => {
    const { id } = await params
    const p = coll(k).find((x) => x.id === id)
    if (!p) return problem(404, `${label(k)} not found`)
    const parsed = partyInput.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return zodProblem(parsed.error)
    const bad = check(k, parsed.data, id)
    if (bad) return bad
    // A party with documents cannot change registration type (would change the VAT treatment of issued documents)
    if (parsed.data.mode !== p.mode && docsOf(k, id).length) return problem(422, "Validation failed", { mode: ["modeLocked"] })
    const before = { ...p }
    Object.assign(p, normalise(parsed.data))
    recordAudit({ actor: user, entity: k, entityId: p.id, ref: p.name, action: "edited", changes: diff(before, p, PARTY_FIELDS) })
    return json(p)
  })

  /** Only parties without documents can be deleted (moved to trash → undo). Others must be deactivated. */
  const DELETE = withAuth<Ctx>("master.edit", async (_req, { params }, user) => {
    const { id } = await params
    const arr = coll(k)
    const i = arr.findIndex((x) => x.id === id)
    if (i < 0) return problem(404, `${label(k)} not found`)
    const n = docsOf(k, id).length
    if (n) return problem(409, `in-use:${n}`)
    const [p] = arr.splice(i, 1)
    db.trash.push({ kind: k, doc: p, at: new Date().toISOString() })
    recordAudit({ actor: user, entity: k, entityId: p.id, ref: p.name, action: "deleted" })
    return json({ ok: true })
  })
  return { GET, PUT, DELETE }
}

export function partyRestore(k: Kind) {
  return withAuth<Ctx>("master.edit", async (_req, { params }, user) => {
    const { id } = await params
    const i = db.trash.findIndex((t) => t.kind === k && t.doc.id === id)
    if (i < 0) return problem(404, `${label(k)} not found in trash`)
    const [t] = db.trash.splice(i, 1)
    coll(k).push(t.doc as Party)
    recordAudit({ actor: user, entity: k, entityId: t.doc.id, ref: (t.doc as Party).name, action: "restored" })
    return json(t.doc)
  })
}
