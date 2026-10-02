/**
 * R6.3 seed — supplementary duty paid on imported packing materials and its decreasing adjustment against exports
 * (Mushak 9.1 note 40). Deterministic and fictitious.
 *
 * Three Bill-of-Entry purchases of SD-bearing packing (polybags, gum tape, export cartons — SD 20 %):
 *  · Feb 2026 — the six-month window lapsed in Aug 2026 with nothing claimed (the lesson the register teaches);
 *  · Apr 2026 — window ends in early Oct 2026: one approved claim (Sep) against the May export, one draft against June;
 *  · Aug 2026 — window open until Feb 2027, no export shipped against it yet.
 * The purchases are inserted before the R4 seed so returns, payments and the stock ledger include them.
 */
import type { HistoryEntry, Item, Line, Party, Purchase, Sale, VatAdjustment } from "../types"
import { calcImportLine, round2, sumLines } from "../vat"
import { sdExportLink } from "../sd-export"
import { findTariff } from "./tariff"

const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+06:00`).toISOString()
const pad = (n: number, w = 4) => String(n).padStart(w, "0")

interface ImportSpec { date: string; vendorId: string; boe: string; lc: string; lcDate: string; usdRate: number; lines: [itemId: string, qty: number, usdUnit: number][] }
const IMPORTS: ImportSpec[] = [
  { date: "2026-02-16", vendorId: "v4", boe: "C-1019387", lc: "0217-2601-0131", lcDate: "2026-01-04", usdRate: 121.9, lines: [["i16", 120_000, 0.021], ["i15", 900, 0.62]] },
  { date: "2026-04-06", vendorId: "v1", boe: "C-1027716", lc: "0217-2601-0158", lcDate: "2026-02-22", usdRate: 122.1, lines: [["i16", 150_000, 0.02], ["i14", 6_000, 0.48]] },
  { date: "2026-08-19", vendorId: "v4", boe: "C-1034052", lc: "0217-2601-0197", lcDate: "2026-07-08", usdRate: 122.4, lines: [["i16", 100_000, 0.021], ["i15", 600, 0.62]] },
]

/** Adds the SD-paid imports to `purchases` (approved, fully paid, factory branch) and their quantities to stock. */
export function seedSdImports(purchases: Purchase[], vendors: Party[], items: Item[], branch: { id: string; name: string }) {
  const out: Purchase[] = []
  for (const spec of IMPORTS) {
    const v = vendors.find((x) => x.id === spec.vendorId)!
    const lines = spec.lines.map(([itemId, qty, usdUnit]): Line => {
      const it = items.find((x) => x.id === itemId)!
      const t = findTariff(it.hsCode)
      const rates = { cdRate: t?.cd ?? 25, rdRate: t?.rd ?? 3, sdRate: t?.sd ?? 20, vatRate: t?.vat ?? 15, aitRate: t?.ait ?? 5, atRate: t?.at ?? 5 }
      const usd = round2(qty * usdUnit)
      const c = calcImportLine({ qty, usd, usdRate: spec.usdRate, ...rates }, true)
      return {
        itemId, name: it.name, hsCode: it.hsCode, uom: it.unit, qty, price: c.unitAv, sdRate: rates.sdRate, vatRate: rates.vatRate,
        subtotal: c.av, sd: c.sd, vat: c.vat, total: c.total, rebateable: true, vds: false, tti: c.tti,
        duty: { usd, usdRate: spec.usdRate, av: c.av, cdRate: rates.cdRate, cd: c.cd, rdRate: rates.rdRate, rd: c.rd, aitRate: rates.aitRate, ait: c.ait, atRate: rates.atRate, at: c.at },
      }
    })
    const t = sumLines(lines, 0)
    const month = `${spec.date.slice(5, 7)}${spec.date.slice(2, 4)}`
    const n = [...purchases, ...out].filter((p) => p.invoiceNo.startsWith(`P-${month}`)).length + 1
    const createdAt = `${spec.date}T11:20:00+06:00`
    const history: HistoryEntry[] = [
      { at: createdAt, by: "Md. Kamal Uddin", action: "created" },
      { at: at(spec.date, "15:05"), by: "Arif Hossain", action: "approved" },
    ]
    const p: Purchase = {
      id: `p${purchases.length + out.length + 1}`, invoiceNo: `P-${month}${pad(n)}`, challanNo: spec.boe, challanDate: spec.date, createdAt, issueDate: spec.date,
      vendorId: v.id, vendorName: v.name, vendorBin: v.bin, vendorAddress: v.address, mode: "Foreign", method: "Transaction",
      lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal,
      tti: round2(lines.reduce((a, l) => a + (l.tti ?? 0), 0)), rebate: round2(lines.reduce((a, l) => a + l.vat + (l.duty?.at ?? 0), 0)),
      paid: t.netTotal, due: 0, process: "Approved", issuedBy: "Md. Kamal Uddin", designation: "Store Officer",
      narration: "Packing materials for export orders — SD paid at import; recoverable against exports within six months (9.1 note 40).",
      branchId: branch.id, branchName: branch.name,
      boe: { no: spec.boe, date: spec.date, lcNo: spec.lc, lcDate: spec.lcDate, customsHouse: v.country === "Korea" ? "101" : "301", origin: v.country ?? "China", cnfFirm: "BAYLINK C&F AGENCY" },
      history,
    }
    out.push(p)
    for (const l of lines) items.find((x) => x.id === l.itemId)!.purchased += l.qty
  }
  purchases.push(...out)
  return out
}

/**
 * Two claims in the open period (Sep 2026) against the Apr-2026 import: polybags for the May export (approved) and
 * cartons for the June export (draft). Built through the same validator the API uses.
 */
export function seedSdClaims(purchases: Purchase[], sales: Sale[], existing: VatAdjustment[], no: (date: string) => string): VatAdjustment[] {
  const p = purchases.find((x) => x.challanNo === "C-1027716")
  if (!p) return []
  const exports = sales.filter((s) => s.export && !s.export.deemed && s.process === "Approved" && s.issueDate >= p.issueDate).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  const specs: [date: string, itemId: string, qty: number, sale: Sale | undefined, approved: boolean, ref: string][] = [
    ["2026-09-14", "i16", 31_000, exports[0], true, "Packing list PL-0526-11 · EXP"],
    ["2026-09-22", "i14", 1_540, exports[1], false, "Packing list PL-0626-07 · EXP"],
  ]
  const out: VatAdjustment[] = []
  specs.forEach(([date, itemId, qty, sale, approved, ref], k) => {
    if (!sale) return
    const r = sdExportLink({ purchaseId: p.id, itemId, qty, saleId: sale.id, issueDate: date, taxPeriod: "2026-09" }, { purchases, sales, adjustments: [...existing, ...out] })
    if ("errors" in r) return
    const id = `va${existing.length + out.length + 1}`
    const by = "Farzana Akter"
    const history: HistoryEntry[] = [{ at: at(date, "10:15"), by, action: "created" }]
    if (approved) history.push({ at: at(date, "16:40"), by: "Arif Hossain", action: "approved" })
    out.push({
      id, no: no(date), kind: "sdExport", note: 40, issueDate: date, taxPeriod: "2026-09", amount: r.amount,
      description: `SD paid at import on ${r.link.itemName} (${r.link.boeNo}) used to pack export ${r.link.saleNo} to ${r.link.customerName} — claimed within six months of the import.`,
      reference: `${ref} ${sale.export?.expNo ?? ""}`.trim(), sdExport: r.link, process: approved ? "Approved" : "Created", issuedBy: by,
      createdAt: at(date, "10:15"), history,
    })
    void k
  })
  return out
}
