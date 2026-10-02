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
/**
 * Fisher–Yates with the seeded PRNG. (A random sort comparator is NOT deterministic: the comparison order is up to
 * the JS engine, so Node and the browser — used by the static demo — produced different data.)
 */
const shuffle = <T,>(arr: readonly T[]) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
const pad = (n: number, w = 4) => String(n).padStart(w, "0")
const bin = () => `${pad(int(1000, 9999), 4)}${pad(int(10000, 99999), 5)}-${pad(int(101, 999), 4)}`

// ── Parties (fictitious businesses; BIN/NID formats as in the legacy system) ──
// Local buyers: retail chains, wholesalers and other garment makers (15 % VAT); foreign buyers: apparel importers.
export const customers: Party[] = [
  { id: "c1", name: "SUNRISE FASHION RETAIL LTD", bin: "000731906-0203", mobile: "01711-402233", address: "Plot 12, Tejgaon I/A, Dhaka-1208", kind: "customer", mode: "Local" },
  { id: "c2", name: "NAKSHI LIFESTYLE LIMITED", bin: "000268417-0101", mobile: "01819-223344", address: "Road 27, Dhanmondi, Dhaka-1209", kind: "customer", mode: "Local" },
  { id: "c3", name: "RIVERVIEW APPAREL SOURCING LTD", bin: bin(), mobile: "01713-556677", address: "Kashimpur, Gazipur-1750", kind: "customer", mode: "Local" },
  { id: "c4", name: "GREENLEAF GARMENTS LTD", bin: bin(), mobile: "01912-889900", address: "Tongi I/A, Gazipur-1710", kind: "customer", mode: "Local" },
  { id: "c5", name: "BAYSIDE MEGA MART LTD", bin: bin(), mobile: "01730-112211", address: "Rupganj, Narayanganj-1460", kind: "customer", mode: "Local" },
  { id: "c6", name: "LOTUS FAMILY STORES LTD", bin: bin(), mobile: "01755-667788", address: "Chashara, Narayanganj-1400", kind: "customer", mode: "Local" },
  { id: "c7", name: "SHAPLA KIDS WEAR LTD", bin: bin(), mobile: "01670-445566", address: "Tongi, Gazipur-1710", kind: "customer", mode: "Local" },
  { id: "c8", name: "DESERT ROSE TEXTILE TRADING LLC", bin: "EXP-AE-2024-118", mobile: "+971-4-3345566", address: "Al Quoz Industrial Area 3, Dubai, UAE", kind: "customer", mode: "Foreign", country: "UAE" },
  { id: "c9", name: "BRANDT & VOGEL TEXTIL GMBH", bin: "EXP-DE-2025-031", mobile: "+49-40-3344-5566", address: "Wandsbeker Zollstrasse 87, Hamburg, Germany", kind: "customer", mode: "Foreign", country: "Germany" },
]

// Suppliers: spinning mills and fabric mills abroad (back-to-back LC imports), local yarn / dyes houses, small packing vendors.
export const vendors: Party[] = [
  { id: "v1", name: "DONGHAE TEXTILE MATERIALS CO LTD", bin: "IMP-KR-DTM", mobile: "+82-2-3456-7890", address: "Seoul, Republic of Korea", kind: "vendor", mode: "Foreign", country: "Korea" },
  { id: "v2", name: "ZHENGZHOU BRIGHTSPIN YARN CO LTD", bin: "IMP-CN-ZBY", mobile: "+86-371-6655-4433", address: "Zhengzhou, Henan, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v3", name: "XIAMEN SEABREEZE DENIM CO LTD", bin: "IMP-CN-XSD", mobile: "+86-592-6881-234", address: "Xiamen, Fujian, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v4", name: "NANTONG EVERGREEN FIBRE CO. LTD", bin: "IMP-CN-NEF", mobile: "+86-513-8511-0099", address: "Nantong, Jiangsu, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v5", name: "SUZHOU JADELINE TEXTILES CO. LTD", bin: "IMP-CN-SJT", mobile: "+86-512-6587-1122", address: "Suzhou, Jiangsu, China", kind: "vendor", mode: "Foreign", country: "China" },
  { id: "v6", name: "BENGAL DYES & CHEMICALS LTD", bin: "002590318-0302", mobile: "01711-908070", address: "Tongi, Gazipur-1710", kind: "vendor", mode: "Local" },
  { id: "v7", name: "MEGHNA SPINNING & PROCESSING LTD", bin: bin(), mobile: "01819-303030", address: "Sonargaon, Narayanganj", kind: "vendor", mode: "Local" },
  { id: "v8", name: "M/S K R TRADING", bin: "NID 1994261234567", mobile: "01552-340011", address: "Nawabpur Road, Dhaka-1100", kind: "vendor", mode: "Non-registered" },
  { id: "v9", name: "M/S NIRAPAD CARTON HOUSE", bin: "NID 1987263456789", mobile: "01677-121314", address: "Konabari, Gazipur-1346", kind: "vendor", mode: "Non-registered" },
]

// ── Items (knit + woven composite: yarn, fabric, dyes, trims and the garments/fabric it sells, with HS codes) ──
type Seed = [string, Item["group"], string, string, Item["unit"], number, number, number]
// name, group, hs, master, unit, purchasePrice, salePrice(0=not sold), opening
const itemSeeds: Seed[] = [
  ["CVC Yarn 30/1 (60/40)", "Raw Material", "52062300", "CVC Yarn", "Kg", 395, 0, 12000],
  ["Polyester Filament Yarn 150D", "Raw Material", "54023300", "Polyester Yarn", "Kg", 240, 0, 6000],
  ["Elastane Yarn 40D", "Raw Material", "54024400", "Elastane Yarn", "Kg", 720, 0, 1800],
  ["Cotton Poplin Fabric 110 cm (pocketing)", "Raw Material", "52083200", "Woven Fabric", "Meter", 165, 0, 24000],
  ["Denim Fabric 12 oz", "Raw Material", "52094200", "Denim Fabric", "Meter", 310, 0, 18000],
  ["Cotton Yarn 26/1 Combed", "Raw Material", "52052300", "Cotton Yarn", "Kg", 345, 0, 2400],
  ["Cotton Yarn 28/1 Combed", "Raw Material", "52052300", "Cotton Yarn", "Kg", 360, 0, 9000],
  ["Cotton Yarn 30/1 Combed", "Raw Material", "52052300", "Cotton Yarn", "Kg", 385, 0, 12000],
  ["Cotton Yarn 30/1 Compact", "Raw Material", "52052300", "Cotton Yarn", "Kg", 410, 0, 14000],
  ["Reactive Dyes (assorted)", "Consumable", "32041600", "Dyes", "Kg", 850, 0, 900],
  ["Plastisol Printing Ink", "Consumable", "32151900", "Ink", "Kg", 1150, 0, 260],
  ["Sewing Thread 40/2 Spun Polyester", "Consumable", "55081000", "Sewing Thread", "Kg", 980, 0, 1400],
  ["Circular Knitting Needles (set)", "Consumable", "84485100", "Knitting Needles", "Pcs", 38500, 0, 24],
  ["Export Carton 5-ply", "Packing Materials", "48191000", "Carton", "Pcs", 62, 0, 3200],
  ["Gum Tape 2\"", "Packing Materials", "39191000", "Tape", "Roll", 95, 0, 700],
  ["Polybag LDPE (garment)", "Packing Materials", "39232100", "Polybag", "Pcs", 2.8, 0, 2600],
  ["Men's Basic T-Shirt", "Finished Goods", "61091000", "T-Shirt", "Pcs", 0, 360, 18000],
  ["Men's Polo Shirt (pique)", "Finished Goods", "61051000", "Polo Shirt", "Pcs", 0, 610, 9000],
  ["Hooded Sweatshirt (fleece)", "Finished Goods", "61102000", "Sweatshirt", "Pcs", 0, 880, 6000],
  ["Dyed Knit Fabric — Rib 1x1 (5% elastane)", "Finished Goods", "60041000", "Rib Fabric", "Kg", 0, 610, 1200],
  ["Dyed Knit Fabric — Single Jersey", "Finished Goods", "60062200", "Jersey Fabric", "Kg", 0, 520, 24000],
  ["Men's 5-Pocket Denim Jeans", "Finished Goods", "62034200", "Denim Jeans", "Pcs", 0, 1150, 5000],
]

export const items: Item[] = itemSeeds.map(([name, group, hs, master, unit, pp, sp, opening], i) => ({
  id: `i${i + 1}`,
  hsCode: hs,
  group,
  masterItem: master,
  brand: group === "Finished Goods" ? "KAC" : pick(["Generic", "Imported", "Local"]),
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
const people = [["Arif Hossain", "Shift-In-Charge"], ["Md. Kamal Uddin", "Store Officer"], ["Farzana Akter", "Accounts Executive"]] as const

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
    const chosen = shuffle(fg).slice(0, n)
    const lines = chosen.map((it) => {
      const qty = it.unit === "Pcs" ? int(20, 160) * (foreign ? 100 : 10) : int(80, 1400) // garments: export 2,000–16,000 pcs, local stock-lots 200–1,600; fabric: kg
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
      issuedBy: by, designation: desig, branchId: "b1", branchName: "",
    })
    if (process !== "Cancelled") for (const l of lines) items.find((i) => i.id === l.itemId)!.sold += l.qty
  }
  // Purchases: ~0.2/day → ≈ 75 bills
  if (rnd() < 0.2) {
    const v = rnd() < 0.45 ? pick(vendors.slice(0, 5)) : rnd() < 0.65 ? pick(vendors.slice(5, 7)) : pick(vendors.slice(7))
    const pool = v.mode === "Foreign" ? buyables.filter((i) => i.group === "Raw Material") : v.mode === "Local" ? buyables.filter((i) => i.group !== "Packing Materials") : buyables.filter((i) => i.group === "Packing Materials" || i.name.startsWith("Sewing Thread"))
    const n = int(1, 3)
    const chosen = shuffle(pool).slice(0, n)
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
      issuedBy: by, designation: desig, branchId: "b1", branchName: "",
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
