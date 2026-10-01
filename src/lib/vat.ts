import type { Line } from "./types"

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Line calculation per VAT & SD Act 2012: SD is charged on value; VAT is charged on (value + SD).
 * Rounded to 2 dp (fixes legacy unrounded floats such as 38260.399999999994).
 */
export function calcLine(input: { qty: number; price: number; sdRate: number; vatRate: number }) {
  const subtotal = round2((input.qty || 0) * (input.price || 0))
  const sd = round2((subtotal * (input.sdRate || 0)) / 100)
  const vat = round2(((subtotal + sd) * (input.vatRate || 0)) / 100)
  return { subtotal, sd, vat, total: round2(subtotal + sd + vat) }
}

export function sumLines(lines: Pick<Line, "subtotal" | "sd" | "vat" | "total">[], discount = 0) {
  const t = lines.reduce(
    (a, l) => ({ subtotal: a.subtotal + l.subtotal, sd: a.sd + l.sd, vat: a.vat + l.vat, total: a.total + l.total }),
    { subtotal: 0, sd: 0, vat: 0, total: 0 }
  )
  const netTotal = round2(t.total - (discount || 0))
  return { subtotal: round2(t.subtotal), sd: round2(t.sd), vat: round2(t.vat), gross: round2(t.total), discount: round2(discount || 0), netTotal }
}

/**
 * Import duty stack used for Foreign purchases (simplified, for mock TTI).
 * AT defaults to 2 % — the manufacturer rate from 1 July 2025 (Finance Ordinance 2025; commercial importers 7.5 %,
 * see `atRateFor` in rules.ts).
 */
export function importTTI(assessable: number, cdRate = 10, rdRate = 3, sdRate = 0, vatRate = 15, aitRate = 5, atRate = 2) {
  const cd = (assessable * cdRate) / 100
  const rd = (assessable * rdRate) / 100
  const sd = ((assessable + cd + rd) * sdRate) / 100
  const vat = ((assessable + cd + rd + sd) * vatRate) / 100
  const ait = (assessable * aitRate) / 100
  const at = ((assessable + cd + rd + sd) * atRate) / 100
  return { cd: round2(cd), rd: round2(rd), sd: round2(sd), vat: round2(vat), ait: round2(ait), at: round2(at), tti: round2(cd + rd + sd + vat + ait + at) }
}

export interface ImportRates { cdRate: number; rdRate: number; sdRate: number; vatRate: number; aitRate: number; atRate: number }

/**
 * One Bill-of-Entry line (R2). AV = USD total × exchange rate unless an assessable value is given (customs may
 * re-assess). Every amount is rounded to 2 dp; TTI = CD+RD+SD+VAT+AIT+AT; total = AV + TTI.
 * Rebate (input-tax credit in 9.1) = VAT + AT when rebateable — CD, RD, SD and AIT are not creditable.
 */
export function calcImportLine(input: { qty: number; usd: number; usdRate: number; av?: number } & ImportRates, rebateable = true) {
  const av = round2(input.av != null && input.av > 0 ? input.av : (input.usd || 0) * (input.usdRate || 0))
  const cd = round2((av * (input.cdRate || 0)) / 100)
  const rd = round2((av * (input.rdRate || 0)) / 100)
  const sd = round2(((av + cd + rd) * (input.sdRate || 0)) / 100)
  const base = av + cd + rd + sd
  const vat = round2((base * (input.vatRate || 0)) / 100)
  const ait = round2((av * (input.aitRate || 0)) / 100)
  const at = round2((base * (input.atRate || 0)) / 100)
  const tti = round2(cd + rd + sd + vat + ait + at)
  const qty = input.qty || 0
  return {
    av, cd, rd, sd, vat, ait, at, tti,
    /** landed cost before VAT/AIT/AT ("Actual price" column of the legacy grid) */
    actual: round2(av + cd + rd),
    unitAv: qty ? round2(av / qty) : 0,
    total: round2(av + tti),
    rebate: rebateable ? round2(vat + at) : 0,
  }
}

/** Debit-note line: the returned share of the purchase line (all amounts pro rata, 2 dp). */
export function calcDebitLine(orig: Pick<Line, "qty" | "price" | "subtotal" | "sd" | "vat" | "total" | "tti" | "rebateable" | "duty">, qty: number) {
  const r = orig.qty ? qty / orig.qty : 0
  const vat = round2(orig.vat * r)
  return {
    subtotal: round2(orig.subtotal * r), sd: round2(orig.sd * r), vat, tti: round2((orig.tti ?? 0) * r), total: round2(orig.total * r),
    rebate: orig.rebateable ? round2((orig.vat + (orig.duty?.at ?? 0)) * r) : 0,
  }
}

/** Credit-note line (Mushak 6.7): the returned share of the sales line — same pro-rata rule as a debit note. */
export function calcCreditLine(orig: Pick<Line, "qty" | "subtotal" | "sd" | "vat" | "total">, qty: number) {
  const r = orig.qty ? qty / orig.qty : 0
  return { subtotal: round2(orig.subtotal * r), sd: round2(orig.sd * r), vat: round2(orig.vat * r), total: round2(orig.total * r) }
}

/**
 * Mushak 4.3 coefficients for ONE unit of output. Each input: gross = qty × (1 + wastage%), value = gross × price.
 * Price = material value + value-addition heads (profit included); unit cost (used to value production) excludes profit.
 * Quantities keep 4 dp (coefficients are small — e.g. 0.0003 kg ink per pouch), money 2 dp.
 */
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
export function calcBom(inputs: { qty: number; wastagePct: number; price: number }[], costs: { head: string; amount: number }[]) {
  const lines = inputs.map((i) => {
    const wastageQty = round4(((i.qty || 0) * (i.wastagePct || 0)) / 100)
    const grossQty = round4((i.qty || 0) + wastageQty)
    return { wastageQty, grossQty, value: round2(grossQty * (i.price || 0)), wastageValue: round2(wastageQty * (i.price || 0)) }
  })
  const materialValue = round2(lines.reduce((a, l) => a + l.value, 0))
  const wastageValue = round2(lines.reduce((a, l) => a + l.wastageValue, 0))
  const valueAdded = round2(costs.reduce((a, c) => a + (c.amount || 0), 0))
  const profit = round2(costs.filter((c) => c.head === "profit").reduce((a, c) => a + (c.amount || 0), 0))
  const price = round2(materialValue + valueAdded)
  return { lines, materialValue, wastageValue, valueAdded, price, unitCost: round2(price - profit) }
}
