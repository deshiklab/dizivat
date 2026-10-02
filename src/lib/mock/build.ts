import type { z } from "zod"
import type { Line, Party, Purchase, Sale } from "../types"
import type { importInput, purchaseInput, saleInput } from "../schemas"
import { findService } from "../r2"
import { findSaleService } from "../r3"
import { bondedLine } from "../bond"
import { calcImportLine, calcLine, round2, sumLines } from "../vat"
import { db, resolveBranch } from "./db"

type SaleData = z.output<typeof saleInput>
type PurchaseData = z.output<typeof purchaseInput>

/**
 * Derives every computed field of a sales invoice from validated input (used by create and edit).
 * R3 variants: service sale (sale-service codes, no SD, no stock) and export / deemed export (zero-rated, shipping documents).
 */
export function buildSaleFields(d: SaleData, cust: Party) {
  const service = d.category === "service"
  const exp = !service && d.export ? d.export : undefined
  const zero = cust.mode === "Foreign" || !!exp
  const lines: Line[] = d.lines.map((l) => {
    const vatRate = zero ? 0 : l.vatRate
    if (service) {
      const s = findSaleService(l.itemId)!
      return { itemId: s.id, name: s.name, hsCode: s.code, uom: s.unit, qty: l.qty, price: l.price, sdRate: 0, vatRate, ...calcLine({ ...l, sdRate: 0, vatRate }) }
    }
    const it = db.items.find((i) => i.id === l.itemId)!
    const batch = l.batchId ? db.batches.find((b) => b.id === l.batchId) : undefined
    return {
      itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate, ...calcLine({ ...l, vatRate }),
      ...(batch ? { batchId: batch.id, batchNo: batch.no } : {}),
    }
  })
  const t = sumLines(lines, d.discount)
  const paid = Math.min(d.paid, t.netTotal)
  return {
    issueDate: d.issueDate, issueTime: d.issueTime,
    customerId: cust.id, customerName: cust.name, customerBin: cust.bin, customerAddress: cust.address,
    deliveryAddress: d.deliveryAddress || cust.address, vehicle: d.vehicle,
    mode: cust.mode as Sale["mode"], method: d.method, vds: zero ? false : d.vds, lines,
    subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: t.discount, netTotal: t.netTotal,
    paid, due: round2(t.netTotal - paid), issuedBy: d.issuedBy, designation: d.designation, narration: d.narration,
    ...(service ? { category: "service" as const } : {}),
    ...(exp ? { export: { ...exp, cnfFirm: exp.cnfFirm || undefined, udNo: exp.udNo || undefined, udDate: exp.udDate || undefined, expNo: exp.expNo || undefined, exporterBond: exp.exporterBond || undefined, ownUdNo: exp.ownUdNo?.trim().toUpperCase() || undefined, shippingAddress: exp.shippingAddress || d.deliveryAddress || cust.address } } : {}),
    ...branchFields(d.branchId),
  } satisfies Partial<Sale>
}

/** Sale-service lines must reference the sale-service list. */
export function unknownSaleServices(lines: { itemId: string }[]) {
  const errors: Record<string, string[]> = {}
  lines.forEach((l, i) => { if (!findSaleService(l.itemId)) errors[`lines.${i}.itemId`] = ["unknown"] })
  return Object.keys(errors).length ? errors : null
}

type ImportData = z.output<typeof importInput>

/** Purchase fields for all three variants: local/non-registered goods, import (Bill of Entry) and service (R2). */
export function buildPurchaseFields(d: PurchaseData | ImportData, v: Party) {
  const nonReg = v.mode === "Non-registered"
  const service = d.category === "service"
  const imp = v.mode === "Foreign" && "boe" in d ? (d as ImportData) : null
  let lines: Line[]
  if (imp) {
    lines = imp.lines.map((l) => {
      const it = db.items.find((i) => i.id === l.itemId)!
      const rebateable = l.rebateable ?? true
      const c = calcImportLine({ qty: l.qty, usd: l.usd, usdRate: l.usdRate, av: l.av, cdRate: l.cdRate, rdRate: l.rdRate, sdRate: l.sdRate, vatRate: l.vatRate, aitRate: l.aitRate, atRate: l.atRate }, rebateable)
      if (imp.boe.bonded) return bondedLine(it, l, c)
      return {
        itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty, price: c.unitAv, sdRate: l.sdRate, vatRate: l.vatRate,
        subtotal: c.av, sd: c.sd, vat: c.vat, total: c.total, tti: c.tti, rebateable, vds: false,
        duty: { usd: l.usd, usdRate: l.usdRate, av: c.av, cdRate: l.cdRate, cd: c.cd, rdRate: l.rdRate, rd: c.rd, aitRate: l.aitRate, ait: c.ait, atRate: l.atRate, at: c.at },
      }
    })
  } else {
    lines = d.lines.map((l) => {
      const ref = service ? findService(l.itemId)! : null
      const it = service ? null : db.items.find((i) => i.id === l.itemId)!
      const vatRate = nonReg ? 0 : l.vatRate
      return {
        itemId: l.itemId, name: ref?.name ?? it!.name, hsCode: ref?.code ?? it!.hsCode, uom: ref?.unit ?? it!.unit, qty: l.qty, price: l.price, sdRate: service ? 0 : l.sdRate, vatRate,
        rebateable: !nonReg && (l.rebateable ?? true), vds: !nonReg && !!l.vds, ...calcLine({ ...l, sdRate: service ? 0 : l.sdRate, vatRate }),
      }
    })
  }
  const t = sumLines(lines, d.discount)
  const paid = Math.min(d.paid, t.netTotal)
  return {
    challanNo: d.challanNo, challanDate: d.challanDate, issueDate: d.issueDate,
    vendorId: v.id, vendorName: v.name, vendorBin: v.bin, vendorAddress: v.address, mode: v.mode as Purchase["mode"],
    method: d.method, lines, subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: t.discount, netTotal: t.netTotal,
    tti: round2(lines.reduce((a, l) => a + (l.tti ?? 0), 0)),
    rebate: round2(lines.filter((l) => l.rebateable).reduce((a, l) => a + l.vat + (l.duty?.at ?? 0), 0)),
    paid, due: round2(t.netTotal - paid), issuedBy: d.issuedBy, designation: d.designation, narration: d.narration,
    ...(service ? { category: "service" as const } : {}),
    ...(imp ? { boe: { no: d.challanNo, date: d.challanDate, ...imp.boe, cnfFirm: imp.boe.cnfFirm || undefined, receiveAddress: imp.boe.receiveAddress || undefined, bonded: imp.boe.bonded || undefined, udNo: (imp.boe.bonded && imp.boe.udNo?.trim().toUpperCase()) || undefined } } : {}),
    ...branchFields(d.branchId),
  } satisfies Partial<Purchase>
}

/** Service lines must reference the service-code list. */
export function unknownServices(lines: { itemId: string }[]) {
  const errors: Record<string, string[]> = {}
  lines.forEach((l, i) => { if (!findService(l.itemId)) errors[`lines.${i}.itemId`] = ["unknown"] })
  return Object.keys(errors).length ? errors : null
}

/** Unknown / inactive item ids → field errors (the client only lists active items, but the API must not trust it). */
export function unknownItems(lines: { itemId: string }[], group?: "Finished Goods" | "buyable") {
  const errors: Record<string, string[]> = {}
  lines.forEach((l, i) => {
    const it = db.items.find((x) => x.id === l.itemId)
    const wrongGroup = it && group && (group === "Finished Goods" ? it.group !== "Finished Goods" : it.group === "Finished Goods")
    if (!it || !it.active || wrongGroup) errors[`lines.${i}.itemId`] = ["unknown"]
  })
  return Object.keys(errors).length ? errors : null
}

/** Resolved branch snapshot for a document (call `unknownBranch` first). */
function branchFields(id?: string) {
  const b = resolveBranch(id)!
  return { branchId: b.id, branchName: b.name }
}

/** Branch must exist and be able to hold stock (not the head office). */
export const unknownBranch = (id: string | undefined, field = "branchId") => (resolveBranch(id) ? null : { [field]: ["unknownBranch"] })
