import { recordAudit } from "@/lib/mock/audit"
import { json, withAuth } from "../_lib"
import { backupStatus, createBackup, ensureScheduled, lastSlot } from "../_r62"

/**
 * R6.2 (GO 16/Mushak/2019): database backups — two scheduled a day (02:00 and 14:00 Asia/Dhaka), the last 30 kept,
 * each a gzip JSON snapshot with its SHA-256. In the mock they live in memory; the PostgreSQL build has a native module.
 */
export const GET = withAuth("settings.manage", async () => {
  await ensureScheduled()
  return json(backupStatus())
})

/** Take a backup now. */
export const POST = withAuth("settings.manage", async (_req, _ctx, user) => {
  const b = await createBackup("manual", user.name, lastSlot().slot)
  recordAudit({ actor: user, entity: "backup", entityId: b.id, ref: `Backup ${b.at.slice(0, 16).replace("T", " ")} UTC`, action: "backedUp", note: `${Math.round(b.size / 1024)} KB · SHA-256 ${b.sha256.slice(0, 12)}…` })
  return json(b, { status: 201 })
})
