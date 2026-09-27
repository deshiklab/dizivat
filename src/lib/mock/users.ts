import type { Preferences, SavedView, User } from "../auth/roles"

/**
 * Demo accounts (mock only — never real credentials). All names, numbers and addresses are fictitious.
 * Every seeded account uses the password below; the login page lists them. Admin-created users get a
 * one-time temporary password instead (see /api/v1/users).
 */
export const DEMO_PASSWORD = "demo1234"

const SEEDED = "2025-07-01T03:00:00.000Z"
const seedUsers = (): User[] => [
  { id: "u1", username: "arif", name: "Arif Hossain", designation: "Shift-In-Charge", initials: "AH", email: "arif@rupsha-flexipack.example", mobile: "01700-555101", department: "Factory — Kaliakair", role: "approver", active: true, createdAt: SEEDED },
  { id: "u2", username: "farzana", name: "Farzana Akter", designation: "Accounts Executive", initials: "FA", email: "farzana@rupsha-flexipack.example", mobile: "01700-555102", department: "Head office — Banani", role: "approver", active: true, createdAt: SEEDED },
  { id: "u3", username: "kamal", name: "Md. Kamal Uddin", designation: "Store Officer", initials: "KU", email: "kamal@rupsha-flexipack.example", mobile: "01700-555103", department: "Factory — Kaliakair", role: "operator", active: true, createdAt: SEEDED },
  { id: "u4", username: "auditor", name: "Sabbir Rahman", designation: "VAT Consultant", initials: "SR", email: "sabbir.audit@example.com", mobile: "01700-555104", department: "External", role: "viewer", active: true, createdAt: "2026-01-12T04:00:00.000Z" },
  { id: "u5", username: "admin", name: "System Administrator", designation: "IT", initials: "SA", email: "it@rupsha-flexipack.example", mobile: "01700-555105", department: "Head office — Banani", role: "admin", active: true, createdAt: SEEDED },
  // A former employee: kept for the audit trail (account disabled)
  { id: "u6", username: "jewel", name: "Jewel Mia", designation: "Store Assistant", initials: "JM", email: "jewel@rupsha-flexipack.example", mobile: "01700-555106", department: "Factory — Kaliakair", role: "operator", active: false, createdAt: SEEDED, lastSignInAt: "2026-03-30T09:12:00.000Z" },
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

/** Readable one-time password, e.g. "Rfx-kemo-4821" (letters + digits, 13 chars). */
export function tempPassword() {
  const c = "bcdfghjkmnpqrstvwxz", v = "aeiou"
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]
  const word = pick(c) + pick(v) + pick(c) + pick(v)
  return `Rfx-${word}-${String(Math.floor(1000 + Math.random() * 9000))}`
}

/** "Md. Kamal Uddin" → "KU" (honorifics skipped). */
export const initialsOf = (name: string) =>
  name.replace(/^(md|mst|mohammad)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"
