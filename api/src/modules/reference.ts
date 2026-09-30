/** Company profile + branches, units of measure and the NBR tariff — PostgreSQL-backed reference data. */
import { Controller, Delete, Get, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { asc, eq, sql } from "drizzle-orm"
import type { Request, Response } from "express"
import type { User } from "@/lib/auth/roles"
import { runQuery, toCSV } from "@/lib/mock/query"
import { companyInput, unitInput } from "@/lib/schemas"
import type { Branch, Company, TariffLine, Unit, UnitRow } from "@/lib/types"
import { Authed, CurrentUser, type AuthedRequest } from "../common/auth"
import { jsonBody, parse, Problem, searchParams, sendCsv } from "../common/http"
import { sqlList } from "../common/list"
import { db, type Tx } from "../db/client"
import { branches, company, meta, units } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

/* ── company ─────────────────────────────────────────────────────────── */

export async function loadCompany(q: Pick<Tx, "select"> = db): Promise<Company> {
  const [c] = await q.select().from(company).where(eq(company.id, 1))
  const bs = await q.select().from(branches).orderBy(asc(branches.position))
  const out: Company = {
    name: c.name, vatSlab: c.vatSlab as Company["vatSlab"], bin: c.bin, tin: c.tin, mobile: c.mobile, email: c.email, address: c.address,
    owner: c.owner, signatory: c.signatory,
    branches: bs.map((b) => {
      const x: Branch = { id: b.id, name: b.name, address: b.address, category: b.category as Branch["category"] }
      if (b.code) x.code = b.code
      return x
    }),
  }
  if (c.phone) out.phone = c.phone
  if (c.updatedAt) out.updatedAt = c.updatedAt.toISOString()
  if (c.updatedBy) out.updatedBy = c.updatedBy
  return out
}

export async function saveCompany(tx: Tx, c: Company) {
  const row = {
    name: c.name, vatSlab: c.vatSlab, bin: c.bin, tin: c.tin, mobile: c.mobile, phone: c.phone ?? null, email: c.email, address: c.address,
    owner: c.owner, signatory: c.signatory, updatedAt: c.updatedAt ? new Date(c.updatedAt) : null, updatedBy: c.updatedBy ?? null,
  }
  await tx.insert(company).values({ id: 1, ...row }).onConflictDoUpdate({ target: company.id, set: row })
  await tx.delete(branches)
  if (c.branches.length) await tx.insert(branches).values(c.branches.map((b, i) => ({ id: b.id, position: i, code: b.code ?? null, name: b.name, address: b.address, category: b.category })))
}

const COMPANY_FIELDS = [
  "name", "vatSlab", "bin", "tin", "mobile", "phone", "email", "address",
  "owner.name", "owner.nid", "owner.mobile", "owner.designation",
  "signatory.name", "signatory.designation", "signatory.mobile", "signatory.email", "signatory.nid",
]

@Controller("api/v1/company")
export class CompanyController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** Everyone signed in can read it (it prints on every Mushak form). */
  @Get() @Authed()
  get() { return mirror.company() }

  @Put() @Authed("settings.manage")
  async put(@Req() req: AuthedRequest, @CurrentUser() user: User) {
    const d = parse(companyInput, jsonBody(req))
    const before = await loadCompany()
    // Branches holding documents / stock keep existing and keep a stock-holding category
    const used = compat().usedBranchIds()
    const removed = before.branches.filter((b) => used.has(b.id) && !d.branches.some((x) => x.id === b.id))
    if (removed.length) throw new Problem(409, `${removed.map((b) => b.name).join(", ")} has documents and stock history — it cannot be removed.`)
    const toOffice: Record<string, string[]> = {}
    d.branches.forEach((b, i) => { if (b.id && used.has(b.id) && b.category === "office") toOffice[`branches.${i}.category`] = ["branchInUse"] })
    if (Object.keys(toOffice).length) throw new Problem(422, "Validation failed", toOffice)
    const next: Company = {
      ...before, ...d,
      branches: d.branches.map((b, i) => ({ ...b, id: b.id || `b${Date.now().toString(36)}${i}`, code: b.code || undefined })) as Branch[],
      phone: d.phone || undefined, updatedAt: new Date().toISOString(), updatedBy: user.name,
    }
    await db.transaction((tx) => saveCompany(tx, next))
    const after = await loadCompany()
    mirror.putCompany(after)
    const changes = compat().diff(before, after, COMPANY_FIELDS)
    const names = (c: Company) => c.branches.map((b) => `${b.name}${b.code ? ` (${b.code})` : ""}`).join("; ")
    if (names(before) !== names(after) || JSON.stringify(before.branches.map((b) => b.address)) !== JSON.stringify(after.branches.map((b) => b.address)))
      changes.push({ field: "branches", from: names(before), to: names(after) })
    if (changes.length) await this.audit.record({ actor: user, entity: "company", ref: after.name, action: "updated", changes })
    return mirror.company()
  }
}

/* ── units ───────────────────────────────────────────────────────────── */

type UnitDb = typeof units.$inferSelect
const toUnit = (r: UnitDb): Unit => ({ id: r.id, code: r.code, name: r.name, decimals: r.decimals, active: r.active, createdAt: r.createdAt.toISOString() })
const unitRow = (u: Unit): UnitRow => ({ ...u, inUse: compat().unitUsage(u.code) })
const unitRef = (u: Unit) => `${u.code} · ${u.name}`

@Injectable()
export class UnitsService {
  async all() { return (await db.select().from(units).orderBy(asc(units.ord))).map(toUnit) }
  /** Items validate their unit against the in-memory list — keep it in step with the table. */
  async sync() { mirror.putUnits(await this.all()) }
}

@Controller("api/v1/units")
export class UnitsController {
  constructor(@Inject(AuditService) private readonly audit: AuditService, @Inject(UnitsService) private readonly svc: UnitsService) {}

  /** `?active=1` → active units only (pickers). Small table: the shared list engine runs on the rows. */
  @Get() @Authed()
  async list(@Req() req: Request) {
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "code.asc")
    if (!sp.get("size")) sp.set("size", "100")
    const rows = (await this.svc.all()).map(unitRow).filter((u) => sp.get("active") !== "1" || u.active)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = runQuery(rows, sp, { search: (u: UnitRow) => `${u.code} ${u.name}`, facets: { status: (u: UnitRow) => (u.active ? "active" : "inactive") } })
    return page
  }

  @Post() @Authed("master.edit")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const d = parse(unitInput, jsonBody(req))
    const [dupe] = await db.select({ id: units.id }).from(units).where(sql`lower(${units.code}) = lower(${d.code})`)
    if (dupe) throw new Problem(422, "Validation failed", { code: ["duplicate"] })
    const [row] = await db.insert(units).values({ id: sql`'un' || nextval('unit_id_seq')`, code: d.code, name: d.name, decimals: d.decimals, active: d.active }).returning()
    await this.svc.sync()
    const u = toUnit(row)
    await this.audit.record({ actor: req.dz!.user, entity: "unit", entityId: u.id, ref: unitRef(u), action: "created" })
    res.status(201).json(unitRow(u))
  }

  @Get(":id") @Authed()
  async get(@Param("id") id: string) {
    const [r] = await db.select().from(units).where(eq(units.id, id))
    if (!r) throw new Problem(404, "Unit not found")
    return unitRow(toUnit(r))
  }

  @Put(":id") @Authed("master.edit")
  async update(@Param("id") id: string, @Req() req: AuthedRequest) {
    const [r] = await db.select().from(units).where(eq(units.id, id))
    if (!r) throw new Problem(404, "Unit not found")
    const before = toUnit(r)
    const d = parse(unitInput, jsonBody(req))
    if (d.code !== before.code) {
      if (compat().unitUsage(before.code)) throw new Problem(422, "Validation failed", { code: ["unitInUse"] })
      const [dupe] = await db.select({ id: units.id }).from(units).where(sql`lower(${units.code}) = lower(${d.code}) and ${units.id} <> ${id}`)
      if (dupe) throw new Problem(422, "Validation failed", { code: ["duplicate"] })
    }
    const [row] = await db.update(units).set({ code: d.code, name: d.name, decimals: d.decimals, active: d.active }).where(eq(units.id, id)).returning()
    await this.svc.sync()
    const u = toUnit(row)
    const changes = compat().diff(before, u, ["code", "name", "decimals", "active"])
    if (changes.length) await this.audit.record({ actor: req.dz!.user, entity: "unit", entityId: u.id, ref: unitRef(u), action: before.active !== u.active ? (u.active ? "activated" : "deactivated") : "edited", changes })
    return unitRow(u)
  }

  /** Only units no item uses can be deleted (deactivate the others). */
  @Delete(":id") @Authed("master.edit")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest) {
    const [r] = await db.select().from(units).where(eq(units.id, id))
    if (!r) throw new Problem(404, "Unit not found")
    const n = compat().unitUsage(r.code)
    if (n) throw new Problem(409, `${r.code} is used by ${n} item${n === 1 ? "" : "s"} — deactivate it instead.`)
    await db.delete(units).where(eq(units.id, id))
    await this.svc.sync()
    await this.audit.record({ actor: req.dz!.user, entity: "unit", entityId: r.id, ref: unitRef(toUnit(r)), action: "deleted" })
    return { ok: true }
  }
}

/* ── tariff ──────────────────────────────────────────────────────────── */

type RawTariff = { hs_code: string; description: string; chapter: string; cd: string; sd: string; vat: string; ait: string; rd: string; at: string; tti: string }
const toTariff = (r: RawTariff): TariffLine => ({
  hsCode: r.hs_code, description: r.description, cd: Number(r.cd), sd: Number(r.sd), vat: Number(r.vat), ait: Number(r.ait),
  rd: Number(r.rd), at: Number(r.at), tti: Number(r.tti), chapter: r.chapter,
})
export const tariffFy = async () => (await db.select().from(meta).where(eq(meta.key, "tariff_fy")))[0]?.value ?? compat().TARIFF_FY

@Controller("api/v1/tariff")
export class TariffController {
  /** ?hs=12345678 → one line (404 if unknown); list with facets vat / chapter / sd; ?format=csv. */
  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    const fy = await tariffFy()
    const hs = sp.get("hs")
    if (hs) {
      const r = await db.execute<RawTariff>(sql`select * from tariff_lines where fy = ${fy} and hs_code = ${hs.replace(/\D/g, "")}`)
      if (!r.rows[0]) throw new Problem(404, `HS code ${hs} is not in the tariff (FY ${fy}).`)
      return res.json(toTariff(r.rows[0]))
    }
    if (!sp.get("sort")) sp.set("sort", "hsCode.asc")
    const csv = sp.get("format") === "csv"
    const num = (c: string) => ({ expr: sql.raw(c) })
    const r = await sqlList<RawTariff, TariffLine>(sp, {
      from: sql`tariff_lines`,
      where: [sql`fy = ${fy}`],
      search: sql`concat_ws(' ', hs_code, substr(hs_code, 1, 4) || '.' || substr(hs_code, 5, 2) || '.' || substr(hs_code, 7), description)`,
      facets: { vat: sql`trim_scale(vat)::text`, chapter: sql`chapter`, sd: sql`case when sd > 0 then 'yes' else 'no' end` },
      sortable: {
        hsCode: { expr: sql`hs_code`, text: true }, description: { expr: sql`description`, text: true }, chapter: { expr: sql`chapter`, text: true },
        cd: num("cd"), sd: num("sd"), vat: num("vat"), ait: num("ait"), rd: num("rd"), at: num("at"), tti: num("tti"),
      },
      order: sql`hs_code`,
    }, toTariff, { all: csv })
    if (csv) {
      return sendCsv(res, toCSV(r.data, [
        { key: "hsCode", label: "HS code" }, { key: "description", label: "Description" },
        ...(["cd", "sd", "vat", "ait", "rd", "at", "tti"] as const).map((k) => ({ key: k, label: k.toUpperCase() })),
      ]), `tariff-${fy}.csv`)
    }
    res.json({ ...r, fy })
  }
}

