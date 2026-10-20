import type { Permission, Role } from "@/lib/auth/roles"
import { TODAY } from "@/lib/company"
import { recordAudit } from "@/lib/mock/audit"
import { company as defaultCompany } from "@/lib/mock/company"
import { branchSplit, db, mainBranchId, type MovementSource, withStock } from "@/lib/mock/db"
import { csvResponse, runQuery, toCSV } from "@/lib/mock/query"
import { hashPosToken, makeNbrAdapter, posQrTokenSync, signPosWebhook } from "@/lib/mock/seed-r10"
import {
  buildBarcodeLabels,
  buildNbrAdapterPayload,
  encodeCode128B,
  posPriceInclTax,
  posSaleAsSale,
  posShiftReport,
} from "@/lib/pos"
import {
  posLabelInput,
  posQueueSyncInput,
  posRegisterInput,
  posSaleInput,
  posSalePatchInput,
  posShiftCloseInput,
  posShiftOpenInput,
  posTerminalImportInput,
  posTerminalLineMatchInput,
  posTerminalLinePatchInput,
  posTokenInput,
  posWebhookInput,
} from "@/lib/schemas"
import type {
  AccountKind,
  Branch,
  Line,
  MoneyAccount,
  Party,
  PosApiToken,
  PosLabelFormat,
  PosQueueEntry,
  PosRegister,
  PosSale,
  PosScope,
  PosShift,
  PosTender,
  PosTenderMethod,
  PosTerminalLine,
  PosTerminalLineMatch,
  PosTerminalLineStatus,
  PosTerminalStatement,
  PosWebhook,
  PosWebhookDelivery,
  PosWebhookEvent,
} from "@/lib/types"
import { calcLine, round2 } from "@/lib/vat"
import { json, problem, withAuth, zodErrors } from "./_lib"
import { closed, periodLocked, type ReturnSource } from "./_r4"

export class PosRuleError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    public readonly title: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(title)
  }
}

function parseSchema<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: unknown } }, body: unknown): T {
  const r = schema.safeParse(body)
  if (!r.success) throw new PosRuleError(422, "Validation failed", zodErrors(r.error as never))
  return r.data as T
}

export type PosSource = MovementSource &
  ReturnSource & {
    posRegisters: PosRegister[]
    posShifts: PosShift[]
    posSales: PosSale[]
    posSettlements: PosTerminalStatement[]
    posSettlementLines: PosTerminalLine[]
    posTokens: PosApiToken[]
    posWebhooks: PosWebhook[]
    posWebhookDeliveries: PosWebhookDelivery[]
    posQueue: PosQueueEntry[]
    customers: Party[]
    moneyAccounts: MoneyAccount[]
    accountingConfig: { closedUpTo?: string; allowAdvance: boolean; autoAllocate: boolean }
    company?: { name: string; bin: string; address: string; branches: Branch[] }
  }

function sellerOf(src: PosSource) {
  const c = src.company ?? defaultCompany
  return { name: c.name, bin: c.bin, address: c.address, branches: c.branches ?? defaultCompany.branches }
}

function nextPosNo(prefix: "POS" | "SH" | "Z" | "TS", date: string, existing: string[]): string {
  const [y, m] = date.split("-")
  const key = `${prefix}-${m}${y.slice(2)}`
  let max = 0
  for (const no of existing) {
    if (no?.startsWith(key)) {
      const n = Number(no.slice(key.length)) || 0
      if (n > max) max = n
    }
  }
  return `${key}${String(max + 1).padStart(4, "0")}`
}

function nextChallanNo(src: PosSource): string {
  let max = 9000
  for (const s of src.posSales) {
    const n = Number(s.challanNo) || 0
    if (n > max) max = n
  }
  return String(max + 1)
}

export function withPosQr(ps: PosSale, src: PosSource): PosSale {
  const seller = sellerOf(src)
  const qr = posQrTokenSync(
    {
      invoiceNo: ps.invoiceNo,
      issueDate: ps.issueDate,
      netTotal: ps.netTotal,
      vat: ps.vat,
    },
    { bin: seller.bin, name: seller.name },
  )
  return { ...ps, qr }
}

/* ── R10.1: Stock availability at register's branch + Catalog ─────────────── */

export function posSoldByBranch(src: PosSource, excludeSaleId?: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const s of src.posSales) {
    if (s.process !== "Approved" || s.id === excludeSaleId) continue
    for (const l of s.lines) {
      const k = `${l.itemId}|${s.branchId}`
      map.set(k, round2((map.get(k) ?? 0) + l.qty))
    }
  }
  return map
}

export interface PosCatalogItem {
  id: string
  sku: string
  name: string
  hsCode: string
  group: string
  unit: string
  salePrice: number
  sdRate: number
  vatRate: number
  priceInclTax: number
  warehouseRemain: number
  posSold: number
  available: number
  barcode: string
}

export function posCatalogItems(src: PosSource, branchId: string, q = ""): PosCatalogItem[] {
  const split = branchSplit(src)
  const posSold = posSoldByBranch(src)
  const needle = q.trim().toLowerCase()
  const items = src.items
    .filter((it) => it.active !== false && it.salePrice > 0)
    .map((it) => {
      const warehouseRemain = round2(split.get(it.id)?.[branchId] ?? (branchId === mainBranchId() ? withStock(it).remain : 0))
      const soldHere = round2(posSold.get(`${it.id}|${branchId}`) ?? 0)
      const available = Math.max(0, round2(warehouseRemain - soldHere))
      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        hsCode: it.hsCode,
        group: it.group,
        unit: it.unit,
        salePrice: it.salePrice,
        sdRate: it.sdRate,
        vatRate: it.vatRate,
        priceInclTax: posPriceInclTax(it.salePrice, it.sdRate, it.vatRate),
        warehouseRemain,
        posSold: soldHere,
        available,
        barcode: encodeCode128B(it.sku),
      }
    })
  if (!needle) return items
  return items.filter(
    (it) =>
      it.sku.toLowerCase().includes(needle) ||
      it.name.toLowerCase().includes(needle) ||
      it.hsCode.toLowerCase().includes(needle) ||
      it.id.toLowerCase() === needle,
  )
}

export function posCatalogView(src: PosSource, query: { registerId?: string; branchId?: string; q?: string }) {
  const reg =
    (query.registerId ? src.posRegisters.find((r) => r.id === query.registerId || r.code === query.registerId) : undefined) ??
    src.posRegisters.find((r) => r.active) ??
    src.posRegisters[0]
  const branchId = query.branchId || reg?.branchId || mainBranchId()
  const openShift = reg ? src.posShifts.find((s) => s.registerId === reg.id && s.status === "open") ?? null : null
  const items = posCatalogItems(src, branchId, query.q ?? "")
  const accounts = src.moneyAccounts
    .filter((a) => a.active)
    .map((a) => ({ id: a.id, kind: a.kind, provider: a.provider, accountNo: a.accountNo, serviceCharge: a.serviceCharge }))
  const customers = src.customers
    .filter((c) => c.active !== false && c.mode === "Local")
    .slice(0, 40)
    .map((c) => ({ id: c.id, name: c.name, bin: c.bin, mobile: c.mobile, address: c.address }))
  return {
    register: reg ?? null,
    registers: posRegistersList(src),
    openShift,
    branchId,
    items,
    accounts,
    customers,
  }
}

export function posStockLookup(src: PosSource, skuOrId: string, registerId?: string) {
  const reg =
    (registerId ? src.posRegisters.find((r) => r.id === registerId || r.code === registerId) : undefined) ??
    src.posRegisters.find((r) => r.active) ??
    src.posRegisters[0]
  const branchId = reg?.branchId ?? mainBranchId()
  const needle = skuOrId.trim().toLowerCase()
  const all = posCatalogItems(src, branchId)
  const hit = all.find((it) => it.sku.toLowerCase() === needle || it.id.toLowerCase() === needle)
  if (!hit) throw new PosRuleError(404, "SKU not found")
  return {
    registerId: reg?.id ?? null,
    registerCode: reg?.code ?? null,
    branchId,
    item: hit,
  }
}

/* ── R10.3: Webhooks dispatcher ───────────────────────────────────────────── */

export function firePosWebhooks(
  src: PosSource,
  event: PosWebhookEvent,
  ref: string,
  payload: Record<string, unknown>,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
): PosWebhookDelivery[] {
  const created: PosWebhookDelivery[] = []
  for (const wh of src.posWebhooks) {
    if (!wh.active || !wh.events.includes(event)) continue
    const body = { event, ref, at: now, ...payload }
    const sig = signPosWebhook(wh.secret, JSON.stringify(body))
    const d: PosWebhookDelivery = {
      id: nextDeliveryId(),
      webhookId: wh.id,
      webhookName: wh.name,
      event,
      ref,
      payload: body,
      signature: sig,
      status: "delivered",
      deliveredAt: now,
    }
    wh.lastDeliveryAt = now
    wh.lastStatus = "delivered"
    src.posWebhookDeliveries.unshift(d)
    created.push(d)
  }
  return created
}

/* ── R10.1 & R10.3: Build / Validate / Void POS Sale ──────────────────────── */

const METHOD_TO_ACCOUNT_KIND: Record<PosTenderMethod, AccountKind> = {
  cash: "cash",
  card: "bank",
  bkash: "mobile",
  nagad: "mobile",
}

function defaultAccountForMethod(reg: PosRegister, method: PosTenderMethod): string {
  switch (method) {
    case "cash":
      return reg.cashAccountId
    case "card":
      return reg.cardAccountId
    case "bkash":
      return reg.bkashAccountId
    case "nagad":
      return reg.nagadAccountId
  }
}

function payloadFingerprint(input: {
  registerId: string
  discount?: number
  lines: { itemId: string; qty: number; price?: number }[]
  tenders: { method: PosTenderMethod; amount: number }[]
}): string {
  const l = input.lines.map((x) => `${x.itemId}:${x.qty}:${x.price ?? ""}`).join(",")
  const t = input.tenders.map((x) => `${x.method}:${x.amount}`).join(",")
  return `${input.registerId}|${input.discount ?? 0}|${l}|${t}`
}

function existingSaleFingerprint(s: PosSale): string {
  const l = s.lines.map((x) => `${x.itemId}:${x.qty}:${x.price}`).join(",")
  const t = s.tenders.map((x) => `${x.method}:${x.amount}`).join(",")
  return `${s.registerId}|${s.discount}|${l}|${t}`
}

export function buildPosSale(
  src: PosSource,
  body: unknown,
  actor: { name: string; role?: Role; designation?: string },
  opts: {
    nextId: () => string
    nextDeliveryId: () => string
    source?: PosSale["source"]
    requireIdempotencyKey?: boolean
    headerIdempotencyKey?: string
    now?: string
  },
): { sale: PosSale; idempotentReplay: boolean; deliveries: PosWebhookDelivery[] } {
  const v = parseSchema(posSaleInput, body)
  const idemKey = (v.idempotencyKey || opts.headerIdempotencyKey || "").trim() || undefined

  if (opts.requireIdempotencyKey && !idemKey) {
    throw new PosRuleError(422, "Validation failed", { idempotencyKey: ["required"] })
  }

  const reg = src.posRegisters.find((r) => r.id === v.registerId || r.code === v.registerId)
  if (!reg) throw new PosRuleError(422, "Validation failed", { registerId: ["unknown"] })
  if (!reg.active) throw new PosRuleError(422, "Validation failed", { registerId: ["inactive"] })

  // Idempotency check before mutating state
  if (idemKey) {
    const existing = src.posSales.find((s) => s.registerId === reg.id && s.idempotencyKey === idemKey)
    if (existing) {
      const normalizedLines = v.lines.map((l) => {
        const it = src.items.find((i) => i.id === l.itemId || i.sku === l.itemId)
        return { itemId: it?.id ?? l.itemId, qty: l.qty, price: l.price ?? it?.salePrice ?? 0 }
      })
      const fpNew = payloadFingerprint({
        registerId: reg.id,
        discount: v.discount,
        lines: normalizedLines,
        tenders: v.tenders,
      })
      const fpOld = existingSaleFingerprint(existing)
      if (fpNew !== fpOld) {
        throw new PosRuleError(
          409,
          `Idempotency key '${idemKey}' was already used on ${existing.invoiceNo} with a different sale payload.`,
        )
      }
      return { sale: withPosQr(existing, src), idempotentReplay: true, deliveries: [] }
    }
  }

  // Resolve open shift on the register
  const shift = v.shiftId
    ? src.posShifts.find((s) => s.id === v.shiftId || s.no === v.shiftId)
    : src.posShifts.find((s) => s.registerId === reg.id && s.status === "open")
  if (!shift || shift.registerId !== reg.id) {
    throw new PosRuleError(409, `No open shift on register ${reg.code} — open a shift before ringing counter sales.`)
  }
  if (shift.status !== "open") {
    throw new PosRuleError(409, `Shift ${shift.no} is already closed (${shift.zNo ?? "Z"}).`)
  }

  const issueDate = v.issueDate || shift.date || TODAY
  const issueTime = v.issueTime || "12:00"
  if (periodLocked(issueDate, src)) {
    throw new PosRuleError(422, "Validation failed", { issueDate: ["periodLocked"] })
  }
  if (closed(issueDate, src)) {
    throw new PosRuleError(422, "Validation failed", { issueDate: ["dateClosed"] })
  }

  // Validate items & live branch stock
  const catalogById = new Map(posCatalogItems(src, reg.branchId).map((c) => [c.id, c]))
  const errors: Record<string, string[]> = {}
  const needByItem = new Map<string, number>()
  const builtLines: Line[] = []

  v.lines.forEach((l, idx) => {
    const it = src.items.find((i) => i.id === l.itemId || i.sku === l.itemId)
    if (!it || it.active === false || it.salePrice <= 0) {
      errors[`lines.${idx}.itemId`] = ["unknown"]
      return
    }
    const price = l.price ?? it.salePrice
    const sdRate = l.sdRate ?? it.sdRate
    const vatRate = l.vatRate ?? it.vatRate
    const c = calcLine({ qty: l.qty, price, sdRate, vatRate })
    needByItem.set(it.id, round2((needByItem.get(it.id) ?? 0) + l.qty))
    builtLines.push({
      itemId: it.id,
      name: it.name,
      hsCode: it.hsCode,
      uom: it.unit,
      qty: l.qty,
      price,
      sdRate,
      vatRate,
      ...c,
    })
  })

  for (const [itemId, reqQty] of needByItem) {
    const cat = catalogById.get(itemId)
    const avail = cat?.available ?? 0
    if (reqQty > avail + 1e-9) {
      builtLines.forEach((bl, idx) => {
        if (bl.itemId === itemId) errors[`lines.${idx}.qty`] = ["insufficient"]
      })
    }
  }
  if (Object.keys(errors).length) {
    throw new PosRuleError(422, "Validation failed", errors)
  }

  const subtotal = round2(builtLines.reduce((a, l) => a + l.subtotal, 0))
  const sd = round2(builtLines.reduce((a, l) => a + l.sd, 0))
  const vat = round2(builtLines.reduce((a, l) => a + l.vat, 0))
  const discount = round2(v.discount ?? 0)
  if (discount > subtotal + 1e-9) {
    throw new PosRuleError(422, "Validation failed", { discount: ["exceedsSubtotal"] })
  }
  const netTotal = round2(subtotal + sd + vat - discount)

  // Validate mixed tenders
  let nonCashSum = 0
  let totalTendered = 0
  let cashCount = 0
  const rawTenders: { method: PosTenderMethod; account: MoneyAccount; amount: number; reference?: string }[] = []

  v.tenders.forEach((t, idx) => {
    const accId = t.accountId || defaultAccountForMethod(reg, t.method)
    const acc = src.moneyAccounts.find((a) => a.id === accId && a.active)
    const expectedKind = METHOD_TO_ACCOUNT_KIND[t.method]
    if (!acc || acc.kind !== expectedKind) {
      errors[`tenders.${idx}.accountId`] = ["accountKindMismatch"]
      return
    }
    if (t.method !== "cash" && !t.reference?.trim()) {
      errors[`tenders.${idx}.reference`] = ["required"]
      return
    }
    const amt = round2(t.amount)
    totalTendered = round2(totalTendered + amt)
    if (t.method === "cash") cashCount += 1
    else nonCashSum = round2(nonCashSum + amt)
    rawTenders.push({
      method: t.method,
      account: acc,
      amount: amt,
      reference: t.reference?.trim() || undefined,
    })
  })

  if (Object.keys(errors).length) {
    throw new PosRuleError(422, "Validation failed", errors)
  }
  if (totalTendered + 1e-9 < netTotal) {
    throw new PosRuleError(422, "Validation failed", { tenders: ["insufficientTender"] })
  }
  if (nonCashSum > netTotal + 1e-9) {
    throw new PosRuleError(422, "Validation failed", { tenders: ["nonCashExceedsTotal"] })
  }
  const totalChange = round2(totalTendered - netTotal)
  if (totalChange > 0 && cashCount === 0) {
    throw new PosRuleError(422, "Validation failed", { tenders: ["changeRequiresCash"] })
  }

  let changeRemaining = totalChange
  const tenders: PosTender[] = rawTenders.map((rt) => {
    const chg = rt.method === "cash" && changeRemaining > 0 ? round2(Math.min(rt.amount, changeRemaining)) : 0
    changeRemaining = round2(changeRemaining - chg)
    return {
      method: rt.method,
      accountId: rt.account.id,
      accountName: rt.account.provider,
      amount: rt.amount,
      changeGiven: chg,
      netAmount: round2(rt.amount - chg),
      ...(rt.reference ? { reference: rt.reference } : {}),
    }
  })

  const cust = v.customerId && v.customerId !== "walkin" ? src.customers.find((c) => c.id === v.customerId) : undefined
  const customerId = cust?.id ?? "walkin"
  const customerName = cust?.name || v.customerName.trim() || "Walk-in customer"
  const customerBin = cust?.bin || v.customerBin.trim() || "—"
  const customerAddress = cust?.address || v.customerAddress.trim() || reg.branchName

  const now = opts.now ?? new Date().toISOString()
  const id = opts.nextId()
  const invoiceNo = nextPosNo(
    "POS",
    issueDate,
    src.posSales.map((s) => s.invoiceNo),
  )
  const challanNo = nextChallanNo(src)

  const baseSale: PosSale = {
    id,
    invoiceNo,
    challanNo,
    issueDate,
    issueTime,
    process: "Approved",
    registerId: reg.id,
    registerCode: reg.code,
    registerName: reg.name,
    shiftId: shift.id,
    shiftNo: shift.no,
    branchId: reg.branchId,
    branchName: reg.branchName,
    customerId,
    customerName,
    customerBin,
    customerMobile: v.customerMobile?.trim() || cust?.mobile || undefined,
    customerAddress,
    lines: builtLines,
    subtotal,
    sd,
    vat,
    discount,
    netTotal,
    tenders,
    tenderedTotal: totalTendered,
    changeGiven: totalChange,
    idempotencyKey: idemKey,
    seqNo: v.seqNo,
    source: opts.source ?? "counter",
    nbrAdapter: makeNbrAdapter(invoiceNo, issueDate, netTotal, vat, now, "issued"),
    issuedBy: actor.name,
    designation: actor.designation ?? "POS Operator",
    note: v.note || undefined,
    createdAt: now,
    history: [{ at: now, by: actor.name, action: "created" }],
  }

  const sale = withPosQr(baseSale, src)
  src.posSales.unshift(sale)
  reg.lastSeenAt = now

  const deliveries = firePosWebhooks(
    src,
    "pos.sale.completed",
    sale.invoiceNo,
    {
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      registerCode: sale.registerCode,
      shiftNo: sale.shiftNo,
      netTotal: sale.netTotal,
      vat: sale.vat,
      irn: sale.nbrAdapter.irn,
      tenders: sale.tenders.map((t) => ({ method: t.method, netAmount: t.netAmount })),
    },
    opts.nextDeliveryId,
    now,
  )

  return { sale, idempotentReplay: false, deliveries }
}

export function cancelPosSale(
  src: PosSource,
  id: string,
  body: unknown,
  actor: { name: string; role?: Role },
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
): { sale: PosSale; deliveries: PosWebhookDelivery[] } {
  const sale = src.posSales.find((s) => s.id === id || s.invoiceNo === id)
  if (!sale) throw new PosRuleError(404, "POS invoice not found")
  const parsed = parseSchema(posSalePatchInput, body)
  if (sale.process === "Cancelled") {
    throw new PosRuleError(409, `${sale.invoiceNo} is already cancelled`)
  }
  const shift = src.posShifts.find((sh) => sh.id === sale.shiftId)
  if (shift && shift.status === "closed") {
    throw new PosRuleError(
      409,
      `Shift ${shift.no} is already closed (${shift.zNo}) — issue a credit note instead of voiding after Z close.`,
    )
  }
  const matchedLine = src.posSettlementLines.find((l) => l.status === "matched" && l.saleId === sale.id)
  if (matchedLine) {
    const st = src.posSettlements.find((s) => s.id === matchedLine.statementId)
    throw new PosRuleError(
      409,
      `${sale.invoiceNo} is already matched on terminal statement ${st?.no ?? matchedLine.statementId}`,
    )
  }
  if (periodLocked(sale.issueDate, src)) {
    throw new PosRuleError(409, `Tax period ${sale.issueDate.slice(0, 7)} is locked`)
  }

  sale.process = "Cancelled"
  sale.cancelReason = parsed.reason
  sale.updatedAt = now
  sale.nbrAdapter = { ...sale.nbrAdapter, status: "voided" }
  sale.history = [...sale.history, { at: now, by: actor.name, action: "cancelled", note: parsed.reason }]
  const refreshed = withPosQr(sale, src)
  Object.assign(sale, refreshed)

  const deliveries = firePosWebhooks(
    src,
    "pos.sale.voided",
    sale.invoiceNo,
    {
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      registerCode: sale.registerCode,
      reason: sale.cancelReason,
      netTotal: sale.netTotal,
      irn: sale.nbrAdapter.irn,
    },
    nextDeliveryId,
    now,
  )

  return { sale, deliveries }
}

export const POS_SALE_CSV_COLUMNS = [
  { key: "invoiceNo", label: "Invoice No" },
  { key: "challanNo", label: "Challan No" },
  { key: "issueDate", label: "Date" },
  { key: "issueTime", label: "Time" },
  { key: "registerCode", label: "Register" },
  { key: "shiftNo", label: "Shift" },
  { key: "customerName", label: "Customer" },
  { key: "subtotal", label: "Subtotal" },
  { key: "vat", label: "VAT" },
  { key: "discount", label: "Discount" },
  { key: "netTotal", label: "Net Total" },
  { key: "tenders", label: "Tenders", get: (s: PosSale) => s.tenders.map((t) => `${t.method}:${t.netAmount}`).join(" + ") },
  { key: "irn", label: "IRN", get: (s: PosSale) => s.nbrAdapter.irn },
  { key: "process", label: "Status" },
]

export function posSalesPage(src: PosSource, url: URL) {
  const sp = url.searchParams
  const shiftFilter = sp.get("shift") ?? ""
  const methodFilter = sp.get("method") ?? ""
  const all = src.posSales
    .map((s) => withPosQr(s, src))
    .filter((s) => {
      if (shiftFilter && s.shiftId !== shiftFilter && s.shiftNo !== shiftFilter) return false
      if (methodFilter && !s.tenders.some((t) => t.method === methodFilter)) return false
      return true
    })

  const { all: rows, ...page } = runQuery(all, sp, {
    search: (s) =>
      `${s.invoiceNo} ${s.challanNo} ${s.customerName} ${s.customerBin} ${s.registerCode} ${s.shiftNo} ${s.nbrAdapter.irn} ${s.tenders.map((t) => t.reference ?? "").join(" ")}`,
    dateField: "issueDate",
    facets: {
      process: (s) => s.process,
      register: (s) => s.registerId,
      source: (s) => s.source,
    },
    totals: ["subtotal", "sd", "vat", "discount", "netTotal"],
  })
  return { rows, page }
}

export function posSaleDetail(src: PosSource, id: string) {
  const hit = src.posSales.find((s) => s.id === id || s.invoiceNo === id)
  if (!hit) throw new PosRuleError(404, "POS invoice not found")
  const sale = withPosQr(hit, src)
  return {
    ...sale,
    mushak63: posSaleAsSale(sale),
    ebill: buildNbrAdapterPayload(sale, sellerOf(src)),
  }
}

export function posSaleEbill(src: PosSource, id: string) {
  const hit = src.posSales.find((s) => s.id === id || s.invoiceNo === id)
  if (!hit) throw new PosRuleError(404, "POS invoice not found")
  const sale = withPosQr(hit, src)
  return buildNbrAdapterPayload(sale, sellerOf(src))
}

/* ── R10.1: Shift Open / Close & X / Z Reports ────────────────────────────── */

export type PosShiftRow = PosShift & { salesCount: number; voidedCount: number; netSales: number; vat: number }

export const POS_SHIFT_CSV_COLUMNS = [
  { key: "no", label: "Shift No" },
  { key: "zNo", label: "Z No", get: (s: PosShiftRow) => s.zNo ?? "" },
  { key: "registerCode", label: "Register" },
  { key: "date", label: "Date" },
  { key: "status", label: "Status" },
  { key: "openingFloat", label: "Opening Float" },
  { key: "netSales", label: "Net Sales" },
  { key: "expectedCash", label: "Expected Cash", get: (s: PosShiftRow) => s.expectedCash ?? 0 },
  { key: "countedCash", label: "Counted Cash", get: (s: PosShiftRow) => s.countedCash ?? "" },
  { key: "variance", label: "Variance", get: (s: PosShiftRow) => s.variance ?? "" },
]

export function posShiftsPage(src: PosSource, url: URL) {
  const enriched: PosShiftRow[] = src.posShifts.map((sh) => {
    const rep = posShiftReport(sh, src.posSales)
    return {
      ...rep.shift,
      salesCount: rep.salesCount,
      voidedCount: rep.voidedCount,
      netSales: rep.netSales,
      vat: rep.vat,
    }
  })

  const { all: rows, ...page } = runQuery(enriched, url.searchParams, {
    search: (s) => `${s.no} ${s.zNo ?? ""} ${s.registerCode} ${s.registerName} ${s.openedBy} ${s.closedBy ?? ""}`,
    dateField: "date",
    facets: {
      status: (s) => s.status,
      register: (s) => s.registerId,
    },
    totals: ["openingFloat", "netSales", "expectedCash"],
  })
  return { rows, page }
}

export function openPosShift(
  src: PosSource,
  body: unknown,
  actor: { name: string; role?: Role },
  nextId: () => string,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
): { shift: PosShift; deliveries: PosWebhookDelivery[] } {
  const v = parseSchema(posShiftOpenInput, body)
  const reg = src.posRegisters.find((r) => r.id === v.registerId || r.code === v.registerId)
  if (!reg) throw new PosRuleError(422, "Validation failed", { registerId: ["unknown"] })
  if (!reg.active) throw new PosRuleError(422, "Validation failed", { registerId: ["inactive"] })
  const alreadyOpen = src.posShifts.find((s) => s.registerId === reg.id && s.status === "open")
  if (alreadyOpen) {
    throw new PosRuleError(409, `Register ${reg.code} already has an open shift (${alreadyOpen.no})`)
  }

  const cashAccountId = v.cashAccountId || reg.cashAccountId
  const cashAcc = src.moneyAccounts.find((a) => a.id === cashAccountId && a.active && a.kind === "cash")
  if (!cashAcc) {
    throw new PosRuleError(422, "Validation failed", { cashAccountId: ["invalidCashAccount"] })
  }

  const date = v.date || TODAY
  const no = nextPosNo("SH", date, src.posShifts.map((s) => s.no))
  const shift: PosShift = {
    id: nextId(),
    no,
    registerId: reg.id,
    registerCode: reg.code,
    registerName: reg.name,
    branchId: reg.branchId,
    branchName: reg.branchName,
    cashAccountId: cashAcc.id,
    date,
    status: "open",
    openingFloat: round2(v.openingFloat),
    openedAt: now,
    openedBy: actor.name,
    note: v.note || undefined,
    history: [{ at: now, by: actor.name, action: "created", note: v.note || `Opening float ৳${v.openingFloat}` }],
  }
  src.posShifts.unshift(shift)

  const deliveries = firePosWebhooks(
    src,
    "pos.shift.opened",
    shift.no,
    { shiftId: shift.id, shiftNo: shift.no, registerCode: shift.registerCode, openingFloat: shift.openingFloat },
    nextDeliveryId,
    now,
  )

  return { shift, deliveries }
}

export function posShiftDetail(src: PosSource, id: string) {
  const shift = src.posShifts.find((s) => s.id === id || s.no === id || s.zNo === id)
  if (!shift) throw new PosRuleError(404, "Shift not found")
  const report = posShiftReport(shift, src.posSales)
  return { shift: report.shift, report }
}

export function closePosShift(
  src: PosSource,
  id: string,
  body: unknown,
  actor: { name: string; role?: Role },
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
) {
  const shift = src.posShifts.find((s) => s.id === id || s.no === id)
  if (!shift) throw new PosRuleError(404, "Shift not found")
  const parsed = parseSchema(posShiftCloseInput, body)
  if (shift.status === "closed") {
    throw new PosRuleError(409, `Shift ${shift.no} is already closed (${shift.zNo})`)
  }

  const preReport = posShiftReport(shift, src.posSales, now)
  const expectedCash = preReport.cashDrawer.expectedCash
  const countedCash = round2(parsed.countedCash)
  const variance = round2(countedCash - expectedCash)
  const zNo = nextPosNo(
    "Z",
    shift.date,
    src.posShifts.map((s) => s.zNo ?? ""),
  )

  shift.status = "closed"
  shift.closedAt = now
  shift.closedBy = actor.name
  shift.zNo = zNo
  shift.expectedCash = expectedCash
  shift.countedCash = countedCash
  shift.variance = variance
  if (parsed.note) shift.note = parsed.note
  shift.history = [
    ...shift.history,
    {
      at: now,
      by: actor.name,
      action: "approved",
      note: parsed.note || `${zNo} closed (counted ৳${countedCash}, expected ৳${expectedCash}, variance ৳${variance})`,
    },
  ]

  const report = posShiftReport(shift, src.posSales, now)
  const deliveries = firePosWebhooks(
    src,
    "pos.shift.closed",
    zNo,
    {
      shiftId: shift.id,
      shiftNo: shift.no,
      zNo,
      registerCode: shift.registerCode,
      expectedCash,
      countedCash,
      variance,
      netSales: report.netSales,
      vat: report.vat,
    },
    nextDeliveryId,
    now,
  )

  return { shift: report.shift, report, deliveries }
}

/* ── R10.2: Card / MFS Terminal Settlement Reconciliation ─────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function channelForAccount(acc: MoneyAccount, explicit?: "card" | "bkash" | "nagad"): "card" | "bkash" | "nagad" {
  if (explicit) return explicit
  if (acc.kind === "bank") return "card"
  const p = acc.provider.toLowerCase()
  return p.includes("nagad") ? "nagad" : "bkash"
}

export function matchTerminalLine(
  src: PosSource,
  account: MoneyAccount,
  channel: "card" | "bkash" | "nagad",
  row: { date: string; reference: string; narration: string; gross: number; fee: number },
  takenSaleIds: Set<string>,
): PosTerminalLineMatch {
  if (row.gross <= 0) return { status: "open" }

  const ref = row.reference.trim().toLowerCase()
  const narr = row.narration.trim().toLowerCase()

  const candidates = src.posSales.filter(
    (s) =>
      s.process === "Approved" &&
      !takenSaleIds.has(s.id) &&
      s.tenders.some((t) => t.method === channel && t.accountId === account.id),
  )

  const byRef = candidates.find((s) => {
    const t = s.tenders.find((x) => x.method === channel && x.accountId === account.id)
    if (!t || Math.abs(t.netAmount - row.gross) > 0.01) return false
    const tRef = (t.reference ?? "").toLowerCase()
    const inv = s.invoiceNo.toLowerCase()
    return (
      (ref && (tRef === ref || inv === ref || ref.includes(inv))) ||
      (tRef && narr.includes(tRef)) ||
      narr.includes(inv)
    )
  })
  if (byRef) {
    takenSaleIds.add(byRef.id)
    const expectedFee = round2((row.gross * account.serviceCharge) / 100)
    return {
      status: "matched",
      saleId: byRef.id,
      invoiceNo: byRef.invoiceNo,
      tenderMethod: channel,
      expectedFee,
    }
  }

  const byDateAmt = candidates.filter((s) => {
    const t = s.tenders.find((x) => x.method === channel && x.accountId === account.id)
    return t && s.issueDate === row.date && Math.abs(t.netAmount - row.gross) <= 0.01
  })
  if (byDateAmt.length === 1) {
    const hit = byDateAmt[0]
    takenSaleIds.add(hit.id)
    const expectedFee = round2((row.gross * account.serviceCharge) / 100)
    return {
      status: "matched",
      saleId: hit.id,
      invoiceNo: hit.invoiceNo,
      tenderMethod: channel,
      expectedFee,
    }
  }

  const sugg = candidates.find((s) =>
    s.tenders.some((t) => t.method === channel && t.accountId === account.id && Math.abs(t.netAmount - row.gross) <= 0.01),
  )
  if (sugg) {
    return {
      status: "open",
      suggestion: {
        saleId: sugg.id,
        invoiceNo: sugg.invoiceNo,
        customerName: sugg.customerName,
        amount: row.gross,
        date: sugg.issueDate,
      },
    }
  }

  return { status: "open" }
}

export function planTerminalStatement(
  src: PosSource,
  account: MoneyAccount,
  explicitChannel: "card" | "bkash" | "nagad" | undefined,
  rawRows: Record<string, unknown>[],
) {
  const channel = channelForAccount(account, explicitChannel)
  const taken = new Set<string>(
    src.posSettlementLines.filter((l) => l.status === "matched" && l.saleId).map((l) => l.saleId!),
  )
  const issues: { row: number; errors: Record<string, string> }[] = []
  const lines: Omit<PosTerminalLine, "id" | "statementId">[] = []

  rawRows.forEach((r, idx) => {
    const rowNo = idx + 1
    const rowErr: Record<string, string> = {}
    const date = String(r.date ?? "").trim()
    const reference = String(r.reference ?? "").trim()
    const narration = String(r.narration ?? "").trim()
    const gross = Number(r.gross ?? 0)
    const fee = Number(r.fee ?? 0)
    const rowChannel = (r.channel ? String(r.channel).trim() : channel) as "card" | "bkash" | "nagad"

    if (!ISO_DATE.test(date)) rowErr.date = "Invalid date (YYYY-MM-DD)"
    if (!narration) rowErr.narration = "Narration is required"
    if (!Number.isFinite(gross) || gross < 0) rowErr.gross = "Gross must be >= 0"
    if (!Number.isFinite(fee) || fee < 0) rowErr.fee = "Fee must be >= 0"
    if (gross === 0 && fee === 0) rowErr.amount = "Gross and fee cannot both be zero"
    if (gross > 0 && fee > gross) rowErr.fee = "Fee cannot exceed gross amount"

    if (Object.keys(rowErr).length) {
      issues.push({ row: rowNo, errors: rowErr })
      return
    }

    const net = gross > 0 ? round2(gross - fee) : round2(-fee)
    const m = matchTerminalLine(src, account, rowChannel, { date, reference, narration, gross, fee }, taken)
    lines.push({
      rowNo,
      date,
      channel: rowChannel,
      reference,
      narration,
      gross: round2(gross),
      fee: round2(fee),
      net,
      ...m,
    })
  })

  const totals = {
    gross: round2(lines.reduce((a, l) => a + l.gross, 0)),
    fee: round2(lines.reduce((a, l) => a + l.fee, 0)),
    net: round2(lines.reduce((a, l) => a + l.net, 0)),
  }

  return {
    accountId: account.id,
    accountName: account.provider,
    channel,
    total: rawRows.length,
    valid: lines.length,
    matched: lines.filter((l) => l.status === "matched").length,
    open: lines.filter((l) => l.status === "open").length,
    totals,
    issues,
    lines,
  }
}

export function terminalStatementView(src: PosSource, st: PosTerminalStatement) {
  const lines = src.posSettlementLines
    .filter((l) => l.statementId === st.id)
    .sort((a, b) => a.rowNo - b.rowNo)

  let posExpectedGross = 0
  for (const s of src.posSales) {
    if (s.process !== "Approved" || s.issueDate < st.from || s.issueDate > st.to) continue
    for (const t of s.tenders) {
      if (t.accountId === st.accountId && t.method === st.channel) {
        posExpectedGross = round2(posExpectedGross + t.netAmount)
      }
    }
  }

  const statementGross = round2(lines.reduce((a, l) => a + l.gross, 0))
  const totalFees = round2(lines.reduce((a, l) => a + l.fee, 0))
  const netSettled = round2(lines.reduce((a, l) => a + l.net, 0))
  const openLines = lines.filter((l) => l.status === "open")
  const unexplained = round2(openLines.reduce((a, l) => a + (l.gross > 0 ? l.gross : l.fee), 0))
  const difference = round2(statementGross - posExpectedGross)

  return {
    statement: st,
    lines,
    posExpectedGross,
    statementGross,
    totalFees,
    netSettled,
    difference,
    unexplained,
    open: openLines.length,
    matched: lines.filter((l) => l.status === "matched").length,
    charges: lines.filter((l) => l.status === "charge").length,
    ignored: lines.filter((l) => l.status === "ignored").length,
    reconciled: openLines.length === 0,
  }
}

export type PosSettlementRow = PosTerminalStatement & {
  matched: number
  open: number
  charges: number
  unexplained: number
  reconciled: boolean
  gross: number
  fee: number
  net: number
}

export const POS_SETTLEMENT_CSV_COLUMNS = [
  { key: "no", label: "Statement No" },
  { key: "channel", label: "Channel" },
  { key: "accountName", label: "Account" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "lineCount", label: "Lines" },
  { key: "gross", label: "Gross" },
  { key: "fee", label: "Fees" },
  { key: "net", label: "Net" },
  { key: "matched", label: "Matched" },
  { key: "open", label: "Open" },
]

export function terminalStatementsPage(src: PosSource, url: URL) {
  const all: PosSettlementRow[] = src.posSettlements.map((st) => {
    const v = terminalStatementView(src, st)
    return {
      ...st,
      matched: v.matched,
      open: v.open,
      charges: v.charges,
      unexplained: v.unexplained,
      reconciled: v.reconciled,
      gross: st.totals.gross,
      fee: st.totals.fee,
      net: st.totals.net,
    }
  })

  const { all: rows, ...page } = runQuery(all, url.searchParams, {
    search: (s) => `${s.no} ${s.accountName} ${s.channel} ${s.source}`,
    dateField: "to",
    facets: {
      channel: (s) => s.channel,
      accountId: (s) => s.accountId,
    },
    totals: ["gross", "fee", "net"],
  })
  return { rows, page }
}

export function importTerminalStatement(
  src: PosSource,
  body: unknown,
  actor: { name: string },
  nextId: () => string,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
) {
  const v = parseSchema(posTerminalImportInput, body)
  const acc = src.moneyAccounts.find((a) => a.id === v.accountId && a.active)
  if (!acc || acc.kind === "cash") {
    throw new PosRuleError(422, "Validation failed", { accountId: ["invalidTerminalAccount"] })
  }

  const plan = planTerminalStatement(src, acc, v.channel, v.rows)
  if (v.dryRun) {
    return { dryRun: true as const, plan }
  }
  if (plan.issues.length) {
    const errs: Record<string, string[]> = {}
    for (const iss of plan.issues) {
      errs[`row ${iss.row}`] = Object.entries(iss.errors).map(([k, msg]) => `${k}: ${msg}`)
    }
    throw new PosRuleError(422, "Terminal statement has invalid rows", errs)
  }

  const dates = plan.lines.map((l) => l.date).sort()
  const from = dates[0] ?? TODAY
  const to = dates[dates.length - 1] ?? from
  const id = nextId()
  const no = nextPosNo(
    "TS",
    to,
    src.posSettlements.map((s) => s.no),
  )

  const st: PosTerminalStatement = {
    id,
    no,
    accountId: acc.id,
    accountName: acc.provider,
    channel: plan.channel,
    source: v.source || `${plan.channel}-terminal-${to}.csv`,
    from,
    to,
    importedAt: now,
    importedBy: actor.name,
    lineCount: plan.lines.length,
    totals: plan.totals,
  }

  const storedLines: PosTerminalLine[] = plan.lines.map((l) => ({
    ...l,
    id: `${id}-l${l.rowNo}`,
    statementId: id,
  }))

  src.posSettlements.unshift(st)
  src.posSettlementLines.push(...storedLines)

  const view = terminalStatementView(src, st)
  const deliveries = view.reconciled
    ? firePosWebhooks(
        src,
        "pos.settlement.reconciled",
        st.no,
        { statementId: st.id, no: st.no, channel: st.channel, totals: st.totals },
        nextDeliveryId,
        now,
      )
    : []

  return { dryRun: false as const, view, storedLines, deliveries }
}

export function deleteTerminalStatement(src: PosSource, id: string): PosTerminalStatement {
  const idx = src.posSettlements.findIndex((s) => s.id === id || s.no === id)
  if (idx < 0) throw new PosRuleError(404, "Terminal statement not found")
  const [removed] = src.posSettlements.splice(idx, 1)
  src.posSettlementLines = src.posSettlementLines.filter((l) => l.statementId !== removed.id)
  return removed
}

export function patchTerminalLine(
  src: PosSource,
  statementId: string,
  lineId: string,
  body: unknown,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
) {
  const line = statementId
    ? src.posSettlementLines.find((l) => l.statementId === statementId && l.id === lineId) ??
      src.posSettlementLines.find((l) => l.id === lineId)
    : src.posSettlementLines.find((l) => l.id === lineId)
  if (!line) throw new PosRuleError(404, "Statement line not found")
  const st = src.posSettlements.find((s) => s.id === (statementId || line.statementId) || s.no === statementId)
  if (!st) throw new PosRuleError(404, "Terminal statement not found")

  const parsed = parseSchema(posTerminalLinePatchInput, body)
  if (line.status === "matched") {
    throw new PosRuleError(409, `Line #${line.rowNo} is already matched to ${line.invoiceNo}`)
  }

  line.status = parsed.status as PosTerminalLineStatus
  line.note = parsed.note || undefined
  const view = terminalStatementView(src, st)
  const deliveries = view.reconciled
    ? firePosWebhooks(
        src,
        "pos.settlement.reconciled",
        st.no,
        { statementId: st.id, no: st.no, channel: st.channel, totals: st.totals },
        nextDeliveryId,
        now,
      )
    : []

  return { line, view, deliveries }
}

export function matchTerminalLineToSale(
  src: PosSource,
  statementId: string,
  lineId: string,
  body: unknown,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
) {
  const line = statementId
    ? src.posSettlementLines.find((l) => l.statementId === statementId && l.id === lineId) ??
      src.posSettlementLines.find((l) => l.id === lineId)
    : src.posSettlementLines.find((l) => l.id === lineId)
  if (!line) throw new PosRuleError(404, "Statement line not found")
  const st = src.posSettlements.find((s) => s.id === (statementId || line.statementId) || s.no === statementId)
  if (!st) throw new PosRuleError(404, "Terminal statement not found")

  const parsed = parseSchema(posTerminalLineMatchInput, body)
  if (line.status !== "open") {
    throw new PosRuleError(409, `Line #${line.rowNo} is ${line.status}`)
  }

  const sale = src.posSales.find((s) => s.id === parsed.saleId || s.invoiceNo === parsed.saleId)
  if (!sale || sale.process !== "Approved") {
    throw new PosRuleError(422, "Validation failed", { saleId: ["invalidSale"] })
  }
  const alreadyMatched = src.posSettlementLines.find((l) => l.status === "matched" && l.saleId === sale.id)
  if (alreadyMatched) {
    throw new PosRuleError(409, `${sale.invoiceNo} is already matched on line #${alreadyMatched.rowNo}`)
  }

  const tender = sale.tenders.find(
    (t) => t.accountId === st.accountId && t.method === line.channel && Math.abs(t.netAmount - line.gross) <= 0.01,
  )
  if (!tender) {
    throw new PosRuleError(422, "Validation failed", { saleId: ["tenderAmountMismatch"] })
  }

  line.status = "matched"
  line.saleId = sale.id
  line.invoiceNo = sale.invoiceNo
  line.tenderMethod = line.channel
  line.suggestion = undefined

  const view = terminalStatementView(src, st)
  const deliveries = view.reconciled
    ? firePosWebhooks(
        src,
        "pos.settlement.reconciled",
        st.no,
        { statementId: st.id, no: st.no, channel: st.channel, totals: st.totals },
        nextDeliveryId,
        now,
      )
    : []

  return { line, view, deliveries }
}

/* ── R10.3: Registers, Scoped API Tokens, Offline Queue & Webhooks ────────── */

export function posRegistersList(src: PosSource) {
  return src.posRegisters.map((r) => {
    const openShift = src.posShifts.find((s) => s.registerId === r.id && s.status === "open") ?? null
    const salesCount = src.posSales.filter((s) => s.registerId === r.id && s.process === "Approved").length
    const activeTokens = src.posTokens.filter((t) => t.registerId === r.id && t.active).length
    const queueCount = src.posQueue.filter((q) => q.registerId === r.id).length
    return {
      ...r,
      openShift: openShift ? { id: openShift.id, no: openShift.no, openedAt: openShift.openedAt, openingFloat: openShift.openingFloat } : null,
      salesCount,
      activeTokens,
      queueCount,
    }
  })
}

function validateRegisterAccounts(
  src: PosSource,
  v: {
    branchId: string
    cashAccountId: string
    cardAccountId: string
    bkashAccountId: string
    nagadAccountId: string
  },
) {
  const seller = sellerOf(src)
  const branch = seller.branches.find((b) => b.id === v.branchId && b.category !== "office")
  const errors: Record<string, string[]> = {}
  if (!branch) errors.branchId = ["invalidBranch"]
  const checkAcc = (field: string, id: string, kind: AccountKind) => {
    const acc = src.moneyAccounts.find((a) => a.id === id && a.active)
    if (!acc || acc.kind !== kind) errors[field] = ["accountKindMismatch"]
  }
  checkAcc("cashAccountId", v.cashAccountId, "cash")
  checkAcc("cardAccountId", v.cardAccountId, "bank")
  checkAcc("bkashAccountId", v.bkashAccountId, "mobile")
  checkAcc("nagadAccountId", v.nagadAccountId, "mobile")
  if (Object.keys(errors).length) {
    throw new PosRuleError(422, "Validation failed", errors)
  }
  return branch!
}

export function buildPosRegister(
  src: PosSource,
  body: unknown,
  nextId: () => string,
  now = new Date().toISOString(),
): PosRegister {
  const v = parseSchema(posRegisterInput, body)
  const code = v.code.toUpperCase()
  if (src.posRegisters.some((r) => r.code.toUpperCase() === code)) {
    throw new PosRuleError(409, `Register code '${code}' already exists`)
  }
  const branch = validateRegisterAccounts(src, v)
  const reg: PosRegister = {
    id: nextId(),
    code,
    name: v.name,
    branchId: branch.id,
    branchName: branch.name,
    cashAccountId: v.cashAccountId,
    cardAccountId: v.cardAccountId,
    bkashAccountId: v.bkashAccountId,
    nagadAccountId: v.nagadAccountId,
    terminalId: v.terminalId || undefined,
    active: v.active ?? true,
    lastSeqNo: 0,
    createdAt: now,
  }
  src.posRegisters.push(reg)
  return reg
}

export function updatePosRegister(src: PosSource, id: string, body: unknown): PosRegister {
  const reg = src.posRegisters.find((r) => r.id === id || r.code === id)
  if (!reg) throw new PosRuleError(404, "Register not found")
  const v = parseSchema(posRegisterInput, body)
  const code = v.code.toUpperCase()
  if (src.posRegisters.some((r) => r.id !== reg.id && r.code.toUpperCase() === code)) {
    throw new PosRuleError(409, `Register code '${code}' already exists`)
  }
  const branch = validateRegisterAccounts(src, v)
  reg.code = code
  reg.name = v.name
  reg.branchId = branch.id
  reg.branchName = branch.name
  reg.cashAccountId = v.cashAccountId
  reg.cardAccountId = v.cardAccountId
  reg.bkashAccountId = v.bkashAccountId
  reg.nagadAccountId = v.nagadAccountId
  reg.terminalId = v.terminalId || undefined
  reg.active = v.active ?? true
  return reg
}

function stripTokenHash(t: PosApiToken): Omit<PosApiToken, "tokenHash"> {
  return {
    id: t.id,
    name: t.name,
    registerId: t.registerId,
    registerCode: t.registerCode,
    prefix: t.prefix,
    scopes: t.scopes,
    active: t.active,
    createdAt: t.createdAt,
    createdBy: t.createdBy,
    ...(t.lastUsedAt ? { lastUsedAt: t.lastUsedAt } : {}),
    ...(t.revokedAt ? { revokedAt: t.revokedAt } : {}),
  }
}

export function posTokensList(src: PosSource) {
  return src.posTokens.map(stripTokenHash)
}

export function issuePosToken(
  src: PosSource,
  body: unknown,
  actor: { name: string },
  nextId: () => string,
  now = new Date().toISOString(),
): { token: Omit<PosApiToken, "tokenHash">; fullRow: PosApiToken; secret: string } {
  const v = parseSchema(posTokenInput, body)
  const reg = src.posRegisters.find((r) => r.id === v.registerId || r.code === v.registerId)
  if (!reg) throw new PosRuleError(422, "Validation failed", { registerId: ["unknown"] })
  const slug = reg.code.toLowerCase().replace(/[^a-z0-9]/g, "")
  const rnd = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")
  const secret = `dzpos_${slug}_${rnd}`
  const scopes = [...new Set(v.scopes)] as PosScope[]
  const fullRow: PosApiToken = {
    id: nextId(),
    name: v.name,
    registerId: reg.id,
    registerCode: reg.code,
    prefix: secret.slice(0, 16),
    tokenHash: hashPosToken(secret),
    scopes,
    active: true,
    createdAt: now,
    createdBy: actor.name,
  }
  src.posTokens.unshift(fullRow)
  return { token: stripTokenHash(fullRow), fullRow, secret }
}

export function revokePosToken(src: PosSource, id: string, now = new Date().toISOString()) {
  const tok = src.posTokens.find((t) => t.id === id)
  if (!tok) throw new PosRuleError(404, "POS token not found")
  if (!tok.active) throw new PosRuleError(409, `Token '${tok.name}' is already revoked`)
  tok.active = false
  tok.revokedAt = now
  return stripTokenHash(tok)
}

export function extractBearerOrPosToken(
  headers: { get?(k: string): string | null } | Record<string, string | string[] | undefined>,
): string | null {
  const get = (k: string): string | null => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      return (headers as { get(k: string): string | null }).get(k)
    }
    const rec = headers as Record<string, string | string[] | undefined>
    const v = rec[k] ?? rec[k.toLowerCase()]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
  const xTok = get("x-pos-token")?.trim()
  if (xTok) return xTok
  const auth = get("authorization")?.trim()
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim()
  return null
}

function scopeMatches(scopes: PosScope[], required: PosScope): boolean {
  if (scopes.includes(required)) return true
  const norm = (s: string) => s.replace(/\./g, ":").replace(/sales:write$/, "sale:write")
  const target = norm(required)
  return scopes.some((s) => norm(s) === target)
}

export function authenticatePosToken(
  src: PosSource,
  rawToken: string,
  requiredScope: PosScope,
  now = new Date().toISOString(),
): PosApiToken {
  const hash = hashPosToken(rawToken)
  const tok = src.posTokens.find((t) => t.tokenHash === hash)
  if (!tok || !tok.active) {
    throw new PosRuleError(401, "Invalid or revoked POS API token")
  }
  if (!scopeMatches(tok.scopes, requiredScope)) {
    const label = requiredScope.replace(/\./g, ":").replace(/sales:write$/, "sale:write")
    throw new PosRuleError(403, `Token '${tok.name}' lacks required scope '${label}'`)
  }
  tok.lastUsedAt = now
  return tok
}

/* ── R10.3: Offline Device Queue with Sequence Numbers ────────────────────── */

export function processPosQueueBatch(
  src: PosSource,
  body: unknown,
  actor: { name: string; role?: Role },
  opts: {
    nextSaleId: () => string
    nextQueueId: () => string
    nextDeliveryId: () => string
    now?: string
  },
) {
  const v = parseSchema(posQueueSyncInput, body)
  const rawEvents = v.entries ?? v.events
  if (!rawEvents || rawEvents.length === 0) {
    throw new PosRuleError(422, "Validation failed", { entries: ["atLeastOneRow"] })
  }
  const reg = src.posRegisters.find((r) => r.id === v.registerId || r.code === v.registerId)
  if (!reg) throw new PosRuleError(422, "Validation failed", { registerId: ["unknown"] })
  if (!reg.active) throw new PosRuleError(422, "Validation failed", { registerId: ["inactive"] })

  const sorted = [...rawEvents].sort((a, b) => a.seqNo - b.seqNo)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].seqNo === sorted[i - 1].seqNo) {
      throw new PosRuleError(422, "Validation failed", { events: ["duplicateSeqNo"] })
    }
  }

  let cursor = reg.lastSeqNo
  for (const ev of sorted) {
    if (ev.seqNo <= cursor) {
      const prev = src.posQueue.find((q) => q.registerId === reg.id && q.seqNo === ev.seqNo)
      if (prev && prev.idempotencyKey !== ev.idempotencyKey) {
        throw new PosRuleError(
          409,
          `Sequence #${ev.seqNo} already synced with a different idempotency key (${prev.idempotencyKey})`,
        )
      }
      continue
    }
    if (ev.seqNo !== cursor + 1) {
      throw new PosRuleError(
        409,
        `Offline queue sequence gap on ${reg.code}: expected #${cursor + 1} after #${cursor}, got #${ev.seqNo}`,
      )
    }
    cursor = ev.seqNo
  }

  const now = opts.now ?? new Date().toISOString()
  const results: {
    seqNo: number
    idempotencyKey: string
    status: "synced" | "replayed"
    saleId: string
    invoiceNo: string
    netTotal: number
  }[] = []
  const newSales: PosSale[] = []
  const newQueueEntries: PosQueueEntry[] = []
  const newDeliveries: PosWebhookDelivery[] = []

  for (const ev of sorted) {
    if (ev.seqNo <= reg.lastSeqNo) {
      const prev = src.posQueue.find((q) => q.registerId === reg.id && q.seqNo === ev.seqNo)
      if (prev) {
        results.push({
          seqNo: ev.seqNo,
          idempotencyKey: ev.idempotencyKey,
          status: "replayed",
          saleId: prev.saleId,
          invoiceNo: prev.invoiceNo,
          netTotal: prev.netTotal,
        })
        continue
      }
    }

    const built = buildPosSale(
      src,
      {
        ...ev.sale,
        registerId: reg.id,
        idempotencyKey: ev.idempotencyKey,
        seqNo: ev.seqNo,
      },
      actor,
      {
        nextId: opts.nextSaleId,
        nextDeliveryId: opts.nextDeliveryId,
        source: "offlineQueue",
        now,
      },
    )

    if (!built.idempotentReplay) {
      newSales.push(built.sale)
      newDeliveries.push(...built.deliveries)
    }

    const qEntry: PosQueueEntry = {
      id: opts.nextQueueId(),
      registerId: reg.id,
      registerCode: reg.code,
      seqNo: ev.seqNo,
      idempotencyKey: ev.idempotencyKey,
      saleId: built.sale.id,
      invoiceNo: built.sale.invoiceNo,
      netTotal: built.sale.netTotal,
      clientCreatedAt: ev.clientCreatedAt || now,
      syncedAt: now,
      status: built.idempotentReplay ? "replayed" : "synced",
    }
    src.posQueue.unshift(qEntry)
    newQueueEntries.push(qEntry)
    if (ev.seqNo > reg.lastSeqNo) reg.lastSeqNo = ev.seqNo
    reg.lastSeenAt = now

    results.push({
      seqNo: ev.seqNo,
      idempotencyKey: ev.idempotencyKey,
      status: built.idempotentReplay ? "replayed" : "synced",
      saleId: built.sale.id,
      invoiceNo: built.sale.invoiceNo,
      netTotal: built.sale.netTotal,
    })
  }

  return {
    registerId: reg.id,
    registerCode: reg.code,
    lastSeqNo: reg.lastSeqNo,
    processed: results.filter((r) => r.status === "synced").length,
    replayed: results.filter((r) => r.status === "replayed").length,
    results,
    newSales,
    newQueueEntries,
    newDeliveries,
  }
}

export function posQueueView(src: PosSource, registerId?: string) {
  const entries = registerId
    ? src.posQueue.filter((q) => q.registerId === registerId || q.registerCode === registerId)
    : src.posQueue
  return {
    registers: src.posRegisters.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      lastSeqNo: r.lastSeqNo,
      lastSeenAt: r.lastSeenAt,
    })),
    entries: [...entries].sort((a, b) => b.seqNo - a.seqNo),
  }
}

/* ── R10.3: Webhooks CRUD & Test Ping ─────────────────────────────────────── */

export function posWebhooksView(src: PosSource) {
  return {
    webhooks: src.posWebhooks,
    deliveries: src.posWebhookDeliveries.slice(0, 50),
  }
}

export function buildPosWebhook(
  src: PosSource,
  body: unknown,
  actor: { name: string },
  nextId: () => string,
  now = new Date().toISOString(),
): PosWebhook {
  const v = parseSchema(posWebhookInput, body)
  const rnd = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")
  const secret = v.secret?.trim() || `whsec_${rnd}`
  const wh: PosWebhook = {
    id: nextId(),
    name: v.name,
    url: v.url,
    events: [...new Set(v.events)] as PosWebhookEvent[],
    secret,
    active: v.active ?? true,
    createdAt: now,
    createdBy: actor.name,
  }
  src.posWebhooks.unshift(wh)
  return wh
}

export function deletePosWebhook(src: PosSource, id: string): PosWebhook {
  const idx = src.posWebhooks.findIndex((w) => w.id === id)
  if (idx < 0) throw new PosRuleError(404, "Webhook not found")
  const [removed] = src.posWebhooks.splice(idx, 1)
  return removed
}

export function testPosWebhook(
  src: PosSource,
  id: string,
  nextDeliveryId: () => string,
  now = new Date().toISOString(),
): PosWebhookDelivery {
  const wh = src.posWebhooks.find((w) => w.id === id)
  if (!wh) throw new PosRuleError(404, "Webhook not found")
  const ev: PosWebhookEvent = wh.events[0] ?? "pos.sale.completed"
  const payload = {
    event: ev,
    ref: "PING-TEST",
    at: now,
    test: true,
    webhookId: wh.id,
  }
  const sig = signPosWebhook(wh.secret, JSON.stringify(payload))
  const delivery: PosWebhookDelivery = {
    id: nextDeliveryId(),
    webhookId: wh.id,
    webhookName: wh.name,
    event: ev,
    ref: "PING-TEST",
    payload,
    signature: sig,
    status: "delivered",
    deliveredAt: now,
  }
  wh.lastDeliveryAt = now
  wh.lastStatus = "delivered"
  src.posWebhookDeliveries.unshift(delivery)
  return delivery
}

/* ── R10.4: Barcode Labels ────────────────────────────────────────────────── */

export function posLabelsView(src: PosSource, format: PosLabelFormat = "38x25", specs?: { itemId: string; qty: number }[]) {
  const sellable = src.items.filter((it) => it.active !== false && it.salePrice > 0)
  const chosen =
    specs && specs.length
      ? specs
      : sellable.slice(0, 5).map((it) => ({ itemId: it.id, qty: 2 }))
  return buildBarcodeLabels(src.items, chosen, format)
}

/* ── Next.js Route Handlers (Mock runtime) ────────────────────────────────── */

function handleRuleError(e: unknown): Response {
  if (e instanceof PosRuleError) return problem(e.status, e.title, e.errors)
  throw e
}

async function runWithExternalOrSession(
  req: Request,
  scope: PosScope,
  perm: Permission | null,
  fn: (ctx: { name: string; role: Role; registerId?: string }) => Response | Promise<Response>,
): Promise<Response> {
  const rawTok = extractBearerOrPosToken(req.headers)
  if (rawTok) {
    try {
      const tok = authenticatePosToken(db, rawTok, scope)
      return await fn({ name: `POS Token (${tok.name})`, role: "operator", registerId: tok.registerId })
    } catch (e) {
      return handleRuleError(e)
    }
  }
  const wrapped = withAuth(perm, (_r, _c, u) => Promise.resolve(fn({ name: u.name, role: u.role })).catch(handleRuleError))
  return wrapped(req, undefined)
}

export const getPosCatalog = withAuth(null, (req) => {
  const url = new URL(req.url)
  return json(
    posCatalogView(db, {
      registerId: url.searchParams.get("registerId") ?? undefined,
      branchId: url.searchParams.get("branchId") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    }),
  )
})

export const listPosSales = withAuth(null, (req) => {
  const url = new URL(req.url)
  const { rows, page } = posSalesPage(db, url)
  if (url.searchParams.get("format") === "csv") {
    return csvResponse(toCSV(rows, POS_SALE_CSV_COLUMNS), "pos-sales.csv")
  }
  return json(page)
})

export const createPosSale = withAuth("doc.create", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const { sale, idempotentReplay } = buildPosSale(
      db,
      body,
      { name: u.name, role: u.role, designation: "POS Cashier" },
      {
        nextId: () => `ps${++db.seq.posSale}`,
        nextDeliveryId: () => `pwd${++db.seq.posDelivery}`,
        source: "counter",
        headerIdempotencyKey: req.headers.get("idempotency-key") ?? undefined,
      },
    )
    if (!idempotentReplay) {
      recordAudit({
        actor: u,
        entity: "posSale",
        entityId: sale.id,
        ref: sale.invoiceNo,
        action: "created",
        note: `${sale.registerCode} · ৳${sale.netTotal}`,
      })
    }
    return json({ ...sale, idempotentReplay }, { status: idempotentReplay ? 200 : 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const getPosSale = (req: Request, id: string) =>
  withAuth(null, () => {
    try {
      return json(posSaleDetail(db, id))
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const patchPosSale = (req: Request, id: string) =>
  withAuth("doc.cancel", async (_r, _ctx, u) => {
    try {
      const body = await req.json().catch(() => null)
      const { sale } = cancelPosSale(db, id, body, { name: u.name, role: u.role }, () => `pwd${++db.seq.posDelivery}`)
      recordAudit({
        actor: u,
        entity: "posSale",
        entityId: sale.id,
        ref: sale.invoiceNo,
        action: "cancelled",
        note: sale.cancelReason,
      })
      return json(sale)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const getPosSaleEbill = (req: Request, id: string) =>
  withAuth(null, () => {
    try {
      return json(posSaleEbill(db, id))
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const listPosShifts = withAuth(null, (req) => {
  const url = new URL(req.url)
  const { rows, page } = posShiftsPage(db, url)
  if (url.searchParams.get("format") === "csv") {
    return csvResponse(toCSV(rows, POS_SHIFT_CSV_COLUMNS), "pos-shifts.csv")
  }
  return json(page)
})

export const createPosShift = withAuth("doc.create", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const { shift } = openPosShift(
      db,
      body,
      { name: u.name, role: u.role },
      () => `sh${++db.seq.posShift}`,
      () => `pwd${++db.seq.posDelivery}`,
    )
    recordAudit({
      actor: u,
      entity: "posShift",
      entityId: shift.id,
      ref: shift.no,
      action: "created",
      note: `${shift.registerCode} · float ৳${shift.openingFloat}`,
    })
    return json(shift, { status: 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const getPosShift = (req: Request, id: string) =>
  withAuth(null, () => {
    try {
      return json(posShiftDetail(db, id))
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const getPosShiftReport = (req: Request, id: string) =>
  withAuth(null, () => {
    try {
      return json(posShiftDetail(db, id).report)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const closePosShiftRoute = (req: Request, id: string) =>
  withAuth("doc.create", async (_r, _ctx, u) => {
    try {
      const body = await req.json().catch(() => null)
      const { shift, report } = closePosShift(
        db,
        id,
        body,
        { name: u.name, role: u.role },
        () => `pwd${++db.seq.posDelivery}`,
      )
      recordAudit({
        actor: u,
        entity: "posShift",
        entityId: shift.id,
        ref: shift.zNo ?? shift.no,
        action: "closed",
        note: `Counted ৳${shift.countedCash} vs expected ৳${shift.expectedCash} (variance ৳${shift.variance})`,
      })
      return json({ shift, report })
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const listPosSettlements = withAuth(null, (req) => {
  const url = new URL(req.url)
  const { rows, page } = terminalStatementsPage(db, url)
  if (url.searchParams.get("format") === "csv") {
    return csvResponse(toCSV(rows, POS_SETTLEMENT_CSV_COLUMNS), "pos-settlements.csv")
  }
  return json(page)
})

export const importPosSettlement = withAuth("doc.create", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const res = importTerminalStatement(
      db,
      body,
      { name: u.name },
      () => `ts${++db.seq.posSettlement}`,
      () => `pwd${++db.seq.posDelivery}`,
    )
    if (res.dryRun) return json(res.plan, { status: 200 })
    recordAudit({
      actor: u,
      entity: "posSettlement",
      entityId: res.view.statement.id,
      ref: res.view.statement.no,
      action: "created",
      note: `${res.view.statement.channel} · ${res.view.statement.lineCount} lines`,
    })
    return json(res.view, { status: 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const getPosSettlement = (req: Request, id: string) =>
  withAuth(null, () => {
    const st = db.posSettlements.find((s) => s.id === id || s.no === id)
    if (!st) return problem(404, "Terminal statement not found")
    return json(terminalStatementView(db, st))
  })(req, undefined)

export const deletePosSettlement = (req: Request, id: string) =>
  withAuth("doc.delete", (_r, _ctx, u) => {
    try {
      const removed = deleteTerminalStatement(db, id)
      recordAudit({
        actor: u,
        entity: "posSettlement",
        entityId: removed.id,
        ref: removed.no,
        action: "deleted",
      })
      return json({ ok: true, id: removed.id })
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const patchPosSettlementLine = (req: Request, id: string, lineId: string) =>
  withAuth("doc.edit", async (_r, _ctx, u) => {
    try {
      const body = await req.json().catch(() => null)
      const { line, view } = patchTerminalLine(db, id, lineId, body, () => `pwd${++db.seq.posDelivery}`)
      recordAudit({
        actor: u,
        entity: "posSettlement",
        entityId: view.statement.id,
        ref: view.statement.no,
        action: "updated",
        note: `Line #${line.rowNo} → ${line.status}`,
      })
      return json(view)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const matchPosSettlementLine = (req: Request, id: string, lineId: string) =>
  withAuth("doc.edit", async (_r, _ctx, u) => {
    try {
      const body = await req.json().catch(() => null)
      const { line, view } = matchTerminalLineToSale(db, id, lineId, body, () => `pwd${++db.seq.posDelivery}`)
      recordAudit({
        actor: u,
        entity: "posSettlement",
        entityId: view.statement.id,
        ref: view.statement.no,
        action: "updated",
        note: `Line #${line.rowNo} matched to ${line.invoiceNo}`,
      })
      return json(view)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const listPosRegisters = withAuth(null, () => json(posRegistersList(db)))

export const createPosRegister = withAuth("settings.manage", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const reg = buildPosRegister(db, body, () => `reg${++db.seq.posRegister}`)
    recordAudit({
      actor: u,
      entity: "posRegister",
      entityId: reg.id,
      ref: `${reg.code} · ${reg.name}`,
      action: "created",
    })
    return json(reg, { status: 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const putPosRegister = (req: Request, id: string) =>
  withAuth("settings.manage", async (_r, _ctx, u) => {
    try {
      const body = await req.json().catch(() => null)
      const reg = updatePosRegister(db, id, body)
      recordAudit({
        actor: u,
        entity: "posRegister",
        entityId: reg.id,
        ref: `${reg.code} · ${reg.name}`,
        action: "updated",
      })
      return json(reg)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const listPosTokens = withAuth(null, () => json(posTokensList(db)))

export const createPosToken = withAuth("settings.manage", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const { token, secret } = issuePosToken(db, body, { name: u.name }, () => `ptk${++db.seq.posToken}`)
    recordAudit({
      actor: u,
      entity: "posToken",
      entityId: token.id,
      ref: `${token.name} (${token.registerCode})`,
      action: "created",
      note: `Scopes: ${token.scopes.join(", ")}`,
    })
    return json({ token, secret }, { status: 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const deletePosToken = (req: Request, id: string) =>
  withAuth("settings.manage", async (_r, _ctx, u) => {
    try {
      const token = revokePosToken(db, id)
      recordAudit({
        actor: u,
        entity: "posToken",
        entityId: token.id,
        ref: `${token.name} (${token.registerCode})`,
        action: "deactivated",
      })
      return json(token)
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const getExternalPosCatalog = (req: Request) =>
  runWithExternalOrSession(req, "pos:catalog.read", null, (ctx) => {
    const url = new URL(req.url)
    return json(
      posCatalogView(db, {
        registerId: url.searchParams.get("registerId") ?? ctx.registerId,
        branchId: url.searchParams.get("branchId") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      }),
    )
  })

export const getExternalPosStock = (req: Request, sku: string) =>
  runWithExternalOrSession(req, "pos:stock.read", null, (ctx) => {
    const url = new URL(req.url)
    return json(posStockLookup(db, sku, url.searchParams.get("registerId") ?? ctx.registerId))
  })

export const createExternalPosSale = (req: Request) =>
  runWithExternalOrSession(req, "pos:sales.write", "doc.create", async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const merged = body && ctx.registerId && !body.registerId ? { ...body, registerId: ctx.registerId } : body
    const { sale, idempotentReplay } = buildPosSale(
      db,
      merged,
      { name: ctx.name, role: ctx.role, designation: "External POS API" },
      {
        nextId: () => `ps${++db.seq.posSale}`,
        nextDeliveryId: () => `pwd${++db.seq.posDelivery}`,
        source: "external",
        requireIdempotencyKey: true,
        headerIdempotencyKey: req.headers.get("idempotency-key") ?? undefined,
      },
    )
    if (!idempotentReplay) {
      recordAudit({
        actor: ctx.name,
        entity: "posSale",
        entityId: sale.id,
        ref: sale.invoiceNo,
        action: "created",
        note: `External POS (${sale.registerCode}) · ৳${sale.netTotal}`,
      })
    }
    return json({ ...sale, sale, replayed: idempotentReplay, idempotentReplay }, { status: idempotentReplay ? 200 : 201 })
  })

export const getPosQueue = withAuth(null, (req) => {
  const url = new URL(req.url)
  return json(posQueueView(db, url.searchParams.get("registerId") ?? undefined))
})

export const syncExternalPosQueue = (req: Request) =>
  runWithExternalOrSession(req, "pos:queue.sync", "doc.create", async (ctx) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const merged = body && ctx.registerId && !body.registerId ? { ...body, registerId: ctx.registerId } : body
    const res = processPosQueueBatch(
      db,
      merged,
      { name: ctx.name, role: ctx.role },
      {
        nextSaleId: () => `ps${++db.seq.posSale}`,
        nextQueueId: () => `pq${++db.seq.posQueue}`,
        nextDeliveryId: () => `pwd${++db.seq.posDelivery}`,
      },
    )
    for (const s of res.newSales) {
      recordAudit({
        actor: ctx.name,
        entity: "posSale",
        entityId: s.id,
        ref: s.invoiceNo,
        action: "created",
        note: `Offline queue seq #${s.seqNo} (${s.registerCode})`,
      })
    }
    return json(
      {
        registerId: res.registerId,
        registerCode: res.registerCode,
        lastSeqNo: res.lastSeqNo,
        processed: res.processed,
        replayed: res.replayed,
        appliedCount: res.processed,
        replayedCount: res.replayed,
        results: res.results,
      },
      { status: res.processed > 0 ? 201 : 200 },
    )
  })

export const getPosWebhooks = withAuth(null, () => json(posWebhooksView(db)))

export const createPosWebhook = withAuth("settings.manage", async (req, _ctx, u) => {
  try {
    const body = await req.json().catch(() => null)
    const wh = buildPosWebhook(db, body, { name: u.name }, () => `pwh${++db.seq.posWebhook}`)
    recordAudit({
      actor: u,
      entity: "posWebhook",
      entityId: wh.id,
      ref: wh.name,
      action: "created",
      note: wh.url,
    })
    return json(wh, { status: 201 })
  } catch (e) {
    return handleRuleError(e)
  }
})

export const removePosWebhook = (req: Request, id: string) =>
  withAuth("settings.manage", async (_r, _ctx, u) => {
    try {
      const wh = deletePosWebhook(db, id)
      recordAudit({
        actor: u,
        entity: "posWebhook",
        entityId: wh.id,
        ref: wh.name,
        action: "deleted",
      })
      return json({ ok: true, id: wh.id })
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const triggerPosWebhookTest = (req: Request, id: string) =>
  withAuth("settings.manage", async () => {
    try {
      return json(testPosWebhook(db, id, () => `pwd${++db.seq.posDelivery}`), { status: 201 })
    } catch (e) {
      return handleRuleError(e)
    }
  })(req, undefined)

export const getPosLabels = withAuth(null, (req) => {
  const url = new URL(req.url)
  const fmt = (url.searchParams.get("format") ?? "38x25") as PosLabelFormat
  const validFmt: PosLabelFormat = fmt === "50x30" || fmt === "a4-24" ? fmt : "38x25"
  return json(posLabelsView(db, validFmt))
})

export const createPosLabels = withAuth(null, async (req) => {
  try {
    const body = await req.json().catch(() => null)
    const parsed = parseSchema(posLabelInput, body)
    const specs = parsed.specs ?? parsed.items
    if (!specs || specs.length === 0) {
      throw new PosRuleError(422, "Validation failed", { specs: ["atLeastOneLine"] })
    }
    for (const sp of specs) {
      if (!db.items.some((it) => it.id === sp.itemId || it.sku === sp.itemId)) {
        throw new PosRuleError(422, "Validation failed", { specs: ["unknownItem"] })
      }
    }
    return json(posLabelsView(db, parsed.format, specs))
  } catch (e) {
    return handleRuleError(e)
  }
})
