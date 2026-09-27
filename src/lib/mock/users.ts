import type { Preferences, SavedView, User } from "../auth/roles"

/**
 * Demo accounts (mock only — never real credentials). Names match the issuers found in the legacy data.
 * Every seeded account uses the password below; the login page lists them. Admin-created users get a
 * one-time temporary password instead (see /api/v1/users).
 */
export const DEMO_PASSWORD = "demo1234"

const SEEDED = "2025-07-01T03:00:00.000Z"
const seedUsers = (): User[] => [
  { id: "u1", username: "chanchal", name: "Chanchal Mahmud", designation: "Shift-In-Charge", initials: "CM", email: "chanchal@pulindustries.com.bd", mobile: "01918-072816", department: "Factory — Dhamrai", role: "approver", active: true, createdAt: SEEDED },
  { id: "u2", username: "nusrat", name: "Nusrat Jahan", designation: "Accounts Executive", initials: "NJ", email: "nusrat@pulindustries.com.bd", mobile: "01711-300400", department: "Head office — Dhanmondi", role: "approver", active: true, createdAt: SEEDED },
  { id: "u3", username: "rafiqul", name: "Md. Rafiqul Islam", designation: "Store Officer", initials: "RI", email: "rafiqul@pulindustries.com.bd", mobile: "01819-556070", department: "Factory — Dhamrai", role: "operator", active: true, createdAt: SEEDED },
  { id: "u4", username: "auditor", name: "Tanvir Hasan", designation: "VAT Consultant", initials: "TH", email: "tanvir.audit@example.com", mobile: "01552-889900", department: "External", role: "viewer", active: true, createdAt: "2026-01-12T04:00:00.000Z" },
  { id: "u5", username: "admin", name: "System Administrator", designation: "IT", initials: "SA", email: "it@pulindustries.com.bd", mobile: "01918-000111", department: "Head office — Dhanmondi", role: "admin", active: true, createdAt: SEEDED },
  // A former employee: kept for the audit trail (legacy "shafiq" account was Disabled)
  { id: "u6", username: "shafiq", name: "Shafiqul Alam", designation: "Store Assistant", initials: "SH", email: "shafiq@pulindustries.com.bd", mobile: "01818-214814", department: "Factory — Dhamrai", role: "operator", active: false, createdAt: SEEDED, lastSignInAt: "2026-03-30T09:12:00.000Z" },
]

interface UserStore {
  users: User[]
  /** uid → password (mock only; Symfony stores hashes). Missing entry = DEMO_PASSWORD. */
  passwords: Record<string, string>
  prefs: Record<string, Preferences>
  views: Record<string, Record<string, SavedView[]>>
  failures: Record<string, { n: number; until: number }>
  /** notifications: uid → ids read, plus a "read everything up to" timestamp */
  notifRead: Record<string, { ids: string[]; allBefore?: string }>
  /** uid → epoch seconds; session tokens issued earlier are void (password reset/change) */
  revokedBefore: Record<string, number>
}
const g = globalThis as unknown as { __rbsUsers3?: UserStore }
export const userStore: UserStore = (g.__rbsUsers3 ??= { users: seedUsers(), passwords: {}, prefs: {}, views: {}, failures: {}, notifRead: {}, revokedBefore: {} })
export const users = userStore.users

export const findUser = (id: string) => users.find((u) => u.id === id)
export const findUserByName = (name: string) => users.find((u) => u.name === name)
export const passwordOf = (uid: string) => userStore.passwords[uid] ?? DEMO_PASSWORD

/** Readable one-time password, e.g. "Pul-kemo-4821" (letters + digits, 13 chars). */
export function tempPassword() {
  const c = "bcdfghjkmnpqrstvwxz", v = "aeiou"
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]
  const word = pick(c) + pick(v) + pick(c) + pick(v)
  return `Pul-${word}-${String(Math.floor(1000 + Math.random() * 9000))}`
}

/** "Md. Rafiqul Islam" → "RI" (honorifics skipped). */
export const initialsOf = (name: string) =>
  name.replace(/^(md|mst|mohammad)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"
