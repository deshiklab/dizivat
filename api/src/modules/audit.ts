/**
 * Audit trail — append-only table. Native modules record through AuditService; events the compat handlers push
 * into the in-memory store are forwarded here after each compat request (same lock), so one trail covers both.
 */
import { Controller, Get, Injectable, Module, Req, Res } from "@nestjs/common"
import { sql } from "drizzle-orm"
import type { Request, Response } from "express"
import type { User } from "@/lib/auth/roles"
import { toCSV } from "@/lib/mock/query"
import type { AuditAction, AuditChange, AuditEntity, AuditEvent } from "@/lib/types"
import { Authed } from "../common/auth"
import { searchParams, sendCsv } from "../common/http"
import { sqlList } from "../common/list"
import { withStateLock } from "../common/lock"
import { db, type Tx } from "../db/client"
import { auditEvents } from "../db/schema"
import { mirror } from "../state"

export interface AuditInput { actor: User | string; entity: AuditEntity; entityId?: string; ref: string; action: AuditAction; changes?: AuditChange[]; note?: string; at?: string }

/** Asia/Dhaka calendar day (UTC+6, no DST). */
export const dhakaDay = (iso: string) => new Date(new Date(iso).getTime() + 6 * 36e5).toISOString().slice(0, 10)

type Raw = { id: number; at: Date; day: string; actor: string; actor_id: string | null; entity: string; entity_id: string | null; ref: string; action: string; changes: AuditChange[] | null; note: string | null }
export const rawToEvent = (r: Raw): AuditEvent => {
  const e: AuditEvent = { id: `a${r.id}`, at: r.at.toISOString(), day: r.day, actor: r.actor, entity: r.entity as AuditEntity, ref: r.ref, action: r.action as AuditAction }
  if (r.actor_id) e.actorId = r.actor_id
  if (r.entity_id) e.entityId = r.entity_id
  if (r.changes?.length) e.changes = r.changes
  if (r.note) e.note = r.note
  // key order as the mock builds it
  return { id: e.id, at: e.at, day: e.day, actor: e.actor, actorId: e.actorId, entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.action, changes: e.changes, note: e.note }
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
      const [row] = await db.insert(auditEvents).values(values(base)).returning({ id: auditEvents.id })
      const ev: AuditEvent = { id: `a${row.id}`, ...base }
      const store = mirror.audit()
      store.events.push(ev)
      store.seq = Math.max(store.seq, row.id)
      persisted.add(ev)
      return ev
    })
  }

  /** Cheap check from the end (events are only ever appended). */
  hasPending() {
    const ev = mirror.audit().events
    for (let i = ev.length - 1; i >= 0 && i >= ev.length - 50; i--) if (!persisted.has(ev[i])) return true
    return false
  }

  /** Inside the state lock: saves events the compat handlers appended, fixing their ids to the table's. */
  async forwardPending(tx: Tx) {
    const store = mirror.audit()
    for (const ev of store.events) {
      if (persisted.has(ev)) continue
      const [row] = await tx.insert(auditEvents).values(values(ev)).returning({ id: auditEvents.id })
      ev.id = `a${row.id}`
      store.seq = Math.max(store.seq, row.id)
      persisted.add(ev)
    }
  }
}

@Controller("api/v1/audit")
export class AuditController {
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
