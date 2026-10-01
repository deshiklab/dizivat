/**
 * PostgreSQL schema (Drizzle). R5.1 moves identity, sessions, audit and reference data into real tables;
 * the business documents still live in `compat_state` until R5.2–R5.5 give each module its own tables.
 * Migrations are generated with `npm run db:generate` into ./drizzle and applied at boot.
 */
import { sql } from "drizzle-orm"
import {
  bigserial, boolean, check, customType, date, index, integer, jsonb, numeric, pgSequence, pgTable, primaryKey, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core"
import type { AuditChange } from "@/lib/types"

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: "date" })

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  /** insertion order — tie-breaker so sorted lists are stable, exactly like the in-memory mock */
  ord: serial("ord").notNull(),
  username: text("username").notNull(),
  name: text("name").notNull(),
  designation: text("designation").notNull(),
  initials: text("initials").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "approver", "operator", "viewer", "vatOfficer"] }).notNull(),
  mobile: text("mobile"),
  department: text("department"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** scrypt$N$r$p$salt$hash — never the password itself */
  passwordHash: text("password_hash").notNull(),
  /** seeded account still on the published demo password (listed on the login page) */
  passwordIsDemo: boolean("password_is_demo").notNull().default(false),
  preferences: jsonb("preferences").$type<Record<string, string>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSignInAt: ts("last_sign_in_at"),
  /** R6.2: VAT officer — last day (Asia/Dhaka) the account may sign in; null for every other role */
  accessUntil: date("access_until", { mode: "string" }),
}, (t) => [
  uniqueIndex("users_username_key").on(t.username),
  uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
  check("users_role_check", sql`${t.role} in ('admin','approver','operator','viewer','vatOfficer')`),
  check("users_officer_access_check", sql`${t.role} <> 'vatOfficer' or ${t.accessUntil} is not null`),
])

/** Server-side sessions: the signed cookie carries `sid`; revoking a row signs that browser out immediately. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  remember: boolean("remember").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at"),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"),
  userAgent: text("user_agent"),
  ip: text("ip"),
}, (t) => [index("sessions_user_idx").on(t.userId)])

/** Brute-force protection survives restarts: 5 failures → 60 s lock per username. */
export const loginFailures = pgTable("login_failures", {
  username: text("username").primaryKey(),
  failures: integer("failures").notNull(),
  lockedUntil: ts("locked_until"),
})

export const savedViews = pgTable("saved_views", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tableKey: text("table_key").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  /** re-saving a view moves it to the end, as in the mock */
  pos: bigserial("pos", { mode: "number" }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.tableKey, t.name] })])

/** Single-row company profile (printed on every Mushak form). */
export const company = pgTable("company", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull(),
  vatSlab: text("vat_slab").notNull(),
  bin: text("bin").notNull(),
  tin: text("tin").notNull(),
  mobile: text("mobile").notNull(),
  phone: text("phone"),
  email: text("email").notNull(),
  address: text("address").notNull(),
  owner: jsonb("owner").$type<{ name: string; nid?: string; mobile: string; designation?: string }>().notNull(),
  signatory: jsonb("signatory").$type<{ name: string; designation: string; mobile: string; email: string; nid: string }>().notNull(),
  updatedAt: ts("updated_at"),
  updatedBy: text("updated_by"),
}, (t) => [check("company_single_row", sql`${t.id} = 1`)])

export const branches = pgTable("branches", {
  id: text("id").primaryKey(),
  position: integer("position").notNull(),
  code: text("code"),
  name: text("name").notNull(),
  address: text("address").notNull(),
  category: text("category").notNull(),
})

/** Append-only audit trail (NBR audits rely on it): the app never updates or deletes rows. */
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull(),
  /** calendar day in Asia/Dhaka — the date filter works on it */
  day: date("day", { mode: "string" }).notNull(),
  actor: text("actor").notNull(),
  actorId: text("actor_id"),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  ref: text("ref").notNull(),
  action: text("action").notNull(),
  changes: jsonb("changes").$type<AuditChange[]>(),
  note: text("note"),
  /** R6: tamper-evident chain — hash = SHA-256(prev_hash + "\n" + canonical event); see src/lib/integrity.ts */
  prevHash: text("prev_hash"),
  hash: text("hash"),
}, (t) => [
  index("audit_at_idx").on(t.at),
  index("audit_day_idx").on(t.day),
  index("audit_entity_id_idx").on(t.entityId),
  index("audit_entity_idx").on(t.entity),
])

export const unitIdSeq = pgSequence("unit_id_seq", { startWith: 1 })
export const units = pgTable("units", {
  id: text("id").primaryKey(),
  ord: serial("ord").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  decimals: integer("decimals").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("units_code_lower_key").on(sql`lower(${t.code})`)])

/** NBR customs & VAT tariff, one row per HS code and fiscal year. Rates in %. */
export const tariffLines = pgTable("tariff_lines", {
  fy: text("fy").notNull(),
  hsCode: text("hs_code").notNull(),
  description: text("description").notNull(),
  chapter: text("chapter").notNull(),
  cd: numeric("cd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  sd: numeric("sd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  vat: numeric("vat", { precision: 7, scale: 2, mode: "number" }).notNull(),
  ait: numeric("ait", { precision: 7, scale: 2, mode: "number" }).notNull(),
  rd: numeric("rd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  at: numeric("at", { precision: 7, scale: 2, mode: "number" }).notNull(),
  tti: numeric("tti", { precision: 9, scale: 2, mode: "number" }).notNull(),
}, (t) => [primaryKey({ columns: [t.fy, t.hsCode] })])

/**
 * Modules not yet migrated (sales, purchases, stock, production, accounting, VAT returns…) keep their exact
 * mock behaviour: their state is one JSONB document, saved after every write. R5.2+ replaces it table by table.
 */
export const compatState = pgTable("compat_state", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
})

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

/** R6.2 (GO 16/Mushak/2019 — at least two backups a day): gzip JSON snapshots of every table, with their SHA-256. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" })
export const backups = pgTable("backups", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().defaultNow(),
  kind: text("kind", { enum: ["scheduled", "manual"] }).notNull(),
  /** schedule slot "YYYY-MM-DD HH:MM" (Asia/Dhaka) the backup belongs to */
  slot: text("slot").notNull(),
  by: text("by").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  tables: jsonb("tables").$type<Record<string, number>>().notNull(),
  data: bytea("data").notNull(),
}, (t) => [
  index("backups_at_idx").on(t.at),
  uniqueIndex("backups_scheduled_slot_key").on(t.slot).where(sql`${t.kind} = 'scheduled'`),
  check("backups_kind_check", sql`${t.kind} in ('scheduled','manual')`),
])
