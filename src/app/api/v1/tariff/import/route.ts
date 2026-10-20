import { recordAudit } from "@/lib/mock/audit"
import { setActiveTariff, tariff, tariffFy } from "@/lib/mock/tariff"
import { tariffImportInput } from "@/lib/schemas"
import { tariffDiff, type TariffImportResult } from "@/lib/tariff-import"
import { json, problem, withAuth, zodProblem } from "../../_lib"

/**
 * R7.1 — import the official NBR tariff for a fiscal year (the file is the authority for the year: its lines
 * replace the year's rows, and the year becomes the one the app looks at). `dryRun` validates and previews
 * only. The mock keeps one year in memory; the native API keeps every year in `tariff_lines` and switches
 * `meta.tariff_fy`.
 */
export const POST = withAuth("master.edit", async (req, _ctx, user) => {
  const parsed = tariffImportInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const { fiscalYear, rows, dryRun } = parsed.data
  const base = tariffFy() === fiscalYear ? [...tariff] : [] // only the year being replaced diffs against its own rows
  const { issues, lines, summary } = tariffDiff(rows, base)
  const valid = rows.length - new Set(issues.map((x) => x.row)).size
  if (!dryRun && issues.length) return problem(422, "Validation failed", { rows: ["issues"] })
  if (!dryRun) {
    setActiveTariff(fiscalYear, lines)
    recordAudit({ actor: user, entity: "tariff", entityId: fiscalYear, ref: `FY ${fiscalYear}`, action: "imported",
      note: `${summary.added} added, ${summary.updated} updated, ${summary.removed} removed, ${summary.unchanged} unchanged` })
  }
  const r: TariffImportResult = {
    fiscalYear, dryRun, total: rows.length, valid, issues, summary,
    applied: dryRun ? 0 : lines.length, activeFy: dryRun ? tariffFy() : fiscalYear,
  }
  return json(r, { status: !dryRun && r.applied ? 201 : 200 })
})
