/**
 * R6.2 — database backups (GO 16/Mushak/2019, enlisted VAT software: at least two backups a day).
 * Each backup is a gzip JSON snapshot of every business table (sessions, lockouts and password hashes excluded),
 * stored in the `backups` table with its SHA-256, taken at 02:00 and 14:00 Asia/Dhaka plus on demand; the newest
 * BACKUP_KEEP are kept. A slot missed while the service was asleep is taken as soon as it wakes (catch-up).
 */
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { gzip as gzipCb } from "node:zlib"
import { Controller, Get, HttpCode, Inject, Injectable, Logger, Param, Post, Req, Res, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common"
import { desc, eq, sql } from "drizzle-orm"
import type { Response } from "express"
import { BACKUP_FORMAT, BACKUP_KEEP, BACKUP_SLOTS, backupFileName, backupRef, dhakaDayOf, lastSlot, nextSlot } from "@/lib/backup-schedule"
import type { BackupRow, BackupStatus, BackupVerify, RestoreDrill } from "@/lib/types"
import { Authed, type AuthedRequest } from "../common/auth"
import { Problem, toIso } from "../common/http"
import { withStateLock } from "../common/lock"
import { db } from "../db/client"
import { backups, meta } from "../db/schema"
import { mirror } from "../state"
import { AuditService } from "./audit"

const gzip = promisify(gzipCb)
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")

/** Not backed up: secrets and transient state. */
const SKIP = new Set(["sessions", "login_failures", "backups"])
const SECRET_COLUMNS = new Set(["password_hash"])

type Meta = Omit<typeof backups.$inferSelect, "data">
const toRow = (r: Meta): BackupRow => ({ id: `bk${r.id}`, at: toIso(r.at), kind: r.kind, slot: r.slot, by: r.by, size: r.size, sha256: r.sha256, tables: r.tables })
const META = { id: backups.id, at: backups.at, kind: backups.kind, slot: backups.slot, by: backups.by, size: backups.size, sha256: backups.sha256, tables: backups.tables }
const idOf = (id: string) => { const n = Number(/^bk(\d+)$/.exec(id)?.[1]); return Number.isSafeInteger(n) && n > 0 ? n : null }

/** Every public table (except SKIP) as JSON rows, plus the document collections inside compat_state. Caller holds the state lock. */
export async function snapshot(): Promise<{ tables: Record<string, unknown[]>; counts: Record<string, number> }> {
  const list = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const { table_name: t } of list.rows as { table_name: string }[]) {
    if (SKIP.has(t)) continue
    const r = await db.execute(sql.raw(`select * from "${t.replace(/"/g, "")}" order by 1`))
    const rows = (r.rows as Record<string, unknown>[]).map((row) => { for (const c of SECRET_COLUMNS) delete row[c]; return row })
    tables[t] = rows
    counts[t] = rows.length
  }
  // the business documents still live in compat_state (R5 compat layer) — count them per collection too
  const state = (tables.compat_state?.[0] as { data?: { db?: Record<string, unknown> } } | undefined)?.data?.db ?? {}
  for (const [k, v] of Object.entries(state)) if (Array.isArray(v)) counts[`documents.${k}`] = v.length
  return { tables, counts }
}

@Injectable()
export class BackupsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger("Backups")
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private running: Promise<unknown> | null = null

  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  onModuleInit() {
    if (process.env.BACKUPS === "off") return this.log.warn("scheduled backups disabled (BACKUPS=off)")
    // shortly after boot (catch up a slot missed while asleep), then every 5 minutes
    this.first = setTimeout(() => void this.tick(), Number(process.env.BACKUP_FIRST_DELAY_MS ?? 20_000))
    this.timer = setInterval(() => void this.tick(), 5 * 60_000)
    this.first.unref(); this.timer.unref()
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); if (this.first) clearTimeout(this.first) }

  /** Takes the current slot's scheduled backup unless it exists. Safe to call repeatedly (unique slot index). */
  async tick() {
    if (this.running) return this.running
    const run = (async () => {
      const { slot } = lastSlot()
      const [have] = await db.select({ id: backups.id }).from(backups).where(sql`${backups.kind} = 'scheduled' and ${backups.slot} = ${slot}`)
      if (have) return null
      const b = await this.create("scheduled", "System", slot)
      if (b) this.log.log(`scheduled backup ${b.id} for ${slot}: ${Math.round(b.size / 1024)} KB`)
      return b
    })().catch((e) => { this.log.error(`scheduled backup failed: ${e instanceof Error ? e.message : String(e)}`); return null })
      .finally(() => { this.running = null })
    this.running = run
    return run
  }

  /** Snapshot → gzip → SHA-256 → row; prunes beyond BACKUP_KEEP. Returns null if a scheduled slot was taken concurrently. */
  async create(kind: "scheduled" | "manual", by: string, slot: string): Promise<BackupRow | null> {
    const at = new Date()
    const { tables, counts } = await withStateLock(() => snapshot())
    const c = mirror.company()
    const data = await gzip(Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, at: at.toISOString(), company: c.name, bin: c.bin, storage: "postgres", tables })))
    const values = { at, kind, slot, by, size: data.byteLength, sha256: sha256(data), tables: counts, data }
    const ins = db.insert(backups).values(values)
    const [row] = kind === "scheduled" ? await ins.onConflictDoNothing().returning(META) : await ins.returning(META)
    if (!row) return null
    await db.execute(sql`delete from backups where id not in (select id from backups order by at desc, id desc limit ${BACKUP_KEEP})`)
    return toRow(row)
  }

  async list(): Promise<BackupRow[]> {
    return (await db.select(META).from(backups).orderBy(desc(backups.at), desc(backups.id)).limit(BACKUP_KEEP)).map(toRow)
  }

  async status(): Promise<BackupStatus> {
    const rows = await this.list()
    const today = dhakaDayOf(new Date().toISOString())
    return {
      timezone: "Asia/Dhaka", schedule: [...BACKUP_SLOTS], retention: BACKUP_KEEP, storage: "postgres",
      today: rows.filter((r) => dhakaDayOf(r.at) === today).length, next: nextSlot(), last: rows[0], rows,
      drill: (await this.drill()) ?? null,
    }
  }

  /** R6.3: the latest restore drill recorded by `restore.js --record` (meta.restore_drill). */
  async drill(): Promise<RestoreDrill | undefined> {
    const [m] = await db.select().from(meta).where(eq(meta.key, "restore_drill"))
    if (!m) return undefined
    try { return JSON.parse(m.value) as RestoreDrill } catch { return undefined }
  }

  async data(id: string) {
    const n = idOf(id)
    if (!n) return null
    const [r] = await db.select().from(backups).where(eq(backups.id, n))
    return r ?? null
  }

  async verify(id: string): Promise<BackupVerify | null> {
    const r = await this.data(id)
    if (!r) return null
    const h = sha256(r.data)
    return { id, ok: h === r.sha256 && r.data.byteLength === r.size, sha256: h, size: r.data.byteLength, checkedAt: new Date().toISOString() }
  }
}

@Controller("api/v1/backups")
export class BackupsController {
  constructor(@Inject(BackupsService) private readonly svc: BackupsService, @Inject(AuditService) private readonly audit: AuditService) {}

  /** Schedule, retention and the stored backups (newest first). Also catches up the current slot if it is missing. */
  @Get() @Authed("settings.manage")
  async status() {
    await this.svc.tick()
    return this.svc.status()
  }

  /** Take a backup now. */
  @Post() @Authed("settings.manage")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const user = req.dz!.user
    const b = (await this.svc.create("manual", user.name, lastSlot().slot))!
    await this.audit.record({ actor: user, entity: "backup", entityId: b.id, ref: backupRef(b.at), action: "backedUp", note: `${Math.round(b.size / 1024)} KB · SHA-256 ${b.sha256.slice(0, 12)}…` })
    res.status(201).json(b)
  }

  /** Download (application/gzip). Audited. */
  @Get(":id") @Authed("settings.manage")
  async download(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const r = await this.svc.data(id)
    if (!r) throw new Problem(404, "Backup not found")
    const at = toIso(r.at)
    await this.audit.record({ actor: req.dz!.user, entity: "backup", entityId: `bk${r.id}`, ref: backupRef(at), action: "downloaded" })
    res.setHeader("Content-Type", "application/gzip")
    res.setHeader("Content-Disposition", `attachment; filename="${backupFileName(at)}"`)
    res.setHeader("X-Backup-SHA256", r.sha256)
    res.setHeader("Cache-Control", "no-store")
    res.end(r.data)
  }

  /** Re-hash and compare with the SHA-256 recorded when it was taken. */
  @Post(":id/verify") @Authed("settings.manage") @HttpCode(200)
  async verify(@Param("id") id: string) {
    const r = await this.svc.verify(id)
    if (!r) throw new Problem(404, "Backup not found")
    return r
  }
}
