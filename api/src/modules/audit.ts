/**
 * Audit trail — append-only table. Native modules record through AuditService; events the compat handlers push
 * into the in-memory store are forwarded here after each compat request (same lock), so one trail covers both.
 */
import { createHash } from "node:crypto"
import { Controller, Get, Injectable, Module, Req, Res } from "@nestjs/common"
import { sql } from "drizzle-orm"
import type { Request, Response } from "express"
import type { User } from "@/lib/auth/roles"
import { toCSV } from "@/lib/mock/query"
import { GENESIS_HASH, linkHash, verifyChain, type ChainFields, type ChainReport } from "@/lib/integrity"
import type { AuditAction, AuditChange, AuditEntity, AuditEvent } from "@/lib/types"
import { Authed } from "../common/auth"
import { searchParams, sendCsv, toIso } from "../common/http"
import { sqlList } from "../common/list"
import { withStateLock } from "../common/lock"
import { lockState } from "../common/state-guard"
import { db, type Tx } from "../db/client"
import { auditEvents } from "../db/schema"
import { mirror } from "../state"

export interface AuditInput { actor: User | string; entity: AuditEntity; entityId?: string; ref: string; action: AuditAction; changes?: AuditChange[]; note?: string; at?: string }

/** Asia/Dhaka calendar day (UTC+6, no DST). */
export const dhakaDay = (iso: string) => new Date(new Date(iso).getTime() + 6 * 36e5).toISOString().slice(0, 10)

type Raw = { id: number; at: Date | string; day: string; actor: string; actor_id: string | null; entity: string; entity_id: string | null; ref: string; action: string; changes: AuditChange[] | null; note: string | null }
export const rawToEvent = (r: Raw): AuditEvent => {
  const e: AuditEvent = { id: `a${r.id}`, at: toIso(r.at), day: r.day, actor: r.actor, entity: r.entity as AuditEntity, ref: r.ref, action: r.action as AuditAction }
  if (r.actor_id) e.actorId = r.actor_id
  if (r.entity_id) e.entityId = r.entity_id
  if (r.changes?.length) e.changes = r.changes
  if (r.note) e.note = r.note
  // key order as the mock builds it
  return { id: e.id, at: e.at, day: e.day, actor: e.actor, actorId: e.actorId, entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.action, changes: e.changes, note: e.note }
}

/* ── R6: tamper-evident chain ─────────────────────────────────────────── */

/** node:crypto SHA-256 — same digest as the portable implementation in src/lib/integrity.ts, only faster. */
export const nodeSha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
type Exec = Pick<Tx, "execute">
/** Hash of the newest sealed row (GENESIS when the table is empty). Call inside the state lock. */
export async function headHash(ex: Exec): Promise<string> {
  const r = await ex.execute(sql`select hash from audit_events where hash is not null order by id desc limit 1`)
  return (r.rows[0] as { hash?: string } | undefined)?.hash ?? GENESIS_HASH
}
/** Adds prev_hash/hash to rows about to be inserted, in order, continuing from `prev`. Returns the new head. */
export function chainValues<T extends ChainFields>(rows: T[], prev: string): { rows: (T & { prevHash: string; hash: string })[]; head: string } {
  const out = rows.map((r) => { const hash = linkHash(prev, r, nodeSha256); const row = { ...r, prevHash: prev, hash }; prev = hash; return row })
  return { rows: out, head: prev }
}

type SealRaw = { id: string | number; at: Date | string; actor: string; actor_id: string | null; entity: string; entity_id: string | null; ref: string; action: string; changes: AuditChange[] | null; note: string | null; prev_hash: string | null; hash: string | null }
const sealFields = (r: SealRaw): ChainFields => ({ at: toIso(r.at), actor: r.actor, actorId: r.actor_id, entity: r.entity, entityId: r.entity_id, ref: r.ref, action: r.action, changes: r.changes, note: r.note })

/**
 * Boot: seals rows written before the chain existed (upgrade from R5.1), oldest first, continuing from the last
 * sealed row. The append-only trigger allows exactly this one-time NULL → hash update.
 */
export async function sealUnchained(log: (m: string) => void) {
  await withStateLock(() => db.transaction(async (tx) => {
    await lockState(tx, { checkEpoch: false })
    const raw = await tx.execute(sql`select * from audit_events where hash is null order by id`)
    const rows = raw.rows as SealRaw[]
    if (!rows.length) return
    const before = await tx.execute(sql`select hash from audit_events where hash is not null and id < ${rows[0].id} order by id desc limit 1`)
    let prev = (before.rows[0] as { hash?: string } | undefined)?.hash ?? GENESIS_HASH
    for (let i = 0; i < rows.length; i += 400) {
      const vals = rows.slice(i, i + 400).map((r) => { const h = linkHash(prev, sealFields(r), nodeSha256); const v = sql`(${String(r.id)}::bigint, ${prev}, ${h})`; prev = h; return v })
      await tx.execute(sql`update audit_events as a set prev_hash = v.p, hash = v.h from (values ${sql.join(vals, sql`, `)}) as v(id, p, h) where a.id = v.id`)
    }
    log(`audit chain: sealed ${rows.length} earlier events`)
  }))
}

/** Verifies the whole chain in id order. */
export async function verifyAuditChain(): Promise<ChainReport> {
  const raw = await db.execute(sql`select * from audit_events order by id`)
  return verifyChain((raw.rows as SealRaw[]).map((r) => ({ id: `a${r.id}`, ...sealFields(r), prevHash: r.prev_hash, hash: r.hash })), nodeSha256)
}

const persisted = new WeakSet<AuditEvent>()
export const markPersisted = (events: AuditEvent[]) => events.forEach((e) => persisted.add(e))

const values = (e: Omit<AuditEvent, "id">) => ({
  at: new Date(e.at), day: e.day, actor: e.actor, actorId: e.actorId ?? null, entity: e.entity, entityId: e.entityId ?? null,
  ref: e.ref, action: e.action, changes: e.changes?.length ? e.changes : null, note: e.note ?? null,
})

@Injectable()
export class AuditService {
  record(e: AuditInput): Promise<AuditEvent> {
    return withStateLock(async () => {
      const at = e.at ?? new Date().toISOString()
      const actor = typeof e.actor === "string" ? e.actor : e.actor.name
      const actorId = typeof e.actor === "string" ? mirror.findUserByName(e.actor)?.id : e.actor.id
      const base = { at, day: dhakaDay(at), actor, actorId, entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.action, changes: e.changes?.length ? e.changes : undefined, note: e.note }
      const [row] = await db.transaction(async (tx) => {
        await lockState(tx)
        const { rows } = chainValues([values(base)], await headHash(tx))
        return tx.insert(auditEvents).values(rows).returning({ id: auditEvents.id })
      })
      const ev: AuditEvent = { id: `a${row.id}`, ...base }
      const store = mirror.audit()
      store.events.push(ev)
      store.seq = Math.max(store.seq, row.id)
      persisted.add(ev)
      return ev
    })
  }

  /**
   * R6.2: a VAT officer's request to a native endpoint → entity "access", action "viewed" — at most once a minute per
   * path (same rule and the same dedupe map as the mock's logOfficerAccess, so compat requests are not logged twice).
   */
  officerAccess(user: User, req: Request) {
    const url = new URL(req.originalUrl, "http://x")
    const path = url.pathname.replace(/^.*\/api\/v1/, "") || "/"
    const seen = ((globalThis as unknown as { __dzAccess?: Map<string, number> }).__dzAccess ??= new Map())
    const key = `${user.id}|${req.method}|${path}`, now = Date.now()
    if ((seen.get(key) ?? 0) > now - 60_000) return
    seen.set(key, now)
    void this.record({ actor: user, entity: "access", entityId: user.id, ref: path, action: "viewed", note: [req.method !== "GET" ? req.method : "", url.search.slice(1, 200)].filter(Boolean).join(" ") || undefined })
      .catch((e) => console.error("[access log]", e))
  }

  /** Cheap check from the end (events are only ever appended). */
  hasPending() {
    const ev = mirror.audit().events
    for (let i = ev.length - 1; i >= 0 && i >= ev.length - 50; i--) if (!persisted.has(ev[i])) return true
    return false
  }

  /** Inside the state lock and a transaction that began with lockState(): saves events the compat handlers appended, fixing their ids to the table's. */
  async forwardPending(tx: Tx) {
    const store = mirror.audit()
    let prev: string | undefined
    for (const ev of store.events) {
      if (persisted.has(ev)) continue
      prev ??= await headHash(tx)
      const { rows, head } = chainValues([values(ev)], prev)
      prev = head
      const [row] = await tx.insert(auditEvents).values(rows).returning({ id: auditEvents.id })
      ev.id = `a${row.id}`
      store.seq = Math.max(store.seq, row.id)
      persisted.add(ev)
    }
  }
}

@Controller("api/v1/audit")
export class AuditController {
  /** R6: re-computes the SHA-256 chain over every audit event; reports the first broken link and the chain head. */
  @Get("verify") @Authed("audit.view")
  async verify(@Res() res: Response) {
    res.json(await withStateLock(() => verifyAuditChain()))
  }

  /** Filters: q, from/to (Dhaka day), entity, action, actor, entityId; newest first by default; ?format=csv. */
  @Get() @Authed("audit.view")
  async list(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "at.desc")
    const entityId = sp.get("entityId")
    const csv = sp.get("format") === "csv"
    const r = await sqlList<Raw, AuditEvent>(sp, {
      from: sql`audit_events`,
      where: entityId ? [sql`entity_id = ${entityId}`] : [],
      search: sql`concat_ws(' ', ref, actor, coalesce(note, ''), coalesce((select string_agg(concat_ws(' ', c->>'field', c->>'from', c->>'to'), ' ') from jsonb_array_elements(changes) c), ''))`,
      dateField: sql`day`,
      facets: { entity: sql`entity`, action: sql`action`, actor: sql`actor` },
      sortable: { at: { expr: sql`at` }, day: { expr: sql`day` }, actor: { expr: sql`actor`, text: true }, entity: { expr: sql`entity`, text: true }, action: { expr: sql`action`, text: true }, ref: { expr: sql`ref`, text: true } },
      order: sql`id`,
    }, rawToEvent, { all: csv })
    if (csv) {
      return sendCsv(res, toCSV(r.data, [
        { key: "at", label: "Time (UTC)" }, { key: "day", label: "Date (Dhaka)" }, { key: "actor", label: "User" },
        { key: "action", label: "Action" }, { key: "entity", label: "Record type" }, { key: "ref", label: "Reference" },
        { key: "changes", label: "Changes", get: (e) => e.changes?.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(" | ") ?? "" },
        { key: "note", label: "Note" },
      ]), `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    res.json(r)
  }
}

@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
