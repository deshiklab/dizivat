import type { CompanySummary } from "../types"

/** Roles & permissions — mirrors the Symfony security voters planned for R1 (see plan §4). */
export type Role = "admin" | "approver" | "operator" | "viewer"
export type Permission =
  | "doc.create" | "doc.edit" | "doc.delete" | "doc.approve" | "doc.cancel"
  | "master.edit" | "users.manage" | "settings.manage" | "audit.view" | "export"

export const ROLES: Role[] = ["admin", "approver", "operator", "viewer"]
export const PERMISSIONS: Permission[] = [
  "doc.create", "doc.edit", "doc.delete", "doc.approve", "doc.cancel", "master.edit", "users.manage", "settings.manage", "audit.view", "export",
]
export const ROLE_PERMS: Record<Role, Permission[]> = {
  admin: [...PERMISSIONS],
  approver: ["doc.create", "doc.edit", "doc.delete", "doc.approve", "doc.cancel", "master.edit", "audit.view", "export"],
  operator: ["doc.create", "doc.edit", "doc.delete", "export"],
  // The VAT consultant / auditor needs the audit trail — that is the point of the role
  viewer: ["audit.view", "export"],
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
