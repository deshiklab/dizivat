/**
 * R6.5 — the duty-drawback claims (Customs, DEDO; claim form Mushak-22): the customs and regulatory duty the
 * drawback view worked out for the exports a claim takes to the Duty Exemption & Drawback Office, and the claim's
 * own journey — draft → filed (DEDO reference) → sanctioned (possibly less, with the reason) → paid, or rejected.
 *
 * As with every family before it, the rules are the mock's own (src/app/api/v1/_r65.ts, reused through the compat
 * bundle): which exports a claim may take (on the drawback view, inside the six-month window, not on an active
 * claim), the amounts frozen at creation, the DBK number, the state each action step needs and the bounds on its
 * date and amount, the register's rows and totals and its CSV columns. What changed is underneath:
 *   - a claim is a row in `drawback_claims`, its lines (the frozen exports with their duties) travelling with it
 *     as JSONB — a record of what was claimed, not figures anything has to add up;
 *   - a claim number is unique in the database as well (partial unique index over the live rows);
 *   - a deleted draft is stamped `deleted_at`, not removed — the register no longer lists it, its exports are
 *     claimable again, and its number stays retired the way the mock's ever-forward counter kept it;
 *   - every write goes through the state guard, and the in-memory copy stays in step: the bond register's
 *     "on a claim" state, the drawback view and the export register still read every claim through the mirror.
 */
import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common"
import { asc, eq, sql } from "drizzle-orm"
import type { ZodError } from "zod"
import type { Request, Response } from "express"
import { toCSV } from "@/lib/mock/query"
import { ACTION_FROM } from "@/lib/drawback"
import { bondRegister } from "@/lib/bond"
import { bondRows } from "@/lib/rmg"
import { TODAY } from "@/lib/company"
import { claimActionInput, claimInput } from "@/lib/schemas"
import { claimList, claimRow } from "@/lib/drawback"
import type { DrawbackClaim, DrawbackRow } from "@/lib/types"
import type { User } from "@/lib/auth/roles"
import type { ClaimWrite } from "@/app/api/v1/_r65"
import { can, ROLE_PERMS, type Permission } from "@/lib/auth/roles"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { lockState } from "../common/state-guard"
import { WriteBack } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { drawbackClaims } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type ClaimDb = typeof drawbackClaims.$inferSelect
/** The audit trail keeps the claim's number as its reference. */
const ENTITY = "drawbackClaim" as const
const LABEL = "Claim not found"

/* ── mappers ───────────────────────────────────────────────────────────── */

/** A row as the rules and the pages know the claim: optional fields absent, not null. */
export function toClaim(r: ClaimDb): DrawbackClaim {
  const c: DrawbackClaim = {
    id: r.id, no: r.no, status: r.status as DrawbackClaim["status"], method: "actual",
    lines: r.lines, cd: r.cd, rd: r.rd, claimed: r.claimed, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.filedOn) c.filedOn = r.filedOn
  if (r.dedoRef) c.dedoRef = r.dedoRef
  if (r.sanctionedOn) c.sanctionedOn = r.sanctionedOn
  if (r.sanctioned != null) c.sanctioned = r.sanctioned
  if (r.disallowedReason) c.disallowedReason = r.disallowedReason
  if (r.paidOn) c.paidOn = r.paidOn
  if (r.paid != null) c.paid = r.paid
  if (r.payRef) c.payRef = r.payRef
  if (r.rejectedOn) c.rejectedOn = r.rejectedOn
  if (r.rejectReason) c.rejectReason = r.rejectReason
  if (r.note) c.note = r.note
  if (r.updatedAt) c.updatedAt = r.updatedAt.toISOString()
  if (r.history) c.history = r.history
  return c
}

/** The claim as the columns hold it. */
export const claimValues = (c: DrawbackClaim) => ({
  id: c.id, no: c.no, status: c.status, method: c.method, lines: c.lines,
  cd: c.cd, rd: c.rd, claimed: c.claimed,
  filedOn: c.filedOn ?? null, dedoRef: c.dedoRef ?? null,
  sanctionedOn: c.sanctionedOn ?? null, sanctioned: c.sanctioned ?? null, disallowedReason: c.disallowedReason ?? null,
  paidOn: c.paidOn ?? null, paid: c.paid ?? null, payRef: c.payRef ?? null,
  rejectedOn: c.rejectedOn ?? null, rejectReason: c.rejectReason ?? null,
  note: c.note ?? null, createdBy: c.createdBy, createdAt: new Date(c.createdAt),
  updatedAt: c.updatedAt ? new Date(c.updatedAt) : null, history: c.history ?? null,
})

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class ClaimsService {
  /** Every live claim in insertion order — the register re-sorts by status and recency the way the mock did. */
  async allClaims(): Promise<DrawbackClaim[]> {
    return (await db.select().from(drawbackClaims).where(sql`${drawbackClaims.deletedAt} is null`).orderBy(asc(drawbackClaims.ord))).map(toClaim)
  }

  /** One claim by id or by number, the way the mock's routes found them. */
  async claimByIdOrNo(idOrNo: string): Promise<DrawbackClaim | undefined> {
    const rows = await db.select().from(drawbackClaims).where(sql`${drawbackClaims.deletedAt} is null and (${drawbackClaims.id} = ${idOrNo} or ${drawbackClaims.no} = ${idOrNo})`)
    return rows.length ? toClaim(rows[0]) : undefined
  }

  /**
   * Stores a new claim. `make` runs the rules inside the lock — which is where the number is claimed and the claim
   * pushed into the in-memory copy — so two creates in flight cannot take the same id or number.
   */
  async createClaim(make: () => ClaimWrite): Promise<ClaimWrite> {
    let made: DrawbackClaim | undefined
    try {
      const { saved, write } = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        made = w.claim
        const [row] = await tx.insert(drawbackClaims).values(claimValues(made)).returning()
        return { saved: toClaim(row), write: w }
      })
      mirror.putDrawbackClaim(saved)
      markClaims([saved])
      return { ...write, claim: saved }
    } catch (e) {
      if (made) { mirror.removeDrawbackClaim(made.id); forgetClaim(made.id) }
      if (uniqueViolation(e) !== null) throw new Problem(409, "That claim number was just taken — please try again.")
      throw e as Error
    }
  }

  /** Replaces a claim — one of the four action steps. */
  async updateClaim(c: DrawbackClaim, before: DrawbackClaim): Promise<DrawbackClaim> {
    try {
      const saved = await db.transaction(async (tx) => {
        await lockState(tx)
        const [row] = await tx.update(drawbackClaims).set(claimValues(c)).where(eq(drawbackClaims.id, c.id)).returning()
        if (!row) throw new Problem(404, LABEL)
        return toClaim(row)
      })
      mirror.putDrawbackClaim(saved)
      markClaims([saved])
      return saved
    } catch (e) {
      mirror.putDrawbackClaim(before) // the rules edit in place: a failed transaction leaves the old claim behind
      markClaims([before])
      throw e as Error
    }
  }

  /** Deletes a draft: the row is stamped, which is what keeps its number retired — the mock's counter never rewinds. */
  async removeClaim(c: DrawbackClaim): Promise<void> {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.update(drawbackClaims).set({ deletedAt: new Date() }).where(eq(drawbackClaims.id, c.id))
    })
    mirror.removeDrawbackClaim(c.id)
    forgetClaim(c.id)
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The claims are rows now, but the in-memory copy stays: the bond register's lot-to-claim links, the drawback
 * view's "on a claim" state and the export register read every claim through it, and a restored backup replaces
 * the whole in-memory world at once. A handler that writes through the mock's array is written back here. See
 * common/writeback.ts.
 */
const claimWb = new WriteBack<DrawbackClaim>("drawbackClaims", () => mirror.drawbackClaims(), (x) => x.id)
export const markClaims = (list: DrawbackClaim[]) => claimWb.mark(list)
export const forgetClaim = (id: string) => claimWb.forget(id)
export const claimDelta = () => claimWb.delta()
type ClaimDelta = ReturnType<typeof claimDelta>
export const commitClaimDelta = (d: ClaimDelta) => claimWb.commit(d)

/**
 * Applies the delta inside the persist transaction and reads the saved claim back into memory, so a value a column
 * type rounded is not rewritten on every request.
 *
 * A claim that left the in-memory list was dropped by a handler that still runs the mock's code (a deleted draft,
 * or a restored older backup): the row is stamped, which retires its number — and the write-back forgets it.
 */
export async function applyClaimDelta(tx: Tx, d: ClaimDelta) {
  for (const c of [...d.insert, ...d.update]) {
    const values = claimValues(c)
    const [row] = await tx.insert(drawbackClaims).values(values).onConflictDoUpdate({ target: drawbackClaims.id, set: values }).returning()
    mirror.putDrawbackClaim(toClaim(row))
    markClaims([c])
  }
  for (const id of d.missing) {
    const stored = claimWb.stored(id)
    if (stored) {
      await tx.update(drawbackClaims).set({ ...claimValues(stored), deletedAt: new Date() }).where(eq(drawbackClaims.id, id))
      mirror.removeDrawbackClaim(id)
      forgetClaim(id)
      continue
    }
    console.warn(`[claims] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/* ── what the rules read ───────────────────────────────────────────────── */

/**
 * The drawback view's rows — the same derivation the mock's `bondRegisterOf()` runs (src/app/api/v1/_r64.ts),
 * over the mirror's copy of the world: the go-live stock, the imports, the coefficients, the exports, the own-UD
 * settlements and the claims themselves, with the company's own bond licence leading the register.
 */
export function drawbackRows(): DrawbackRow[] {
  const p = mirror.vatSettings().profile
  const licence = bondRows({ name: mirror.company().name, licenceNo: p?.bondLicenseNo ?? "", expiry: p?.bondLicenseExpiry ?? "" }, [], TODAY)[0]
  const stock = (id: string) => {
    const i = mirror.findItem(id)
    return i ? i.opening + i.purchased + i.prodReceive - i.prodIssue - i.sold - i.damage : 0
  }
  return bondRegister(
    { purchases: mirror.purchases(), sales: mirror.sales(), boms: mirror.boms(), items: mirror.items(), openings: mirror.openings(), bondUds: mirror.bondUds(), drawbackClaims: mirror.drawbackClaims() },
    { today: TODAY, licence, stock },
  ).drawback.rows
}

/** What the claim rules are handed on a write: the view's rows and the claims themselves, from the in-memory copy
 *  the write belongs to. A read hands the rules the rows instead (see `claimReadSource`). */
const claimWriteSource = () => ({ rows: drawbackRows(), claims: mirror.drawbackClaims(), sales: mirror.sales() })
/** The same, with the claims read back from the table: what the register and one claim answer. */
const claimReadSource = (all: DrawbackClaim[]) => ({ rows: drawbackRows(), claims: all, sales: mirror.sales() })

/* ── controller ────────────────────────────────────────────────────────── */

/** The mock's deny(): 403 naming the permission the role lacks — for the second permission a route needs. */
const deny = (user: User, perm: Permission) => {
  if (!can(ROLE_PERMS[user.role], perm)) throw new Problem(403, `Your role (${user.role}) is not allowed to do this (${perm}).`)
}

/**
 * The drawback-claim endpoints. The behaviour is shared with the mock handlers (see the header); this class only
 * adds storage, the state guard and the audit trail. The action steps' permission and from-state are checked in
 * the order the mock's handler checked them — the body first, then the permission the action needs, then the
 * state it moves from — which the contract suite pins down.
 */
@Controller("api/v1/vat/drawback-claims")
export class DrawbackClaimsController {
  constructor(
    @Inject(ClaimsService) private readonly svc: ClaimsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The register: every claim with its frozen exports, the totals by state. `?status=` filters, `?format=csv`
   *  prints one row per export with the claim's own state beside it. */
  @Get() @Authed()
  async register(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    const all = await this.svc.allClaims()
    const list = claimList(all, TODAY, sp.get("status") || undefined, mirror.sales())
    if (sp.get("format") === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8")
      sendCsv(res, toCSV(compat().claimCsvRows(list), compat().claimCsvColumns), `drawback-claims-${TODAY}.csv`)
      return
    }
    res.json(list)
  }

  /** A draft claim over the open exports of the drawback view — the view's rows are frozen into its lines. */
  @Post() @Authed("doc.create")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = claimInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const w = await this.svc.createClaim(() => compat().claimCreate(parsed.data, user, TODAY, claimWriteSource()))
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    await this.audit.record({ at: w.at, actor: user, entity: ENTITY, entityId: w.claim.id, ref: w.ref, action: "created", ...(w.note ? { note: w.note } : {}) })
    res.status(201).json(w.row)
  }

  /** One claim — by id or by number, with its exports' proceeds. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const c = await this.svc.claimByIdOrNo(id)
    if (!c) throw new Problem(404, LABEL)
    res.json(claimRow(c, TODAY, mirror.sales()))
  }

  /** Remove a draft. Anything past draft is refused before the body is parsed, as the contract pins. */
  @Delete(":id") @Authed("doc.delete")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.claimByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status !== "draft") throw new Problem(409, `Only a draft claim can be deleted — ${cur.no} is ${cur.status}.`)
    await this.svc.removeClaim(cur)
    await this.audit.record({ actor: req.dz!.user, entity: ENTITY, entityId: cur.id, ref: cur.no, action: "deleted" })
    res.json({ ok: true, id: cur.id })
  }

  /**
   * One action step — file / sanction / pay / reject. file is the applicant's own step; the other three are the
   * office's, checked once the body says which step it is. The from-state is refused before the rules run.
   */
  @Post(":id/action") @Authed("doc.create") @HttpCode(200)
  async action(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.claimByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    const parsed = claimActionInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const d = parsed.data
    const user = req.dz!.user
    if (compat().CLAIM_ACTION_PERM[d.action] === "doc.approve") deny(user, "doc.approve")
    if (!ACTION_FROM[d.action].includes(cur.status)) throw new Problem(409, `Cannot ${d.action} a ${cur.status} claim (${cur.no}).`)
    const before = structuredClone(cur)
    const w = compat().claimAct(cur, d, user, TODAY, claimReadSource(await this.svc.allClaims()))
    if ("status" in w) throw new Problem(w.status, w.title, w.errors)
    const saved = await this.svc.updateClaim(w.claim, before)
    await this.audit.record({ at: w.at, actor: user, entity: ENTITY, entityId: saved.id, ref: w.ref, action: w.action, ...(w.note ? { note: w.note } : {}) })
    res.json(claimRow(saved, TODAY, mirror.sales()))
  }
}
