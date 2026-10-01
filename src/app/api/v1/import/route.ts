import { recordAudit } from "@/lib/mock/audit"
import { bulkImportInput } from "@/lib/schemas"
import { json, withAuth, zodProblem } from "../_lib"
import { bulkImport } from "../_r62"

/**
 * R6.2 (NBR enlistment — bulk upload): POST { entity: items|customers|vendors, dryRun, rows } — rows are spreadsheet
 * records with field-name keys (the browser parses CSV / XLSX). dryRun validates only; otherwise all valid rows are
 * created in one go, or none if any row has an issue (created = 0, issues listed). Existing records are skipped.
 */
export const POST = withAuth("master.edit", async (req, _ctx, user) => {
  const parsed = bulkImportInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const { entity, dryRun, rows } = parsed.data
  const r = bulkImport(entity, rows, dryRun, user, (e) => recordAudit({ actor: user, entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.entity === "import" ? "imported" : "created", note: e.note }))
  return json(r, { status: !dryRun && r.created ? 201 : 200 })
})
