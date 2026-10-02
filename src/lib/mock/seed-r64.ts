/**
 * R6.4 seed — bonded (IM-7) imports for the bond consumption register. Deterministic and fictitious.
 *
 * Four warehousing Bills of Entry against back-to-back LCs (duty suspended under the general bond):
 *  · Jan 2026 — denim, consumed by the Feb jeans export (cleared);
 *  · Mar 2026 — compact yarn, partly consumed by the polo exports;
 *  · Jul 2026 — denim + pocketing for the next woven order (open);
 *  · Sep 2026 — combed yarn + elastane for the autumn knit order (open).
 * Two go-live carry-forwards on the opening stock (bonded part brought in with its Bill of Entry):
 *  · pocketing, BoE Nov 2024 — the 24-month bonding period ends in early Nov 2026 (expiring);
 *  · printing ink, BoE Aug 2024 — past 24 months, inside the Commissioner's 6-month extension, and the book balance
 *    is larger than the ink on the shelf (shortfall: duty at risk at the bond audit).
 * The imports carry no duty, VAT or input credit, so tax payable, returns and the existing documents are unchanged;
 * they are appended after the R6.3 purchases (p98+) and added to stock.
 */
import type { HistoryEntry, Item, OpeningEntry, Party, Purchase } from "../types"
import { bondedLine } from "../bond"
import { calcImportLine, round2, sumLines } from "../vat"
import { findTariff } from "./tariff"

const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+06:00`).toISOString()
const pad = (n: number, w = 4) => String(n).padStart(w, "0")

interface BondSpec { date: string; vendorId: string; boe: string; lc: string; lcDate: string; usdRate: number; lines: [itemId: string, qty: number, usdUnit: number][] }
const BONDED: BondSpec[] = [
  { date: "2026-01-20", vendorId: "v3", boe: "C-1012264", lc: "BB-LC-0934-25-0412", lcDate: "2025-12-08", usdRate: 121.8, lines: [["i5", 8_000, 2.45]] },
  { date: "2026-03-12", vendorId: "v5", boe: "C-1022835", lc: "BB-LC-0934-26-0031", lcDate: "2026-01-26", usdRate: 122.0, lines: [["i9", 10_000, 3.3]] },
  { date: "2026-07-10", vendorId: "v1", boe: "C-1031147", lc: "BB-LC-0934-26-0089", lcDate: "2026-05-28", usdRate: 122.3, lines: [["i5", 6_000, 2.5], ["i4", 4_000, 1.3]] },
  { date: "2026-09-08", vendorId: "v2", boe: "C-1036620", lc: "BB-LC-0934-26-0142", lcDate: "2026-07-30", usdRate: 122.4, lines: [["i8", 12_000, 3.15], ["i3", 1_500, 5.9]] },
]
/** go-live (1 Jul 2025) opening stock still under bond: opening entry item → Bill of Entry, date and bonded quantity */
const CARRY: { itemId: string; boe: string; date: string; qty: number }[] = [
  { itemId: "i4", boe: "C-0988415", date: "2024-11-05", qty: 9_000 },
  { itemId: "i11", boe: "C-0979032", date: "2024-08-20", qty: 120 },
]

const ratesOf = (it: Item) => {
  const t = findTariff(it.hsCode)
  return { cdRate: t?.cd ?? 10, rdRate: t?.rd ?? 3, sdRate: t?.sd ?? 0, vatRate: t?.vat ?? 15, aitRate: t?.ait ?? 5, atRate: t?.at ?? 5 }
}

/** Adds the bonded imports to `purchases` (approved, paid through the LC, factory branch) and their quantities to stock. */
export function seedBondedImports(purchases: Purchase[], vendors: Party[], items: Item[], branch: { id: string; name: string }) {
  const out: Purchase[] = []
  for (const spec of BONDED) {
    const v = vendors.find((x) => x.id === spec.vendorId)!
    const lines = spec.lines.map(([itemId, qty, usdUnit]) => {
      const it = items.find((x) => x.id === itemId)!
      const rates = ratesOf(it)
      const usd = round2(qty * usdUnit)
      const c = calcImportLine({ qty, usd, usdRate: spec.usdRate, ...rates }, true)
      return bondedLine(it, { qty, usd, usdRate: spec.usdRate, ...rates }, c)
    })
    const t = sumLines(lines, 0)
    const month = `${spec.date.slice(5, 7)}${spec.date.slice(2, 4)}`
    const n = [...purchases, ...out].filter((p) => p.invoiceNo.startsWith(`P-${month}`)).length + 1
    const createdAt = `${spec.date}T10:40:00+06:00`
    const history: HistoryEntry[] = [
      { at: createdAt, by: "Md. Kamal Uddin", action: "created" },
      { at: at(spec.date, "14:20"), by: "Farzana Akter", action: "approved" },
    ]
    const p: Purchase = {
      id: `p${purchases.length + out.length + 1}`, invoiceNo: `P-${month}${pad(n)}`, challanNo: spec.boe, challanDate: spec.date, createdAt, issueDate: spec.date,
      vendorId: v.id, vendorName: v.name, vendorBin: v.bin, vendorAddress: v.address, mode: "Foreign", method: "Transaction",
      lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal, tti: 0, rebate: 0,
      paid: t.netTotal, due: 0, process: "Approved", issuedBy: "Md. Kamal Uddin", designation: "Store Officer",
      narration: `Warehoused under bond (IM-7) against ${spec.lc} — duty suspended; to be consumed in exports within the 24-month bonding period.`,
      branchId: branch.id, branchName: branch.name,
      boe: { no: spec.boe, date: spec.date, lcNo: spec.lc, lcDate: spec.lcDate, customsHouse: v.country === "Korea" ? "101" : "301", origin: v.country ?? "China", cnfFirm: "BAYLINK C&F AGENCY", bonded: true },
      history,
    }
    out.push(p)
    for (const l of lines) items.find((x) => x.id === l.itemId)!.purchased += l.qty
  }
  purchases.push(...out)
  return out
}

/** Marks the bonded part of two go-live opening entries (quantity, value and input tax unchanged). */
export function seedBondCarryForward(openings: OpeningEntry[], items: Item[]) {
  for (const c of CARRY) {
    const os = openings.find((o) => o.itemId === c.itemId && o.process === "Approved")
    const it = items.find((x) => x.id === c.itemId)
    if (!os || !it) continue
    const qty = Math.min(c.qty, os.qty)
    const av = round2(qty * os.price)
    const duty = calcImportLine({ qty, usd: 0, usdRate: 0, av, ...ratesOf(it) }, true)
    os.bond = { boeNo: c.boe, boeDate: c.date, qty, dutyForegone: duty.tti }
  }
}
