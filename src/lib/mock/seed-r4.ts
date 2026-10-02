/**
 * R4 seed — accounting (money accounts, receipts, payments) and NBR VAT (VDS, adjustments, treasury deposits, 9.1 returns).
 * Deterministic and fictitious. Receipts/payments start at the accounting go-live (1 Jul 2026) and explain part of the amounts
 * already marked paid on the invoices; everything before that was settled in the legacy system.
 * Returns are filed for every month from Jul 2025 to Aug 2026 — each month's treasury deposit covers note 50, so the closing
 * balance carries forward exactly as it would in the NBR portal. Sep 2026 is the open period (due 15 Oct 2026).
 */
import type {
  AccountingConfig, Allocation, CreditNote, DebitNote, HistoryEntry, MoneyAccount, MoneyDoc, MoneyMethod, Party, PayMethod, Purchase,
  ReturnManual, Sale, TreasuryDeposit, TreasuryHead, VatAdjustment, VatReturn, VdsEntry,
} from "../types"
import { TODAY } from "../company"
import { economicCode, periodEnd, periodOf, periodsBetween, returnDue } from "../r4"
import { round2 } from "../vat"
import type { VatProfile } from "../types"
import { computeReturn, EMPTY_MANUAL, type ReturnSource } from "./vat-return"
import { seedSdClaims } from "./seed-r63"

export const GO_LIVE = "2026-07-01"
export const FIRST_RETURN = "2025-07"
export const LAST_FILED = "2026-08"
const ZONE = "0015"
const OPERATOR = "Md. Kamal Uddin"
const APPROVERS = ["Arif Hossain", "Farzana Akter"]
const ADDRESS = "Plot 22-25, BSCIC Road, Konabari, Gazipur - 1346"

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
const minDate = (a: string, b: string) => (a < b ? a : b)
const at = (d: string, h: number) => `${d}T${String(h).padStart(2, "0")}:15:00.000Z`
const trail = (date: string, i: number, by = OPERATOR, approved = true): HistoryEntry[] => [
  { at: at(date, 4), by, action: "created" },
  ...(approved ? [{ at: at(date, 6 + (i % 3)), by: APPROVERS[i % 2], action: "approved" as const }] : []),
]
const monthNo = (prefix: string, date: string, used: Map<string, number>) => {
  const key = `${prefix}-${date.slice(5, 7)}${date.slice(2, 4)}`
  const n = (used.get(key) ?? 0) + 1
  used.set(key, n)
  return `${key}${String(n).padStart(4, "0")}`
}
/** A-challan style number: FY (2627) + 10 digits. */
const challanNo = (date: string, n: number) => {
  const y = Number(date.slice(2, 4)), m = Number(date.slice(5, 7))
  const fy = m >= 7 ? `${y}${y + 1}` : `${y - 1}${y}`
  return `${fy}-${String(4_100_000_000 + n * 7919).padStart(10, "0")}`
}

export const SEED_ACCOUNTS: MoneyAccount[] = [
  { id: "ac1", kind: "bank", provider: "DUTCH-BANGLA BANK PLC.", accountNo: "1071100045872", owner: "KANCHANJHARA APPAREL COMPOSITE LTD", branch: "Konabari", bankType: "current", serviceCharge: 0, openingBalance: 35_000_000, openingDate: GO_LIVE, address: "Konabari Bazar, Gazipur", active: true, createdAt: at("2026-06-28", 5) },
  { id: "ac2", kind: "bank", provider: "BRAC BANK PLC.", accountNo: "1501203658741001", owner: "KANCHANJHARA APPAREL COMPOSITE LTD", branch: "Gazipur Chowrasta", bankType: "current", serviceCharge: 0, openingBalance: 12_000_000, openingDate: GO_LIVE, active: true, createdAt: at("2026-06-28", 5) },
  { id: "ac3", kind: "bank", provider: "SONALI BANK PLC.", accountNo: "4433401009876", owner: "KANCHANJHARA APPAREL COMPOSITE LTD", branch: "Konabari", bankType: "savings", serviceCharge: 0, openingBalance: 2_500_000, openingDate: GO_LIVE, active: true, createdAt: at("2026-06-28", 5) },
  { id: "ac4", kind: "mobile", provider: "bKash", accountNo: "01711-555012", owner: "KANCHANJHARA APPAREL COMPOSITE LTD", authorised: OPERATOR, walletType: "merchant", serviceCharge: 1.5, openingBalance: 150_000, openingDate: GO_LIVE, active: true, createdAt: at("2026-06-29", 5) },
  { id: "ac5", kind: "mobile", provider: "Nagad", accountNo: "01819-440233", owner: "KANCHANJHARA APPAREL COMPOSITE LTD", authorised: "Farzana Akter", walletType: "merchant", serviceCharge: 1, openingBalance: 80_000, openingDate: GO_LIVE, active: true, createdAt: at("2026-06-29", 5) },
  { id: "ac6", kind: "cash", provider: "Cash in hand — Factory", accountNo: "CASH-01", owner: "Accounts department", serviceCharge: 0, openingBalance: 4_000_000, openingDate: GO_LIVE, active: true, createdAt: at("2026-06-29", 5) },
]

const METHOD: Record<PayMethod, MoneyMethod> = { Bank: "bankTransfer", Transaction: "bankTransfer", Cheque: "cheque", Mobile: "mobile", Cash: "cash" }
const ACCOUNT_FOR = (m: MoneyMethod, i: number) => (m === "cash" ? "ac6" : m === "mobile" ? (i % 3 ? "ac4" : "ac5") : i % 2 ? "ac2" : "ac1")
const CHEQUE_BANKS = ["CITY BANK PLC.", "EASTERN BANK PLC.", "ISLAMI BANK BANGLADESH PLC.", "PRIME BANK PLC.", "UNITED COMMERCIAL BANK PLC.", "MUTUAL TRUST BANK PLC."]

interface SeedSrc { sales: Sale[]; purchases: Purchase[]; creditNotes: CreditNote[]; debitNotes: DebitNote[]; customers: Party[]; vendors: Party[] }

function moneyDoc(kind: MoneyDoc["kind"], i: number, date: string, party: Party, method: MoneyMethod, amount: number, allocations: Allocation[], used: Map<string, number>, opts: { approved?: boolean; note?: string } = {}): MoneyDoc {
  const accountId = ACCOUNT_FOR(method, i)
  const acct = SEED_ACCOUNTS.find((a) => a.id === accountId)!
  const allocated = round2(allocations.reduce((a, x) => a + x.amount, 0))
  const approved = opts.approved ?? true
  return {
    id: `${kind === "receipt" ? "mr" : "pv"}${i}`, no: monthNo(kind === "receipt" ? "MR" : "PV", date, used), kind, date,
    partyId: party.id, partyName: party.name, partyBin: party.bin, method, accountId, accountName: `${acct.provider} · ${acct.accountNo}`,
    ...(method === "cheque" ? { chequeNo: `CHQ ${4_471_000 + i * 37}`, chequeDate: date, chequeBank: kind === "receipt" ? CHEQUE_BANKS[i % CHEQUE_BANKS.length] : acct.provider } : {}),
    ...(method === "mobile" ? { reference: `TXN${(0x9f4a1c + i * 4099).toString(16).toUpperCase()}` } : method === "bankTransfer" ? { reference: `NPSB-${260_700 + i * 13}` } : {}),
    amount, charge: kind === "receipt" && method === "mobile" ? round2((amount * acct.serviceCharge) / 100) : 0,
    allocations, allocated, unallocated: round2(amount - allocated), note: opts.note,
    process: approved ? "Approved" : "Created", issuedBy: kind === "receipt" ? "Farzana Akter" : OPERATOR,
    createdAt: at(date, 4), history: trail(date, i, kind === "receipt" ? "Farzana Akter" : OPERATOR, approved),
  }
}

/**
 * R6.3: demo business profile — a knit + woven composite garment maker: exports garments directly (EXP / bonded
 * fabric) and also sells dyed knit fabric to other exporters against their UDs (deemed export), so it is not 100 %
 * export-oriented. Own bond licence, BKMEA member, manufacturer for advance tax.
 */
export const SEED_PROFILE: VatProfile = {
  segment: "rmgComposite", exportOriented: false, importerType: "manufacturer", filerCategory: "standard",
  bondLicenseNo: "CUS-BOND/DHK/G-1186/2021", bondLicenseExpiry: "2027-06-30", associationNo: "BKMEA-2864", holidays: [],
}

export function seedR4(d: SeedSrc) {
  const used = new Map<string, number>()
  const moneyDocs: MoneyDoc[] = []
  // Receipts: one per invoice issued since go-live that carries a paid amount
  const liveSales = d.sales.filter((s) => s.process === "Approved" && s.issueDate >= GO_LIVE && s.paid > 0).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  liveSales.forEach((s, i) => {
    const cust = d.customers.find((c) => c.id === s.customerId)!
    const date = minDate(addDays(s.issueDate, i % 9), TODAY)
    moneyDocs.push(moneyDoc("receipt", i + 1, date, cust, METHOD[s.method], s.paid, [{ docId: s.id, docNo: s.invoiceNo, docDate: s.issueDate, docTotal: s.netTotal, amount: s.paid }], used))
  })
  let r = liveSales.length
  const dueSale = d.sales.filter((s) => s.process === "Approved" && s.due > 0 && s.mode === "Local").sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0]
  if (dueSale) {
    const cust = d.customers.find((c) => c.id === dueSale.customerId)!
    const part = round2(Math.floor(dueSale.due / 2000) * 1000)
    moneyDocs.push(moneyDoc("receipt", ++r, "2026-09-24", cust, "cheque", part, [{ docId: dueSale.id, docNo: dueSale.invoiceNo, docDate: dueSale.issueDate, docTotal: dueSale.netTotal, amount: part }], used, { approved: false, note: "Part payment — balance promised by 10 Oct." }))
  }
  const adv = d.customers.find((c) => c.mode === "Local" && c.id !== dueSale?.customerId) ?? d.customers[0]
  moneyDocs.push(moneyDoc("receipt", ++r, "2026-09-22", adv, "bankTransfer", 500_000, [], used, { note: "Advance against purchase order PO-2026-118 (polo shirts, Puja collection)." }))

  const livePur = d.purchases.filter((p) => p.process === "Approved" && p.issueDate >= GO_LIVE && p.paid > 0).sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  livePur.forEach((p, i) => {
    const v = d.vendors.find((x) => x.id === p.vendorId)!
    const date = minDate(addDays(p.issueDate, (i * 2) % 7), TODAY)
    const method = p.mode === "Foreign" ? "bankTransfer" : METHOD[p.method]
    moneyDocs.push(moneyDoc("payment", i + 1, date, v, method, p.paid, [{ docId: p.id, docNo: p.invoiceNo, docDate: p.issueDate, docTotal: p.netTotal, amount: p.paid }], used))
  })
  const duePur = d.purchases.filter((p) => p.process === "Approved" && p.due > 0 && p.mode === "Local").sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0]
  if (duePur) {
    const v = d.vendors.find((x) => x.id === duePur.vendorId)!
    const part = round2(Math.min(duePur.due, Math.floor(duePur.due / 2000) * 1000 || duePur.due))
    moneyDocs.push(moneyDoc("payment", livePur.length + 1, "2026-09-24", v, "bankTransfer", part, [{ docId: duePur.id, docNo: duePur.invoiceNo, docDate: duePur.issueDate, docTotal: duePur.netTotal, amount: part }], used, { approved: false }))
  }

  // VDS — purchases we withheld on (we issue Mushak 6.6) and certificates received from withholding customers
  const vds: VdsEntry[] = []
  let v = 0
  const certDate = (issue: string, k: number) => minDate(minDate(addDays(issue, 2 + (k % 3)), periodEnd(periodOf(issue))), TODAY)
  for (const p of d.purchases.filter((x) => x.process === "Approved" && x.lines.some((l) => l.vds)).sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    const ls = p.lines.filter((l) => l.vds)
    const amount = round2(ls.reduce((a, l) => a + l.vat, 0))
    if (!amount || periodOf(p.issueDate) > "2026-09") continue
    if (periodOf(p.issueDate) === "2026-09" && v % 2) { v++; continue } // a few still to be issued this month
    const date = certDate(p.issueDate, v)
    v++
    vds.push({
      id: `vds${vds.length + 1}`, no: monthNo("VDS", date, used), mode: "purchase", docId: p.id, docNo: p.invoiceNo, challanNo: p.challanNo, docDate: p.issueDate,
      partyId: p.vendorId, partyName: p.vendorName, partyBin: p.vendorBin, partyAddress: p.vendorAddress,
      docValue: round2(ls.reduce((a, l) => a + l.subtotal, 0)), docVat: amount, amount, certificateNo: `RFL/VDS/${date.slice(2, 4)}${date.slice(5, 7)}/${String(vds.length + 1).padStart(3, "0")}`,
      certificateDate: date, taxPeriod: periodOf(date), process: "Approved", issuedBy: "Farzana Akter", createdAt: at(date, 4), history: trail(date, vds.length, "Farzana Akter"),
    })
  }
  let k = 0
  const withholders = new Set(d.customers.filter((c) => c.vdsWithholder).map((c) => c.id))
  for (const s of d.sales.filter((x) => x.process === "Approved" && x.vds && x.vat > 0 && withholders.has(x.customerId)).sort((a, b) => a.issueDate.localeCompare(b.issueDate))) {
    k++
    if (periodOf(s.issueDate) === "2026-09" && k % 3 !== 0) continue // certificates still awaited from customers
    const date = certDate(s.issueDate, k)
    const cust = d.customers.find((c) => c.id === s.customerId)!
    vds.push({
      id: `vds${vds.length + 1}`, no: monthNo("VDS", date, used), mode: "sales", docId: s.id, docNo: s.invoiceNo, challanNo: s.challanNo, docDate: s.issueDate,
      partyId: s.customerId, partyName: s.customerName, partyBin: s.customerBin, partyAddress: cust.address,
      docValue: s.subtotal, docVat: s.vat, amount: s.vat, certificateNo: `VDS-${cust.bin.slice(0, 4)}-${date.slice(2, 4)}${date.slice(5, 7)}-${String(k).padStart(3, "0")}`,
      certificateDate: date, taxPeriod: periodOf(date), process: "Approved", issuedBy: "Farzana Akter", createdAt: at(date, 5), history: trail(date, k, "Farzana Akter"),
    })
  }

  const adjustments: VatAdjustment[] = [
    ["2026-02-26", "otherIncrease", 27, 18_450, "Input tax credit reversed on fabric issued for free buyer samples (not a taxable supply), per section 46.", "Store memo SM-0226-07"],
    ["2026-05-28", "otherDecrease", 32, 9_870, "Input tax on the Apr-2026 bill of entry C-41877 not claimed in time for 04-2026; claimed within the 4 tax periods allowed.", "BoE C-41877"],
    ["2026-08-27", "otherIncrease", 27, 6_200, "VAT on jhut (cutting waste) sales recorded outside the sales register — added on the consultant's review.", "Consultant note 08/2026"],
  ].map(([date, kind, note, amount, description, reference], i) => ({
    id: `va${i + 1}`, no: monthNo("VA", date as string, used), kind: kind as VatAdjustment["kind"], note: note as VatAdjustment["note"], issueDate: date as string, taxPeriod: periodOf(date as string),
    amount: amount as number, description: description as string, reference: reference as string, process: "Approved" as const, issuedBy: "Farzana Akter", createdAt: at(date as string, 5), history: trail(date as string, i, "Farzana Akter"),
  }))
  adjustments.push({
    id: "va4", no: monthNo("VA", "2026-09-23", used), kind: "otherIncrease", note: 27, issueDate: "2026-09-23", taxPeriod: "2026-09", amount: 3_150,
    description: "Input tax on canteen supplies claimed in error on purchase P-0926 — to be reversed this period.", reference: "Internal review 23/09", process: "Created",
    issuedBy: "Farzana Akter", createdAt: at("2026-09-23", 5), history: trail("2026-09-23", 0, "Farzana Akter", false),
  })
  // R6.3: SD on exported inputs — claims in the open period (note 40)
  adjustments.push(...seedSdClaims(d.purchases, d.sales, adjustments, (date) => monthNo("VA", date, used)))

  // Returns + treasury deposits, month by month
  const treasury: TreasuryDeposit[] = []
  const returns: VatReturn[] = []
  const src: ReturnSource = { sales: d.sales, purchases: d.purchases, creditNotes: d.creditNotes, debitNotes: d.debitNotes, vds, adjustments, treasury, returns, vatSettings: { zoneCode: ZONE } }
  let ch = 0
  const deposit = (head: TreasuryHead, period: string, date: string, amount: number) => {
    ch++
    const id = `tc${treasury.length + 1}`
    const t: TreasuryDeposit = {
      id, no: monthNo("TC", date, used), head, code: economicCode(head, ZONE), taxPeriod: period, challanNo: challanNo(date, ch), challanDate: date, mode: date >= GO_LIVE ? "online" : ch % 3 ? "cheque" : "online",
      bank: "SONALI BANK PLC.", bankBranch: "Konabari", district: "Gazipur", ...(date >= GO_LIVE ? { accountId: "ac1" } : {}), amount,
      depositor: "Farzana Akter", designation: "Accounts Executive", address: ADDRESS,
      description: `${head === "vds" ? "VAT deducted at source" : head === "sd" ? "Supplementary duty" : head === "penalty" ? "Penalty for late return" : "VAT"} for tax period ${period.slice(5)}-${period.slice(0, 4)}`,
      process: "Approved", createdAt: at(date, 4), history: trail(date, ch, "Farzana Akter"),
    }
    treasury.push(t)
    return t
  }
  const LATE = "2025-12"
  const REFUNDS: Record<string, number> = { "2026-04": 3_500_000, "2026-08": 2_800_000 }
  for (const period of periodsBetween(FIRST_RETURN, LAST_FILED).reverse()) {
    const due = returnDue(period)
    const late = period === LATE
    const manual: ReturnManual = late ? { ...EMPTY_MANUAL, penaltyLate: 10_000 } : EMPTY_MANUAL
    const c0 = computeReturn(src, period, manual)
    const vdsAmt = c0.notes.find((n) => n.note === 24)!.amount ?? 0
    if (vdsAmt > 0) {
      const t = deposit("vds", period, `${due.slice(0, 8)}07`, Math.ceil(vdsAmt))
      for (const x of vds) if (x.mode === "purchase" && x.taxPeriod === period) { x.treasuryId = t.id; x.treasuryChallan = t.challanNo }
    }
    const depDate = late ? `${due.slice(0, 8)}19` : `${due.slice(0, 8)}${10 + (returns.length % 4)}`
    if (late) deposit("penalty", period, depDate, 10_000)
    const vatNeed = Math.ceil(c0.payableVat - (vdsAmt > 0 ? Math.ceil(vdsAmt) : 0) - (late ? 10_000 : 0))
    if (vatNeed > 0) deposit("vat", period, depDate, vatNeed)
    if (c0.payableSd > 0) deposit("sd", period, depDate, Math.ceil(c0.payableSd))
    // Refund claims (Part 11) on the returns where the carried-forward credit had built up
    const claim = REFUNDS[period]
    let final = manual
    if (claim) {
      const avail = computeReturn(src, period, manual).closingVat
      const refundVat = Math.min(claim, Math.floor(avail))
      if (refundVat > 0) final = { ...manual, refund: true, refundVat }
    }
    const snap = computeReturn(src, period, final)
    const submitted = late ? `${due.slice(0, 8)}19` : `${due.slice(0, 8)}${String(Math.min(15, 11 + (returns.length % 4))).padStart(2, "0")}`
    returns.push({
      id: period, period, type: late ? "late" : "original", activities: true, submissionDate: submitted, status: "submitted", manual: final, snapshot: snap,
      submittedBy: "Farzana Akter", submittedAt: at(submitted, 9), ackNo: `NBR-91-${period.replace("-", "")}-${String(830_417 + returns.length * 1_117).padStart(7, "0")}`,
      createdAt: at(`${due.slice(0, 8)}05`, 4),
      history: [{ at: at(`${due.slice(0, 8)}05`, 4), by: "Farzana Akter", action: "created" }, { at: at(submitted, 9), by: "Farzana Akter", action: "submitted", note: late ? "Late return — penalty Tk 10,000 deposited (note 43)." : final.refund ? `Refund of Tk ${final.refundVat.toLocaleString("en-IN")} requested (note 67).` : undefined }],
    })
  }

  const accountingConfig: AccountingConfig = { closedUpTo: "2026-06-30", allowAdvance: true, autoAllocate: true }
  return {
    moneyAccounts: structuredClone(SEED_ACCOUNTS), moneyDocs, vds, adjustments, treasury, returns, accountingConfig, vatSettings: { zoneCode: ZONE, profile: structuredClone(SEED_PROFILE) },
  }
}
