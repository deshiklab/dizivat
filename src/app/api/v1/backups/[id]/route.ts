import { recordAudit } from "@/lib/mock/audit"
import { problem, withAuth } from "../../_lib"
import { backupData } from "../../_r62"

type Ctx = { params: Promise<{ id: string }> }

/** Download one backup (application/gzip — a JSON snapshot of every table). The download is audited. */
export const GET = withAuth<Ctx>("settings.manage", async (_req, { params }, user) => {
  const b = backupData((await params).id)
  if (!b) return problem(404, "Backup not found")
  recordAudit({ actor: user, entity: "backup", entityId: b.id, ref: `Backup ${b.at.slice(0, 16).replace("T", " ")} UTC`, action: "downloaded" })
  const name = `dizivat-backup-${b.at.slice(0, 19).replace(/[:T]/g, "-")}.json.gz`
  return new Response(b.data as unknown as BodyInit, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "X-Backup-SHA256": b.sha256, "Cache-Control": "no-store" } })
})
