import { tti } from "./mock/tariff"
import type { TariffLine } from "./types"

/**
 * R7.1 — the NBR tariff import, shared by both runtimes (the mock route and the native module call the same
 * rules, so a file that validates against one validates against the other).
 *
 * The official tariff is published with the budget each June, one row per HS code and fiscal year. An import
 * REPLACES that fiscal year's rows: the file is the authority for the year, so lines it omits are removed and
 * lines it carries overwrite whatever rates were stored — master items keep their own profiles (a difference
 * from the tariff was already flagged as an override with a reason, R5.2), they are not re-pointed.
 *
 * The response is the bulk import's shape plus a preview summary: what the apply would add, update, leave
 * unchanged and remove against the year's current rows. `dryRun` reports only.
 */

/** Fiscal years run July–June and are written `2026-27`. */
export const TARIFF_FY_RE = /^\d{4}-\d{2}$/
/** The official tariff carries ~7,000 lines; the ceiling keeps a wrong upload (a whole workbook) out. */
export const MAX_TARIFF_ROWS = 7500

export type TariffImportIssue = { row: number; field: string; message: string }
export type TariffDiffSummary = { added: number; updated: number; unchanged: number; removed: number }
export type TariffImportResult = {
  fiscalYear: string; dryRun: boolean; total: number; valid: number; issues: TariffImportIssue[]; summary: TariffDiffSummary;
  /** set when not a dry run: the year's rows on file after the apply, and the year the app now looks at */
  applied: number; activeFy: string;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim())
const num = (v: unknown) => { const s = str(v).replace(/,/g, ""); if (!s) return 0; const n = Number(s); return Number.isFinite(n) ? n : NaN }
const RATES = ["cd", "sd", "vat", "ait", "rd", "at"] as const

export type TariffRates = Record<(typeof RATES)[number], number>

/** One spreadsheet row → the stored line (chapter is the HS chapter, TTI is always computed, never uploaded). */
export function tariffPayload(r: Record<string, unknown>): { hsCode: string; description: string } & TariffRates {
  const hs = str(r.hsCode).replace(/\D/g, "")
  const out: { hsCode: string; description: string } & TariffRates = {
    hsCode: hs.length === 10 ? hs.slice(0, 8) : hs, description: str(r.description),
    cd: num(r.cd), sd: num(r.sd), vat: num(r.vat), ait: num(r.ait), rd: num(r.rd), at: num(r.at),
  }
  return out
}

/**
 * Validates every row (HS code 8 digits, description, rates 0–100, no duplicate HS in the file) and diffs the
 * valid lines against the year's current rows. All-or-nothing like the master-data import: with any issue
 * nothing is applied.
 */
export function tariffDiff(rows: Record<string, unknown>[], existing: TariffLine[]): { issues: TariffImportIssue[]; lines: TariffLine[]; summary: TariffDiffSummary } {
  const issues: TariffImportIssue[] = []
  const lines: TariffLine[] = []
  const seen = new Set<string>()
  const byHs = new Map(existing.map((l) => [l.hsCode, l]))
  rows.forEach((raw, i) => {
    const row = i + 2 // spreadsheet row number (row 1 = the header)
    const p = tariffPayload(raw)
    if (!p.hsCode) { issues.push({ row, field: "hsCode", message: "required" }); return }
    if (p.hsCode.length !== 8) { issues.push({ row, field: "hsCode", message: "hsDigits" }); return }
    if (seen.has(p.hsCode)) { issues.push({ row, field: "hsCode", message: "duplicateInFile" }); return }
    seen.add(p.hsCode)
    if (str(raw.description).length < 3) { issues.push({ row, field: "description", message: "descriptionShort" }); return }
    for (const k of RATES) {
      if (Number.isNaN(p[k]) || p[k] < 0 || p[k] > 100) { issues.push({ row, field: k, message: "rate" }); return }
    }
    lines.push({ ...p, chapter: p.hsCode.slice(0, 2), tti: tti(p) })
  })
  const next = new Set(lines.map((l) => l.hsCode))
  const same = (a: TariffLine, b: TariffLine) => a.description === b.description && RATES.every((k) => a[k] === b[k])
  const summary = {
    added: lines.filter((l) => !byHs.has(l.hsCode)).length,
    updated: lines.filter((l) => byHs.has(l.hsCode) && !same(byHs.get(l.hsCode)!, l)).length,
    unchanged: lines.filter((l) => byHs.has(l.hsCode) && same(byHs.get(l.hsCode)!, l)).length,
    removed: existing.filter((l) => !next.has(l.hsCode)).length,
  }
  return { issues, lines, summary }
}
