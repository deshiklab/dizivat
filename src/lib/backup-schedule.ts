/**
 * R6.2 (GO 16/Mushak/2019 — at least two backups a day): the backup schedule, shared by the mock API and the
 * native PostgreSQL backup module. Pure functions, Asia/Dhaka (UTC+6, no DST).
 */
export const BACKUP_SLOTS = ["02:00", "14:00"] as const
export const BACKUP_KEEP = 30
export const BACKUP_FORMAT = "dizivat-backup/1"

/** The most recent schedule slot at or before `now`, as "YYYY-MM-DD HH:MM" and its instant. */
export function lastSlot(now = Date.now()): { slot: string; at: number } {
  const local = new Date(now + 6 * 36e5)
  const day = local.toISOString().slice(0, 10)
  const hm = local.toISOString().slice(11, 16)
  const today = [...BACKUP_SLOTS].reverse().find((s) => s <= hm)
  if (today) return { slot: `${day} ${today}`, at: Date.parse(`${day}T${today}:00+06:00`) }
  const y = new Date(now + 6 * 36e5 - 864e5).toISOString().slice(0, 10)
  const s = BACKUP_SLOTS[BACKUP_SLOTS.length - 1]
  return { slot: `${y} ${s}`, at: Date.parse(`${y}T${s}:00+06:00`) }
}

/** ISO instant of the next slot after `now`. */
export function nextSlot(now = Date.now()): string {
  const { at } = lastSlot(now)
  for (let h = 1; h <= 24; h++) { const t = at + h * 36e5; const s = lastSlot(t); if (s.at > at) return new Date(s.at).toISOString() }
  return new Date(at + 864e5).toISOString()
}

/** Asia/Dhaka calendar day of an ISO instant. */
export const dhakaDayOf = (iso: string) => new Date(Date.parse(iso) + 6 * 36e5).toISOString().slice(0, 10)
/** "Backup 2026-09-25 08:00 UTC" — the audit-trail reference. */
export const backupRef = (at: string) => `Backup ${at.slice(0, 16).replace("T", " ")} UTC`
/** Download file name. */
export const backupFileName = (at: string) => `dizivat-backup-${at.slice(0, 19).replace(/[:T]/g, "-")}.json.gz`
