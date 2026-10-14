import { recordAudit } from "@/lib/mock/audit"
import { bulkImportInput } from "@/lib/schemas"
import { json, withAuth, zodProblem } from "../_lib"
import { bulkImport, importOnboarding, mockOnboardingWorld } from "../_r62"

/**
 * R6.2 (NBR enlistment — bulk upload): POST { entity: items|customers|vendors, dryRun, rows } — rows are spreadsheet
 * records with field-name keys (the browser parses CSV / XLSX). dryRun validates only; otherwise all valid rows are
 * created in one go, or none if any row has an issue (created = 0, issues listed). Existing records are skipped.
 *
 * R7.4 (onboarding): entity may also be openingStock or purchases — the rows become draft opening entries and
 * draft purchase invoices (rows sharing an invoice number are one invoice's lines), created through the same code
 * path the single-doc POSTs take. Drafts move no stock and count in no return until approved the ordinary way.
 *
 * R7.6: and sales — historical invoices for finished goods, one row per line, rows sharing an invoice number
 * one invoice; a foreign customer makes it a zero-rated direct export (LC block from the sheet); the old
 * system's number rides in the narration, which is what a re-upload de-duplicates on.
 */
export const POST = withAuth("master.edit", async (req, _ctx, user) => {
  const parsed = bulkImportInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const { entity, dryRun, rows } = parsed.data
  const audit = (e: { entity: "item" | "customer" | "vendor" | "opening" | "purchase" | "sale" | "import"; entityId?: string; ref: string; note?: string }) =>
    recordAudit({ actor: user, entity: e.entity, entityId: e.entityId, ref: e.ref, action: e.entity === "import" ? "imported" : "created", note: e.note })
  const r = entity === "openingStock" || entity === "purchases" || entity === "sales"
    ? await importOnboarding(entity, rows, dryRun, user, audit, mockOnboardingWorld())
    : bulkImport(entity, rows, dryRun, user, audit)
  return json(r, { status: !dryRun && r.created ? 201 : 200 })
})
