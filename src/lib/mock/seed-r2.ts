/**
 * R2 seed data (Purchase & Inventory). Deterministic and independent of seed.ts's PRNG sequence, so the Sprint 1–4
 * documents (and their tests/baselines) are unchanged. Called once from db.init().
 * NB: helpers must be hoisted `function` declarations (db.init runs at module load).
 */
import type { DebitLine, DebitNote, DebitReason, HistoryEntry, Item, Line, MasterItem, OpeningEntry, Party, Purchase, TaxProfile } from "../types"
import { SERVICES } from "../r2"
import { calcDebitLine, calcImportLine, calcLine, round2, sumLines } from "../vat"
import { findTariff } from "./tariff"

function prng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const pad = (n: number, w = 4) => String(n).padStart(w, "0")
const noKey = (prefix: string, date: string) => `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`

/** Service providers (fictional) used by service purchases. */
export const EXTRA_VENDORS: Party[] = [
  { id: "v10", name: "PRIME HAUL TRANSPORT AGENCY", bin: "002745118-0402", mobile: "01711-402233", address: "Station Road, Tongi, Gazipur-1710", kind: "vendor", mode: "Local", active: true },
  { id: "v11", name: "SHIELDLINE SECURITY SERVICES LTD", bin: "003118926-0101", mobile: "01819-556677", address: "Mohakhali C/A, Dhaka-1212", kind: "vendor", mode: "Local", active: true },
  { id: "v12", name: "BAYLINK C&F AGENCY", bin: "001973462-0203", mobile: "01913-778899", address: "Agrabad C/A, Chattogram-4100", kind: "vendor", mode: "Local", active: true },
  { id: "v13", name: "MD. HABIBUR RAHMAN (KNITTING MACHINE MECHANIC)", bin: "NID 1990263311442", mobile: "01745-221100", address: "Konabari Bazar, Gazipur-1346", kind: "vendor", mode: "Non-registered", active: true },
  { id: "v14", name: "NETCORE IT SOLUTIONS", bin: "004209871-0103", mobile: "01670-334455", address: "Mirpur DOHS, Dhaka-1216", kind: "vendor", mode: "Local", active: true },
]

/** Import purchases get a Bill of Entry header and a full duty stack from the tariff (replaces the flat mock TTI). */
export function enrichImports(purchases: Purchase[], vendors: Party[]) {
  let lc = 40
  for (const p of purchases) {
    if (p.mode !== "Foreign") continue
    const v = vendors.find((x) => x.id === p.vendorId)
    const day = Number(p.issueDate.slice(8, 10)), mon = Number(p.issueDate.slice(5, 7))
    const usdRate = round2(121.2 + ((day * 7 + mon * 3) % 18) / 10)
    const lines = p.lines.map((l): Line => {
      const t = findTariff(l.hsCode)
      const rates = { cdRate: t?.cd ?? 10, rdRate: t?.rd ?? 3, sdRate: t?.sd ?? 0, vatRate: t?.vat ?? 15, aitRate: t?.ait ?? 5, atRate: t?.at ?? 5 }
      const usd = round2(l.subtotal / usdRate)
      const c = calcImportLine({ qty: l.qty, usd, usdRate, ...rates }, l.rebateable !== false)
      return {
        ...l, price: c.unitAv, subtotal: c.av, sdRate: rates.sdRate, sd: c.sd, vatRate: rates.vatRate, vat: c.vat, tti: c.tti, total: c.total,
        duty: { usd, usdRate, av: c.av, cdRate: rates.cdRate, cd: c.cd, rdRate: rates.rdRate, rd: c.rd, aitRate: rates.aitRate, ait: c.ait, atRate: rates.atRate, at: c.at },
      }
    })
    const t = sumLines(lines, p.discount)
    const ratio = p.netTotal ? p.paid / p.netTotal : 0
    lc += 3 + (day % 5)
    const lcDate = new Date(new Date(p.issueDate).getTime() - (35 + (day % 20)) * 864e5).toISOString().slice(0, 10)
    Object.assign(p, {
      lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, netTotal: t.netTotal,
      tti: round2(lines.reduce((a, l) => a + (l.tti ?? 0), 0)),
      rebate: round2(lines.reduce((a, l) => a + (l.rebateable ? l.vat + (l.duty?.at ?? 0) : 0), 0)),
      paid: round2(t.netTotal * ratio), due: round2(t.netTotal - round2(t.netTotal * ratio)),
      boe: {
        no: p.challanNo, date: p.challanDate, lcNo: `0217-${p.issueDate.slice(2, 4)}01-${pad(lc)}`, lcDate,
        customsHouse: v?.country === "Korea" ? "101" : day % 6 === 0 ? "501" : "301", origin: v?.country ?? "China", cnfFirm: "BAYLINK C&F AGENCY",
      },
    } satisfies Partial<Purchase>)
  }
}

/** Master items: one per distinct `masterItem` name, rates from the tariff; one deliberate (flagged) override. */
export function seedMasterItems(items: Item[]): MasterItem[] {
  const out: MasterItem[] = []
  for (const it of items) {
    if (out.some((m) => m.name === it.masterItem)) continue
    const t = findTariff(it.hsCode)
    const rates: TaxProfile = { vat: t?.vat ?? it.vatRate, sd: t?.sd ?? it.sdRate, cd: t?.cd ?? 0, rd: t?.rd ?? 0, ait: t?.ait ?? 0, at: t?.at ?? 0 }
    const m: MasterItem = {
      id: `m${out.length + 1}`, name: it.masterItem, hsCode: it.hsCode, group: it.group, category: "general", unit: it.unit, priceMethod: "average",
      description: t?.description, rates, active: true, createdAt: "2025-06-24T04:30:00.000Z",
      history: [{ at: "2025-06-24T04:30:00.000Z", by: "System Administrator", action: "created" }],
    }
    if (m.name === "Knitting Needles") {
      m.rates = { ...rates, cd: 1 }
      m.overrideReason = "Concessionary CD on knitting-machine spares for export-oriented textile units (illustrative)."
      m.history!.push({ at: "2026-02-10T05:15:00.000Z", by: "Farzana Akter", action: "edited", note: "CD 5% → 1% (override)" })
      m.updatedAt = "2026-02-10T05:15:00.000Z"
    }
    out.push(m)
  }
  return out
}

/** Opening stock: one approved entry per item at the factory (FY start) — they add up to Item.opening — plus two drafts. */
export function seedOpening(items: Item[], main: { id: string; name: string }, store: { id: string; name: string }): OpeningEntry[] {
  const out: OpeningEntry[] = []
  const at = "2025-07-01T04:00:00.000Z"
  const approved: HistoryEntry[] = [{ at, by: "Farzana Akter", action: "created" }, { at: "2025-07-01T06:30:00.000Z", by: "Arif Hossain", action: "approved" }]
  items.forEach((it, i) => {
    if (!it.opening) return
    const price = it.group === "Finished Goods" ? it.costPrice : it.purchasePrice
    const value = round2(it.opening * price)
    const inputTax = it.group === "Finished Goods" ? "standard" : it.group === "Packing Materials" && i % 2 ? "reduced" : "standard"
    out.push({
      id: `os${out.length + 1}`, no: `OS-0725${pad(out.length + 1)}`, itemId: it.id, name: it.name, hsCode: it.hsCode, sku: it.sku, uom: it.unit,
      branchId: main.id, branchName: main.name, date: "2025-07-01", inputTax, qty: it.opening, price, value,
      vatPaid: it.group === "Finished Goods" ? 0 : round2(value * (inputTax === "reduced" ? 0.075 : 0.15)),
      process: "Approved", issuedBy: "Farzana Akter", createdAt: at, history: approved.map((h) => ({ ...h })),
    })
  })
  const draft = (it: Item, qty: number, day: string, note: string) => {
    const created = `2026-09-${day}T05:20:00.000Z`
    out.push({
      id: `os${out.length + 1}`, no: `OS-0926${pad(out.filter((o) => o.no.startsWith("OS-0926")).length + 1)}`, itemId: it.id, name: it.name, hsCode: it.hsCode, sku: it.sku, uom: it.unit,
      branchId: store.id, branchName: store.name, date: `2026-09-${day}`, inputTax: "standard", qty, price: it.costPrice, value: round2(qty * it.costPrice), vatPaid: 0,
      note, process: "Created", issuedBy: "Md. Kamal Uddin", createdAt: created, history: [{ at: created, by: "Md. Kamal Uddin", action: "created" }],
    })
  }
  const fg = items.filter((i) => i.group === "Finished Goods")
  if (fg[0]) draft(fg[0], 120, "21", "Stock found at the Ashulia store during the September count — not yet on the books.")
  if (fg[2]) draft(fg[2], 85, "23", "Ashulia store count variance (to be verified by accounts).")
  return out
}

/** Service purchases (Apr–Sep 2026) from the service providers above; ids continue the purchase sequence. */
export function seedServicePurchases(startId: number, main: { id: string; name: string }): Purchase[] {
  const rnd = prng(20260401)
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
  const plan: [vendor: string, services: string[], price: [number, number]][] = [
    ["v10", ["sv1"], [6500, 14500]], ["v11", ["sv2"], [84000, 84000]], ["v12", ["sv3"], [18000, 42000]], ["v13", ["sv4"], [3500, 9000]], ["v14", ["sv5"], [12500, 12500]],
  ]
  const out: Purchase[] = []
  const seq = new Map<string, number>()
  const people = [["Md. Kamal Uddin", "Store Officer"], ["Farzana Akter", "Accounts Executive"]] as const
  for (let m = 4; m <= 9; m++) {
    for (const [vid, svc, [lo, hi]] of plan) {
      if (vid !== "v11" && vid !== "v14" && rnd() < 0.45) continue // monthly contracts always bill; others ad hoc
      const v = EXTRA_VENDORS.find((x) => x.id === vid)!
      const nonReg = v.mode === "Non-registered"
      const day = Math.min(m === 9 ? 24 : 28, int(2, 27))
      const date = `2026-${pad(m, 2)}-${pad(day, 2)}`
      const lines: Line[] = svc.map((sid) => {
        const s = SERVICES.find((x) => x.id === sid)!
        const qty = s.unit === "Trip" ? int(2, 9) : 1
        const price = lo === hi ? lo : Math.round(int(lo, hi) / 50) * 50
        const vatRate = nonReg ? 0 : s.vatRate
        return { itemId: s.id, name: s.name, hsCode: s.code, uom: s.unit, qty, price, sdRate: 0, vatRate, rebateable: !nonReg, vds: !nonReg && s.vds, ...calcLine({ qty, price, sdRate: 0, vatRate }) }
      })
      const t = sumLines(lines)
      const key = noKey("PS", date); seq.set(key, (seq.get(key) ?? 0) + 1)
      const age = (Date.UTC(2026, 8, 25) - Date.parse(date)) / 864e5
      const process = age < 6 ? "Created" : "Approved"
      const paid = age > 30 ? t.netTotal : 0
      const [by, desig] = people[out.length % 2]
      out.push({
        id: `p${startId + out.length}`, invoiceNo: `${key}${pad(seq.get(key)!)}`, challanNo: `INV-${int(1000, 9999)}`, challanDate: date,
        createdAt: `${date}T${pad(int(9, 16), 2)}:${pad(int(0, 59), 2)}:00+06:00`, issueDate: date,
        vendorId: v.id, vendorName: v.name, vendorBin: v.bin, vendorAddress: v.address, mode: v.mode as Purchase["mode"], category: "service",
        method: nonReg ? "Cash" : "Bank", lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal, tti: 0,
        rebate: round2(lines.filter((l) => l.rebateable).reduce((a, l) => a + l.vat, 0)), paid, due: round2(t.netTotal - paid), process,
        issuedBy: by, designation: desig, narration: nonReg ? "Service from an unregistered person — no input tax." : undefined,
        branchId: main.id, branchName: main.name,
      })
    }
  }
  // One cancelled bill (duplicate entry) so the list shows every state
  const dup = out.find((p) => p.vendorId === "v10" && p.process === "Approved")
  if (dup) dup.process = "Cancelled"
  return out
}

/**
 * Debit notes against approved local/import purchases: small returns (quality, damage, excess) that the stock can
 * absorb. Approved ones are applied to Item.purchased by the caller. `available(itemId)` = factory stock.
 */
export function seedDebitNotes(purchases: Purchase[], available: (itemId: string) => number): DebitNote[] {
  const plan: { reason: DebitReason; pct: number; process: DebitNote["process"]; note: string }[] = [
    { reason: "quality", pct: 0.06, process: "Approved", note: "Yarn count variation beyond ±3% (Ne) — rejected by QC (report QC-26-114)." },
    { reason: "damaged", pct: 0.04, process: "Approved", note: "Cones crushed and wet in transit; vendor agreed to credit." },
    { reason: "excess", pct: 0.05, process: "Approved", note: "Delivered more than the PO quantity." },
    { reason: "wrongItem", pct: 0.08, process: "Cancelled", note: "Raised against the wrong challan — replaced." },
    { reason: "quality", pct: 0.05, process: "Created", note: "Shade and GSM below the approved lab dip; awaiting vendor confirmation." },
  ]
  const candidates = purchases
    .filter((p) => p.process === "Approved" && (p.category ?? "goods") === "goods" && p.issueDate >= "2026-05-01")
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  const out: DebitNote[] = []
  const seq = new Map<string, number>()
  const taken = new Map<string, number>()
  for (const [i, p] of candidates.filter((_, j) => j % 3 === 1).entries()) {
    const step = plan[out.length]
    if (!step) break
    const src = p.lines[0]
    const qty = Math.max(1, Math.round(src.qty * step.pct))
    const avail = available(src.itemId) - (taken.get(src.itemId) ?? 0)
    if (step.process === "Approved" && qty > avail * 0.5) continue
    const c = calcDebitLine(src, qty)
    const line: DebitLine = { itemId: src.itemId, name: src.name, hsCode: src.hsCode, uom: src.uom, purchasedQty: src.qty, qty, price: src.price, sdRate: src.sdRate, vatRate: src.vatRate, ...c }
    const d = new Date(Date.parse(p.issueDate) + (4 + (i % 6)) * 864e5).toISOString().slice(0, 10)
    const date = d > "2026-09-24" ? "2026-09-24" : d
    const key = noKey("DN", date); seq.set(key, (seq.get(key) ?? 0) + 1)
    const created = `${date}T0${4 + (i % 4)}:15:00.000Z`
    const history: HistoryEntry[] = [{ at: created, by: "Md. Kamal Uddin", action: "created" }]
    if (step.process !== "Created") history.push({ at: `${date}T09:40:00.000Z`, by: "Arif Hossain", action: "approved" })
    const dn: DebitNote = {
      id: `dn${out.length + 1}`, no: `${key}${pad(seq.get(key)!)}`, purchaseId: p.id, purchaseNo: p.invoiceNo, purchaseDate: p.issueDate, purchaseMode: p.mode, challanNo: p.challanNo,
      vendorId: p.vendorId, vendorName: p.vendorName, vendorBin: p.vendorBin, vendorAddress: p.vendorAddress, branchId: p.branchId, branchName: p.branchName,
      issueDate: date, issueTime: `1${i % 6}:30`, reason: step.reason, note: step.note, issuedBy: "Md. Kamal Uddin", designation: "Store Officer",
      process: step.process === "Cancelled" ? "Approved" : step.process, lines: [line],
      subtotal: line.subtotal, sd: line.sd, vat: line.vat, tti: line.tti, total: line.total, rebate: line.rebate, createdAt: created, history,
    }
    if (step.process === "Cancelled") {
      dn.process = "Cancelled"; dn.cancelReason = step.note
      history.push({ at: `${date}T11:05:00.000Z`, by: "Farzana Akter", action: "cancelled", note: step.note })
    }
    if (dn.process === "Approved") taken.set(src.itemId, (taken.get(src.itemId) ?? 0) + qty)
    out.push(dn)
  }
  return out
}
