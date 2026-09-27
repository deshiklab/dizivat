import type { TariffLine } from "../types"

/**
 * Sample of the NBR customs & VAT tariff (legacy "Tax Tariff" lists all 7,136 lines).
 * Rates are ILLUSTRATIVE mock values for the chapters the company trades in — R4 replaces this with the
 * official tariff feed for the fiscal year (published with the budget each June).
 *
 * TTI (total tax incidence on import, % of assessable value AV), NBR method:
 *   CD = AV·cd, RD = AV·rd, SD = (AV+CD+RD)·sd, VAT = (AV+CD+RD+SD)·vat, AIT = AV·ait, AT = (AV+CD+RD+SD)·at
 * The legacy screen shows TTI = 0 for every line; here it is computed.
 */
export function tti(r: { cd: number; rd: number; sd: number; vat: number; ait: number; at: number }) {
  const av = 100
  const cd = av * r.cd / 100, rd = av * r.rd / 100
  const sd = (av + cd + rd) * r.sd / 100
  const base = av + cd + rd + sd
  const vat = base * r.vat / 100, at = base * r.at / 100, ait = av * r.ait / 100
  return Math.round((cd + rd + sd + vat + ait + at) * 100) / 100
}

type Row = [hs: string, description: string, cd: number, sd: number, vat: number, ait: number, rd: number, at: number]
const rows: Row[] = [
  ["10011910", "Durum wheat, other than seed, wrapped/canned up to 2.5 kg", 5, 0, 15, 0, 0, 5],
  ["10063010", "Semi-milled or wholly milled rice, wrapped/canned up to 2.5 kg", 25, 0, 15, 5, 3, 5],
  ["29153100", "Ethyl acetate", 5, 0, 15, 5, 0, 5],
  ["29153200", "Vinyl acetate", 5, 0, 15, 5, 0, 5],
  ["29171400", "Maleic anhydride", 5, 0, 15, 5, 0, 5],
  ["32081000", "Paints and varnishes based on polyesters", 25, 20, 15, 5, 3, 5],
  ["32089090", "Other paints, varnishes and lacquers in a non-aqueous medium", 25, 20, 15, 5, 3, 5],
  ["32151100", "Printing ink, black", 10, 0, 15, 5, 0, 5],
  ["32151900", "Printing ink, other than black", 10, 0, 15, 5, 0, 5],
  ["35069100", "Adhesives based on polymers or rubber", 10, 0, 15, 5, 0, 5],
  ["39011000", "Polyethylene, specific gravity < 0.94, in primary forms", 5, 0, 15, 5, 0, 5],
  ["39021000", "Polypropylene, in primary forms", 5, 0, 15, 5, 0, 5],
  ["39043000", "Vinyl chloride–vinyl acetate copolymers, in primary forms", 5, 0, 15, 5, 0, 5],
  ["39095000", "Polyurethanes, in primary forms", 5, 0, 15, 5, 0, 5],
  ["39191000", "Self-adhesive plastic tape in rolls ≤ 20 cm wide", 25, 20, 15, 5, 3, 5],
  ["39199090", "Other self-adhesive plastic plates, sheets and film", 25, 20, 15, 5, 3, 5],
  ["39201000", "Plates/sheets/film of polymers of ethylene, non-cellular", 10, 0, 15, 5, 0, 5],
  ["39204310", "PVC film, ≥ 6 % plasticiser, for pharmaceutical packing", 10, 0, 15, 5, 0, 5],
  ["39204910", "Rigid PVC film for pharmaceutical blister packing", 10, 0, 15, 5, 0, 5],
  ["39204990", "Other plates/sheets/film of polymers of vinyl chloride", 25, 0, 15, 5, 3, 5],
  ["39206200", "Film of polyethylene terephthalate (PET)", 10, 0, 15, 5, 0, 5],
  ["39209290", "Other film of polyamides (BOPA)", 10, 0, 15, 5, 0, 5],
  ["39219090", "Other plates/sheets/film of plastics, laminated", 25, 0, 15, 5, 3, 5],
  ["39232100", "Sacks and bags of polymers of ethylene", 25, 20, 15, 5, 3, 5],
  ["39232990", "Sacks, bags and pouches of other plastics", 25, 20, 15, 5, 3, 5],
  ["39235000", "Stoppers, lids, caps and other closures of plastics", 25, 20, 15, 5, 3, 5],
  ["48101300", "Coated paper for writing/printing, in rolls", 25, 0, 15, 5, 3, 5],
  ["48114100", "Self-adhesive paper and paperboard", 25, 0, 15, 5, 3, 5],
  ["48191000", "Cartons, boxes and cases of corrugated paper or paperboard", 25, 20, 15, 5, 3, 5],
  ["48192000", "Folding cartons of non-corrugated paperboard", 25, 20, 15, 5, 3, 5],
  ["48229000", "Bobbins, spools, cops and cores of paper or paperboard", 25, 0, 15, 5, 3, 5],
  ["76061200", "Plates and sheets of aluminium alloys, > 0.2 mm", 10, 0, 15, 5, 0, 5],
  ["76071110", "Aluminium foil, rolled, not backed, ≤ 0.2 mm, for pharmaceutical packing", 5, 0, 15, 5, 0, 5],
  ["76071190", "Other aluminium foil, rolled, not backed", 10, 0, 15, 5, 0, 5],
  ["76071900", "Other aluminium foil, not backed", 10, 0, 15, 5, 0, 5],
  ["76072010", "Aluminium foil, backed, for tea-chest lining", 25, 0, 15, 5, 3, 5],
  ["76072090", "Other aluminium foil, backed (laminates, blister and strip foil)", 25, 0, 15, 5, 3, 5],
  ["84224000", "Other packing or wrapping machinery", 1, 0, 15, 5, 0, 0],
  ["84425010", "Printing cylinders and plates, engraved or etched", 5, 0, 15, 5, 0, 5],
  ["84431600", "Flexographic printing machinery", 1, 0, 15, 5, 0, 0],
  ["85444900", "Other electric conductors, ≤ 1,000 V", 10, 0, 15, 5, 0, 5],
]

export const tariff: TariffLine[] = rows.map(([hsCode, description, cd, sd, vat, ait, rd, at]) => ({
  hsCode, description, cd, sd, vat, ait, rd, at, tti: tti({ cd, sd, vat, ait, rd, at }), chapter: hsCode.slice(0, 2),
}))
export const TARIFF_FY = "2026-27"
export const findTariff = (hs: string) => tariff.find((t) => t.hsCode === hs.replace(/\D/g, ""))
