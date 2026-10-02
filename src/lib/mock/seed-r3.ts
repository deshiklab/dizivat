/**
 * R3 seed data (Sales & Production). Deterministic and independent of seed.ts's PRNG sequence, so earlier documents
 * are unchanged. Called once from db.init(); stock-moving documents are approved only when the factory holds the stock.
 * NB: helpers must be hoisted `function` declarations (db.init runs at module load).
 */
import type { Batch, BatchLine, Bom, BomCost, BomInput, Consumption, CostHead, CreditLine, CreditNote, CreditReason, HistoryEntry, Item, Line, Party, Sale, WorkOrder } from "../types"
import { SALE_SERVICES } from "../r3"
import { calcBom, calcCreditLine, calcLine, round2, round4, sumLines } from "../vat"

const pad = (n: number, w = 4) => String(n).padStart(w, "0")
const key = (prefix: string, date: string) => `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`
const at = (date: string, hhmm = "10:30") => new Date(`${date}T${hhmm}:00+06:00`).toISOString()
const addH = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 36e5).toISOString()
const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10)
const APPROVERS = ["Arif Hossain", "Farzana Akter"]

type Bal = { get: (itemId: string) => number; add: (itemId: string, q: number) => void }

/** A 100 % export-oriented knit garment factory — buys our dyed knit fabric against back-to-back LCs (deemed export). */
export const EXTRA_CUSTOMERS: Party[] = [
  { id: "c10", name: "AURORA KNIT COMPOSITE LTD", bin: "001582734-0302", mobile: "01713-909090", address: "Plot 41, Dhaka EPZ, Savar, Dhaka-1349", kind: "customer", mode: "Local", active: true, creditLimit: 3_000_000,
    // R6 (RMG): direct garment exporter with a bonded warehouse — the buyer side of our deemed exports
    exporterType: "direct", bondLicenseNo: "CUS-BOND/DEPZ/B-2231/2020", bondLicenseExpiry: "2027-12-31", associationNo: "BKMEA-3318" },
]

/** Credit terms and VDS status for the seeded customers. */
export function enrichCustomers(customers: Party[]) {
  const terms: Record<string, [number, boolean]> = {
    c1: [12_000_000, false], c2: [8_000_000, true], c3: [4_000_000, false], c4: [3_000_000, true], c5: [2_500_000, false], c6: [2_000_000, false], c7: [1_500_000, true],
  }
  for (const c of customers) {
    const t = terms[c.id]
    if (t) { c.creditLimit = t[0]; c.vdsWithholder = t[1] }
  }
}

/** Export invoices get their shipping documents (LC, customs station, Bill of Export). */
export const SEED_USD_RATE = 122
export function enrichExports(sales: Sale[], customers: Party[]) {
  let lc = 210, bill = 5120, exp = 4410
  const foreign = sales.filter((s) => s.mode === "Foreign")
  const lastId = foreign.filter((s) => s.process !== "Cancelled").at(-1)?.id
  for (const s of foreign) {
    const c = customers.find((x) => x.id === s.customerId)
    const day = Number(s.issueDate.slice(8, 10))
    lc += 2 + (day % 4); bill += 7 + (day % 9)
    s.export = {
      deemed: false, lcNo: `EXP-LC-${s.issueDate.slice(2, 4)}-${pad(lc)}`, lcDate: addDays(s.issueDate, -(25 + (day % 15))),
      customsHouse: day % 5 === 0 ? "101" : "301", country: c?.country ?? "UAE", billNo: `C-${bill}${day % 10}`, billDate: s.issueDate,
      shippingAddress: s.deliveryAddress, cnfFirm: "BAYLINK C&F AGENCY",
      // R6 (RMG): EXP form and FC proceeds — the latest shipment still waits for its EXP number (shows as "at risk")
      expNo: s.id === lastId ? undefined : `EXP-0934-${s.issueDate.slice(2, 4)}-${pad((exp += 3 + (day % 5)), 5)}`,
      currency: "USD", fcValue: Math.round((s.subtotal / SEED_USD_RATE) * 100) / 100, exchangeRate: SEED_USD_RATE,
    }
  }
}

function history(created: string, by: string, process: "Created" | "Approved" | "Cancelled", i: number, cancelNote?: string): HistoryEntry[] {
  const h: HistoryEntry[] = [{ at: created, by, action: "created" }]
  if (process !== "Created") h.push({ at: addH(created, 2 + (i % 4)), by: APPROVERS[i % 2], action: "approved" })
  if (process === "Cancelled") h.push({ at: addH(created, 28), by: APPROVERS[(i + 1) % 2], action: "cancelled", note: cancelNote })
  return h
}

/**
 * Service sales (Jul–Sep 2026, SS- numbering) and deemed exports to the EPZ customer (S- numbering, zero-rated).
 * Ids continue the sales sequence. Deemed exports are approved only when the factory has the stock.
 */
export function seedR3Sales(startId: number, sales: Sale[], customers: Party[], items: Item[], main: { id: string; name: string }, bal: Bal): Sale[] {
  const out: Sale[] = []
  let id = startId
  const plan: [date: string, cust: string, lines: [svc: string, qty: number, price: number][], process: "Created" | "Approved" | "Cancelled", paidPart: number][] = [
    ["2026-07-08", "c1", [["ss1", 4200, 145], ["ss2", 6, 42000]], "Approved", 1],
    ["2026-07-21", "c2", [["ss3", 3, 18500]], "Approved", 1],
    ["2026-07-29", "c5", [["ss4", 12500, 22]], "Approved", 1],
    ["2026-08-05", "c3", [["ss1", 2600, 150], ["ss3", 2, 16000]], "Approved", 1],
    ["2026-08-17", "c4", [["ss5", 4, 22000]], "Approved", 1],
    ["2026-08-26", "c6", [["ss6", 1, 145000]], "Approved", 0.5],
    ["2026-09-02", "c1", [["ss2", 8, 41500]], "Approved", 0],
    ["2026-09-09", "c7", [["ss4", 8200, 22], ["ss1", 1500, 148]], "Cancelled", 0],
    ["2026-09-15", "c2", [["ss1", 3800, 146], ["ss5", 2, 22000]], "Approved", 0],
    ["2026-09-22", "c3", [["ss3", 1, 17500]], "Created", 0],
    ["2026-09-24", "c1", [["ss6", 1, 145000], ["ss2", 4, 42000]], "Created", 0],
  ]
  const seq = new Map<string, number>()
  plan.forEach(([date, cid, ls, process, paidPart], i) => {
    const c = customers.find((x) => x.id === cid)!
    const lines: Line[] = ls.map(([sid, qty, price]) => {
      const s = SALE_SERVICES.find((x) => x.id === sid)!
      return { itemId: s.id, name: s.name, hsCode: s.code, uom: s.unit, qty, price, sdRate: 0, vatRate: s.vatRate, ...calcLine({ qty, price, sdRate: 0, vatRate: s.vatRate }) }
    })
    const t = sumLines(lines)
    const k = key("SS", date); seq.set(k, (seq.get(k) ?? 0) + 1)
    const created = at(date, `${pad(10 + (i % 6), 2)}:${pad((i * 13) % 60, 2)}`)
    const by = i % 3 === 0 ? ["Md. Kamal Uddin", "Store Officer"] : ["Farzana Akter", "Accounts Executive"]
    const paid = process === "Cancelled" ? 0 : round2(t.netTotal * paidPart)
    out.push({
      id: `s${id++}`, invoiceNo: `${k}${pad(seq.get(k)!)}`, challanNo: `SV-${pad(301 + i, 4)}`, createdAt: created, issueDate: date, issueTime: `${pad(10 + (i % 6), 2)}:15`,
      customerId: c.id, customerName: c.name, customerBin: c.bin, customerAddress: c.address, deliveryAddress: c.address, mode: "Local",
      method: i % 4 === 3 ? "Cheque" : "Bank", vds: !!c.vdsWithholder, lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal,
      paid, due: round2(t.netTotal - paid), process, issuedBy: by[0], designation: by[1], branchId: main.id, branchName: main.name, category: "service",
      cancelReason: process === "Cancelled" ? "Job not carried out — the customer withdrew the order before production." : undefined,
      history: history(created, by[0], process, i, process === "Cancelled" ? "Job not carried out — the customer withdrew the order before production." : undefined),
    })
  })

  // Deemed exports (local supply to the EPZ garment factory against back-to-back LCs — zero-rated)
  const epz = customers.find((c) => c.id === "c10")!
  const deemed: [date: string, itemId: string, qty: number, price: number, process: "Created" | "Approved", lc: string][] = [
    ["2026-09-10", "i21", 5000, 520, "Approved", "BB-LC-0934-26-0117"],
    ["2026-09-22", "i20", 200, 610, "Created", "BB-LC-0934-26-0142"],
  ]
  deemed.forEach(([date, itemId, qty, price, process0, lc], i) => {
    const it = items.find((x) => x.id === itemId)!
    const process = process0 === "Approved" && bal.get(itemId) >= qty ? "Approved" : "Created"
    const line: Line = { itemId, name: it.name, hsCode: it.hsCode, uom: it.unit, qty, price, sdRate: 0, vatRate: 0, ...calcLine({ qty, price, sdRate: 0, vatRate: 0 }) }
    const t = sumLines([line])
    const k = key("S", date)
    const n = [...sales, ...out].filter((s) => s.invoiceNo.startsWith(k)).length + 1
    const created = at(date, "15:10")
    const challan = Math.max(...sales.map((s) => Number(s.challanNo) || 0)) + 1 + i
    out.push({
      id: `s${id++}`, invoiceNo: `${k}${pad(n)}`, challanNo: String(challan), createdAt: created, issueDate: date, issueTime: "15:00",
      customerId: epz.id, customerName: epz.name, customerBin: epz.bin, customerAddress: epz.address, deliveryAddress: epz.address,
      vehicle: `Dhaka Metro-Ta 14-${pad(2210 + i * 37)}`, mode: "Local", method: "Bank", vds: false, lines: [line],
      subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal, paid: 0, due: t.netTotal, process,
      issuedBy: "Arif Hossain", designation: "Shift-In-Charge", branchId: main.id, branchName: main.name,
      // R6 (RMG): the first supply meets all five NBR conditions; the draft still lacks the exporter's UD (at risk)
      export: {
        deemed: true, lcNo: lc, lcDate: addDays(date, -18), customsHouse: "", country: "", billNo: "", billDate: "", shippingAddress: epz.address,
        udNo: i === 0 ? "BKMEA/UD/2026/08812" : undefined, udDate: i === 0 ? addDays(date, -25) : undefined,
        currency: "USD", fcValue: Math.round((t.subtotal / SEED_USD_RATE) * 100) / 100, exchangeRate: SEED_USD_RATE,
      },
      history: history(created, "Arif Hossain", process, i),
    })
    if (process === "Approved") { bal.add(itemId, -qty); it.sold += qty }
  })
  return out
}

/** Credit notes (Mushak 6.7) against approved local goods sales — returns come back into the factory stock. */
export function seedCreditNotes(sales: Sale[], items: Item[], bal: Bal): CreditNote[] {
  const pool = sales.filter((s) => s.process === "Approved" && s.mode === "Local" && s.category !== "service" && !s.export && s.issueDate >= "2026-07-15" && s.issueDate <= "2026-09-20" && !s.lines.some((l) => l.itemId === "i19"))
  const picks = [0, 3, 7, 11, 15].map((i) => pool[Math.min(i, pool.length - 1)]).filter((s, i, a) => s && a.indexOf(s) === i)
  const plan: [CreditReason, "Created" | "Approved" | "Cancelled", string][] = [
    ["damaged", "Approved", "Cartons crushed in transit; customer returned the affected pieces."],
    ["quality", "Approved", "Shade variation between panels on part of the lot (QC report attached)."],
    ["excess", "Approved", "Delivered above the PO quantity; excess taken back."],
    ["wrongItem", "Created", "Wrong size ratio delivered — awaiting return confirmation."],
    ["priceAdjustment", "Cancelled", ""],
  ]
  const out: CreditNote[] = []
  const seq = new Map<string, number>()
  picks.forEach((s, i) => {
    const [reason, process, note] = plan[i]
    const src = s.lines[0]
    const unit = src.uom === "Pcs" ? 10 : 1
    const qty = Math.max(unit, Math.round((src.qty * (0.05 + (i % 3) * 0.02)) / unit) * unit)
    const c = calcCreditLine(src, qty)
    const line: CreditLine = { itemId: src.itemId, name: src.name, hsCode: src.hsCode, uom: src.uom, soldQty: src.qty, qty, price: src.price, sdRate: src.sdRate, vatRate: src.vatRate, ...c }
    const date = addDays(s.issueDate, 3 + i * 2) > "2026-09-24" ? "2026-09-24" : addDays(s.issueDate, 3 + i * 2)
    const k = key("CN", date); seq.set(k, (seq.get(k) ?? 0) + 1)
    const created = at(date, "12:40")
    const cancelNote = "Raised in error — the price difference was settled on the next invoice instead."
    out.push({
      id: `cn${out.length + 1}`, no: `${k}${pad(seq.get(k)!)}`, saleId: s.id, saleNo: s.invoiceNo, saleDate: s.issueDate, saleMode: s.mode, challanNo: s.challanNo,
      customerId: s.customerId, customerName: s.customerName, customerBin: s.customerBin, customerAddress: s.customerAddress, branchId: s.branchId, branchName: s.branchName,
      issueDate: date, issueTime: "12:30", reason, note: note || undefined, issuedBy: "Farzana Akter", designation: "Accounts Executive", process,
      lines: [line], subtotal: c.subtotal, sd: c.sd, vat: c.vat, total: c.total, createdAt: created,
      cancelReason: process === "Cancelled" ? cancelNote : undefined, history: history(created, "Farzana Akter", process, i, process === "Cancelled" ? cancelNote : undefined),
    })
    if (process === "Approved") { const it = items.find((x) => x.id === src.itemId)!; it.sold = round2(it.sold - qty); bal.add(src.itemId, qty) }
  })
  return out
}

/* ── Production ──────────────────────────────────────────────────────── */

/**
 * Input coefficients per unit of each finished good: [input item, qty, wastage %]. Garments are declared per piece
 * from yarn (the composite knits and dyes its own fabric), knit fabric per kg, jeans per piece from denim.
 */
const RECIPES: Record<string, [string, number, number][]> = {
  i17: [["i6", 0.2, 2], ["i10", 0.006, 5], ["i11", 0.004, 5], ["i12", 0.003, 10], ["i16", 1, 0]],
  i18: [["i9", 0.28, 2], ["i3", 0.004, 5], ["i10", 0.009, 5], ["i12", 0.004, 10], ["i14", 0.042, 0]],
  i19: [["i1", 0.42, 2], ["i2", 0.16, 3], ["i12", 0.006, 10]],
  i20: [["i7", 1.0, 3], ["i3", 0.05, 5], ["i10", 0.025, 5]],
  i21: [["i8", 1.04, 3], ["i10", 0.02, 5], ["i3", 0.002, 5], ["i12", 0.0005, 5]],
  i22: [["i5", 1.3, 3], ["i4", 0.25, 3], ["i12", 0.012, 10], ["i14", 0.05, 0], ["i16", 1, 0]],
}
const SPLIT: [CostHead, number][] = [["labour", 0.28], ["power", 0.14], ["overhead", 0.18], ["packing", 0.05], ["admin", 0.08], ["finance", 0.04], ["profit", 0.23]]

/** Builds a BOM record from coefficients (prices from the item master); value added fills the gap to `price`. */
export function makeBom(fg: Item, items: Item[], recipe: [string, number, number][], price: number, version: number, extra: Partial<Bom>): Bom {
  const raw = recipe.map(([id, qty, w]) => ({ it: items.find((i) => i.id === id)!, qty, wastagePct: w }))
  const pre = calcBom(raw.map((r) => ({ qty: r.qty, wastagePct: r.wastagePct, price: r.it.purchasePrice })), [])
  const gap = Math.max(0, round2(price - pre.materialValue))
  const costs: BomCost[] = SPLIT.map(([head, f]) => ({ head, amount: round2(gap * f) }))
  costs[costs.length - 1].amount = round2(costs[costs.length - 1].amount + gap - costs.reduce((a, c) => a + c.amount, 0))
  const c = calcBom(raw.map((r) => ({ qty: r.qty, wastagePct: r.wastagePct, price: r.it.purchasePrice })), costs)
  const inputs: BomInput[] = raw.map((r, i) => ({ itemId: r.it.id, name: r.it.name, sku: r.it.sku, uom: r.it.unit, qty: round4(r.qty), wastagePct: r.wastagePct, price: r.it.purchasePrice, ...c.lines[i] }))
  return {
    id: "", no: `BOM-${fg.sku}-v${version}`, itemId: fg.id, itemName: fg.name, sku: fg.sku, hsCode: fg.hsCode, uom: fg.unit, version,
    effectiveDate: "2025-07-01", licenseDate: "2025-06-25", inputs, costs, materialValue: c.materialValue, wastageValue: c.wastageValue, valueAdded: c.valueAdded,
    price: c.price, unitCost: c.unitCost, process: "Approved", createdAt: at("2025-06-22", "11:00"), ...extra,
  }
}

/** One approved 4.3 declaration per finished good; the T-shirt has an amended v2, the rib fabric a pending v2 draft. */
export function seedBoms(items: Item[]): Bom[] {
  const out: Bom[] = []
  const push = (b: Bom) => { b.id = `bom${out.length + 1}`; out.push(b) }
  const std = (b: Bom): Bom => ({ ...b, history: [{ at: b.createdAt, by: "Farzana Akter", action: "created" }, { at: addH(b.createdAt, 30), by: "Arif Hossain", action: "approved" }] })
  for (const fg of items.filter((i) => i.group === "Finished Goods")) {
    const recipe = RECIPES[fg.id]
    if (!recipe) continue
    if (fg.id === "i17") {
      const v1 = makeBom(fg, items, recipe.map(([id, q, w]) => [id, q, id === "i6" ? 3.5 : w]), round2(fg.salePrice * 0.94), 1, { supersededAt: at("2026-01-20", "16:00") })
      push(std(v1))
      const v2Created = at("2026-01-14", "11:20")
      push({
        ...makeBom(fg, items, recipe, fg.salePrice, 2, { effectiveDate: "2026-02-01", licenseDate: "2026-01-20", createdAt: v2Created, amendmentReason: "New open-width compactor cut yarn (knitting + dyeing) wastage from 3.5 % to 2 %; declared price revised to the current market rate." }),
        history: [{ at: v2Created, by: "Farzana Akter", action: "created" }, { at: at("2026-01-20", "16:00"), by: "Arif Hossain", action: "approved" }],
      })
      continue
    }
    push(std(makeBom(fg, items, recipe, fg.salePrice, 1, {})))
    if (fg.id === "i20") {
      const created = at("2026-09-23", "14:05")
      push({
        ...makeBom(fg, items, recipe.map(([id, q, w]) => [id, id === "i3" ? 0.07 : q, w]), round2(fg.salePrice * 1.04), 2, {
          effectiveDate: "2026-10-01", licenseDate: "", createdAt: created, process: "Created",
          amendmentReason: "Buyer asked for more stretch recovery: elastane share 5 % → 7 % (0.05 → 0.07 kg per kg); elastane price increase.",
        }),
        history: [{ at: created, by: "Farzana Akter", action: "created" }],
      })
    }
  }
  return out
}

/** Consumption of inputs for `qty` units by the BOM (gross coefficients incl. wastage). */
export function consumptionFor(bom: Bom, qty: number, items: Item[]): Consumption[] {
  return bom.inputs.map((i) => {
    const q = round2(i.grossQty * qty)
    const it = items.find((x) => x.id === i.itemId)
    return { itemId: i.itemId, name: i.name, sku: i.sku, uom: i.uom, qty: q, price: i.price, value: round2(q * (it?.purchasePrice ?? i.price)) }
  })
}
/** Merge consumption rows of several batch lines (same input item → one row). */
export function mergeConsumption(rows: Consumption[]): Consumption[] {
  const m = new Map<string, Consumption>()
  for (const r of rows) {
    const x = m.get(r.itemId)
    if (x) { x.qty = round2(x.qty + r.qty); x.value = round2(x.value + r.value) } else m.set(r.itemId, { ...r })
  }
  return [...m.values()]
}

/**
 * Work orders and production batches (Aug–Sep 2026) plus the go-live opening batch. Approved batches consume inputs
 * from the factory and receive finished goods; a batch whose inputs are not on hand stays a draft.
 */
export function seedProduction(items: Item[], boms: Bom[], vendors: Party[], main: { id: string; name: string }, bal: Bal) {
  const item = (id: string) => items.find((i) => i.id === id)!
  const activeBom = (id: string, date: string) => boms.filter((b) => b.itemId === id && b.process === "Approved" && b.effectiveDate <= date).sort((a, b) => b.version - a.version)[0]
  const woPlan: [no: string, date: string, req: string, due: string, lines: [string, number][], process: "Created" | "Approved", remark: string][] = [
    ["PW-08260001", "2026-08-03", "REQ-26-114", "2026-08-20", [["i18", 12000], ["i21", 10000]], "Approved", "Monthly plan — August (polo export order; single jersey for AURORA's back-to-back LC)."],
    ["PW-08260002", "2026-08-20", "REQ-26-121", "2026-08-31", [["i20", 1500]], "Approved", "Rib 1x1 collar & cuff fabric for AURORA KNIT COMPOSITE LTD (UD BKMEA/UD/2026/08812)."],
    ["PW-09260001", "2026-09-08", "REQ-26-133", "2026-09-30", [["i22", 2000], ["i18", 8000]], "Approved", "September plan — denim jeans (woven unit) and polo shirts."],
    ["PW-09260002", "2026-09-18", "REQ-26-139", "2026-10-05", [["i21", 30000]], "Approved", "Single jersey for AURORA KNIT COMPOSITE LTD — UD BKMEA/UD/2026/09120."],
    ["PW-09260003", "2026-09-24", "", "2026-10-10", [["i20", 600]], "Created", "Draft — waiting for the October sales forecast."],
  ]
  const workOrders: WorkOrder[] = woPlan.map(([no, date, req, due, ls, process, remark], i) => {
    const created = at(date, "09:40")
    return {
      id: `wo${i + 1}`, no, requisitionNo: req || undefined, issueDate: date, dueDate: due, remark, process, status: process === "Created" ? "draft" : "open",
      lines: ls.map(([id, qty]) => { const it = item(id); return { itemId: id, name: it.name, sku: it.sku, uom: it.unit, qty, received: 0, damaged: 0, remaining: qty } }),
      issuedBy: "Arif Hossain", createdAt: created, history: history(created, "Arif Hossain", process, i),
    }
  })
  const wo = (no: string) => workOrders.find((w) => w.no === no)!

  type Plan = { no: string; mode: Batch["mode"]; date: string; receive?: string; vendor?: string; lines: [itemId: string, wo: string, issue: number, receive: number, damage: number][]; process: "Created" | "Approved" | "Cancelled"; remark: string; received?: string }
  const plan: Plan[] = [
    { no: "PB-07250001", mode: "opening", date: "2025-07-01", lines: [["i18", "", 1200, 1180, 20], ["i22", "", 260, 255, 5]], process: "Approved", remark: "Work in progress at go-live, finished and brought forward." },
    { no: "PB-08260001", mode: "inHouse", date: "2026-08-06", receive: "2026-08-12", lines: [["i18", "PW-08260001", 12000, 11800, 200], ["i21", "PW-08260001", 5000, 4950, 50]], process: "Approved", remark: "Knit unit — polo line 2; single jersey on circular machines 4–9." },
    { no: "PB-08260002", mode: "inHouse", date: "2026-08-18", receive: "2026-08-21", lines: [["i21", "PW-08260001", 5000, 4925, 75]], process: "Approved", remark: "" },
    { no: "PB-08260003", mode: "inHouse", date: "2026-08-24", receive: "2026-08-30", lines: [["i20", "PW-08260002", 1500, 1450, 50]], process: "Approved", remark: "Buyer spec RB-27; 50 kg rejected at QC (shade variation after dyeing)." },
    { no: "PB-09260001", mode: "contractual", date: "2026-09-02", receive: "2026-09-12", vendor: "v7", lines: [["i22", "PW-09260001", 900, 880, 20]], process: "Approved", received: "2026-09-12", remark: "Enzyme + stone wash of jeans by the washing subcontractor (Mushak 6.4)." },
    { no: "PB-09260002", mode: "inHouse", date: "2026-09-10", lines: [["i17", "", 5000, 0, 0]], process: "Cancelled", remark: "Planned on the superseded 4.3 version — re-planned." },
    { no: "PB-09260003", mode: "contractual", date: "2026-09-21", vendor: "v7", lines: [["i18", "PW-09260001", 4000, 0, 0]], process: "Approved", remark: "Inputs sent to the embroidery subcontractor; finished goods expected in October." },
    { no: "PB-09260004", mode: "inHouse", date: "2026-09-23", receive: "2026-09-25", lines: [["i20", "", 300, 290, 10]], process: "Created", remark: "Trial run for the 7 % elastane rib (draft)." },
  ]
  const batches: Batch[] = []
  plan.forEach((p, i) => {
    const vendor = p.vendor ? vendors.find((v) => v.id === p.vendor) : undefined
    const lines: BatchLine[] = p.lines.map(([id, woNo, issue, receive, damage]) => {
      const it = item(id), b = activeBom(id, p.date)
      const unitCost = b?.unitCost ?? it.costPrice
      const w = woNo ? wo(woNo) : undefined
      const rq = p.mode === "contractual" && !p.received ? 0 : receive
      return { itemId: id, name: it.name, sku: it.sku, uom: it.unit, workOrderId: w?.id, workOrderNo: w?.no, issueQty: issue, receiveQty: rq, damageQty: p.mode === "contractual" && !p.received ? 0 : damage, bomId: b?.id, bomVersion: b?.version, unitCost, value: round2(rq * unitCost) }
    })
    const consumption = p.mode === "opening" ? [] : mergeConsumption(lines.flatMap((l) => { const b = boms.find((x) => x.id === l.bomId); return b ? consumptionFor(b, l.issueQty, items) : [] }))
    let process = p.process
    if (process === "Approved" && consumption.some((c) => bal.get(c.itemId) < c.qty - 1e-9)) process = "Created"
    const created = at(p.date, "08:50")
    const batch: Batch = {
      id: `pb${i + 1}`, no: p.no, mode: p.mode, issueDate: p.date, receiveDate: p.receive ?? (p.mode === "opening" ? p.date : undefined),
      vendorId: vendor?.id, vendorName: vendor?.name, vendorBin: vendor?.bin, vendorAddress: vendor?.address, address: vendor ? `${vendor.name}, ${vendor.address}` : undefined,
      remark: p.remark || undefined, jobProcess: p.mode === "contractual" ? (p.no === "PB-09260001" ? "washing" : "embroidery") : undefined, issuedBy: "Arif Hossain", designation: "Shift-In-Charge", issueTime: "09:00", lines, consumption,
      totalIssue: round2(lines.reduce((a, l) => a + l.issueQty, 0)), totalReceive: round2(lines.reduce((a, l) => a + l.receiveQty, 0)), totalDamage: round2(lines.reduce((a, l) => a + l.damageQty, 0)),
      materialValue: round2(consumption.reduce((a, c) => a + c.value, 0)), value: round2(lines.reduce((a, l) => a + l.value, 0)),
      process, receivedAt: p.received && process === "Approved" ? at(p.received, "16:00") : undefined, branchId: main.id, branchName: main.name, createdAt: created,
      cancelReason: process === "Cancelled" ? "Planned on the superseded 4.3 version — re-planned on the current declaration." : undefined,
      history: history(created, "Arif Hossain", process, i, process === "Cancelled" ? "Planned on the superseded 4.3 version — re-planned on the current declaration." : undefined),
    }
    if (batch.receivedAt) batch.history!.push({ at: batch.receivedAt, by: "Md. Kamal Uddin", action: "edited", note: "Finished goods received from the contractor" })
    if (process === "Approved") {
      for (const c of consumption) { item(c.itemId).prodIssue = round2(item(c.itemId).prodIssue + c.qty); bal.add(c.itemId, -c.qty) }
      for (const l of lines) if (l.receiveQty) { item(l.itemId).prodReceive = round2(item(l.itemId).prodReceive + l.receiveQty); bal.add(l.itemId, l.receiveQty) }
    }
    batches.push(batch)
  })
  return { workOrders, batches }
}
