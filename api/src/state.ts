/**
 * The in-process world shared with the compat bundle. Native modules own users, company and units in PostgreSQL
 * and write every change through to these globals, so unported handlers (which read them) see the same data.
 * One instance per database — the compat layer is single-writer by design until R5.5 removes it.
 */
import { createRequire } from "node:module"
import { join } from "node:path"
import type { Preferences, SavedView, User } from "@/lib/auth/roles"
import type { AuditEvent, Company, Unit } from "@/lib/types"

export type CompatModule = typeof import("./compat/entry")

interface UserStore {
  users: User[]; passwords: Record<string, string>; prefs: Record<string, Preferences>
  views: Record<string, Record<string, SavedView[]>>; failures: Record<string, { n: number; until: number }>
  notifRead: Record<string, { ids: string[]; allBefore?: string }>; revokedBefore: Record<string, number>
}
interface Globals {
  __dzDb?: Record<string, unknown> & { units: Unit[] }
  __dzUsers?: UserStore
  __dzAudit?: { events: AuditEvent[]; seq: number }
  __dzCompany?: Company
  __dzNoDelay?: boolean
}
export const G = globalThis as unknown as Globals

let mod: CompatModule | null = null
/** Requires dist/compat.js (next to dist/main.js). Call only after the globals are restored. */
export function loadCompat(): CompatModule {
  if (!mod) {
    G.__dzNoDelay = true // the mock's artificial latency is for the browser demo only
    mod = createRequire(__filename)(join(__dirname, "compat.js")) as CompatModule
  }
  return mod
}
export const compat = (): CompatModule => {
  if (!mod) throw new Error("compat bundle not loaded")
  return mod
}

/** Restores saved state before the compat bundle initialises (its stores use `globalThis.x ??= seed()`). */
export function restoreGlobals(s: { db: Record<string, unknown> & { units: Unit[] }; notifRead: UserStore["notifRead"]; users: User[]; prefs: Record<string, Preferences>; company: Company; units: Unit[]; events: AuditEvent[] }) {
  G.__dzDb = { ...s.db, units: s.units }
  G.__dzUsers = { users: s.users, passwords: {}, prefs: s.prefs, views: {}, failures: {}, notifRead: s.notifRead ?? {}, revokedBefore: {} }
  G.__dzAudit = { events: s.events, seq: s.events.reduce((m, e) => Math.max(m, Number(e.id.slice(1)) || 0), 0) }
  G.__dzCompany = s.company
}

/* ── write-through mirror (mutate in place: the compat modules hold references) ── */

const replaceObject = <T extends object>(target: T, next: T) => {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k]
  Object.assign(target, next)
}

export const mirror = {
  users: (): User[] => G.__dzUsers!.users,
  findUser: (id: string) => G.__dzUsers!.users.find((u) => u.id === id),
  findUserByName: (name: string) => G.__dzUsers!.users.find((u) => u.name === name),
  putUser(u: User, prefs: Preferences) {
    const list = G.__dzUsers!.users
    const cur = list.find((x) => x.id === u.id)
    if (cur) replaceObject(cur, u)
    else list.push(u)
    G.__dzUsers!.prefs[u.id] = prefs
    return cur ?? u
  },
  company: (): Company => G.__dzCompany!,
  putCompany: (c: Company) => replaceObject(G.__dzCompany!, c),
  units: (): Unit[] => G.__dzDb!.units,
  putUnits(list: Unit[]) { const u = G.__dzDb!.units; u.splice(0, u.length, ...list) },
  audit: () => G.__dzAudit!,
}
