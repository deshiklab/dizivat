/**
 * R6.3 — supplementary duty paid on inputs of exported goods (Mushak 9.1 note 40).
 *
 * SD paid on a purchase (normally on import, e.g. polybags, gum tape, cartons) is not an input-tax credit. When the
 * input goes into goods exported within six months of the purchase, the SD may be taken back as a decreasing
 * adjustment of SD in the return of the period of the claim (note 40, which reduces note 36 — net payable SD).
 *
 * Pure module shared by the mock API, the NestJS compat layer, the seed and the browser. A claim is a VAT adjustment
 * of kind "sdExport" that links one SD-paid purchase line to one approved direct-export invoice; the amount is the
 * SD of the line pro rata to the quantity claimed. Drafts reserve their quantity so the same SD cannot be claimed twice.
 */
import type { Purchase, Sale, SdEligible, SdEligibleExport, SdEligibleRow, SdExportLink, VatAdjustment } from "./types"
import { round2 } from "./vat"

export const SD_EXPORT_MONTHS = 6
/** a window with fewer days left than this is flagged "expiring" */
export const SD_EXPIRING_DAYS = 30

const parse = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 864e5)

/** Same day `n` months later, clamped to the month end (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(date: string, n: number) {
  const d = parse(date)
  const day = d.getUTCDate()
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  t.setUTCDate(Math.min(day, last))
  return iso(t)
}
/** Last export date that still qualifies for SD paid on a purchase of `purchaseDate`. */
export const sdDeadline = (purchaseDate: string) => addMonths(purchaseDate, SD_EXPORT_MONTHS)

export const isDirectExport = (s: Sale) => !!s.export && !s.export.deemed && s.process === "Approved"

interface Src { purchases: Purchase[]; sales: Sale[]; adjustments: VatAdjustment[] }

/** Quantity of a purchase line already claimed (approved or draft claims, cancelled ones excluded). */
export function claimedOf(adjustments: VatAdjustment[], purchaseId: string, itemId: string, excludeId?: string) {
  let qty = 0, amount = 0
  for (const a of adjustments) {
    if (a.kind !== "sdExport" || !a.sdExport || a.process === "Cancelled" || a.id === excludeId) continue
    if (a.sdExport.purchaseId !== purchaseId || a.sdExport.itemId !== itemId) continue
    qty += a.sdExport.qty; amount += a.amount
  }
  return { qty: round2(qty), amount: round2(amount) }
}

/** The six-month register: every approved SD-paid purchase line, what is claimed, what is left and until when. */
export function sdEligible(src: Src, today: string, excludeId?: string): SdEligible {
  const rows: SdEligibleRow[] = []
  for (const p of src.purchases) {
    if (p.process !== "Approved") continue
    for (const l of p.lines) {
      if (!(l.sd > 0) || !(l.qty > 0)) continue
      const c = claimedOf(src.adjustments, p.id, l.itemId, excludeId)
      const deadline = sdDeadline(p.issueDate)
      const daysLeft = daysBetween(today, deadline)
      const remainingQty = round2(Math.max(0, l.qty - c.qty))
      const remaining = round2(Math.max(0, l.sd - c.amount))
      const state: SdEligibleRow["state"] = remainingQty <= 0 || remaining <= 0 ? "claimed" : daysLeft < 0 ? "lapsed" : daysLeft < SD_EXPIRING_DAYS ? "expiring" : "open"
      rows.push({
        purchaseId: p.id, purchaseNo: p.invoiceNo, purchaseDate: p.issueDate, vendorName: p.vendorName, boeNo: p.boe?.no, mode: p.mode,
        itemId: l.itemId, name: l.name, uom: l.uom, qty: l.qty, sd: round2(l.sd),
        claimedQty: c.qty, claimed: c.amount, remainingQty, remaining, deadline, daysLeft, state,
      })
    }
  }
  rows.sort((a, b) => (a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : a.purchaseNo.localeCompare(b.purchaseNo)))
  const earliest = rows.filter((r) => r.state === "open" || r.state === "expiring").reduce((m, r) => (r.purchaseDate < m ? r.purchaseDate : m), today)
  const exports: SdEligibleExport[] = src.sales
    .filter((s) => isDirectExport(s) && s.issueDate >= earliest && s.issueDate <= today)
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))
    .map((s) => ({ saleId: s.id, invoiceNo: s.invoiceNo, date: s.issueDate, customerName: s.customerName, expNo: s.export?.expNo, currency: s.export?.currency, fcValue: s.export?.fcValue, subtotal: s.subtotal }))
  const sum = (st: SdEligibleRow["state"]) => round2(rows.filter((r) => r.state === st).reduce((a, r) => a + r.remaining, 0))
  const open = sum("open"), expiring = sum("expiring")
  return { rows, exports, totals: { open, expiring, claimable: round2(open + expiring), lapsed: rows.filter((r) => r.state === "lapsed").length, lapsedUnclaimed: sum("lapsed") } }
}

export interface SdClaimInput { purchaseId?: string; itemId?: string; qty?: number; saleId?: string; issueDate: string; taxPeriod: string }

/**
 * Validates a claim and builds its link + amount. Errors use the shared validation codes, keyed by form field.
 * `excludeId` is the claim being edited (its own quantity does not count against the remaining quantity).
 */
export function sdExportLink(a: SdClaimInput, src: Src, excludeId?: string): { link: SdExportLink; amount: number } | { errors: Record<string, string[]> } {
  const e: Record<string, string[]> = {}
  const p = src.purchases.find((x) => x.id === a.purchaseId)
  if (!a.purchaseId) e.purchaseId = ["required"]
  else if (!p) e.purchaseId = ["unknown"]
  else if (p.process !== "Approved") e.purchaseId = ["sdPurchaseApproved"]
  const l = p?.lines.find((x) => x.itemId === a.itemId)
  if (p && !e.purchaseId) {
    if (!a.itemId) e.itemId = ["required"]
    else if (!l) e.itemId = ["unknown"]
    else if (!(l.sd > 0)) e.itemId = ["sdNoSd"]
  }
  const s = src.sales.find((x) => x.id === a.saleId)
  if (!a.saleId) e.saleId = ["required"]
  else if (!s) e.saleId = ["unknown"]
  else if (!isDirectExport(s)) e.saleId = ["sdDirectExportOnly"]
  const deadline = p ? sdDeadline(p.issueDate) : ""
  if (p && s && !e.saleId && (s.issueDate < p.issueDate || s.issueDate > deadline)) e.saleId = ["sdWindow"]
  if (s && !e.saleId) {
    if (a.issueDate < s.issueDate) e.issueDate = ["beforeSale"]
    // the claim itself must be made inside the window — a lapsed line can no longer be claimed
    else if (a.issueDate > deadline) e.issueDate = ["sdClaimLapsed"]
    if (a.taxPeriod < s.issueDate.slice(0, 7)) e.taxPeriod = ["sdPeriodBeforeExport"]
  }
  if (a.qty == null || !Number.isFinite(a.qty)) e.qty = ["required"]
  else if (!(a.qty > 0)) e.qty = ["positive"]
  else if (p && l && !e.itemId) {
    const c = claimedOf(src.adjustments, p.id, l.itemId, excludeId)
    if (a.qty > round2(l.qty - c.qty) + 1e-9) e.qty = ["sdExceeds"]
  }
  if (Object.keys(e).length || !p || !l || !s) return { errors: Object.keys(e).length ? e : { purchaseId: ["required"] } }
  const qty = a.qty as number
  return {
    amount: round2((l.sd * qty) / l.qty),
    link: {
      purchaseId: p.id, purchaseNo: p.invoiceNo, purchaseDate: p.issueDate, vendorName: p.vendorName, boeNo: p.boe?.no,
      itemId: l.itemId, itemName: l.name, uom: l.uom, purchasedQty: l.qty, qty, sdPaid: round2(l.sd),
      saleId: s.id, saleNo: s.invoiceNo, saleDate: s.issueDate, customerName: s.customerName, deadline,
    },
  }
}
