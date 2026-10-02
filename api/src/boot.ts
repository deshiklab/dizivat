/**
 * Boot: first start seeds PostgreSQL from the demo data set (the same one the mock and the Pages demo use);
 * later starts restore everything from PostgreSQL before the compat bundle initialises.
 */
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { gzip } from "node:zlib"
import { asc, eq, sql } from "drizzle-orm"
import { BACKUP_FORMAT, lastSlot } from "@/lib/backup-schedule"
import type { Preferences, User } from "@/lib/auth/roles"
import type { AuditEvent, Unit } from "@/lib/types"
import { hashPassword } from "./common/password"
import { db } from "./db/client"
import { auditEvents, backups, compatState, meta, tariffLines, units, users } from "./db/schema"
import { snapshot } from "./modules/backups"
import { chainValues, markPersisted, rawToEvent, sealUnchained } from "./modules/audit"
import { GENESIS_HASH } from "@/lib/integrity"
import { compatSnapshot, markSaved } from "./modules/compat"
import { toUser } from "./modules/identity"
import { loadCompany, saveCompany } from "./modules/reference"
import { G, loadCompat, restoreGlobals } from "./state"
import { lockState, setEpoch } from "./common/state-guard"

export const SEED_VERSION = "r6.4.1"

/**
 * Demo instances re-seed when the code ships a newer demo data set (SEED_VERSION differs from the stored one) —
 * after taking a backup of everything, so the old data can still be downloaded from Settings → Backups.
 * Customer installations set DEMO_RESEED=off and keep their data across upgrades.
 */
const demoReseed = () => (process.env.DEMO_RESEED ?? "on") !== "off"

export async function bootState(log: (m: string) => void) {
  const [state] = await db.select().from(compatState).where(eq(compatState.key, "main"))
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  if (state && n) {
    await sealUnchained(log) // R6: upgrade — chain the events written by R5.1
    const [v] = await db.select().from(meta).where(eq(meta.key, "seed_version"))
    if (v?.value !== SEED_VERSION && demoReseed()) {
      log(`demo data set ${v?.value ?? "?"} → ${SEED_VERSION}: backing up, then re-seeding (DEMO_RESEED=off keeps the data)`)
      await backupBeforeReseed(v?.value ?? "?", log)
      return seed(log)
    }
    return restore(state.data as { db: Record<string, unknown>; notifRead: Record<string, { ids: string[] }> }, log)
  }
  return seed(log)
}

async function seed(log: (m: string) => void) {
  const t0 = Date.now()
  const m = loadCompat() // fresh globals: demo users, company, documents, audit history
  const demoHash = await Promise.all(m.userStore.users.map(() => hashPassword(m.DEMO_PASSWORD)))
  const events = m.auditStore.events
  const snapshot = compatSnapshot()
  const seededAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await lockState(tx, { checkEpoch: false }) // waits for any other instance's in-flight write (deploy overlap)
    // the append-only guard on audit_events lets this transaction (and only it) clear the table
    await tx.execute(sql`set local dizivat.reseed = 'on'`)
    for (const t of ["sessions", "saved_views", "login_failures", "users", "branches", "company", "units", "tariff_lines", "audit_events", "compat_state", "meta"])
      await tx.execute(sql.raw(`delete from ${t}`))
    await tx.insert(users).values(m.userStore.users.map((u, i) => ({
      id: u.id, username: u.username, name: u.name, designation: u.designation, initials: u.initials, email: u.email, role: u.role,
      mobile: u.mobile ?? null, department: u.department ?? null, active: u.active, mustChangePassword: !!u.mustChangePassword,
      accessUntil: u.role === "vatOfficer" ? u.accessUntil ?? null : null,
      passwordHash: demoHash[i], passwordIsDemo: true, preferences: {}, createdAt: new Date(u.createdAt),
      lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
    })))
    await saveCompany(tx, m.company)
    await tx.insert(units).values(m.db.units.map((u) => ({ id: u.id, code: u.code, name: u.name, decimals: u.decimals, active: u.active, createdAt: new Date(u.createdAt) })))
    const unitSeq = (m.db.seq as Record<string, number>).unit
    await tx.execute(sql`select setval('unit_id_seq', ${unitSeq})`)
    for (let i = 0; i < m.tariff.length; i += 500)
      await tx.insert(tariffLines).values(m.tariff.slice(i, i + 500).map((t) => ({ fy: m.TARIFF_FY, ...t })))
    await tx.execute(sql`alter sequence audit_events_id_seq restart with 1`)
    let prev = GENESIS_HASH
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500)
      const chained = chainValues(chunk.map((e) => ({
        at: new Date(e.at), day: e.day, actor: e.actor, actorId: e.actorId ?? null, entity: e.entity, entityId: e.entityId ?? null,
        ref: e.ref, action: e.action, changes: e.changes?.length ? e.changes : null, note: e.note ?? null,
      })), prev)
      prev = chained.head
      const ids = await tx.insert(auditEvents).values(chained.rows).returning({ id: auditEvents.id })
      ids.forEach((r, j) => { chunk[j].id = `a${r.id}` })
    }
    await tx.insert(compatState).values({ key: "main", data: JSON.parse(snapshot) as unknown })
    await tx.insert(meta).values([
      { key: "seed_version", value: SEED_VERSION }, { key: "seeded_at", value: seededAt }, { key: "tariff_fy", value: m.TARIFF_FY },
    ])
  })
  setEpoch(seededAt)
  G.__dzAudit!.seq = events.reduce((mx, e) => Math.max(mx, Number(e.id.slice(1))), 0)
  markPersisted(events)
  markSaved(snapshot)
  log(`seeded demo data: ${m.userStore.users.length} users, ${m.db.units.length} units, ${m.tariff.length} tariff lines, ${events.length} audit events (${Date.now() - t0} ms)`)
}

async function restore(state: { db: Record<string, unknown>; notifRead: Record<string, { ids: string[] }> }, log: (m: string) => void) {
  const t0 = Date.now()
  const userRows = await db.select().from(users).orderBy(asc(users.ord))
  const prefs: Record<string, Preferences> = {}
  const list: User[] = userRows.map((r) => { prefs[r.id] = r.preferences as Preferences; return toUser(r) })
  const unitRows: Unit[] = (await db.select().from(units).orderBy(asc(units.ord))).map((r) => ({ id: r.id, code: r.code, name: r.name, decimals: r.decimals, active: r.active, createdAt: r.createdAt.toISOString() }))
  const [ep] = await db.select().from(meta).where(eq(meta.key, "seeded_at"))
  setEpoch(ep?.value)
  const raw = await db.execute(sql`select * from audit_events order by id`)
  const events: AuditEvent[] = (raw.rows as Parameters<typeof rawToEvent>[0][]).map(rawToEvent)
  restoreGlobals({ db: state.db as never, notifRead: state.notifRead, users: list, prefs, company: await loadCompany(), units: unitRows, events })
  loadCompat()
  markPersisted(events)
  markSaved(compatSnapshot())
  log(`restored from PostgreSQL: ${list.length} users, ${events.length} audit events (${Date.now() - t0} ms)`)
}

/** Pre-reseed safety net: one gzip snapshot of the database in the backups table (kept by the re-seed). */
async function backupBeforeReseed(from: string, log: (m: string) => void) {
  const { tables, counts } = await snapshot()
  const data = await promisify(gzip)(Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, at: new Date().toISOString(), storage: "postgres", reason: `before demo re-seed ${from} → ${SEED_VERSION}`, tables })))
  await db.insert(backups).values({
    kind: "manual", slot: lastSlot().slot, by: `System (before demo reset ${from} → ${SEED_VERSION})`,
    size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex"), tables: counts, data,
  })
  log(`pre-reseed backup: ${Math.round(data.byteLength / 1024)} KB`)
}
