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

/** Import duty stack used for Foreign purchases (simplified, for mock TTI). */
export function importTTI(assessable: number, cdRate = 10, rdRate = 3, sdRate = 0, vatRate = 15, aitRate = 5, atRate = 5) {
  const cd = (assessable * cdRate) / 100
  const rd = (assessable * rdRate) / 100
  const sd = ((assessable + cd + rd) * sdRate) / 100
  const vat = ((assessable + cd + rd + sd) * vatRate) / 100
  const ait = (assessable * aitRate) / 100
  const at = ((assessable + cd + rd + sd) * atRate) / 100
  return { cd: round2(cd), rd: round2(rd), sd: round2(sd), vat: round2(vat), ait: round2(ait), at: round2(at), tti: round2(cd + rd + sd + vat + ait + at) }
}
