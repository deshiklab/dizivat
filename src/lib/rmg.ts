/**
 * R6 — RMG (ready-made garments) export compliance.
 *
 * Direct export: zero-rated (Mushak 9.1 note 1) on the strength of the export LC / contract, the EXP form and the
 * Bill of Export. Deemed export: a local supply to a 100 % export-oriented factory is zero-rated (note 2) only when
 * all five conditions of NBR's clarification of 9 October 2025 hold — otherwise VAT at 15 % applies.
 */
import type { ExportInfo, Party, Sale } from "./types"

export const EXPORT_CURRENCIES = ["USD", "EUR", "GBP", "BDT"] as const

export type DeemedCheck = "actualExporter" | "backToBackLc" | "foreignCurrency" | "bondedExporter" | "inUdUp"
export type DirectCheck = "exportLc" | "expForm" | "billOfExport" | "foreignCurrency" | "customsDestination"
export interface ExportCheck<K extends string = DeemedCheck | DirectCheck> { key: K; ok: boolean }
export interface ExportCompliance { kind: "direct" | "deemed"; checks: ExportCheck[]; complete: boolean; missing: string[] }

type Buyer = Pick<Party, "exporterType" | "bondLicenseNo" | "bondLicenseExpiry"> | undefined

const fc = (e: Partial<ExportInfo>) => !!e.currency && e.currency !== "BDT" && (e.fcValue ?? 0) > 0

/** The five NBR conditions for a zero-rated deemed export (supply to an exporter against a back-to-back LC). */
export function deemedChecks(e: Partial<ExportInfo>, buyer: Buyer, date: string): ExportCheck<DeemedCheck>[] {
  const bond = (e.exporterBond || buyer?.bondLicenseNo || "").trim()
  const bondValid = !!bond && (!buyer?.bondLicenseExpiry || buyer.bondLicenseExpiry >= date)
  return [
    { key: "actualExporter", ok: !!buyer?.exporterType },
    { key: "backToBackLc", ok: !!e.lcNo?.trim() && !!e.lcDate },
    { key: "foreignCurrency", ok: fc(e) },
    { key: "bondedExporter", ok: bondValid },
    { key: "inUdUp", ok: !!e.udNo?.trim() },
  ]
}

/** Documents that support a zero-rated direct export. */
export function directChecks(e: Partial<ExportInfo>): ExportCheck<DirectCheck>[] {
  return [
    { key: "exportLc", ok: !!e.lcNo?.trim() && !!e.lcDate },
    { key: "expForm", ok: !!e.expNo?.trim() },
    { key: "billOfExport", ok: !!e.billNo?.trim() && !!e.billDate },
    { key: "foreignCurrency", ok: fc(e) },
    { key: "customsDestination", ok: !!e.customsHouse && !!e.country },
  ]
}

export function exportCompliance(s: Pick<Sale, "export" | "issueDate">, buyer: Buyer): ExportCompliance | undefined {
  const e = s.export
  if (!e) return undefined
  const checks: ExportCheck[] = e.deemed ? deemedChecks(e, buyer, s.issueDate) : directChecks(e)
  const missing = checks.filter((c) => !c.ok).map((c) => c.key)
  return { kind: e.deemed ? "deemed" : "direct", checks, complete: !missing.length, missing }
}

/** BDT value of the foreign-currency amount (for the register's reconciliation column). */
export const fcToBdt = (e: Partial<ExportInfo>) => (e.fcValue && e.exchangeRate ? Math.round(e.fcValue * e.exchangeRate * 100) / 100 : 0)

/** Default register start: 1 July of the previous fiscal year (Bangladesh FY runs July–June). */
export const registerFrom = (today: string) => `${Number(today.slice(0, 4)) - (today.slice(5, 7) >= "07" ? 1 : 2)}-07-01`
