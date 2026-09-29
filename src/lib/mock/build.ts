import type { z } from "zod"
import type { Line, Party, Purchase, Sale } from "../types"
import type { importInput, purchaseInput, saleInput } from "../schemas"
import { findService } from "../r2"
import { calcImportLine, calcLine, round2, sumLines } from "../vat"
import { db, resolveBranch } from "./db"

type SaleData = z.output<typeof saleInput>
type PurchaseData = z.output<typeof purchaseInput>

/** Derives every computed field of a sales invoice from validated input (used by create and edit). */
export function buildSaleFields(d: SaleData, cust: Party) {
  const lines = d.lines.map((l) => {
    const it = db.items.find((i) => i.id === l.itemId)!
    const vatRate = cust.mode === "Foreign" ? 0 : l.vatRate
    return { itemId: it.id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate, ...calcLine({ ...l, vatRate }) }
  })
  const t = sumLines(lines, d.discount)
  const paid = Math.min(d.paid, t.netTotal)
  return {
    issueDate: d.issueDate, issueTime: d.issueTime,
    customerId: cust.id, customerName: cust.name, customerBin: cust.bin, customerAddress: cust.address,
    deliveryAddress: d.deliveryAddress || cust.address, vehicle: d.vehicle,
    mode: cust.mode as Sale["mode"], method: d.method, vds: cust.mode === "Foreign" ? false : d.vds, lines,
    subtotal: t.subtotal, sd: t.sd, vat: t.vat, discount: t.discount, netTotal: t.netTotal,
    paid, due: round2(t.netTotal - paid), issuedBy: d.issuedBy, designation: d.designation, narration: d.narration,
    ...branchFields(d.branchId),
  } satisfies Partial<Sale>
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
    ...(imp ? { boe: { no: d.challanNo, date: d.challanDate, ...imp.boe, cnfFirm: imp.boe.cnfFirm || undefined, receiveAddress: imp.boe.receiveAddress || undefined } } : {}),
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
