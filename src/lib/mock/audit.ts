import type { AuditAction, AuditChange, AuditEntity, AuditEvent } from "../types"
import type { User } from "../auth/roles"
import { findUserByName } from "./users"

/** Calendar day in Asia/Dhaka (UTC+6, no DST) for an ISO instant. */
export const dhakaDay = (iso: string) => new Date(new Date(iso).getTime() + 6 * 36e5).toISOString().slice(0, 10)

interface AuditStore { events: AuditEvent[]; seq: number }
const g = globalThis as unknown as { __dzAudit?: AuditStore }
export const auditStore: AuditStore = (g.__dzAudit ??= { events: [], seq: 0 })

export interface AuditInput {
  actor: User | string
  entity: AuditEntity
  entityId?: string
  ref: string
  action: AuditAction
  changes?: AuditChange[]
  note?: string
  at?: string
}

/** Append-only: events are never edited or deleted (NBR audits rely on it). */
export function recordAudit(e: AuditInput): AuditEvent {
  const at = e.at ?? new Date().toISOString()
  const actorName = typeof e.actor === "string" ? e.actor : e.actor.name
  const actorId = typeof e.actor === "string" ? findUserByName(e.actor)?.id : e.actor.id
  const ev: AuditEvent = {
    id: `a${++auditStore.seq}`, at, day: dhakaDay(at), actor: actorName, actorId,
    entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.action,
    changes: e.changes?.length ? e.changes : undefined, note: e.note,
  }
  auditStore.events.push(ev)
  return ev
}

const show = (v: unknown): string => {
  if (v == null || v === "") return "—"
  if (typeof v === "boolean") return v ? "yes" : "no"
  if (Array.isArray(v)) return v.length ? v.map(show).join(", ") : "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/** Field-level differences between two records (only the listed fields; nested objects via dotted paths). */
export function diff<T extends object>(before: T, after: T, fields: string[]): AuditChange[] {
  const get = (o: object, path: string) => path.split(".").reduce<unknown>((a, k) => (a == null ? a : (a as Record<string, unknown>)[k]), o)
  const out: AuditChange[] = []
  for (const f of fields) {
    const a = show(get(before, f)), b = show(get(after, f))
    if (a !== b) out.push({ field: f, from: a, to: b })
  }
  return out
}
