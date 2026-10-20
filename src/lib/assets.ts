/**
 * R9.4 — the fixed-asset fold: the depreciation schedule and the register rows.
 *
 * Depreciation is derived, never stored: straight line at the class's NBR Third Schedule rate, one month
 * at a time from the month the asset was commissioned (a full month's charge — the NBR works in whole
 * months once an asset is in use) to the month being reported on, or the month before it was sold. A
 * revaluation resets the carrying amount against the revaluation reserve (3950) and the charge then runs
 * on the new amount; the salvage applies to the original cost basis alone. The postings themselves are
 * rules in `lib/gl.ts` — this file is the register's read model (the schedule a user can point at).
 */
import type { AssetClass, AssetRegisterRow, AssetSchedule, AssetScheduleRow, FixedAsset } from "./types"
import { round2 } from "./vat"

/** `YYYY-MM` of a date string — the depreciation clock's unit. */
export const monthOf = (date: string) => date.slice(0, 7)

const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) // mo is 1-based; Date.UTC reads it 0-based, landing on the first of the NEXT month
  const d = new Date(Date.UTC(y, mo, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = []
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m)
  return out
}

export const assetClassOf = (asset: FixedAsset, classes: AssetClass[]) =>
  classes.find((c) => c.id === asset.classId) ?? classes.find((c) => c.id === "plant") ?? classes[0]

/** The straight-line charge of one month on a carrying amount, at the class's rate. */
export const monthlyCharge = (base: number, rate: number) => round2((base * rate) / 100 / 12)

/**
 * The schedule: one row per month from commissioning, carrying the base it charges, the month's
 * depreciation, the accumulated total and the closing net book value. A revaluation starts a fresh
 * segment — the carrying amount becomes the valuer's figure, the charge runs on it from that month, and
 * the accumulated column keeps counting the asset's whole life (so the register's NBV is the schedule's
 * last word, never cost minus accum). A disposed asset simply stops the month before the sale.
 */
export function scheduleOf(asset: FixedAsset, cls: AssetClass | undefined, to: string): AssetSchedule {
  const rate = cls?.rate ?? 10
  const endMonth = monthOf(to)
  const startMonth = monthOf(asset.date)
  const disposedMonth = asset.disposal ? monthOf(asset.disposal.date) : undefined
  const revals = [...(asset.revaluations ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
  const rows: AssetScheduleRow[] = []
  let base = asset.cost // what the charge runs on — a revaluation re-bases it
  let salvage = asset.salvage // the salvage belongs to the cost basis alone; a revaluation drops it
  let accum = 0 // this segment's accumulation (since the last revaluation)
  let total = 0 // everything the asset has ever depreciated
  for (const m of monthsBetween(startMonth, endMonth)) {
    if (disposedMonth && m >= disposedMonth) break
    const reval = revals.find((r) => monthOf(r.date) === m)
    if (reval) {
      base = round2(reval.toValue)
      salvage = 0
      accum = 0
      rows.push({ month: m, base, depreciation: 0, accum: total, nbv: base, event: "revalued" })
    }
    let dep = monthlyCharge(base, rate)
    const cap = round2(base - salvage - accum)
    if (dep > cap) dep = Math.max(0, cap)
    if (base - salvage - accum <= 0.005) dep = 0
    accum = round2(accum + dep)
    total = round2(total + dep)
    rows.push({ month: m, base, depreciation: dep, accum: total, nbv: round2(base - accum) })
  }
  if (disposedMonth) rows.push({ month: disposedMonth, base, depreciation: 0, accum: total, nbv: round2(base - accum), event: "disposed" })
  const nbv = round2(base - accum)
  return {
    asset: {
      id: asset.id, no: asset.no, name: asset.name, className: cls?.name ?? "—", rate,
      date: asset.date, cost: asset.cost, salvage: asset.salvage, disposedOn: asset.disposal?.date,
    },
    to,
    rows,
    totals: { depreciation: total },
    disposal: asset.disposal ? { date: asset.disposal.date, proceeds: asset.disposal.proceeds, nbvAtDisposal: nbv, gainLoss: round2(asset.disposal.proceeds - nbv) } : undefined,
  }
}

/** The accumulated depreciation an asset carries as of `to` (a disposed asset stops the month before the sale). */
export const accumulatedOf = (asset: FixedAsset, cls: AssetClass | undefined, to: string) => scheduleOf(asset, cls, to).totals.depreciation

/** The register: every live asset with its class, its derived position as of `to`, and its status. */
export function assetRegisterRows(assets: FixedAsset[], classes: AssetClass[], to: string): AssetRegisterRow[] {
  return assets.map((a) => {
    const cls = assetClassOf(a, classes)
    const status: AssetRegisterRow["status"] =
      a.process === "Created" ? "Draft" : a.process === "Cancelled" ? "Cancelled" : a.disposal ? "Disposed" : "Active"
    // a draft (or a cancelled record) posts nothing — the books only know it once it is approved. Its row
    // shows the cost as entered, and the sheet previews the walk it would run.
    if (a.process !== "Approved") {
      return {
        id: a.id, no: a.no, name: a.name, classId: a.classId, className: cls?.name ?? "—", rate: cls?.rate ?? 0,
        date: a.date, cost: a.cost, accumDep: 0, nbv: a.cost, monthly: 0,
        status, inputVat: a.inputVat, creditable: a.creditable,
        ...(a.branchId ? { branchId: a.branchId } : {}),
        ...(a.purchaseId ? { purchaseId: a.purchaseId } : {}),
        process: a.process,
      }
    }
    const sched = scheduleOf(a, cls, to)
    const accum = sched.totals.depreciation
    // the month's charge runs on the base the schedule ended on; the NBV is its last word (never cost − accum,
    // because a revaluation re-bases the carrying amount without touching the accumulated column)
    const base = sched.rows.length ? sched.rows[sched.rows.length - 1].base : a.cost
    const nbv = sched.disposal?.nbvAtDisposal ?? (sched.rows.length ? sched.rows[sched.rows.length - 1].nbv : a.cost)
    return {
      id: a.id, no: a.no, name: a.name, classId: a.classId, className: cls?.name ?? "—", rate: cls?.rate ?? 0,
      date: a.date, cost: a.cost, accumDep: accum, nbv,
      monthly: !a.disposal ? monthlyCharge(base, cls?.rate ?? 0) : 0,
      status, inputVat: a.inputVat, creditable: a.creditable,
      ...(a.disposal ? { disposalDate: a.disposal.date, disposalProceeds: a.disposal.proceeds, gainLoss: sched.disposal?.gainLoss } : {}),
      ...(a.branchId ? { branchId: a.branchId } : {}),
      ...(a.purchaseId ? { purchaseId: a.purchaseId } : {}),
      process: a.process,
    }
  })
}
