import { json, problem, withAuth } from "../../../_lib"
import { verifyBackup } from "../../../_r62"

type Ctx = { params: Promise<{ id: string }> }

/** Re-hash a stored backup and compare with the SHA-256 recorded when it was taken. */
export const POST = withAuth<Ctx>("settings.manage", async (_req, { params }) => {
  const r = await verifyBackup((await params).id)
  return r ? json(r) : problem(404, "Backup not found")
})
