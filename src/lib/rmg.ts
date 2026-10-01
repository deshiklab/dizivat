/**
 * R6 — RMG (ready-made garments) export compliance.
 *
 * Direct export: zero-rated (Mushak 9.1 note 1) on the strength of the export LC / contract, the EXP form and the
 * Bill of Export. Deemed export: a local supply to a 100 % export-oriented factory is zero-rated (note 2) only when
 * all five conditions of NBR's clarification of 9 October 2025 hold — otherwise VAT at 15 % applies.
 */
import type { SubconProcess, BondRow, ExportInfo, Party, ProceedsState, Sale, UdRecord, UdRow, UdState } from "./types"

export const EXPORT_CURRENCIES = ["USD", "EUR", "GBP", "BDT"] as const

export type DeemedCheck = "actualExporter" | "backToBackLc" | "foreignCurrency" | "bondedExporter" | "inUdUp" | "udBalance"
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

/**
 * R6.2: when the UD quoted on a deemed export is in the UD register, the invoice must also fit it — UD active and
 * not expired on the invoice date, every item listed, and quantities within what is left (`udBalance`). A UD that is
 * not in the register adds no check (the number alone satisfies condition 5, as in R6.1).
 */
export function exportCompliance(s: Pick<Sale, "export" | "issueDate"> & Partial<Pick<Sale, "lines">>, buyer: Buyer, fit?: UdFit | null): ExportCompliance | undefined {
  const e = s.export
  if (!e) return undefined
  const checks: ExportCheck[] = e.deemed ? deemedChecks(e, buyer, s.issueDate) : directChecks(e)
  if (e.deemed && fit) checks.push({ key: "udBalance", ok: fit.ok })
  const missing = checks.filter((c) => !c.ok).map((c) => c.key)
  return { kind: e.deemed ? "deemed" : "direct", checks, complete: !missing.length, missing }
}

/** BDT value of the foreign-currency amount (for the register's reconciliation column). */
export const fcToBdt = (e: Partial<ExportInfo>) => (e.fcValue && e.exchangeRate ? Math.round(e.fcValue * e.exchangeRate * 100) / 100 : 0)

/** Default register start: 1 July of the previous fiscal year (Bangladesh FY runs July–June). */
export const registerFrom = (today: string) => `${Number(today.slice(0, 4)) - (today.slice(5, 7) >= "07" ? 1 : 2)}-07-01`

/* ── R6.2 — UD / UP register ─────────────────────────────────────────────────────────────────────────── */

const norm = (x?: string) => (x ?? "").trim().toUpperCase()
/** Days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)
/** UD usage at which the register warns (the exporter must amend the UD before more supplies). */
export const UD_WARN_PCT = 80

/** The UD record an invoice quotes (same customer, same number), if it is in the register. */
export const findUd = (uds: UdRecord[], customerId: string, udNo?: string) =>
  udNo?.trim() ? uds.find((u) => u.customerId === customerId && norm(u.no) === norm(udNo)) : undefined

/** Deemed-export quantities already drawn against each UD line (cancelled invoices excluded). */
export function udUses(ud: UdRecord, sales: Sale[], excludeSaleId?: string) {
  const out = new Map<string, { qty: number; uses: { saleId: string; invoiceNo: string; date: string; qty: number; process: Sale["process"] }[] }>()
  for (const s of sales) {
    if (s.id === excludeSaleId || s.process === "Cancelled" || !s.export?.deemed || s.customerId !== ud.customerId || norm(s.export.udNo) !== norm(ud.no)) continue
    for (const l of s.lines) {
      const r = out.get(l.itemId) ?? { qty: 0, uses: [] }
      r.qty += l.qty
      r.uses.push({ saleId: s.id, invoiceNo: s.invoiceNo, date: s.issueDate, qty: l.qty, process: s.process })
      out.set(l.itemId, r)
    }
  }
  return out
}

export type UdProblem = "closed" | "expired" | "notListed" | "exceeds"
export interface UdFit { ok: boolean; udId: string; problems: UdProblem[]; lines: { itemId: string; qty: number; remaining: number; listed: boolean }[] }

/** Does an invoice (its lines, on its date) fit the UD's remaining quantities? Other invoices only — not itself. */
export function udFit(ud: UdRecord, lines: { itemId: string; qty: number }[], issueDate: string, sales: Sale[], saleId?: string): UdFit {
  const used = udUses(ud, sales, saleId)
  const need = new Map<string, number>()
  for (const l of lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty)
  const problems = new Set<UdProblem>()
  if (ud.status === "closed") problems.add("closed")
  if (ud.expiry < issueDate) problems.add("expired")
  const out = [...need].map(([itemId, qty]) => {
    const line = ud.lines.find((x) => x.itemId === itemId)
    const remaining = line ? Math.round((line.qty - (used.get(itemId)?.qty ?? 0)) * 1000) / 1000 : 0
    if (!line) problems.add("notListed")
    else if (qty > remaining + 1e-9) problems.add("exceeds")
    return { itemId, qty, remaining, listed: !!line }
  })
  return { ok: !problems.size, udId: ud.id, problems: [...problems], lines: out }
}

/** Fit of a saved / draft invoice against the register (null when it quotes no registered UD). */
export function udFitForSale(s: Pick<Sale, "id" | "customerId" | "issueDate" | "lines" | "export">, uds: UdRecord[], sales: Sale[]): UdFit | null {
  if (!s.export?.deemed) return null
  const ud = findUd(uds, s.customerId, s.export.udNo)
  return ud ? udFit(ud, s.lines, s.issueDate, sales, s.id) : null
}

/** Register row: usage per line, overall % and state. */
export function udRow(ud: UdRecord, sales: Sale[], today: string): UdRow {
  const used = udUses(ud, sales)
  const lines = ud.lines.map((l) => {
    const u = used.get(l.itemId)
    const q = Math.round((u?.qty ?? 0) * 1000) / 1000
    return { ...l, used: q, remaining: Math.round((l.qty - q) * 1000) / 1000, pct: l.qty ? Math.round((q / l.qty) * 1000) / 10 : 0, uses: u?.uses ?? [] }
  })
  const usedPct = lines.length ? Math.max(...lines.map((l) => l.pct)) : 0
  const daysLeft = daysBetween(today, ud.expiry)
  const state: UdState = ud.status === "closed" ? "closed" : lines.some((l) => l.remaining < -1e-9) ? "over" : daysLeft < 0 ? "expired"
    : lines.length && lines.every((l) => l.remaining <= 1e-9) ? "exhausted" : usedPct >= UD_WARN_PCT ? "warn" : "ok"
  const invoices = new Set(lines.flatMap((l) => l.uses.map((x) => x.saleId))).size
  return { ...ud, lines, usedPct, state, invoices, daysLeft }
}

/** Bond licence watch-list (own licence + every exporter customer), warning BOND_WARN_DAYS before expiry. */
export const BOND_WARN_DAYS = 90
export function bondRows(own: { name: string; licenceNo: string; expiry: string } | null, customers: Party[], today: string): BondRow[] {
  const row = (kind: BondRow["kind"], name: string, licenceNo: string, expiry: string, partyId?: string): BondRow => {
    const daysLeft = expiry ? daysBetween(today, expiry) : null
    const state: BondRow["state"] = !licenceNo || !expiry ? "missing" : daysLeft! < 0 ? "expired" : daysLeft! <= BOND_WARN_DAYS ? "expiring" : "valid"
    return { kind, partyId, name, licenceNo, expiry, daysLeft, state }
  }
  const rows = customers.filter((c) => c.exporterType && c.active !== false).map((c) => row("customer", c.name, c.bondLicenseNo ?? "", c.bondLicenseExpiry ?? "", c.id))
  if (own && (own.licenceNo || own.expiry)) rows.unshift(row("own", own.name, own.licenceNo, own.expiry))
  const order = { expired: 0, missing: 1, expiring: 2, valid: 3 }
  return rows.sort((a, b) => (a.kind === "own" ? -1 : b.kind === "own" ? 1 : order[a.state] - order[b.state] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0)))
}

/* ── R6.2 — export proceeds (PRC) ────────────────────────────────────────────────────────────────────── */

/** Export proceeds must be repatriated within 120 days of shipment (Bangladesh Bank, Guidelines for Foreign Exchange
 *  Transactions, ch. 8). Deemed exports (back-to-back LCs) are tracked against the same limit. */
/** R6.2: what a contractor does on a contractual (Mushak 6.4) batch */
export const SUBCON_PROCESSES = ["manufacture", "printing", "embroidery", "washing", "dyeing", "lamination", "other"] as const satisfies readonly SubconProcess[]

export const PROCEEDS_DAYS = 120
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)

export function proceedsOf(e: Partial<ExportInfo>, invoiceDate: string, today: string): { realisedFc: number; outstandingFc: number; due?: string; state: ProceedsState } {
  const realisedFc = Math.round((e.realisations ?? []).reduce((t, r) => t + r.fcAmount, 0) * 100) / 100
  if (!e.fcValue || !e.currency || e.currency === "BDT") return { realisedFc, outstandingFc: 0, state: "na" }
  const outstandingFc = Math.max(0, Math.round((e.fcValue - realisedFc) * 100) / 100)
  const due = addDays(e.billDate || invoiceDate, PROCEEDS_DAYS)
  const state: ProceedsState = outstandingFc <= 0.005 ? "realised" : today > due ? "overdue" : realisedFc > 0 ? "partial" : "outstanding"
  return { realisedFc, outstandingFc, due, state }
}
