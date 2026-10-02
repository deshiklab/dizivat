import type { TariffLine } from "../types"

/**
 * Sample of the NBR customs & VAT tariff (legacy "Tax Tariff" lists all 7,136 lines).
 * Rates are ILLUSTRATIVE mock values for the chapters the company trades in (textiles and garments, plus the packing and chemical lines it buys) — R4 replaces this with the
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
  ["32041600", "Reactive dyes and preparations based thereon", 5, 0, 15, 5, 0, 5],
  ["32041700", "Pigments and preparations based thereon (textile printing)", 5, 0, 15, 5, 0, 5],
  ["32081000", "Paints and varnishes based on polyesters", 25, 20, 15, 5, 3, 5],
  ["32089090", "Other paints, varnishes and lacquers in a non-aqueous medium", 25, 20, 15, 5, 3, 5],
  ["32151100", "Printing ink, black", 10, 0, 15, 5, 0, 5],
  ["32151900", "Printing ink, other than black", 10, 0, 15, 5, 0, 5],
  ["35069100", "Adhesives based on polymers or rubber", 10, 0, 15, 5, 0, 5],
  ["38099100", "Finishing agents, dye carriers, of a kind used in the textile industry", 5, 0, 15, 5, 0, 5],
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
  ["52051200", "Cotton yarn ≥ 85 %, single, uncombed (carded), 232.56–714.29 dtex (Ne 8–25)", 5, 0, 15, 5, 0, 5],
  ["52052300", "Cotton yarn ≥ 85 %, single, combed, 192.31–232.56 dtex (Ne 26–30)", 5, 0, 15, 5, 0, 5],
  ["52052400", "Cotton yarn ≥ 85 %, single, combed, 125–192.31 dtex (Ne 31–47)", 5, 0, 15, 5, 0, 5],
  ["52062300", "Cotton yarn < 85 % (CVC), single, combed, 192.31–232.56 dtex", 5, 0, 15, 5, 0, 5],
  ["52083200", "Woven fabrics of cotton ≥ 85 %, dyed, plain weave, 100–200 g/m²", 25, 0, 15, 5, 3, 5],
  ["52094200", "Denim of cotton ≥ 85 %, > 200 g/m²", 25, 0, 15, 5, 3, 5],
  ["54011000", "Sewing thread of synthetic filaments", 10, 0, 15, 5, 0, 5],
  ["54023300", "Textured yarn of polyesters", 5, 0, 15, 5, 0, 5],
  ["54024400", "Elastomeric yarn, single, untwisted (elastane / spandex)", 5, 0, 15, 5, 0, 5],
  ["55081000", "Sewing thread of synthetic staple fibres", 10, 0, 15, 5, 0, 5],
  ["58071000", "Woven labels, badges and similar articles", 25, 0, 15, 5, 3, 5],
  ["60041000", "Knitted fabrics > 30 cm wide, ≥ 5 % elastomeric yarn (rib, lycra jersey)", 25, 0, 15, 5, 3, 5],
  ["60062200", "Other knitted fabrics of cotton, dyed (single jersey, pique, fleece)", 25, 0, 15, 5, 3, 5],
  ["61051000", "Men's or boys' shirts of cotton, knitted (polo shirts)", 25, 45, 15, 5, 3, 5],
  ["61091000", "T-shirts, singlets and other vests of cotton, knitted", 25, 45, 15, 5, 3, 5],
  ["61102000", "Jerseys, pullovers, sweatshirts of cotton, knitted", 25, 45, 15, 5, 3, 5],
  ["62034200", "Men's or boys' trousers of cotton (denim jeans), woven", 25, 45, 15, 5, 3, 5],
  ["62052000", "Men's or boys' shirts of cotton, woven", 25, 45, 15, 5, 3, 5],
  ["76061200", "Plates and sheets of aluminium alloys, > 0.2 mm", 10, 0, 15, 5, 0, 5],
  ["76071110", "Aluminium foil, rolled, not backed, ≤ 0.2 mm, for pharmaceutical packing", 5, 0, 15, 5, 0, 5],
  ["76071190", "Other aluminium foil, rolled, not backed", 10, 0, 15, 5, 0, 5],
  ["76071900", "Other aluminium foil, not backed", 10, 0, 15, 5, 0, 5],
  ["76072010", "Aluminium foil, backed, for tea-chest lining", 25, 0, 15, 5, 3, 5],
  ["76072090", "Other aluminium foil, backed (laminates, blister and strip foil)", 25, 0, 15, 5, 3, 5],
  ["84224000", "Other packing or wrapping machinery", 1, 0, 15, 5, 0, 0],
  ["84425010", "Printing cylinders and plates, engraved or etched", 5, 0, 15, 5, 0, 5],
  ["84431600", "Flexographic printing machinery", 1, 0, 15, 5, 0, 0],
  ["84471200", "Circular knitting machines, cylinder diameter > 165 mm", 1, 0, 15, 5, 0, 0],
  ["84485100", "Sinkers, needles and other articles for knitting machines", 5, 0, 15, 5, 0, 5],
  ["85444900", "Other electric conductors, ≤ 1,000 V", 10, 0, 15, 5, 0, 5],
  ["96062200", "Buttons of base metal, not covered with textile material", 25, 0, 15, 5, 3, 5],
  ["96071100", "Slide fasteners (zippers) fitted with chain scoops of base metal", 25, 0, 15, 5, 3, 5],
]

export const tariff: TariffLine[] = rows.map(([hsCode, description, cd, sd, vat, ait, rd, at]) => ({
  hsCode, description, cd, sd, vat, ait, rd, at, tti: tti({ cd, sd, vat, ait, rd, at }), chapter: hsCode.slice(0, 2),
}))
export const TARIFF_FY = "2026-27"
export const findTariff = (hs: string) => tariff.find((t) => t.hsCode === hs.replace(/\D/g, ""))
