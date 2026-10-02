/**
 * PostgreSQL schema (Drizzle). R5.1 moves identity, sessions, audit and reference data into real tables, R5.2 the
 * master data (customers and vendors as `parties`, SKUs as `items`, HS-code products as `master_items`); the
 * business documents still live in `compat_state` until R5.3–R5.5 give each module its own tables.
 * Migrations are generated with `npm run db:generate` into ./drizzle and applied at boot.
 */
import { sql } from "drizzle-orm"
import {
  bigserial, boolean, check, customType, date, index, integer, jsonb, numeric, pgSequence, pgTable, primaryKey, serial, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core"
import type { AuditChange, HistoryEntry } from "@/lib/types"

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
 * R5.2 — customers and vendors: the first business records out of the compat layer. One table, `kind` tells them
 * apart; documents (still in `compat_state` until R5.3) reference them by id.
 * A deleted party keeps its row (`deleted_at`) — that is the 10-second undo trash — so master data never leaves
 * relational storage, and the uniqueness rules the API checks are also enforced here.
 */
export const parties = pgTable("parties", {
  id: text("id").primaryKey(),
  /** insertion order — tie-breaker so sorted lists are stable, exactly like the in-memory mock */
  ord: serial("ord").notNull(),
  kind: text("kind", { enum: ["customer", "vendor"] }).notNull(),
  /** party names in capitals, as printed on Mushak 6.3 */
  name: text("name").notNull(),
  /** BIN (Local), NID (Non-registered) or foreign reference; "" when unknown */
  bin: text("bin").notNull().default(""),
  mode: text("mode").notNull(),
  mobile: text("mobile").notNull().default(""),
  address: text("address").notNull(),
  country: text("country"),
  email: text("email"),
  contactPerson: text("contact_person"),
  /** optional in the contract: NULL means active (only `false` is ever stored) */
  active: boolean("active"),
  /** R3 (customers): credit limit in BDT and VDS-withholder flag — seeded, not editable through the API */
  creditLimit: numeric("credit_limit", { precision: 18, scale: 2, mode: "number" }),
  vdsWithholder: boolean("vds_withholder"),
  /** R6 (RMG): exporter class, customs bond licence and trade-body membership */
  exporterType: text("exporter_type"),
  bondLicenseNo: text("bond_license_no"),
  bondLicenseExpiry: date("bond_license_expiry", { mode: "string" }),
  associationNo: text("association_no"),
  /** in the undo trash: DELETE sets it, restore clears it */
  deletedAt: ts("deleted_at"),
}, (t) => [
  index("parties_live_kind_idx").on(t.kind).where(sql`${t.deletedAt} is null`),
  // the duplicate rules of partyErrors(), enforced by the database (per kind, NID prefix ignored, trash excluded)
  uniqueIndex("parties_live_name_key").on(t.kind, sql`lower(btrim(${t.name}))`).where(sql`${t.deletedAt} is null`),
  uniqueIndex("parties_live_bin_key").on(t.kind, sql`regexp_replace(${t.bin}, '^NID ', '')`).where(sql`${t.bin} <> '' and ${t.deletedAt} is null`),
  check("parties_kind_check", sql`${t.kind} in ('customer','vendor')`),
  check("parties_exporter_check", sql`${t.exporterType} is null or ${t.exporterType} in ('direct','deemed')`),
])

/**
 * R5.2 — SKUs. The movement counters live on the row, so an item's `remain`
 * (opening + purchased + prodReceive − prodIssue − sold − damage) travels with it; the documents that move the
 * counters are still compat state until R5.3 and write them back through the mirror. Quantities carry the units'
 * three decimals, money two. Items are never deleted — an unused one is deactivated (its ledger must stay readable).
 */
export const items = pgTable("items", {
  id: text("id").primaryKey(),
  /** insertion order — tie-breaker so sorted lists are stable, exactly like the in-memory mock */
  ord: serial("ord").notNull(),
  hsCode: text("hs_code").notNull(),
  group: text("group").notNull(),
  /** the master item's *name*: SKUs reference their master by name, so renaming one carries them along */
  masterItem: text("master_item").notNull(),
  brand: text("brand").notNull(),
  name: text("name").notNull(),
  /** unit-of-measure code from the Units master */
  unit: text("unit").notNull(),
  sku: text("sku").notNull(),
  purchasePrice: numeric("purchase_price", { precision: 18, scale: 2, mode: "number" }).notNull(),
  /** derived when the SKU is created (from the purchase price, or the sale price without one) and never edited */
  costPrice: numeric("cost_price", { precision: 18, scale: 2, mode: "number" }).notNull(),
  salePrice: numeric("sale_price", { precision: 18, scale: 2, mode: "number" }).notNull(),
  vatRate: numeric("vat_rate", { precision: 7, scale: 2, mode: "number" }).notNull(),
  sdRate: numeric("sd_rate", { precision: 7, scale: 2, mode: "number" }).notNull(),
  opening: numeric("opening", { precision: 18, scale: 3, mode: "number" }).notNull(),
  purchased: numeric("purchased", { precision: 18, scale: 3, mode: "number" }).notNull(),
  prodReceive: numeric("prod_receive", { precision: 18, scale: 3, mode: "number" }).notNull(),
  prodIssue: numeric("prod_issue", { precision: 18, scale: 3, mode: "number" }).notNull(),
  sold: numeric("sold", { precision: 18, scale: 3, mode: "number" }).notNull(),
  damage: numeric("damage", { precision: 18, scale: 3, mode: "number" }).notNull(),
  reorderLevel: numeric("reorder_level", { precision: 18, scale: 3, mode: "number" }).notNull(),
  active: boolean("active").notNull(),
}, (t) => [
  // SKUs are unique case-insensitively (skuTaken)
  uniqueIndex("items_sku_lower_key").on(sql`lower(${t.sku})`),
  index("items_master_item_idx").on(t.masterItem),
  index("items_hs_code_idx").on(t.hsCode),
  check("items_group_check", sql`${t.group} in ('Raw Material','Consumable','Packing Materials','Finished Goods')`),
])

/**
 * R5.2 — master items: the HS-code product a SKU belongs to, with its tax profile. Rates default from the tariff
 * (`tariff_lines`); a difference is flagged as an override and needs a reason. The profile is stored flat, like the
 * tariff's own columns, so a master item and its HS line can be compared in SQL.
 */
export const masterItems = pgTable("master_items", {
  id: text("id").primaryKey(),
  /** insertion order — tie-breaker so sorted lists are stable, exactly like the in-memory mock */
  ord: serial("ord").notNull(),
  name: text("name").notNull(),
  hsCode: text("hs_code").notNull(),
  group: text("group").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  priceMethod: text("price_method").notNull(),
  description: text("description"),
  vat: numeric("vat", { precision: 7, scale: 2, mode: "number" }).notNull(),
  sd: numeric("sd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  cd: numeric("cd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  rd: numeric("rd", { precision: 7, scale: 2, mode: "number" }).notNull(),
  ait: numeric("ait", { precision: 7, scale: 2, mode: "number" }).notNull(),
  at: numeric("at", { precision: 7, scale: 2, mode: "number" }).notNull(),
  /** mandatory once a rate differs from the tariff (buildMaster) */
  overrideReason: text("override_reason"),
  active: boolean("active").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at"),
  /** the master item's own trail, shown on its register row; the same entries are in `audit_events` */
  history: jsonb("history").$type<HistoryEntry[]>(),
}, (t) => [
  // names are unique case-insensitively (buildMaster)
  uniqueIndex("master_items_name_lower_key").on(sql`lower(${t.name})`),
  index("master_items_hs_code_idx").on(t.hsCode),
  check("master_items_group_check", sql`${t.group} in ('Raw Material','Consumable','Packing Materials','Finished Goods')`),
  check("master_items_category_check", sql`${t.category} in ('general','commercialImporter','medicine','petroleum','superShop')`),
  check("master_items_price_method_check", sql`${t.priceMethod} in ('average','standard')`),
])

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
