import type {
  Item,
  PayMethod,
  PosBarcodeLabel,
  PosLabelFormat,
  PosSale,
  PosShift,
  PosShiftReport,
  PosTenderMethod,
  Sale,
} from "./types"
import { calcLine, round2 } from "./vat"

/** Standard Code-128 module width patterns (values 0..106; 0..105 are 11 modules, 106 Stop is 13 modules). */
const C128: readonly string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100",
  "10001100100", "11001001000", "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100",
  "10011101100", "10011100110", "11001110010", "11001011100", "11001001110", "11011100100", "11001110100", "11101101110",
  "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010", "11011011000", "11011000110",
  "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110",
  "11101110110", "11010001110", "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110",
  "11100010110", "11101101000", "11101100010", "11100011010", "11101111010", "11001000010", "11110001010", "10100110000",
  "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000", "10110000100", "10011010000",
  "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100",
  "11110010010", "11011011110", "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000",
  "10111100010", "11110101000", "11110100010", "10111011110", "10111101110", "11101011110", "11110101110", "11010000100",
  "11010010000", "11010011100", "1100011101011",
]

/** Encode an ASCII string (32..126) as a Code-128B binary bar pattern ("1" = black module, "0" = white module). */
export function encodeCode128B(text: string): string {
  const clean = text.trim() || "POS"
  let sum = 104 // Start Code B
  const parts: string[] = [C128[104]]
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i)
    const val = code >= 32 && code <= 126 ? code - 32 : 0
    sum += val * (i + 1)
    parts.push(C128[val])
  }
  parts.push(C128[sum % 103], C128[106])
  return parts.join("")
}

/** Unit price inclusive of SD and VAT for retail counter display and barcode labels. */
export function posPriceInclTax(salePrice: number, sdRate = 0, vatRate = 15): number {
  return calcLine({ qty: 1, price: salePrice, sdRate, vatRate }).total
}

/** Project a PosSale into the statutory Sale shape so `<Mushak63 />` and R8.1 QR verification work identically. */
export function posSaleAsSale(ps: PosSale): Sale {
  const methods = [...new Set(ps.tenders.map((t) => t.method))]
  const payMode: PayMethod =
    methods.length === 1
      ? methods[0] === "cash"
        ? "Cash"
        : methods[0] === "card"
          ? "Bank"
          : "Mobile"
      : "Transaction"
  return {
    id: ps.id,
    invoiceNo: ps.invoiceNo,
    challanNo: ps.challanNo,
    qr: ps.qr,
    issueDate: ps.issueDate,
    issueTime: ps.issueTime,
    customerId: ps.customerId,
    customerName: ps.customerName,
    customerBin: ps.customerBin || "—",
    customerAddress: ps.customerAddress || "Counter retail sale",
    deliveryAddress: ps.customerAddress || ps.branchName,
    vehicle: `POS · ${ps.registerCode}`,
    mode: "Local",
    vds: false,
    method: payMode,
    process: ps.process,
    lines: ps.lines,
    subtotal: ps.subtotal,
    sd: ps.sd,
    vat: ps.vat,
    discount: ps.discount,
    netTotal: ps.netTotal,
    paid: ps.process === "Approved" ? ps.netTotal : 0,
    due: 0,
    narration: ps.note || `POS sale (${ps.registerCode} · ${ps.shiftNo})`,
    issuedBy: ps.issuedBy,
    designation: ps.designation,
    branchId: ps.branchId,
    branchName: ps.branchName,
    createdAt: ps.createdAt,
    updatedAt: ps.updatedAt,
    cancelReason: ps.cancelReason,
    history: ps.history,
  }
}

const TENDER_METHODS: PosTenderMethod[] = ["cash", "card", "bkash", "nagad"]

/** Fold a shift and its POS sales into an X report (while open) or Z report (once closed). */
export function posShiftReport(shift: PosShift, sales: PosSale[], now = shift.closedAt ?? shift.openedAt): PosShiftReport {
  const shiftSales = sales.filter((s) => s.shiftId === shift.id)
  const approved = shiftSales.filter((s) => s.process === "Approved")
  const voided = shiftSales.filter((s) => s.process === "Cancelled")

  const subtotal = round2(approved.reduce((a, s) => a + s.subtotal, 0))
  const sd = round2(approved.reduce((a, s) => a + s.sd, 0))
  const vat = round2(approved.reduce((a, s) => a + s.vat, 0))
  const discount = round2(approved.reduce((a, s) => a + s.discount, 0))
  const netSales = round2(approved.reduce((a, s) => a + s.netTotal, 0))
  const voidedTotal = round2(voided.reduce((a, s) => a + s.netTotal, 0))

  const rateMap = new Map<number, { rate: number; taxable: number; vat: number; count: number }>()
  for (const s of approved) {
    for (const l of s.lines) {
      const cur = rateMap.get(l.vatRate) ?? { rate: l.vatRate, taxable: 0, vat: 0, count: 0 }
      cur.taxable = round2(cur.taxable + l.subtotal + l.sd)
      cur.vat = round2(cur.vat + l.vat)
      cur.count += 1
      rateMap.set(l.vatRate, cur)
    }
  }
  const vatByRate = [...rateMap.values()].sort((a, b) => b.rate - a.rate)

  const tenders = TENDER_METHODS.map((method) => {
    let count = 0
    let tendered = 0
    let changeGiven = 0
    let netAmount = 0
    for (const s of approved) {
      for (const t of s.tenders) {
        if (t.method !== method) continue
        count += 1
        tendered = round2(tendered + t.amount)
        changeGiven = round2(changeGiven + t.changeGiven)
        netAmount = round2(netAmount + t.netAmount)
      }
    }
    return { method, count, tendered, changeGiven, netAmount }
  })

  const cashRow = tenders.find((t) => t.method === "cash")!
  const expectedCash = round2(shift.openingFloat + cashRow.netAmount)
  const countedCash = shift.status === "closed" ? (shift.countedCash ?? expectedCash) : shift.countedCash
  const variance = countedCash !== undefined ? round2(countedCash - expectedCash) : undefined

  return {
    kind: shift.status === "closed" ? "Z" : "X",
    shift: {
      ...shift,
      expectedCash,
      ...(countedCash !== undefined ? { countedCash, variance } : {}),
    },
    generatedAt: now,
    salesCount: approved.length,
    voidedCount: voided.length,
    voidedTotal,
    subtotal,
    sd,
    vat,
    discount,
    netSales,
    vatByRate,
    tenders,
    cashDrawer: {
      openingFloat: shift.openingFloat,
      cashTendered: cashRow.tendered,
      changeGiven: cashRow.changeGiven,
      netCashSales: cashRow.netAmount,
      expectedCash,
      ...(countedCash !== undefined ? { countedCash, variance } : {}),
    },
    invoices: shiftSales.map((s) => ({
      id: s.id,
      invoiceNo: s.invoiceNo,
      issueTime: s.issueTime,
      customerName: s.customerName,
      netTotal: s.netTotal,
      vat: s.vat,
      process: s.process,
      methods: [...new Set(s.tenders.map((t) => t.method))],
    })),
  }
}

/** R10.4 — Finance Act 2026 NBR e-Invoice Adapter envelope for ERP-issued Mushak 6.3. */
export function buildNbrAdapterPayload(
  ps: PosSale,
  seller: { name: string; bin: string; address: string },
) {
  return {
    schema: "nbr.gov.bd/mushak-6.3/fa2026-v1",
    adapter: ps.nbrAdapter,
    issuer: {
      software: "DiziVAT",
      authority: "Finance Act 2026 — NBR ERP Self-Issued Mushak 6.3",
      mode: ps.nbrAdapter.mode,
      schemaVersion: ps.nbrAdapter.schemaVersion,
    },
    seller: {
      name: seller.name,
      bin: seller.bin,
      address: seller.address,
      branchId: ps.branchId,
      branchName: ps.branchName,
      registerCode: ps.registerCode,
    },
    buyer: {
      name: ps.customerName,
      bin: ps.customerBin || "—",
      mobile: ps.customerMobile || undefined,
      address: ps.customerAddress,
    },
    invoice: {
      invoiceNo: ps.invoiceNo,
      challanNo: ps.challanNo,
      issueDate: ps.issueDate,
      issueTime: ps.issueTime,
      process: ps.process,
      shiftNo: ps.shiftNo,
      source: ps.source,
    },
    lines: ps.lines.map((l, idx) => ({
      sl: idx + 1,
      itemId: l.itemId,
      itemName: l.name,
      hsCode: l.hsCode,
      unit: l.uom,
      qty: l.qty,
      unitPrice: l.price,
      subtotal: l.subtotal,
      sdRate: l.sdRate,
      sd: l.sd,
      vatRate: l.vatRate,
      vat: l.vat,
      total: l.total,
    })),
    taxSummary: {
      subtotal: ps.subtotal,
      sd: ps.sd,
      vat: ps.vat,
      discount: ps.discount,
      netTotal: ps.netTotal,
      tenderedTotal: ps.tenderedTotal,
      changeGiven: ps.changeGiven,
    },
    tenders: ps.tenders.map((t) => ({
      method: t.method,
      accountId: t.accountId,
      amount: t.amount,
      changeGiven: t.changeGiven,
      netAmount: t.netAmount,
      reference: t.reference || undefined,
    })),
    verification: {
      qrToken: ps.qr ?? "",
      verifyPath: ps.qr ? `/verify/mushak-63?t=${encodeURIComponent(ps.qr)}` : "",
      apiVerifyPath: ps.qr ? `/api/v1/verify/invoice?token=${encodeURIComponent(ps.qr)}` : "",
    },
  }
}

/** R10.4 — Build printable item barcode labels with Code-128B bar patterns and tax-inclusive retail pricing. */
export function buildBarcodeLabels(
  items: Item[],
  specs: { itemId: string; qty: number }[],
  format: PosLabelFormat = "38x25",
): { format: PosLabelFormat; totalLabels: number; labels: PosBarcodeLabel[] } {
  const byId = new Map(items.map((it) => [it.id, it]))
  const labels: PosBarcodeLabel[] = []
  let totalLabels = 0
  for (const s of specs) {
    const it = byId.get(s.itemId)
    if (!it) continue
    const qty = Math.max(1, Math.min(200, Math.trunc(s.qty)))
    totalLabels += qty
    labels.push({
      itemId: it.id,
      sku: it.sku,
      name: it.name,
      hsCode: it.hsCode,
      unit: it.unit,
      salePrice: it.salePrice,
      vatRate: it.vatRate,
      sdRate: it.sdRate,
      priceInclTax: posPriceInclTax(it.salePrice, it.sdRate, it.vatRate),
      qty,
      bars: encodeCode128B(it.sku),
    })
  }
  return { format, totalLabels, labels }
}
