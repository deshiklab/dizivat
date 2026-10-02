/**
 * R6.5 seed — our own UDs / UP and their bond settlement, and the duty-drawback claim history. Fictitious.
 *
 * Own UDs / UP, linked to the R6.4 bonded Bills of Entry (boe.udNo) and the exports shipped under them (ownUdNo):
 *  · BKMEA polo spring order — compact yarn BoE (Mar), polo exports Mar + May: shipped, SETTLED 15 Sep 2026 —
 *    2,000 kg carried to the autumn polo UD, the rest cleared on payment of duty;
 *  · BGMEA jeans spring order — denim BoE (Jan), jeans export Feb: shipped and expired → READY to settle (the UD's
 *    denim was all consumed; the rest came from duty-paid stock, so nothing is due);
 *  · BGMEA jeans autumn order — denim + pocketing BoE (Jul): in progress; pocketing imported beyond the UD (warning);
 *  · Bond Commissionerate UP — combed yarn + elastane BoE (Sep) for knit fabric supplied as deemed export: in progress;
 *  · BKMEA polo autumn order — brought forward 2,000 kg from the spring UD: in progress.
 * Drawback claims: two refunded (one with a disallowance), one sanctioned, two filed, one rejected (its export has
 * lapsed since), one draft. The export whose window closes today and the June jeans shipment are still unclaimed.
 * Nothing here moves stock or tax; existing documents only gain the UD reference.
 */
import { bondRegister } from "../bond"
import { claimLines, claimTotals } from "../drawback"
import { udStatement } from "../settlement"
import { round2 } from "../vat"
import type { Bom, BondUd, DrawbackClaim, HistoryEntry, Item, OpeningEntry, Purchase, Sale } from "../types"

const at = (date: string, hm: string) => new Date(`${date}T${hm}:00+06:00`).toISOString()
const FARZANA = "Farzana Akter", ARIF = "Arif Hossain", KAMAL = "Md. Kamal Uddin"

type Spec = Omit<BondUd, "inputs" | "garments" | "createdBy" | "createdAt" | "history"> & { inputs: [string, number][]; garments: [string, number][]; boes: string[]; exports: string[]; by: string }
const SPECS: Spec[] = [
  {
    id: "bu1", no: "BKMEA/UD/2026/02114", kind: "UD", issuer: "BKMEA", date: "2026-03-01", expiry: "2026-08-31", masterLcNo: "EXP-LC-26-0253", masterLcValue: 121_770, currency: "USD",
    buyer: "BRANDT & VOGEL TEXTIL GMBH", inputs: [["i9", 10_000]], garments: [["i18", 24_600]], boes: ["C-1022835"], exports: ["s132", "s170"], by: FARZANA,
    note: "Spring 2026 pique polo programme — two shipments.",
  },
  {
    id: "bu2", no: "BGMEA/UD/2026/00412", kind: "UD", issuer: "BGMEA", date: "2026-01-08", expiry: "2026-06-30", masterLcNo: "EXP-LC-26-0244", masterLcValue: 109_868.64, currency: "USD",
    buyer: "DESERT ROSE TEXTILE TRADING LLC", inputs: [["i5", 16_000], ["i4", 3_100]], garments: [["i22", 11_800]], boes: ["C-1012264"], exports: ["s118"], by: FARZANA,
    note: "Spring 2026 5-pocket jeans — pocketing came from the go-live bonded stock.",
  },
  {
    id: "bu3", no: "BGMEA/UD/2026/01980", kind: "UD", issuer: "BGMEA", date: "2026-06-20", expiry: "2026-12-31", masterLcNo: "EXP-LC-26-0270", masterLcValue: 84_600, currency: "USD",
    buyer: "BRANDT & VOGEL TEXTIL GMBH", inputs: [["i5", 12_500], ["i4", 3_500]], garments: [["i22", 9_000]], boes: ["C-1031147"], exports: [], by: KAMAL,
  },
  {
    id: "bu4", no: "CUS/UP/2026/1187", kind: "UP", issuer: "Customs", date: "2026-09-01", expiry: "2027-03-31", masterLcNo: "BB-LC-0934-26-0117", masterLcValue: 68_200, currency: "USD",
    buyer: "AURORA KNIT COMPOSITE LTD (deemed export)", inputs: [["i8", 17_200], ["i3", 1_500]], garments: [["i21", 16_000]], boes: ["C-1036620"], exports: ["s226"], by: FARZANA,
    note: "Single jersey for AURORA KNIT against its UD BKMEA/UD/2026/08812.",
  },
  {
    id: "bu5", no: "BKMEA/UD/2026/03390", kind: "UD", issuer: "BKMEA", date: "2026-09-01", expiry: "2027-02-28", masterLcNo: "EXP-LC-26-0274", masterLcValue: 149_400, currency: "USD",
    buyer: "BRANDT & VOGEL TEXTIL GMBH", inputs: [["i9", 8_600], ["i3", 130]], garments: [["i18", 30_000]], boes: [], exports: [], by: KAMAL,
  },
]

export function seedBondUds(purchases: Purchase[], sales: Sale[], items: Item[], boms: Bom[]): BondUd[] {
  const item = (id: string) => items.find((i) => i.id === id)!
  const uds: BondUd[] = SPECS.map(({ inputs, garments, boes, exports, by, ...u }) => {
    for (const p of purchases) if (p.boe?.bonded && boes.includes(p.boe.no)) p.boe.udNo = u.no
    for (const s of sales) if (exports.includes(s.id) && s.export) s.export.ownUdNo = u.no
    const createdAt = at(u.date, "12:10")
    return {
      ...u,
      inputs: inputs.map(([id, qty]) => { const it = item(id); return { itemId: id, name: it.name, hsCode: it.hsCode, uom: it.unit, qty } }),
      garments: garments.map(([id, qty]) => { const it = item(id); return { itemId: id, name: it.name, uom: it.unit, qty } }),
      createdBy: by, createdAt, history: [{ at: createdAt, by, action: "created" } as HistoryEntry],
    }
  })
  // spring polo UD settled: 2,000 kg to the autumn polo UD, the rest cleared on payment of duty
  const bu1 = uds[0]
  const live = udStatement(bu1, { purchases, sales, boms, bondUds: uds }).lines
  const lines = live.map((l) => {
    const carryQty = l.itemId === "i9" ? Math.min(2_000, l.balance) : 0
    const dutyPaidQty = Math.round((l.balance - carryQty) * 1000) / 1000
    return { ...l, carryQty, carryTo: carryQty ? "BKMEA/UD/2026/03390" : undefined, dutyPaidQty, dutyPaid: round2(dutyPaidQty * l.dutyPerUnit) }
  })
  const when = at("2026-09-15", "16:40")
  bu1.settlement = {
    date: "2026-09-15", bondRef: "CBC/DHK/UD-SET/2026/0417", paymentRef: "CUS-PAY/2026/077812",
    note: "Settled by the Bond Commissionerate, Dhaka after the May shipment.", lines, dutyPaid: round2(lines.reduce((a, l) => a + l.dutyPaid, 0)), by: ARIF, at: when,
  }
  bu1.updatedAt = when
  bu1.history!.push({ at: when, by: ARIF, action: "approved", note: `Settled — ${bu1.settlement.bondRef}` })
  return uds
}

type ClaimSpec = { no: string; saleIds: string[]; created: string; by: string; filed?: [string, string]; sanctioned?: [string, number | null, string?]; paid?: [string, string]; rejected?: [string, string] }
const CLAIMS: ClaimSpec[] = [
  { no: "DBK-11250001", saleIds: ["s17", "s21"], created: "2025-11-10", by: FARZANA, filed: ["2025-11-12", "DEDO/DHK/2025/3318"], sanctioned: ["2026-01-20", 61_200, "Wastage above the declared coefficient on one fleece lot disallowed."], paid: ["2026-02-15", "EFT-SONALI-2602-11873"] },
  { no: "DBK-12250002", saleIds: ["s44", "s56"], created: "2025-12-04", by: FARZANA, filed: ["2025-12-08", "DEDO/DHK/2025/3561"], sanctioned: ["2026-02-24", null], paid: ["2026-03-30", "EFT-SONALI-2603-20419"] },
  { no: "DBK-03260003", saleIds: ["s98", "s105"], created: "2026-03-19", by: FARZANA, filed: ["2026-03-22", "DEDO/DHK/2026/0712"], sanctioned: ["2026-06-10", null] },
  { no: "DBK-04260004", saleIds: ["s112"], created: "2026-04-13", by: KAMAL, filed: ["2026-04-15", "DEDO/DHK/2026/0904"], rejected: ["2026-07-02", "Bill of export not endorsed by customs — re-file with the endorsed copy."] },
  { no: "DBK-05260005", saleIds: ["s118"], created: "2026-05-10", by: FARZANA, filed: ["2026-05-12", "DEDO/DHK/2026/1166"] },
  { no: "DBK-07260006", saleIds: ["s121"], created: "2026-07-26", by: KAMAL, filed: ["2026-07-28", "DEDO/DHK/2026/1528"] },
  { no: "DBK-09260007", saleIds: ["s170"], created: "2026-09-22", by: KAMAL },
]

/** Claim history over the R6.4 drawback view (amounts as worked out at the time — the same engine). */
export function seedDrawbackClaims(src: { purchases: Purchase[]; sales: Sale[]; boms: Bom[]; items: Item[]; openings: OpeningEntry[] }): DrawbackClaim[] {
  const reg = bondRegister(src, { today: "2026-09-25", licence: { kind: "own", name: "", licenceNo: "", expiry: "", daysLeft: null, state: "missing" }, stock: () => 0 })
  return CLAIMS.map((c, i) => {
    const lines = claimLines(reg.drawback.rows.filter((r) => c.saleIds.includes(r.saleId)))
    const t = claimTotals(lines)
    const createdAt = at(c.created, "10:30")
    const history: HistoryEntry[] = [{ at: createdAt, by: c.by, action: "created" }]
    const claim: DrawbackClaim = { id: `dc${i + 1}`, no: c.no, status: "draft", method: "actual", lines, ...t, createdBy: c.by, createdAt, history }
    if (c.filed) { claim.status = "filed"; claim.filedOn = c.filed[0]; claim.dedoRef = c.filed[1]; history.push({ at: at(c.filed[0], "11:00"), by: c.by, action: "submitted", note: `Filed with DEDO — ${c.filed[1]}` }) }
    if (c.sanctioned) {
      claim.status = "sanctioned"; claim.sanctionedOn = c.sanctioned[0]; claim.sanctioned = c.sanctioned[1] ?? t.claimed
      if (c.sanctioned[2]) claim.disallowedReason = c.sanctioned[2]
      history.push({ at: at(c.sanctioned[0], "15:00"), by: ARIF, action: "approved", note: `Sanctioned ৳ ${claim.sanctioned.toFixed(2)}` })
    }
    if (c.paid) { claim.status = "paid"; claim.paidOn = c.paid[0]; claim.paid = claim.sanctioned; claim.payRef = c.paid[1]; history.push({ at: at(c.paid[0], "12:00"), by: ARIF, action: "edited", note: `Refund received — ${c.paid[1]}` }) }
    if (c.rejected) { claim.status = "rejected"; claim.rejectedOn = c.rejected[0]; claim.rejectReason = c.rejected[1]; history.push({ at: at(c.rejected[0], "15:30"), by: ARIF, action: "cancelled", note: c.rejected[1] }) }
    claim.updatedAt = history[history.length - 1].at
    return claim
  })
}
