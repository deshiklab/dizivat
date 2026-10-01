/**
 * Identity: sign-in / sign-out, the current user (/me) and user administration — PostgreSQL-backed.
 * Responses and error codes are identical to the mock handlers (docs/API.md); what changed is underneath:
 * scrypt hashes, a sessions table (real sign-out and revocation), lockouts that survive restarts.
 */
import { randomInt } from "node:crypto"
import { Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Req, Res } from "@nestjs/common"
import { and, eq, sql } from "drizzle-orm"
import type { Request, Response } from "express"
import { z } from "zod"
import { accessExpired, accessUntilError, ROLE_PERMS, type Me, type Preferences, type SavedView, type User } from "@/lib/auth/roles"
import { toCSV } from "@/lib/mock/query"
import { passwordChange, userInput, userUpdate } from "@/lib/schemas"
import { Authed, CurrentUser, SessionService, type AuthedRequest } from "../common/auth"
import { jsonBody, parse, Problem, searchParams, sendCsv, sleep, toIso, zodErrors } from "../common/http"
import { sqlList } from "../common/list"
import { hashPassword, verifyPassword } from "../common/password"
import { db } from "../db/client"
import { loginFailures, savedViews, users } from "../db/schema"
import { compat, mirror } from "../state"
import { AuditService } from "./audit"

type UserRow = typeof users.$inferSelect

export const toUser = (r: UserRow): User => {
  const u: User = { id: r.id, username: r.username, name: r.name, designation: r.designation, initials: r.initials, email: r.email, role: r.role, active: r.active, createdAt: r.createdAt.toISOString() }
  if (r.mobile != null) u.mobile = r.mobile
  if (r.department != null) u.department = r.department
  if (r.lastSignInAt) u.lastSignInAt = r.lastSignInAt.toISOString()
  if (r.mustChangePassword) u.mustChangePassword = true
  if (r.accessUntil) u.accessUntil = r.accessUntil
  return u
}
type RawUser = Record<string, unknown> & { id: string; created_at: Date | string; last_sign_in_at: Date | string | null }
const rawToUser = (r: RawUser): User => toUser({
  ...(r as unknown as UserRow), mustChangePassword: r.must_change_password as boolean, accessUntil: (r.access_until as string | null) ?? null,
  createdAt: new Date(toIso(r.created_at)), lastSignInAt: r.last_sign_in_at ? new Date(toIso(r.last_sign_in_at)) : null,
})

/** "Md. Kamal Uddin" → "KU" (honorifics skipped) — as src/lib/mock/users.ts. */
export const initialsOf = (name: string) =>
  name.replace(/^(md|mst|mohammad)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"

/** Readable one-time password, e.g. "Rfx-kemo-4821" — crypto-random now. */
export function tempPassword() {
  const c = "bcdfghjkmnpqrstvwxz", v = "aeiou"
  const pick = (s: string) => s[randomInt(s.length)]
  return `Rfx-${pick(c)}${pick(v)}${pick(c)}${pick(v)}-${randomInt(1000, 10000)}`
}

@Injectable()
export class UsersService {
  async byId(id: string) { return (await db.select().from(users).where(eq(users.id, id)))[0] }
  async byUsername(username: string) { return (await db.select().from(users).where(eq(users.username, username)))[0] }

  /** Re-reads the row and writes it through to the compat globals. */
  async refresh(id: string): Promise<User> {
    const r = await this.byId(id)
    return mirror.putUser(toUser(r), r.preferences as Preferences)
  }

  meFor(user: User): Me {
    const c = mirror.company()
    return { user, permissions: ROLE_PERMS[user.role], preferences: compatPrefs(user.id), company: { name: c.name, bin: c.bin, address: c.address, vatSlab: c.vatSlab } }
  }
}
const compatPrefs = (uid: string): Preferences => (globalThis as unknown as { __dzUsers: { prefs: Record<string, Preferences> } }).__dzUsers.prefs[uid] ?? {}

/* ── auth ─────────────────────────────────────────────────────────────── */

const loginBody = z.object({ username: z.string().trim().min(1, "required"), password: z.string().min(1, "required"), remember: z.boolean().optional() })
const MAX_FAILURES = 5
const LOCK_MS = 60_000

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post("login") @HttpCode(200)
  async login(@Req() req: Request, @Res() res: Response) {
    const parsed = loginBody.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error, ""))
    const { username, password, remember } = parsed.data
    const key = username.toLowerCase()
    await sleep(350) // constant-ish time; slows guessing
    const [f] = await db.select().from(loginFailures).where(eq(loginFailures.username, key))
    const until = f?.lockedUntil?.getTime() ?? 0
    if (f && until > Date.now()) throw new Problem(429, "locked", { _: [String(Math.ceil((until - Date.now()) / 1000))] })

    const row = await this.users.byUsername(key)
    const ok = await verifyPassword(password, row?.passwordHash)
    if (!row || !ok) {
      const n = (f && until <= Date.now() && f.failures >= MAX_FAILURES ? 0 : f?.failures ?? 0) + 1
      const lockedUntil = n >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null
      await db.insert(loginFailures).values({ username: key, failures: n, lockedUntil })
        .onConflictDoUpdate({ target: loginFailures.username, set: { failures: n, lockedUntil } })
      // Only known accounts are logged — logging arbitrary usernames would let anyone fill the audit trail
      if (row) await this.audit.record({ actor: toUser(row), entity: "session", entityId: row.id, ref: row.username, action: "signInFailed", note: n >= MAX_FAILURES ? "Wrong password — locked for 60 s" : "Wrong password" })
      throw new Problem(401, "invalid", { _: [String(Math.max(0, MAX_FAILURES - n))] })
    }
    if (f) await db.delete(loginFailures).where(eq(loginFailures.username, key))
    // Checked after the password so a disabled account is not revealed to someone guessing
    if (!row.active) throw new Problem(403, "disabled")
    // R6.2: a VAT officer's access period has ended
    if (accessExpired(toUser(row))) {
      await this.audit.record({ actor: toUser(row), entity: "session", entityId: row.id, ref: row.username, action: "signInFailed", note: `Access period ended ${row.accessUntil ?? ""}`.trim() })
      throw new Problem(403, "expired")
    }
    await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, row.id))
    const user = await this.users.refresh(row.id)
    await this.audit.record({ actor: user, entity: "session", entityId: user.id, ref: user.username, action: "signedIn" })
    await this.sessions.create(req, res, user, !!remember)
    res.json(this.users.meFor(user))
  }

  /** Ends this session server-side (the cookie stops working even if it was copied). */
  @Post("logout") @HttpCode(200)
  async logout(@Req() req: Request, @Res() res: Response) {
    const s = await this.sessions.resolve(req)
    if (s) {
      await this.audit.record({ actor: s.user, entity: "session", entityId: s.user.id, ref: s.user.username, action: "signedOut" })
      await this.sessions.revoke(s.token.sid, "signedOut")
    }
    this.sessions.clearCookie(res)
    res.json({ ok: true })
  }

  /** Public: what the sign-in page shows — demo accounts still on the demo password, and the company name. */
  @Get("login-info")
  async loginInfo() {
    const rows = await db.select().from(users).where(and(eq(users.active, true), eq(users.passwordIsDemo, true))).orderBy(users.ord)
    const c = mirror.company()
    return {
      demo: rows.map((r) => ({ username: r.username, name: r.name, designation: r.designation, role: r.role })),
      demoPassword: compat().DEMO_PASSWORD,
      company: { name: c.name, bin: c.bin },
    }
  }
}

/* ── me ───────────────────────────────────────────────────────────────── */

const prefsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  accent: z.enum(["blue", "emerald", "violet", "orange"]).optional(),
  density: z.enum(["compact", "cozy", "comfortable"]).optional(),
  text: z.enum(["md", "lg", "xl"]).optional(),
})
const viewSchema = z.object({ table: z.string().min(1).max(40), name: z.string().trim().min(1).max(40), query: z.string().max(2000) })

@Controller("api/v1/me")
export class MeController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get() @Authed()
  me(@CurrentUser() user: User) { return this.users.meFor(user) }

  /** Change own password: every session of this user is revoked; this browser gets a fresh one. */
  @Put("password") @Authed()
  async password(@Req() req: AuthedRequest, @Res() res: Response) {
    const user = req.dz!.user
    const { current, next } = parse(passwordChange, jsonBody(req))
    await sleep(300)
    const row = await this.users.byId(user.id)
    if (!(await verifyPassword(current, row.passwordHash))) throw new Problem(422, "Validation failed", { current: ["pwWrong"] })
    if (next.toLowerCase().includes(user.username)) throw new Problem(422, "Validation failed", { next: ["pwUsername"] })
    await db.update(users).set({ passwordHash: await hashPassword(next), passwordIsDemo: false, mustChangePassword: false }).where(eq(users.id, user.id))
    await this.sessions.revokeUser(user.id, "passwordChanged")
    const fresh = await this.users.refresh(user.id)
    await this.audit.record({ actor: fresh, entity: "user", entityId: fresh.id, ref: fresh.username, action: "passwordChanged" })
    await this.sessions.create(req, res, fresh, req.dz!.remember)
    res.json(this.users.meFor(fresh))
  }

  @Put("preferences") @Authed()
  async preferences(@Req() req: AuthedRequest) {
    const p = parse(prefsSchema, jsonBody(req))
    const uid = req.dz!.user.id
    const [row] = await db.update(users).set({ preferences: sql`${users.preferences} || ${JSON.stringify(p)}::jsonb` }).where(eq(users.id, uid)).returning({ preferences: users.preferences })
    await this.users.refresh(uid)
    return row.preferences
  }

  /** Saved list views per user and table. */
  @Get("views") @Authed()
  async views(@Req() req: AuthedRequest) {
    const table = searchParams(req).get("table")
    if (!table) throw new Problem(400, "table is required")
    return listViews(req.dz!.user.id, table)
  }

  @Post("views") @Authed()
  async saveView(@Req() req: AuthedRequest, @Res() res: Response) {
    const v = parse(viewSchema, jsonBody(req))
    const uid = req.dz!.user.id
    const list = await listViews(uid, v.table)
    const next = [...list.filter((x) => x.name !== v.name), { name: v.name, query: v.query }]
    if (next.length > 30) throw new Problem(422, "Too many saved views (max 30 per list)")
    await db.transaction(async (tx) => {
      await tx.delete(savedViews).where(and(eq(savedViews.userId, uid), eq(savedViews.tableKey, v.table), eq(savedViews.name, v.name)))
      await tx.insert(savedViews).values({ userId: uid, tableKey: v.table, name: v.name, query: v.query })
    })
    res.status(201).json(next)
  }

  @Delete("views") @Authed()
  async deleteView(@Req() req: AuthedRequest) {
    const sp = searchParams(req)
    const table = sp.get("table"), name = sp.get("name")
    if (!table || !name) throw new Problem(400, "table and name are required")
    await db.delete(savedViews).where(and(eq(savedViews.userId, req.dz!.user.id), eq(savedViews.tableKey, table), eq(savedViews.name, name)))
    return listViews(req.dz!.user.id, table)
  }
}

async function listViews(uid: string, table: string): Promise<SavedView[]> {
  const rows = await db.select({ name: savedViews.name, query: savedViews.query }).from(savedViews)
    .where(and(eq(savedViews.userId, uid), eq(savedViews.tableKey, table))).orderBy(savedViews.pos)
  return rows
}

/* ── users (admin) ───────────────────────────────────────────────────── */

const USER_FIELDS = ["name", "designation", "email", "mobile", "department", "role", "active", "accessUntil"]

@Controller("api/v1/users")
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get() @Authed("users.manage")
  async list(@Req() req: Request, @Res() res: Response) {
    const sp = searchParams(req)
    if (!sp.get("sort")) sp.set("sort", "name.asc")
    const csv = sp.get("format") === "csv"
    const r = await sqlList<RawUser, User>(sp, {
      from: sql`users`,
      search: sql`concat_ws(' ', name, username, email, designation, coalesce(department, ''), coalesce(mobile, ''))`,
      facets: { role: sql`role`, status: sql`case when active then 'active' else 'inactive' end` },
      sortable: {
        name: { expr: sql`name`, text: true }, username: { expr: sql`username`, text: true }, email: { expr: sql`email`, text: true },
        role: { expr: sql`role`, text: true }, designation: { expr: sql`designation`, text: true }, department: { expr: sql`department`, text: true },
        mobile: { expr: sql`mobile`, text: true }, active: { expr: sql`active` }, createdAt: { expr: sql`created_at` }, lastSignInAt: { expr: sql`last_sign_in_at` },
      },
      order: sql`ord`,
    }, rawToUser, { all: csv })
    if (csv) {
      return sendCsv(res, toCSV(r.data, [
        { key: "name", label: "Name" }, { key: "username", label: "Username" }, { key: "role", label: "Role" },
        { key: "designation", label: "Designation" }, { key: "department", label: "Department" }, { key: "mobile", label: "Mobile" },
        { key: "email", label: "Email" }, { key: "active", label: "Status", get: (u) => (u.active ? "Active" : "Inactive") },
        { key: "lastSignInAt", label: "Last sign-in" }, { key: "createdAt", label: "Created" },
      ]), `users-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    res.json(r)
  }

  /** Invite: account with a one-time temporary password (returned once; only its hash is stored). */
  @Post() @Authed("users.manage")
  async invite(@Req() req: AuthedRequest, @Res() res: Response) {
    const d = parse(userInput, jsonBody(req))
    if (await this.users.byUsername(d.username)) throw new Problem(422, "Validation failed", { username: ["duplicate"] })
    const [dupe] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${d.email})`)
    if (dupe) throw new Problem(422, "Validation failed", { email: ["duplicate"] })
    const ae = accessUntilError(d.role, d.accessUntil)
    if (ae) throw new Problem(422, "Validation failed", { accessUntil: [ae] })
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
    const pw = tempPassword()
    const id = `u${n + 1}-${Date.now().toString(36)}`
    await db.insert(users).values({
      id, username: d.username, name: d.name, designation: d.designation, email: d.email, role: d.role,
      mobile: d.mobile ?? null, department: d.department ?? null, active: d.active, initials: initialsOf(d.name),
      accessUntil: d.role === "vatOfficer" ? d.accessUntil : null, mustChangePassword: true, passwordHash: await hashPassword(pw), passwordIsDemo: false,
    })
    const user = await this.users.refresh(id)
    await this.audit.record({ actor: req.dz!.user, entity: "user", entityId: user.id, ref: user.username, action: "invited", note: `Role: ${user.role}${user.accessUntil ? ` · access until ${user.accessUntil}` : ""}` })
    res.status(201).json({ user, tempPassword: pw })
  }

  @Get(":id") @Authed("users.manage")
  async get(@Param("id") id: string) {
    const r = await this.users.byId(id)
    if (!r) throw new Problem(404, "User not found")
    return toUser(r)
  }

  /** Profile, role, status. 422 self / lastAdmin; deactivation revokes the user's sessions immediately. */
  @Put(":id") @Authed("users.manage")
  async update(@Param("id") id: string, @Req() req: AuthedRequest) {
    const actor = req.dz!.user
    const row = await this.users.byId(id)
    if (!row) throw new Problem(404, "User not found")
    const u = toUser(row)
    const d = parse(userUpdate, jsonBody(req))
    const [dupe] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${d.email}) and ${users.id} <> ${id}`)
    if (dupe) throw new Problem(422, "Validation failed", { email: ["duplicate"] })
    // R6.2: an officer's access date is validated when it changes (an unchanged past date can stay while deactivating)
    if (d.role === "vatOfficer" && (d.accessUntil !== u.accessUntil || u.role !== "vatOfficer")) {
      const ae = accessUntilError(d.role, d.accessUntil)
      if (ae) throw new Problem(422, "Validation failed", { accessUntil: [ae] })
    } else if (d.role === "vatOfficer" && !d.accessUntil) throw new Problem(422, "Validation failed", { accessUntil: ["required"] })
    const roleChanged = d.role !== u.role, statusChanged = d.active !== u.active
    if (u.id === actor.id && roleChanged) throw new Problem(422, "Validation failed", { role: ["self"] })
    if (u.id === actor.id && !d.active) throw new Problem(422, "Validation failed", { active: ["self"] })
    const losesAdmin = u.role === "admin" && u.active && (d.role !== "admin" || !d.active)
    if (losesAdmin) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(sql`${users.id} <> ${id} and ${users.role} = 'admin' and ${users.active}`)
      if (!n) throw new Problem(422, "Validation failed", { [d.active ? "role" : "active"]: ["lastAdmin"] })
    }
    await db.update(users).set({
      name: d.name, designation: d.designation, email: d.email, role: d.role, active: d.active,
      mobile: d.mobile ?? null, department: d.department ?? null, initials: initialsOf(d.name),
      accessUntil: d.role === "vatOfficer" ? d.accessUntil : null,
    }).where(eq(users.id, id))
    if (statusChanged && !d.active) await this.sessions.revokeUser(id, "deactivated")
    const after = await this.users.refresh(id)
    const action = statusChanged ? (after.active ? "activated" : "deactivated") : roleChanged ? "roleChanged" : "updated"
    await this.audit.record({ actor, entity: "user", entityId: id, ref: after.username, action, changes: compat().diff(u, after, USER_FIELDS) })
    return after
  }

  /** New one-time password, forced change at next sign-in, sessions revoked, lockout cleared. */
  @Post(":id/reset-password") @Authed("users.manage") @HttpCode(200)
  async reset(@Param("id") id: string, @Req() req: AuthedRequest) {
    const actor = req.dz!.user
    const row = await this.users.byId(id)
    if (!row) throw new Problem(404, "User not found")
    if (row.id === actor.id) throw new Problem(422, "Use “Change password” for your own account.", { _: ["self"] })
    const pw = tempPassword()
    await db.update(users).set({ passwordHash: await hashPassword(pw), passwordIsDemo: false, mustChangePassword: true }).where(eq(users.id, id))
    await this.sessions.revokeUser(id, "passwordReset")
    await db.delete(loginFailures).where(eq(loginFailures.username, row.username))
    const u = await this.users.refresh(id)
    await this.audit.record({ actor, entity: "user", entityId: u.id, ref: u.username, action: "passwordReset" })
    return { tempPassword: pw }
  }
}
