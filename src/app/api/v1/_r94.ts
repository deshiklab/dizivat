/**
 * R9.4 — the fixed assets: the register (each asset a document with the usual draft → approve → cancel
 * lifecycle), the schedule (the depreciation walk a user can point at — see `lib/assets.ts`), the two
 * final actions a live asset can take (sell it, or re-value it), and the classes the NBR Third Schedule
 * defines the rates by.
 *
 * Nothing here stores a posting: the acquisition, the monthly depreciation, the revaluation reserve and
 * the disposal gain/loss all fold from these rows at read time by `lib/gl.ts`'s rules. A draft asset
 * posts nothing. A cancelled asset stays out of the fold. A disposal is final — no undo.
 */
import { closed, lifecycle, nextNo } from "./_r4"
import { invalidRule, json, problem, ruleResponse, withAuth, zodErrors, type RuleProblem } from "./_lib"
import { assetActionInput, assetClassInput, assetInput } from "@/lib/schemas"
import { csvResponse, runQuery, toCSV, type QuerySpec } from "@/lib/mock/query"
import { db } from "@/lib/mock/db"
import { diff, recordAudit } from "@/lib/mock/audit"
import { TODAY } from "@/lib/company"
import { assetRegisterRows, monthOf, scheduleOf } from "@/lib/assets"
import { round2 } from "@/lib/vat"
import type { AssetClass, AssetRegisterRow, FixedAsset } from "@/lib/types"
import type { GlSource } from "@/lib/gl"

/* ── the assets (documents) ────────────────────────────────────────────── */

export type AssetFields = Omit<FixedAsset, "id" | "no" | "createdAt" | "history" | "disposal" | "revaluations">

/** What an asset body may hold, checked against the classes and the books' cut-off. */
export function buildAsset(body: unknown, self: FixedAsset | undefined, src: GlSource): RuleProblem | { process: "Created" | "Approved"; date: string; fields: AssetFields } {
  const parsed = assetInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const t = parsed.data
  const cls = src.assetClasses.find((c) => c.id === t.classId)
  if (!cls) return invalidRule({ classId: ["unknownClass"] })
  if (!cls.active) return invalidRule({ classId: ["inactiveClass"] })
  if (t.salvage >= t.cost) return invalidRule({ salvage: ["belowCost"] })
  if (t.purchaseId && !src.purchases.some((p) => p.id === t.purchaseId && p.process === "Approved"))
    return invalidRule({ purchaseId: ["unknownPurchase"] })
  if (closed(t.date, src)) return invalidRule({ date: ["dateClosed"] })
  if (t.date > TODAY) return invalidRule({ date: ["future"] })
  return {
    process: t.process, date: t.date,
    fields: {
      name: t.name, classId: t.classId, date: t.date, cost: round2(t.cost), salvage: round2(t.salvage),
      inputVat: round2(t.inputVat), creditable: t.creditable, process: t.process, issuedBy: self?.issuedBy ?? "",
      ...(t.branchId ? { branchId: t.branchId } : {}), ...(t.purchaseId ? { purchaseId: t.purchaseId } : {}), ...(t.memo ? { memo: t.memo } : {}),
    },
  }
}

/** Approving: the books must not be closed for the commissioning month. */
export function assetApproveRule(d: FixedAsset, src: GlSource = db): RuleProblem | undefined {
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be approved.` }
    : undefined
}

/** Cancelling: the same cut-off — and a disposed asset stays, as history. */
export function assetCancelRule(d: FixedAsset, src: GlSource = db): RuleProblem | undefined {
  if (d.disposal) return { status: 409, title: `${d.no} was disposed of on ${d.disposal.date} — it stays in the register as history.` }
  return closed(d.date, src)
    ? { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — ${d.no} cannot be cancelled.` }
    : undefined
}

/** A new asset's identity: the next id of its series and the next AS-MMYY####. */
export const assetIdentity = (date: string) => ({
  id: `fa${db.seq.asset + 1}`,
  no: nextNo("AS", "asset", db.assets, date),
})
export const claimAssetId = () => { db.seq.asset += 1 }

export const ASSET_DIFF_FIELDS = ["name", "classId", "date", "cost", "salvage", "branchId", "purchaseId", "inputVat", "creditable", "memo"] as const

export const ASSET_CSV_COLUMNS = [
  { key: "date", label: "Commissioned" }, { key: "no", label: "Asset" }, { key: "name", label: "Name" },
  { key: "className", label: "Class" }, { key: "rate", label: "Rate %/yr" }, { key: "cost", label: "Cost" },
  { key: "accumDep", label: "Accum. dep." }, { key: "nbv", label: "Net book value" }, { key: "monthly", label: "Monthly dep." },
  { key: "status", label: "Status" }, { key: "inputVat", label: "Input VAT" }, { key: "creditable", label: "Creditable" },
  { key: "disposalDate", label: "Disposed on" }, { key: "disposalProceeds", label: "Proceeds" }, { key: "gainLoss", label: "Gain / (loss)" },
  { key: "process", label: "Process" },
]

export const assetSpec: QuerySpec<AssetRegisterRow> = {
  search: (r) => `${r.no} ${r.name} ${r.className}`,
  dateField: "date",
  facets: { status: (r) => r.status, class: (r) => r.className, process: (r) => r.process },
  totals: ["cost", "accumDep", "nbv"],
}

/** The register rows — the read model the list serves (cost, the derived depreciation, the net book value). */
export const assetRows = (): AssetRegisterRow[] => assetRegisterRows(db.assets, db.assetClasses, TODAY)

/** The assets' mock endpoints: the `lifecycle` factory for the document routes, the register for the list. */
export function assetRoutes() {
  const build = (body: unknown, self?: FixedAsset) => {
    const r = buildAsset(body, self, db)
    return "status" in r ? { error: ruleResponse(r) } : r
  }
  const routes = lifecycle<FixedAsset, AssetFields>({
    entity: "asset", label: "Asset", list: () => db.assets, idPrefix: "fa", seq: "asset", noPrefix: "AS",
    build,
    approve: (d: FixedAsset) => {
      const rule = assetApproveRule(d)
      return rule ? ruleResponse(rule) : null
    },
    cancel: (d: FixedAsset) => {
      const rule = assetCancelRule(d)
      return rule ? ruleResponse(rule) : null
    },
    diffFields: [...ASSET_DIFF_FIELDS],
    spec: { search: (a) => `${a.no} ${a.name}`, dateField: "date" },
    csv: ASSET_CSV_COLUMNS as unknown as { key: string; label: string }[],
    csvName: "asset-register",
  })
  const registerGET = withAuth(null, async (req) => {
    const sp = new URL(req.url).searchParams
    if (!sp.get("sort")) sp.set("sort", "date.desc")
    // ?asOf= pins the walk's end month (the reports' own convention) — the drill and the sheet use it
    const asOf = sp.get("asOf") || TODAY
    const r = runQuery(assetRegisterRows(db.assets, db.assetClasses, asOf), sp, assetSpec)
    if (sp.get("format") === "csv") return csvResponse(toCSV(r.all, ASSET_CSV_COLUMNS), `asset-register-${TODAY}.csv`)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...pg } = r
    return json({ ...pg, facetLabels: {} })
  })
  return { ...routes, list: { GET: registerGET, POST: routes.list.POST } }
}

/* ── the schedule (one asset's depreciation walk) ───────────────────────── */

/** One asset's schedule — month by month from commissioning to today (or `?to`, if earlier). */
export const assetScheduleRoute = withAuth<{ params: Promise<{ id: string }> }>(null, async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const a = db.assets.find((x) => x.id === id || x.no === id)
  if (!a) return problem(404, "Asset not found")
  const to = new URL(req.url).searchParams.get("to")
  const cls = db.assetClasses.find((c) => c.id === a.classId)
  return json(scheduleOf(a, cls, to && to < TODAY ? to : TODAY))
})

/* ── the actions (dispose / revalue — final, no undo) ───────────────────── */

/** What an action may do: an approved, undisposed asset; a real date; open books; and the fields it needs. */
export function assetActionRule(asset: FixedAsset | undefined, body: unknown, src: GlSource):
  RuleProblem | { action: "dispose" | "revalue"; date: string; proceeds?: number; accountId?: string; toValue?: number; reason: string } {
  if (!asset) return { status: 404, title: "Asset not found" }
  const parsed = assetActionInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const a = parsed.data
  if (asset.process !== "Approved") return { status: 409, title: `${asset.no} is still a draft — approve it before acting on it.` }
  if (a.date < asset.date) return invalidRule({ date: ["beforeCommissioned"] })
  if (a.date > TODAY) return invalidRule({ date: ["future"] })
  if (closed(a.date, src)) return { status: 409, title: `The books are closed up to ${src.accountingConfig.closedUpTo} — the ${a.action === "dispose" ? "disposal" : "revaluation"} cannot be dated inside a closed month.` }
  if (a.action === "dispose") {
    if (asset.disposal) return { status: 409, title: `${asset.no} was already disposed of on ${asset.disposal.date}.` }
    if (a.proceeds === undefined) return invalidRule({ proceeds: ["required"] })
    if (a.accountId && !src.moneyAccounts.some((m) => m.id === a.accountId)) return invalidRule({ accountId: ["unknownAccount"] })
    return { action: "dispose", date: a.date, proceeds: round2(a.proceeds), accountId: a.accountId, reason: a.reason }
  }
  if (asset.disposal) return { status: 409, title: `${asset.no} was disposed of on ${asset.disposal.date} — its value no longer moves.` }
  if ((asset.revaluations ?? []).some((r) => monthOf(r.date) === monthOf(a.date)))
    return { status: 409, title: `${asset.no} was already revalued in ${monthOf(a.date)} — one revaluation a month.` }
  if (a.toValue === undefined) return invalidRule({ toValue: ["required"] })
  return { action: "revalue", date: a.date, toValue: round2(a.toValue), reason: a.reason }
}

/** The action route: dispose or revalue one asset — one append to the record, audited, no undo. */
export const assetActionRoute = withAuth<{ params: Promise<{ id: string }> }>("doc.edit", async (req, { params }, user) => {
  const { id } = await params
  const asset = db.assets.find((x) => x.id === id || x.no === id)
  const r = assetActionRule(asset, await req.json().catch(() => ({})), db)
  if ("status" in r) return problem(r.status, r.title, r.errors)
  const at = new Date().toISOString()
  const a = asset!
  if (r.action === "dispose") {
    a.disposal = { date: r.date, proceeds: r.proceeds!, ...(r.accountId ? { accountId: r.accountId } : {}), reason: r.reason, at, by: user.name }
    a.history = [...a.history, { at, by: user.name, action: "edited" as const, note: `Sold for ${r.proceeds!} — ${r.reason}` }]
  } else {
    a.revaluations = [...(a.revaluations ?? []), { date: r.date, toValue: r.toValue!, reason: r.reason, at, by: user.name }]
    a.history = [...a.history, { at, by: user.name, action: "edited" as const, note: `Revalued to ${r.toValue!} — ${r.reason}` }]
  }
  recordAudit({ at, actor: user.name, entity: "asset", entityId: a.id, ref: a.no, action: r.action, note: r.reason })
  return json(a, { status: 201 })
})

/* ── the classes (settings-managed; the rates the schedules run on) ─────── */

/** What a class body may hold: a fresh name, a rate inside the schedule's bounds. */
export function buildAssetClass(body: unknown, self: AssetClass | undefined): RuleProblem | { fields: { name: string; rate: number; note?: string; active: boolean } } {
  const parsed = assetClassInput.safeParse(body)
  if (!parsed.success) return invalidRule(zodErrors(parsed.error))
  const t = parsed.data
  const clash = db.assetClasses.find((c) => c.id !== self?.id && c.name.toLowerCase() === t.name.toLowerCase())
  if (clash) return { status: 409, title: `A class named “${clash.name}” already exists.` }
  return { fields: { name: t.name, rate: t.rate, ...(t.note ? { note: t.note } : {}), active: t.active } }
}

/** The next class id: acl{n} past the highest the register holds. */
export const nextClassId = () => `acl${Math.max(0, ...db.assetClasses.map((c) => Number(c.id.replace(/^acl/, "")) || 0)) + 1}`

export const assetClassRoutes = {
  list: {
    GET: withAuth(null, async () => json(db.assetClasses)),
    POST: withAuth("settings.manage", async (req, _ctx, user) => {
      const r = buildAssetClass(await req.json().catch(() => ({})), undefined)
      if ("status" in r) return ruleResponse(r)
      const c: AssetClass = { id: nextClassId(), ...r.fields }
      db.assetClasses.push(c)
      recordAudit({ actor: user.name, entity: "assetClass", entityId: c.id, ref: c.name, action: "created" })
      return json(c, { status: 201 })
    }),
  },
  doc: {
    PUT: withAuth<{ params: Promise<{ id: string }> }>("settings.manage", async (req, { params }, user) => {
      const { id } = await params
      const c = db.assetClasses.find((x) => x.id === id)
      if (!c) return problem(404, "Asset class not found")
      const r = buildAssetClass(await req.json().catch(() => ({})), c)
      if ("status" in r) return ruleResponse(r)
      const before = { name: c.name, rate: c.rate, active: c.active }
      Object.assign(c, r.fields)
      recordAudit({ actor: user.name, entity: "assetClass", entityId: c.id, ref: c.name, action: "edited", note: `rate ${before.rate}% → ${c.rate}%`, changes: diff(before, { name: c.name, rate: c.rate, active: c.active }, ["name", "rate", "active"]) })
      return json(c)
    }),
  },
}
