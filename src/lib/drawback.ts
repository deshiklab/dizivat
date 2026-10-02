/**
 * R6.5 (RMG) — duty-drawback claims (Customs, DEDO; claim form Mushak-22).
 *
 * The R6.4 drawback view works out, per export, the customs duty + regulatory duty paid on the imported inputs it
 * consumed. A claim takes one or more of those exports to the Duty Exemption & Drawback Office within 6 months of the
 * export: draft → filed (DEDO reference) → sanctioned (possibly less than claimed, with the reason) → paid; a filed
 * claim can also be rejected, which frees its exports to be claimed again while their window is open.
 */
import { daysBetween } from "./sd-export"
import { round2 } from "./vat"
import type { ClaimStatus, DrawbackClaim, DrawbackClaimLine, DrawbackClaimList, DrawbackClaimRow, DrawbackRow } from "./types"

export const CLAIM_MAX_EXPORTS = 30

/** Claim lines from the drawback rows of the chosen exports (amounts frozen at creation). */
export function claimLines(rows: DrawbackRow[]): DrawbackClaimLine[] {
  return rows.map((r) => ({
    saleId: r.saleId, invoiceNo: r.invoiceNo, exportDate: r.exportDate, billNo: r.billNo, deemed: r.deemed, customerName: r.customerName,
    deadline: r.deadline, inputs: r.inputs.map((x) => ({ ...x })), cd: r.cd, rd: r.rd, total: r.total,
  }))
}

export function claimTotals(lines: DrawbackClaimLine[]) {
  const cd = round2(lines.reduce((a, l) => a + l.cd, 0)), rd = round2(lines.reduce((a, l) => a + l.rd, 0))
  return { cd, rd, claimed: round2(cd + rd) }
}

/** Which exports can go on a new claim: on the drawback view, still inside the window, not on an active claim. */
export function claimableCheck(saleIds: string[], rows: DrawbackRow[], claims: DrawbackClaim[], selfId?: string): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {}
  const seen = new Set<string>()
  saleIds.forEach((id, i) => {
    const r = rows.find((x) => x.saleId === id)
    if (seen.has(id)) errors[`saleIds.${i}`] = ["duplicate"]
    else if (!r) errors[`saleIds.${i}`] = ["notClaimable"]
    else if (claims.some((c) => c.id !== selfId && c.status !== "rejected" && c.lines.some((l) => l.saleId === id))) errors[`saleIds.${i}`] = ["alreadyClaimed"]
    else if (r.state === "lapsed") errors[`saleIds.${i}`] = ["lapsed"]
    seen.add(id)
  })
  return Object.keys(errors).length ? errors : null
}

export type ClaimAction = "file" | "sanction" | "pay" | "reject"
/** The status each action needs. */
export const ACTION_FROM: Record<ClaimAction, ClaimStatus[]> = { file: ["draft"], sanction: ["filed"], pay: ["sanctioned"], reject: ["filed"] }

export function claimRow(c: DrawbackClaim, today: string): DrawbackClaimRow {
  const deadline = c.lines.map((l) => l.deadline).sort()[0] ?? ""
  return {
    ...c, deadline, daysLeft: deadline ? daysBetween(today, deadline) : 0,
    disallowed: c.sanctioned != null && (c.status === "sanctioned" || c.status === "paid") ? round2(c.claimed - c.sanctioned) : 0,
  }
}

const ORDER: Record<ClaimStatus, number> = { draft: 0, filed: 1, sanctioned: 2, paid: 3, rejected: 4 }
export function claimList(claims: DrawbackClaim[], today: string, status?: string): DrawbackClaimList {
  const all = claims.map((c) => claimRow(c, today))
  const rows = all.filter((r) => !status || r.status === status)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.createdAt < b.createdAt ? 1 : -1))
  const sum = (xs: DrawbackClaimRow[], f: (r: DrawbackClaimRow) => number) => round2(xs.reduce((a, r) => a + f(r), 0))
  return {
    rows,
    totals: {
      draft: sum(all.filter((r) => r.status === "draft"), (r) => r.claimed),
      pending: sum(all.filter((r) => r.status === "filed"), (r) => r.claimed),
      sanctioned: sum(all.filter((r) => r.status === "sanctioned"), (r) => r.sanctioned ?? 0),
      refunded: sum(all.filter((r) => r.status === "paid"), (r) => r.paid ?? 0),
      disallowed: sum(all, (r) => r.disallowed),
      rejected: sum(all.filter((r) => r.status === "rejected"), (r) => r.claimed),
    },
  }
}
