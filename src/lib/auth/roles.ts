import type { CompanySummary } from "../types"

/** Roles & permissions — mirrors the Symfony security voters planned for R1 (see plan §4). */
/** vatOfficer (R6.2): an NBR VAT official given read-only, time-limited access for audit (GO 16/Mushak/2019);
 *  every page they open is written to the audit trail. */
export type Role = "admin" | "approver" | "operator" | "viewer" | "vatOfficer"
export type Permission =
  | "doc.create" | "doc.edit" | "doc.delete" | "doc.approve" | "doc.cancel"
  | "master.edit" | "users.manage" | "settings.manage" | "audit.view" | "export"

export const ROLES: Role[] = ["admin", "approver", "operator", "viewer", "vatOfficer"]
export const PERMISSIONS: Permission[] = [
  "doc.create", "doc.edit", "doc.delete", "doc.approve", "doc.cancel", "master.edit", "users.manage", "settings.manage", "audit.view", "export",
]
export const ROLE_PERMS: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  approver: ["doc.create", "doc.edit", "doc.delete", "doc.approve", "doc.cancel", "master.edit", "audit.view", "export"],
  operator: ["doc.create", "doc.edit", "doc.delete", "export"],
  // The VAT consultant / auditor needs the audit trail — that is the point of the role
  viewer: ["audit.view", "export"],
  // NBR official: reads everything a viewer can, incl. the audit trail; never writes
  vatOfficer: ["audit.view", "export"],
}
/** Longest access an administrator may grant a VAT officer in one go (days). */
export const OFFICER_MAX_DAYS = 90
/** Today in Asia/Dhaka (UTC+6, no DST) on the real clock — access expiry is a security control, not demo data. */
export const dhakaToday = (now = Date.now()) => new Date(now + 6 * 36e5).toISOString().slice(0, 10)
/** A VAT officer whose access period has ended (or was never set) cannot sign in; open sessions stop working. */
export const accessExpired = (u: Pick<User, "role" | "accessUntil">, today = dhakaToday()) => u.role === "vatOfficer" && (!u.accessUntil || u.accessUntil < today)
/** 422 field error for an officer's access date, or null: from today up to OFFICER_MAX_DAYS ahead. */
export function accessUntilError(role: string, accessUntil: string | undefined, today = dhakaToday()): string | null {
  if (role !== "vatOfficer") return null
  if (!accessUntil) return "required"
  if (accessUntil < today) return "accessPast"
  const max = new Date(Date.parse(today) + OFFICER_MAX_DAYS * 864e5).toISOString().slice(0, 10)
  return accessUntil > max ? "accessTooLong" : null
}

export interface User {
  id: string
  username: string
  name: string
  designation: string
  initials: string
  email: string
  role: Role
  mobile?: string
  department?: string
  /** deactivated users cannot sign in; existing sessions stop working immediately */
  active: boolean
  createdAt: string
  lastSignInAt?: string
  /** set after an admin reset / invite: the next sign-in must choose a new password */
  mustChangePassword?: boolean
  /** R6.2: last day (YYYY-MM-DD, Asia/Dhaka) a VAT officer may sign in; required for that role */
  accessUntil?: string
}

export interface Preferences {
  theme?: "light" | "dark" | "system"
  accent?: "blue" | "emerald" | "violet" | "orange"
  density?: "compact" | "cozy" | "comfortable"
  text?: "md" | "lg" | "xl"
}

export interface SavedView { name: string; query: string }

export interface Me { user: User; permissions: Permission[]; preferences: Preferences; company: CompanySummary }

export const can = (perms: readonly Permission[] | undefined, p?: Permission) => !p || !!perms?.includes(p)
