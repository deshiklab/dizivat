import type { Item, Line, Party, Purchase, Sale, PayMethod } from "../types"
import { calcLine, importTTI, round2, sumLines } from "../vat"

/** Deterministic PRNG so every reload/SSR produces identical data. */
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20260925)
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)]
const between = (a: number, b: number) => a + rnd() * (b - a)
const int = (a: number, b: number) => Math.floor(between(a, b + 1))
const pad = (n: number, w = 4) => String(n).padStart(w, "0")
const bin = () => `${pad(int(1000, 9999), 4)}${pad(int(10000, 99999), 5)}-${pad(int(101, 999), 4)}`

// ── Parties (names observed in the legacy system + representative additions) ──
export const customers: Party[] = [
  { id: "c1", name: "HILLCREST PRINTERS LTD", bin: "000512347-0203", mobile: "01711-402233", address: "Plot 12, Tejgaon I/A, Dhaka-1208", kind: "customer", mode: "Local" },
  { id: "c2", name: "ESSENTIAL DRUGS COMPANY LIMITED", bin: "000045678-0101", mobile: "01819-223344", address: "Tejgaon I/A, Dhaka-1208", kind: "customer", mode: "Local" },
  { id: "c3", name: "DELTA PHARMA PACKAGING LTD", bin: bin(), mobile: "01713-556677", address: "Kashimpur, Gazipur-1750", kind: "customer", mode: "Local" },
  { id: "c4", name: "ORION HEALTHCARE LTD", bin: bin(), mobile: "01912-889900", address: "Tongi I/A, Gazipur-1710", kind: "customer", mode: "Local" },
  { id: "c5", name: "NAVANA FOODS & BEVERAGE LTD", bin: bin(), mobile: "01730-112211", address: "Rupganj, Narayanganj-1460", kind: "customer", mode: "Local" },
  { id: "c6", name: "MEGHNA CONSUMER PRODUCTS LTD", bin: bin(), mobile: "01755-667788", address: "Meghnaghat, Sonargaon, Narayanganj", kind: "customer", mode: "Local" },
  { id: "c7", name: "SHOHAG AGRO CHEMICALS LTD", bin: bin(), mobile: "01670-445566", address: "Savar, Dhaka-1340", kind: "customer", mode: "Local" },
  { id: "c8", name: "GULF MEDICAL SUPPLIES LLC", bin: "EXP-AE-2024-118", mobile: "+971-4-3345566", address: "Al Quoz Industrial Area 3, Dubai, UAE", kind: "customer", mode: "Foreign", country: "UAE" },
  { id: "c9", name: "COLOMBO PHARMA (PVT) LTD", bin: "EXP-LK-2025-031", mobile: "+94-11-2233445", address: "Ekala Industrial Estate, Ja-Ela, Sri Lanka", kind: "customer", mode: "Foreign", country: "Sri Lanka" },
]

export const vendors: Party[] = [
  { id: "v1", name: "HYUNDAI L AND C CORPORATION", bin: "IMP-KR-HLC", mobile: "+82-2-3456-7890", address: "Seoul, Republic of Korea", kind: "vendor", mode: "Foreign", country: "Korea" },
  { id: "v2", name: "HENAN MINGSHENG NEW MATERIAL TECHNOLOGY CO LTD", bin: "IMP-CN-HMS", mobile: "+86-371-6655-4433", address: "Zhengzhou, Henan, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v3", name: "XIAMEN CHANGSU INDUSTRIAL CORPORATION LTD", bin: "IMP-CN-XCS", mobile: "+86-592-6881-234", address: "Xiamen, Fujian, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v4", name: "NANTONG COMENS NEW MATERIALS CO. LTD", bin: "IMP-CN-NTC", mobile: "+86-513-8511-0099", address: "Nantong, Jiangsu, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v5", name: "SUZHOU BOWU NEW MATERIAL TECHNOLOGY CO. LTD", bin: "IMP-CN-SBW", mobile: "+86-512-6587-1122", address: "Suzhou, Jiangsu, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v6", name: "BENE CHEMICALS LTD", bin: "002314567-0302", mobile: "01711-908070", address: "Tongi, Gazipur-1710", kind: "vendor", mode: "Local" },
  { id: "v7", name: "DHAKA POLY INDUSTRIES LTD", bin: bin(), mobile: "01819-303030", address: "Ashulia, Savar, Dhaka", kind: "vendor", mode: "Local" },
  { id: "v8", name: "M/S J N G ENTERPRISE", bin: "NID 1994261234567", mobile: "01552-340011", address: "Nawabpur Road, Dhaka-1100", kind: "vendor", mode: "Non-registered" },
  { id: "v9", name: "M/S RAHMAN CARTON HOUSE", bin: "NID 1987263456789", mobile: "01677-121314", address: "Dhamrai, Dhaka-1350", kind: "vendor", mode: "Non-registered" },
]

// ── Items (HS codes & names from the legacy Items list) ──
type Seed = [string, Item["group"], string, string, Item["unit"], number, number, number]
// name, group, hs, master, unit, purchasePrice, salePrice(0=not sold), opening
const itemSeeds: Seed[] = [
  ["LLDPE Granules", "Raw Material", "39021000", "Polyethylene", "Kg", 182, 0, 4200],
  ["VC-VA Terpolymer Resin", "Raw Material", "39043000", "Vinyl Resin", "Kg", 465, 0, 850],
  ["PU Resins", "Raw Material", "39095000", "Polyurethane", "Kg", 540, 0, 620],
  ["PVC Rigid Film 250µ", "Raw Material", "39204910", "PVC Film", "Kg", 238, 0, 5200],
  ["BOPA Film 15µ", "Raw Material", "39209290", "BOPA Film", "Kg", 412, 0, 1800],
  ["Aluminium Foil 20µ", "Raw Material", "76071110", "Aluminium Foil", "Kg", 610, 0, 2400],
  ["Aluminium Foil 25µ", "Raw Material", "76071110", "Aluminium Foil", "Kg", 598, 0, 1950],
  ["Aluminium Foil 30µ", "Raw Material", "76071110", "Aluminium Foil", "Kg", 590, 0, 1600],
  ["Aluminium Foil 47µ", "Raw Material", "76071110", "Aluminium Foil", "Kg", 575, 0, 900],
  ["Heat Seal Lacquer", "Consumable", "32089090", "Lacquer", "Kg", 720, 0, 380],
  ["Printing Ink (Gravure)", "Consumable", "32151900", "Ink", "Kg", 890, 0, 260],
  ["Ethyl Acetate Solvent", "Consumable", "29153100", "Solvent", "Kg", 168, 0, 1400],
  ["Printing Cylinder", "Consumable", "84425010", "Cylinder", "Pcs", 38500, 0, 24],
  ["Export Carton 5-ply", "Packing Materials", "48191000", "Carton", "Pcs", 62, 0, 3200],
  ["Gum Tape 2\"", "Packing Materials", "39191000", "Tape", "Roll", 95, 0, 700],
  ["Paper Core 3\"", "Packing Materials", "48229000", "Core", "Pcs", 38, 0, 2600],
  ["Printed Blister Foil (Alu 20µ)", "Finished Goods", "76072090", "Blister Foil", "Kg", 0, 1180, 1250],
  ["Cold Form Alu-Alu Laminate", "Finished Goods", "76072090", "Alu-Alu", "Kg", 0, 1620, 640],
  ["PVC/PVDC Blister Film", "Finished Goods", "39204990", "Blister Film", "Kg", 0, 486, 2100],
  ["Strip Pack Laminate (Paper/Poly/Foil)", "Finished Goods", "76072090", "Strip Laminate", "Kg", 0, 845, 980],
  ["Printed Laminated Pouch", "Finished Goods", "39232990", "Pouch", "Pcs", 0, 4.6, 185000],
  ["Sachet Roll Stock (PET/Alu/PE)", "Finished Goods", "39219090", "Roll Stock", "Kg", 0, 732, 1500],
]

export const items: Item[] = itemSeeds.map(([name, group, hs, master, unit, pp, sp, opening], i) => ({
  id: `i${i + 1}`,
  hsCode: hs,
  group,
  masterItem: master,
  brand: group === "Finished Goods" ? "PUL" : pick(["Generic", "Imported", "Local"]),
  name,
  unit,
  sku: `${group === "Finished Goods" ? "FG" : group === "Raw Material" ? "RM" : group === "Consumable" ? "CN" : "PM"}-${pad(i + 1, 3)}`,
  purchasePrice: pp,
  costPrice: group === "Finished Goods" ? round2(sp * 0.78) : round2(pp * 1.12),
  salePrice: sp,
  vatRate: 15,
  sdRate: 0,
  opening,
  purchased: 0,
  prodReceive: 0,
  prodIssue: 0,
  sold: 0,
  damage: group === "Finished Goods" ? int(0, 25) : int(0, 12),
  reorderLevel: Math.round(opening * 0.35),
  active: true,
}))

const methods: PayMethod[] = ["Bank", "Bank", "Bank", "Cheque", "Cash", "Mobile"]
const people = [["Chanchal Mahmud", "Shift-In-Charge"], ["Md. Rafiqul Islam", "Store Officer"], ["Nusrat Jahan", "Accounts Executive"]] as const

function* monthsBack(from = new Date(2025, 6, 1), to = new Date(2026, 8, 24)) {
  const d = new Date(from)
  while (d <= to) { yield new Date(d); d.setDate(d.getDate() + 1) }
}
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`

function makeLine(it: Item, qty: number, price: number, extra: Partial<Line> = {}): Line {
  const c = calcLine({ qty, price, sdRate: it.sdRate, vatRate: it.vatRate })
  return { itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty, price, sdRate: it.sdRate, vatRate: it.vatRate, ...c, ...extra }
}

export const sales: Sale[] = []
export const purchases: Purchase[] = []

let challan = 312, cSeq = 1034900
const sSeq = new Map<string, number>(), pSeq = new Map<string, number>()
const fg = items.filter((i) => i.group === "Finished Goods")
const buyables = items.filter((i) => i.group !== "Finished Goods")

for (const day of monthsBack()) {
  if (day.getDay() === 5) continue // Friday — weekend in Bangladesh
  const mm = pad(day.getMonth() + 1, 2), yy = String(day.getFullYear()).slice(2)
  // Sales: ~0.55/day → ≈ 190 invoices
  if (rnd() < 0.55) {
    const cust = rnd() < 0.08 ? pick(customers.slice(7)) : rnd() < 0.5 ? pick(customers.slice(0, 2)) : pick(customers.slice(2, 7))
    const foreign = cust.mode === "Foreign"
    const n = int(1, 3)
    const chosen = [...fg].sort(() => rnd() - 0.5).slice(0, n)
    const lines = chosen.map((it) => {
      const qty = it.unit === "Pcs" ? int(20, 160) * 1000 : int(80, 1400)
      const price = round2(it.salePrice * between(0.95, 1.06))
      const l = makeLine(it, qty, price)
      if (foreign) { l.vatRate = 0; l.vat = 0; l.total = l.subtotal + l.sd } // exports are zero-rated
      return l
    })
    const disc = rnd() < 0.2 ? round2(sumLines(lines).gross * 0.01) : 0
    const t = sumLines(lines, disc)
    const k = `${mm}${yy}`; sSeq.set(k, (sSeq.get(k) ?? 0) + 1)
    const ageDays = (new Date(2026, 8, 25).getTime() - day.getTime()) / 864e5
    const process = ageDays < 12 && rnd() < 0.75 ? "Created" : rnd() < 0.03 ? "Cancelled" : "Approved"
    const paid = process === "Cancelled" ? 0 : ageDays > 60 ? t.netTotal : ageDays > 20 ? round2(t.netTotal * pick([1, 1, 0.5, 0])) : pick([0, 0, round2(t.netTotal * 0.3)])
    const [by, desig] = pick(people)
    challan += 1
    sales.push({
      id: `s${sales.length + 1}`,
      invoiceNo: `S-${k}${pad(sSeq.get(k)!)}`,
      challanNo: String(challan),
      createdAt: `${iso(day)}T${pad(int(9, 17), 2)}:${pad(int(0, 59), 2)}:00+06:00`,
      issueDate: iso(day),
      issueTime: `${pad(int(9, 18), 2)}:${pad(int(0, 59), 2)}`,
      customerId: cust.id, customerName: cust.name, customerBin: cust.bin, customerAddress: cust.address,
      deliveryAddress: cust.address,
      vehicle: foreign ? `Container ${pick(["MSKU", "TGHU", "CMAU"])}${int(1000000, 9999999)}` : `Dhaka Metro-${pick(["Ta", "Da", "Ga"])} ${int(11, 24)}-${pad(int(1000, 9999))}`,
      mode: cust.mode as Sale["mode"],
      method: pick(methods),
      vds: !foreign && rnd() < 0.25,
      lines,
      subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: t.discount, netTotal: t.netTotal,
      paid, due: round2(t.netTotal - paid), process,
      issuedBy: by, designation: desig,
    })
    if (process !== "Cancelled") for (const l of lines) items.find((i) => i.id === l.itemId)!.sold += l.qty
  }
  // Purchases: ~0.2/day → ≈ 75 bills
  if (rnd() < 0.2) {
    const v = rnd() < 0.45 ? pick(vendors.slice(0, 5)) : rnd() < 0.65 ? pick(vendors.slice(5, 7)) : pick(vendors.slice(7))
    const pool = v.mode === "Foreign" ? buyables.filter((i) => i.group === "Raw Material") : v.mode === "Local" ? buyables.filter((i) => i.group !== "Packing Materials") : buyables.filter((i) => i.group === "Packing Materials" || i.name.includes("Solvent"))
    const n = int(1, 3)
    const chosen = [...pool].sort(() => rnd() - 0.5).slice(0, n)
    let tti = 0
    const lines = chosen.map((it) => {
      const qty = it.unit === "Pcs" && it.purchasePrice > 1000 ? int(1, 6) : it.unit === "Kg" ? int(200, 6000) : int(300, 4000)
      const price = round2(it.purchasePrice * between(0.93, 1.07))
      const l = makeLine(it, qty, price, { rebateable: v.mode !== "Non-registered", vds: v.mode === "Local" && rnd() < 0.3 })
      if (v.mode === "Non-registered") { l.vatRate = 0; l.vat = 0; l.total = l.subtotal; l.rebateable = false }
      if (v.mode === "Foreign") {
        const d = importTTI(l.subtotal)
        l.vat = d.vat; l.tti = d.tti; l.total = round2(l.subtotal + d.tti); tti += d.tti
      }
      return l
    })
    const t = sumLines(lines)
    const k = `${mm}${yy}`; pSeq.set(k, (pSeq.get(k) ?? 0) + 1)
    const ageDays = (new Date(2026, 8, 25).getTime() - day.getTime()) / 864e5
    const process = ageDays < 8 && rnd() < 0.6 ? "Created" : "Approved"
    const paid = ageDays > 45 ? t.netTotal : round2(t.netTotal * pick([0, 0.5, 1]))
    cSeq += int(1, 40)
    const [by, desig] = pick(people)
    purchases.push({
      id: `p${purchases.length + 1}`,
      invoiceNo: `P-${k}${pad(pSeq.get(k)!)}`,
      challanNo: v.mode === "Foreign" ? `C-${cSeq}` : v.mode === "Local" ? `MC-${int(1000, 9999)}` : `BILL-${int(100, 999)}`,
      challanDate: iso(day),
      createdAt: `${iso(day)}T${pad(int(9, 17), 2)}:${pad(int(0, 59), 2)}:00+06:00`,
      issueDate: iso(day),
      vendorId: v.id, vendorName: v.name, vendorBin: v.bin, vendorAddress: v.address,
      mode: v.mode as Purchase["mode"],
      method: v.mode === "Foreign" ? "Transaction" : pick(methods),
      lines,
      subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: 0, netTotal: t.netTotal,
      tti: round2(tti), rebate: round2(lines.filter((l) => l.rebateable).reduce((a, l) => a + l.vat, 0)),
      paid, due: round2(t.netTotal - paid), process,
      issuedBy: by, designation: desig,
    })
    for (const l of lines) items.find((i) => i.id === l.itemId)!.purchased += l.qty
  }
}

// Production movements: raw materials issued to the floor, finished goods received
for (const it of items) {
  if (it.group === "Finished Goods") {
    const closing = Math.round(it.reorderLevel * between(1.4, 4))
    it.prodReceive = Math.max(0, Math.round(it.sold + it.damage + closing - it.opening))
  }
  else it.prodIssue = Math.round((it.opening + it.purchased) * between(0.55, 0.85))
}
// A few items purposely below re-order level for the dashboard
for (const id of ["i6", "i11", "i19"]) {
  const it = items.find((i) => i.id === id)!
  const remain = it.opening + it.purchased + it.prodReceive - it.prodIssue - it.sold - it.damage
  const target = Math.round(it.reorderLevel * 0.6)
  if (it.group === "Finished Goods") it.prodReceive -= Math.max(0, remain - target)
  else it.prodIssue += Math.max(0, remain - target)
}
