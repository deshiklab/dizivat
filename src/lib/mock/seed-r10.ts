import { sha256 } from "../integrity"
import { qrCanonical, saleQrCore } from "../invoice-qr"
import type {
  Branch,
  Item,
  Line,
  NbrEInvoiceAdapter,
  PosApiToken,
  PosQueueEntry,
  PosRegister,
  PosSale,
  PosShift,
  PosTerminalLine,
  PosTerminalStatement,
  PosWebhook,
  PosWebhookDelivery,
} from "../types"
import { calcLine, round2 } from "../vat"
import { company } from "./company"

/** Known demo tokens so external POS API tests and third-party demos can authenticate immediately. */
export const DEMO_POS_TOKEN = "dzpos_reg1_demo_token_2026"
export const DEMO_POS_READ_TOKEN = "dzpos_reg1_read_only_2026"

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  const words = new Uint32Array(((len + 9 + 63) >> 6) << 4)
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8)
  words[len >> 2] |= 0x80 << (24 - (len & 3) * 8)
  words[words.length - 1] = len * 8
  words[words.length - 2] = Math.floor((len * 8) / 0x100000000)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let o = 0; o < words.length; o += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[o + i]
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff
    out[i * 4 + 3] = h[i] & 0xff
  }
  return out
}

function hmacSha256Hex(keyStr: string, msgStr: string): string {
  const enc = new TextEncoder()
  const rawKey = enc.encode(keyStr)
  const keyBytes = rawKey.length > 64 ? sha256Bytes(rawKey) : rawKey
  const blockKey = new Uint8Array(64)
  blockKey.set(keyBytes)
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    ipad[i] = blockKey[i] ^ 0x36
    opad[i] = blockKey[i] ^ 0x5c
  }
  const msgBytes = enc.encode(msgStr)
  const inner = new Uint8Array(64 + msgBytes.length)
  inner.set(ipad, 0)
  inner.set(msgBytes, 64)
  const innerHash = sha256Bytes(inner)
  const outer = new Uint8Array(64 + 32)
  outer.set(opad, 0)
  outer.set(innerHash, 64)
  return Array.from(sha256Bytes(outer), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function hashPosToken(raw: string): string {
  return sha256(raw)
}

export function signPosWebhook(secret: string, payloadJson: string): string {
  return `sha256=${hmacSha256Hex(secret, payloadJson)}`
}

/** Synchronous equivalent of `invoiceQrToken` over `qrCanonical(saleQrCore(...))`. */
export function posQrTokenSync(
  sale: { invoiceNo: string; issueDate: string; netTotal: number; vat: number },
  seller: { bin: string; name: string },
): string {
  const secret = process.env.SESSION_SECRET ?? "dizivat-dev-secret-change-in-production"
  const core = saleQrCore(sale, seller)
  const sig = hmacSha256Hex(secret, qrCanonical(core)).slice(0, 20)
  const pois = (n: number) => String(Math.round(n * 100))
  return [sale.invoiceNo, sale.issueDate.replace(/-/g, ""), pois(sale.netTotal), pois(sale.vat), sig].join(".")
}

export function makeNbrAdapter(
  invoiceNo: string,
  issueDate: string,
  netTotal: number,
  vat: number,
  signedAt: string,
  status: "issued" | "voided" = "issued",
): NbrEInvoiceAdapter {
  const sig8 = sha256(`${company.bin}|${invoiceNo}|${issueDate}|${netTotal.toFixed(2)}|${vat.toFixed(2)}`)
    .slice(0, 8)
    .toUpperCase()
  return {
    mode: "selfIssued63",
    schemaVersion: "FA2026-6.3/1",
    irn: `IRN-${company.bin}-${invoiceNo}-${sig8}`,
    signedAt,
    status,
  }
}

function buildLine(item: Item, qty: number, price = item.salePrice): Line {
  const c = calcLine({ qty, price, sdRate: item.sdRate, vatRate: item.vatRate })
  return {
    itemId: item.id,
    name: item.name,
    hsCode: item.hsCode,
    uom: item.unit,
    qty,
    price,
    sdRate: item.sdRate,
    vatRate: item.vatRate,
    ...c,
  }
}

export interface SeededPos {
  posRegisters: PosRegister[]
  posShifts: PosShift[]
  posSales: PosSale[]
  posSettlements: PosTerminalStatement[]
  posSettlementLines: Record<string, PosTerminalLine[]>
  posTokens: PosApiToken[]
  posWebhooks: PosWebhook[]
  posWebhookDeliveries: PosWebhookDelivery[]
  posQueue: PosQueueEntry[]
}

export function seedPos(items: Item[], branches: Branch[]): SeededPos {
  const byId = new Map(items.map((it) => [it.id, it]))
  const i17 = byId.get("i17")!
  const i18 = byId.get("i18")!
  const i19 = byId.get("i19")!
  const b1 = branches.find((b) => b.id === "b1") ?? branches[0]
  const b3 = branches.find((b) => b.id === "b3") ?? branches[0]

  const posRegisters: PosRegister[] = [
    {
      id: "reg1",
      code: "REG-01",
      name: "Factory Outlet Counter 1 — Konabari",
      branchId: b1.id,
      branchName: b1.name,
      cashAccountId: "ac6",
      cardAccountId: "ac1",
      bkashAccountId: "ac4",
      nagadAccountId: "ac5",
      terminalId: "TERM-DBBL-0102",
      active: true,
      lastSeqNo: 2,
      lastSeenAt: "2026-09-25T11:20:00Z",
      createdAt: "2025-10-01T09:00:00Z",
    },
    {
      id: "reg2",
      code: "REG-02",
      name: "Ashulia Showroom Counter 2",
      branchId: b3.id,
      branchName: b3.name,
      cashAccountId: "ac6",
      cardAccountId: "ac2",
      bkashAccountId: "ac4",
      nagadAccountId: "ac5",
      terminalId: "TERM-BRAC-0301",
      active: true,
      lastSeqNo: 0,
      lastSeenAt: "2026-09-24T18:00:00Z",
      createdAt: "2025-10-01T09:00:00Z",
    },
  ]

  // Shift 1 (closed yesterday with Z-09260001 and a Tk 140 cash shortage variance)
  // Shift 2 (open today on REG-01 for live counter sales and X report)
  const posShifts: PosShift[] = [
    {
      id: "sh1",
      no: "SH-09260001",
      registerId: "reg1",
      registerCode: "REG-01",
      registerName: "Factory Outlet Counter 1 — Konabari",
      branchId: b1.id,
      branchName: b1.name,
      cashAccountId: "ac6",
      date: "2026-09-24",
      status: "closed",
      openingFloat: 10_000,
      openedAt: "2026-09-24T09:00:00Z",
      openedBy: "Md. Kamal Hossain",
      closedAt: "2026-09-24T20:00:00Z",
      closedBy: "Md. Arifur Rahman",
      zNo: "Z-09260001",
      expectedCash: 25_640,
      countedCash: 25_500,
      variance: -140,
      note: "Evening Z close — Tk 140 cash shortage recorded on drawer count",
      history: [
        { at: "2026-09-24T09:00:00Z", by: "Md. Kamal Hossain", action: "created", note: "Shift opened with Tk 10,000 float" },
        { at: "2026-09-24T20:00:00Z", by: "Md. Arifur Rahman", action: "approved", note: "Z-09260001 closed (counted Tk 25,500 vs expected Tk 25,640)" },
      ],
    },
    {
      id: "sh2",
      no: "SH-09260002",
      registerId: "reg1",
      registerCode: "REG-01",
      registerName: "Factory Outlet Counter 1 — Konabari",
      branchId: b1.id,
      branchName: b1.name,
      cashAccountId: "ac6",
      date: "2026-09-25",
      status: "open",
      openingFloat: 10_000,
      openedAt: "2026-09-25T09:00:00Z",
      openedBy: "Md. Kamal Hossain",
      note: "Morning counter shift",
      history: [
        { at: "2026-09-25T09:00:00Z", by: "Md. Kamal Hossain", action: "created", note: "Shift opened with Tk 10,000 float" },
      ],
    },
  ]

  function makeSale(spec: {
    id: string
    invoiceNo: string
    challanNo: string
    issueDate: string
    issueTime: string
    shiftId: string
    shiftNo: string
    customerId: string
    customerName: string
    customerBin: string
    customerMobile?: string
    customerAddress: string
    lines: Line[]
    discount?: number
    tenders: PosSale["tenders"]
    source: PosSale["source"]
    idempotencyKey?: string
    seqNo?: number
    createdAt: string
    note?: string
  }): PosSale {
    const subtotal = round2(spec.lines.reduce((a, l) => a + l.subtotal, 0))
    const sd = round2(spec.lines.reduce((a, l) => a + l.sd, 0))
    const vat = round2(spec.lines.reduce((a, l) => a + l.vat, 0))
    const discount = round2(spec.discount ?? 0)
    const netTotal = round2(subtotal + sd + vat - discount)
    const tenderedTotal = round2(spec.tenders.reduce((a, t) => a + t.amount, 0))
    const changeGiven = round2(spec.tenders.reduce((a, t) => a + t.changeGiven, 0))
    const qr = posQrTokenSync(
      {
        invoiceNo: spec.invoiceNo,
        issueDate: spec.issueDate,
        netTotal,
        vat,
      },
      { bin: company.bin, name: company.name },
    )
    return {
      id: spec.id,
      invoiceNo: spec.invoiceNo,
      challanNo: spec.challanNo,
      qr,
      issueDate: spec.issueDate,
      issueTime: spec.issueTime,
      process: "Approved",
      registerId: "reg1",
      registerCode: "REG-01",
      registerName: "Factory Outlet Counter 1 — Konabari",
      shiftId: spec.shiftId,
      shiftNo: spec.shiftNo,
      branchId: b1.id,
      branchName: b1.name,
      customerId: spec.customerId,
      customerName: spec.customerName,
      customerBin: spec.customerBin,
      customerMobile: spec.customerMobile,
      customerAddress: spec.customerAddress,
      lines: spec.lines,
      subtotal,
      sd,
      vat,
      discount,
      netTotal,
      tenders: spec.tenders,
      tenderedTotal,
      changeGiven,
      idempotencyKey: spec.idempotencyKey,
      seqNo: spec.seqNo,
      source: spec.source,
      nbrAdapter: makeNbrAdapter(spec.invoiceNo, spec.issueDate, netTotal, vat, spec.createdAt, "issued"),
      issuedBy: "Md. Kamal Hossain",
      designation: "VAT Officer",
      note: spec.note,
      createdAt: spec.createdAt,
      history: [{ at: spec.createdAt, by: "Md. Kamal Hossain", action: "created" }],
    }
  }

  // ps1: 20 x i17 (360) + 10 x i18 (610) -> subtotal 13,300, VAT 1,995, netTotal 15,295
  // Mixed tender: Cash 5,500 (change 205, net 5,295) + Card 10,000 (AUTH-884120)
  const ps1 = makeSale({
    id: "ps1",
    invoiceNo: "POS-09260001",
    challanNo: "9001",
    issueDate: "2026-09-24",
    issueTime: "11:15",
    shiftId: "sh1",
    shiftNo: "SH-09260001",
    customerId: "walkin",
    customerName: "Walk-in customer",
    customerBin: "—",
    customerMobile: "01711-223344",
    customerAddress: "Konabari Factory Outlet, Gazipur",
    lines: [buildLine(i17, 20), buildLine(i18, 10)],
    tenders: [
      { method: "cash", accountId: "ac6", accountName: "Main Cash Box — Gazipur", amount: 5_500, changeGiven: 205, netAmount: 5_295 },
      { method: "card", accountId: "ac1", accountName: "Dutch-Bangla Bank PLC", amount: 10_000, changeGiven: 0, netAmount: 10_000, reference: "AUTH-884120" },
    ],
    source: "counter",
    idempotencyKey: "reg1-seq-1",
    seqNo: 1,
    createdAt: "2026-09-24T11:15:00Z",
    note: "Mixed tender counter sale (Cash + DBBL Nexus Card)",
  })

  // ps2: 15 x i19 (880) + 10 x i17 (360) -> subtotal 16,800, VAT 2,520, netTotal 19,320
  // Mixed tender: Cash 10,345 + bKash 8,975 (BKX90411A)
  const ps2 = makeSale({
    id: "ps2",
    invoiceNo: "POS-09260002",
    challanNo: "9002",
    issueDate: "2026-09-24",
    issueTime: "16:40",
    shiftId: "sh1",
    shiftNo: "SH-09260001",
    customerId: "c1",
    customerName: "Tejgaon Garments Sourcing Ltd.",
    customerBin: "001122334-0101",
    customerMobile: "01819-556677",
    customerAddress: "214 Tejgaon Industrial Area, Dhaka-1208",
    lines: [buildLine(i19, 15), buildLine(i17, 10)],
    tenders: [
      { method: "cash", accountId: "ac6", accountName: "Main Cash Box — Gazipur", amount: 10_345, changeGiven: 0, netAmount: 10_345 },
      { method: "bkash", accountId: "ac4", accountName: "bKash", amount: 8_975, changeGiven: 0, netAmount: 8_975, reference: "BKX90411A" },
    ],
    source: "counter",
    createdAt: "2026-09-24T16:40:00Z",
    note: "Counter sample lot purchase (Cash + bKash Merchant)",
  })

  // ps3 (today's open shift sh2): 10 x i18 (610) -> subtotal 6,100, VAT 915, netTotal 7,015
  // Mixed tender: Nagad 4,015 (NGD77102C) + Cash 3,000
  const ps3 = makeSale({
    id: "ps3",
    invoiceNo: "POS-09260003",
    challanNo: "9003",
    issueDate: "2026-09-25",
    issueTime: "10:25",
    shiftId: "sh2",
    shiftNo: "SH-09260002",
    customerId: "walkin",
    customerName: "Walk-in customer",
    customerBin: "—",
    customerMobile: "01912-889900",
    customerAddress: "Konabari Factory Outlet, Gazipur",
    lines: [buildLine(i18, 10)],
    tenders: [
      { method: "nagad", accountId: "ac5", accountName: "Nagad", amount: 4_015, changeGiven: 0, netAmount: 4_015, reference: "NGD77102C" },
      { method: "cash", accountId: "ac6", accountName: "Main Cash Box — Gazipur", amount: 3_000, changeGiven: 0, netAmount: 3_000 },
    ],
    source: "counter",
    createdAt: "2026-09-25T10:25:00Z",
    note: "Morning counter sale (Nagad + Cash)",
  })

  // ps4 (today's open shift sh2, synced from offline device queue seqNo 2): 5 x i17 (360) -> subtotal 1,800, VAT 270, netTotal 2,070
  // Paid by Card 2,070 (AUTH-889401)
  const ps4 = makeSale({
    id: "ps4",
    invoiceNo: "POS-09260004",
    challanNo: "9004",
    issueDate: "2026-09-25",
    issueTime: "11:18",
    shiftId: "sh2",
    shiftNo: "SH-09260002",
    customerId: "walkin",
    customerName: "Walk-in customer",
    customerBin: "—",
    customerAddress: "Konabari Factory Outlet, Gazipur",
    lines: [buildLine(i17, 5)],
    tenders: [
      { method: "card", accountId: "ac1", accountName: "Dutch-Bangla Bank PLC", amount: 2_070, changeGiven: 0, netAmount: 2_070, reference: "AUTH-889401" },
    ],
    source: "offlineQueue",
    idempotencyKey: "reg1-seq-2",
    seqNo: 2,
    createdAt: "2026-09-25T11:18:00Z",
    note: "Synced from offline device queue (seq #2)",
  })

  const posSales: PosSale[] = [ps1, ps2, ps3, ps4]

  // R10.2: Seeded Card Terminal Settlement Statement (TS-09260001) on ac1 (Dutch-Bangla Bank PLC)
  const ts1Lines: PosTerminalLine[] = [
    {
      id: "tsl1-1",
      statementId: "ts1",
      rowNo: 1,
      date: "2026-09-24",
      channel: "card",
      reference: "AUTH-884120",
      narration: "VISA POS settlement · POS-09260001",
      gross: 10_000,
      fee: 150,
      net: 9_850,
      status: "matched",
      saleId: "ps1",
      invoiceNo: "POS-09260001",
      tenderMethod: "card",
      expectedFee: 150,
    },
    {
      id: "tsl1-2",
      statementId: "ts1",
      rowNo: 2,
      date: "2026-09-25",
      channel: "card",
      reference: "AUTH-889401",
      narration: "MASTERCARD POS settlement · POS-09260004",
      gross: 2_070,
      fee: 31.05,
      net: 2_038.95,
      status: "matched",
      saleId: "ps4",
      invoiceNo: "POS-09260004",
      tenderMethod: "card",
      expectedFee: 31.05,
    },
    {
      id: "tsl1-3",
      statementId: "ts1",
      rowNo: 3,
      date: "2026-09-25",
      channel: "card",
      reference: "TERM-FEE-0926",
      narration: "Monthly POS terminal rental & GPRS service charge",
      gross: 0,
      fee: 500,
      net: -500,
      status: "open",
    },
  ]

  const posSettlements: PosTerminalStatement[] = [
    {
      id: "ts1",
      no: "TS-09260001",
      accountId: "ac1",
      accountName: "Dutch-Bangla Bank PLC",
      channel: "card",
      source: "dbbl-nexus-pos-batch-0925.csv",
      from: "2026-09-24",
      to: "2026-09-25",
      importedAt: "2026-09-25T11:30:00Z",
      importedBy: "Md. Arifur Rahman",
      lineCount: ts1Lines.length,
      totals: {
        gross: round2(ts1Lines.reduce((a, l) => a + l.gross, 0)),
        fee: round2(ts1Lines.reduce((a, l) => a + l.fee, 0)),
        net: round2(ts1Lines.reduce((a, l) => a + l.net, 0)),
      },
    },
  ]

  const posSettlementLines: Record<string, PosTerminalLine[]> = {
    ts1: ts1Lines,
  }

  // R10.3: Scoped API tokens
  const posTokens: PosApiToken[] = [
    {
      id: "ptk1",
      name: "Counter 1 full sync token",
      registerId: "reg1",
      registerCode: "REG-01",
      prefix: DEMO_POS_TOKEN.slice(0, 15),
      tokenHash: hashPosToken(DEMO_POS_TOKEN),
      scopes: [
        "pos:catalog:read",
        "pos:sale:write",
        "pos:shift:write",
        "pos:queue:sync",
        "pos:catalog.read",
        "pos:stock.read",
        "pos:sales.write",
        "pos:queue.sync",
      ],
      active: true,
      createdAt: "2026-09-01T09:00:00Z",
      createdBy: "System Administrator",
      lastUsedAt: "2026-09-25T11:18:00Z",
    },
    {
      id: "ptk2",
      name: "Price-checker kiosk (read-only)",
      registerId: "reg1",
      registerCode: "REG-01",
      prefix: DEMO_POS_READ_TOKEN.slice(0, 15),
      tokenHash: hashPosToken(DEMO_POS_READ_TOKEN),
      scopes: ["pos:catalog:read", "pos:catalog.read", "pos:stock.read"],
      active: true,
      createdAt: "2026-09-05T10:00:00Z",
      createdBy: "System Administrator",
      lastUsedAt: "2026-09-25T10:00:00Z",
    },
  ]

  // R10.3: Offline queue entries
  const posQueue: PosQueueEntry[] = [
    {
      id: "pq1",
      registerId: "reg1",
      registerCode: "REG-01",
      seqNo: 1,
      idempotencyKey: "reg1-seq-1",
      saleId: "ps1",
      invoiceNo: "POS-09260001",
      netTotal: ps1.netTotal,
      clientCreatedAt: "2026-09-24T11:15:00Z",
      syncedAt: "2026-09-24T11:15:05Z",
      status: "synced",
    },
    {
      id: "pq2",
      registerId: "reg1",
      registerCode: "REG-01",
      seqNo: 2,
      idempotencyKey: "reg1-seq-2",
      saleId: "ps4",
      invoiceNo: "POS-09260004",
      netTotal: ps4.netTotal,
      clientCreatedAt: "2026-09-25T11:18:00Z",
      syncedAt: "2026-09-25T11:18:04Z",
      status: "synced",
    },
  ]

  // R10.3: Webhooks and signed deliveries
  const whSecret = "whsec_kanchanjhara_pos_2026"
  const posWebhooks: PosWebhook[] = [
    {
      id: "pwh1",
      name: "Retail ERP & Loyalty Sink",
      url: "https://pos-sink.kanchanjhara-apparel.example/webhooks/dizivat",
      events: [
        "pos.sale.completed",
        "pos.sale.voided",
        "pos.shift.opened",
        "pos.shift.closed",
        "pos.settlement.reconciled",
      ],
      secret: whSecret,
      active: true,
      createdAt: "2026-09-01T09:30:00Z",
      createdBy: "System Administrator",
      lastDeliveryAt: "2026-09-25T11:18:04Z",
      lastStatus: "delivered",
    },
  ]

  const d1Payload = {
    event: "pos.shift.closed",
    shiftNo: "SH-09260001",
    zNo: "Z-09260001",
    registerCode: "REG-01",
    expectedCash: 25_640,
    countedCash: 25_500,
    variance: -140,
  }
  const d2Payload = {
    event: "pos.sale.completed",
    invoiceNo: "POS-09260004",
    registerCode: "REG-01",
    netTotal: ps4.netTotal,
    vat: ps4.vat,
    irn: ps4.nbrAdapter.irn,
  }

  const posWebhookDeliveries: PosWebhookDelivery[] = [
    {
      id: "pwd1",
      webhookId: "pwh1",
      webhookName: "Retail ERP & Loyalty Sink",
      event: "pos.shift.closed",
      ref: "Z-09260001",
      payload: d1Payload,
      signature: signPosWebhook(whSecret, JSON.stringify(d1Payload)),
      status: "delivered",
      deliveredAt: "2026-09-24T20:00:02Z",
    },
    {
      id: "pwd2",
      webhookId: "pwh1",
      webhookName: "Retail ERP & Loyalty Sink",
      event: "pos.sale.completed",
      ref: "POS-09260004",
      payload: d2Payload,
      signature: signPosWebhook(whSecret, JSON.stringify(d2Payload)),
      status: "delivered",
      deliveredAt: "2026-09-25T11:18:04Z",
    },
  ]

  return {
    posRegisters,
    posShifts,
    posSales,
    posSettlements,
    posSettlementLines,
    posTokens,
    posWebhooks,
    posWebhookDeliveries,
    posQueue,
  }
}
