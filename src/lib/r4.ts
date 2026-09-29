type Tone = "success" | "warning" | "info" | "danger" | "neutral"
import type { AccountKind, AdjustmentKind, MoneyMethod, ReturnPart, VatReturnType, TreasuryHead, TreasuryMode, VdsMode } from "./types"

/* ── Accounting ────────────────────────────────────────────────────────── */

/** Scheduled banks in Bangladesh (legacy dropdown had 44; names as registered with Bangladesh Bank). */
export const BANKS = [
  "AB BANK PLC.", "AGRANI BANK PLC.", "AL-ARAFAH ISLAMI BANK PLC.", "BANGLADESH COMMERCE BANK LTD.", "BANGLADESH DEVELOPMENT BANK PLC.",
  "BANGLADESH KRISHI BANK", "BANK ASIA PLC.", "BASIC BANK LTD.", "BENGAL COMMERCIAL BANK PLC.", "BRAC BANK PLC.",
  "CITIZENS BANK PLC.", "CITY BANK PLC.", "COMMUNITY BANK BANGLADESH PLC.", "DHAKA BANK PLC.", "DUTCH-BANGLA BANK PLC.",
  "EASTERN BANK PLC.", "EXIM BANK PLC.", "FIRST SECURITY ISLAMI BANK PLC.", "GLOBAL ISLAMI BANK PLC.", "ICB ISLAMIC BANK LTD.",
  "IFIC BANK PLC.", "ISLAMI BANK BANGLADESH PLC.", "JAMUNA BANK PLC.", "JANATA BANK PLC.", "MEGHNA BANK PLC.",
  "MERCANTILE BANK PLC.", "MIDLAND BANK PLC.", "MODHUMOTI BANK PLC.", "MUTUAL TRUST BANK PLC.", "NATIONAL BANK LTD.",
  "NCC BANK PLC.", "NRB BANK PLC.", "NRBC BANK PLC.", "ONE BANK PLC.", "PADMA BANK PLC.", "PRIME BANK PLC.", "PUBALI BANK PLC.",
  "RUPALI BANK PLC.", "SHAHJALAL ISLAMI BANK PLC.", "SHIMANTO BANK PLC.", "SOCIAL ISLAMI BANK PLC.", "SONALI BANK PLC.",
  "SOUTHEAST BANK PLC.", "STANDARD BANK PLC.", "STANDARD CHARTERED BANK", "TRUST BANK PLC.", "UNION BANK PLC.", "UNITED COMMERCIAL BANK PLC.", "UTTARA BANK PLC.",
] as const

/** Mobile financial services (legacy: Bkash, Rocket, Nexus, iPay …). */
export const WALLETS = ["bKash", "Nagad", "Rocket", "Upay", "tap", "OK Wallet", "Cellfin"] as const

export const ACCOUNT_KINDS: AccountKind[] = ["bank", "mobile", "cash"]
export const MONEY_METHODS: MoneyMethod[] = ["bankTransfer", "cheque", "mobile", "cash"]
/** Which account kind each payment method draws on. */
export const METHOD_ACCOUNT: Record<MoneyMethod, AccountKind> = { cash: "cash", bankTransfer: "bank", cheque: "bank", mobile: "mobile" }
export const METHOD_TONE: Record<MoneyMethod, Tone> = { cash: "neutral", bankTransfer: "info", cheque: "warning", mobile: "success" }

/* ── Treasury (TR-6) ───────────────────────────────────────────────────── */

export const TREASURY_HEADS: TreasuryHead[] = ["vat", "vds", "sd", "interest", "penalty", "excise", "devSurcharge", "ictSurcharge", "healthSurcharge", "envSurcharge"]
export const TREASURY_MODES: TreasuryMode[] = ["online", "cheque", "payOrder", "draft", "cash"]
/** Mushak 9.1 Part 9 note each head is reported under (VDS, interest and penalties are paid under the VAT code). */
export const HEAD_NOTE: Record<TreasuryHead, 58 | 59 | 60 | 61 | 62 | 63 | 64> = {
  vat: 58, vds: 58, interest: 58, penalty: 58, sd: 59, excise: 60, devSurcharge: 61, ictSurcharge: 62, healthSurcharge: 63, envSurcharge: 64,
}
/**
 * Economic code per head. The third segment of the VAT/SD/excise codes is the VAT commissionerate (set in VAT settings);
 * surcharges go to fixed 1/1103 codes (Mushak 9.1, Part 9).
 */
export function economicCode(head: TreasuryHead, zone: string) {
  switch (head) {
    case "sd": return `1/1133/${zone}/0711`
    case "excise": return `1/1133/${zone}/0601`
    case "devSurcharge": return "1/1103/0000/2225"
    case "ictSurcharge": return "1/1103/0000/2214"
    case "healthSurcharge": return "1/1103/0000/2212"
    case "envSurcharge": return "1/1103/0000/2213"
    default: return `1/1133/${zone}/0311`
  }
}
export const HEAD_TONE: Record<TreasuryHead, Tone> = {
  vat: "info", vds: "warning", sd: "warning", interest: "danger", penalty: "danger", excise: "neutral",
  devSurcharge: "neutral", ictSurcharge: "neutral", healthSurcharge: "neutral", envSurcharge: "neutral",
}

/** The 64 districts (legacy "District Name" had 65 options incl. the placeholder). */
export const DISTRICTS = [
  "Bagerhat", "Bandarban", "Barguna", "Barishal", "Bhola", "Bogura", "Brahmanbaria", "Chandpur", "Chapai Nawabganj", "Chattogram", "Chuadanga",
  "Cox's Bazar", "Cumilla", "Dhaka", "Dinajpur", "Faridpur", "Feni", "Gaibandha", "Gazipur", "Gopalganj", "Habiganj", "Jamalpur", "Jashore",
  "Jhalokathi", "Jhenaidah", "Joypurhat", "Khagrachhari", "Khulna", "Kishoreganj", "Kurigram", "Kushtia", "Lakshmipur", "Lalmonirhat",
  "Madaripur", "Magura", "Manikganj", "Meherpur", "Moulvibazar", "Munshiganj", "Mymensingh", "Naogaon", "Narail", "Narayanganj", "Narsingdi",
  "Natore", "Netrokona", "Nilphamari", "Noakhali", "Pabna", "Panchagarh", "Patuakhali", "Pirojpur", "Rajbari", "Rajshahi", "Rangamati",
  "Rangpur", "Satkhira", "Shariatpur", "Sherpur", "Sirajganj", "Sunamganj", "Sylhet", "Tangail", "Thakurgaon",
] as const

/* ── VDS & adjustments ─────────────────────────────────────────────────── */

export const VDS_MODES: VdsMode[] = ["purchase", "sales"]
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ["otherIncrease", "otherDecrease", "sdIncrease", "sdDecrease"]
export const ADJUSTMENT_NOTE: Record<AdjustmentKind, 27 | 32 | 38 | 39> = { otherIncrease: 27, otherDecrease: 32, sdIncrease: 38, sdDecrease: 39 }
export const ADJUSTMENT_TONE: Record<AdjustmentKind, Tone> = { otherIncrease: "danger", otherDecrease: "success", sdIncrease: "warning", sdDecrease: "info" }

/* ── Mushak 9.1 ────────────────────────────────────────────────────────── */

export const RETURN_TYPES: VatReturnType[] = ["original", "amended", "full", "late"]
/** Section of the VAT & SD Act 2012 each return type is filed under. */
export const RETURN_SECTION: Record<VatReturnType, string> = { original: "64", amended: "66", full: "67", late: "65" }
/** Purchases above this, paid other than through a bank, lose their input-tax credit (9.1 note 25). */
export const NON_BANK_LIMIT = 100_000
/** Mushak 6.10: individual purchases / sales above Tk 2 lakh. */
export const M610_LIMIT = 200_000

export interface NoteDef { note: number; part: ReturnPart; en: string; bn: string; kind: "vsv" | "vv" | "amount"; total?: boolean; formula?: string }
/** Parts and notes of the NBR Mushak-9.1 return form (rule 47(1)), in form order. */
export const RETURN_PARTS: { part: ReturnPart; en: string; bn: string }[] = [
  { part: 3, en: "Part 3: Supply — output tax", bn: "অংশ-৩: সরবরাহ — উৎপাদ কর" },
  { part: 4, en: "Part 4: Purchase — input tax", bn: "অংশ-৪: ক্রয় — উপকরণ কর" },
  { part: 5, en: "Part 5: Increasing adjustments (VAT)", bn: "অংশ-৫: বৃদ্ধিকারী সমন্বয় (মূসক)" },
  { part: 6, en: "Part 6: Decreasing adjustments (VAT)", bn: "অংশ-৬: হ্রাসকারী সমন্বয় (মূসক)" },
  { part: 7, en: "Part 7: Net tax calculation", bn: "অংশ-৭: নিট কর হিসাব" },
  { part: 8, en: "Part 8: Adjustment for old account current balance", bn: "অংশ-৮: পুরাতন হিসাবের চলতি জের সমন্বয়" },
  { part: 9, en: "Part 9: Account-code-wise payment schedule (treasury deposit)", bn: "অংশ-৯: হিসাব কোডভিত্তিক পরিশোধ তফসিল (ট্রেজারি জমা)" },
  { part: 10, en: "Part 10: Closing balance", bn: "অংশ-১০: সমাপনী জের" },
  { part: 11, en: "Part 11: Refund", bn: "অংশ-১১: ফেরত" },
]
export const RETURN_NOTES: NoteDef[] = [
  { note: 1, part: 3, kind: "vsv", en: "Zero-rated goods/service — direct export", bn: "শূন্যহারবিশিষ্ট পণ্য/সেবা — সরাসরি রপ্তানি" },
  { note: 2, part: 3, kind: "vsv", en: "Zero-rated goods/service — deemed export", bn: "শূন্যহারবিশিষ্ট পণ্য/সেবা — প্রচ্ছন্ন রপ্তানি" },
  { note: 3, part: 3, kind: "vsv", en: "Exempted goods/service", bn: "অব্যাহতিপ্রাপ্ত পণ্য/সেবা" },
  { note: 4, part: 3, kind: "vsv", en: "Standard-rated goods/service", bn: "আদর্শ হারবিশিষ্ট পণ্য/সেবা" },
  { note: 5, part: 3, kind: "vsv", en: "Goods based on MRP", bn: "সর্বোচ্চ খুচরা মূল্যভিত্তিক পণ্য" },
  { note: 6, part: 3, kind: "vsv", en: "Goods/service based on specific VAT", bn: "সুনির্দিষ্ট করভিত্তিক পণ্য/সেবা" },
  { note: 7, part: 3, kind: "vsv", en: "Goods/service other than standard rate", bn: "আদর্শ হার ব্যতীত অন্যান্য হারবিশিষ্ট পণ্য/সেবা" },
  { note: 8, part: 3, kind: "vsv", en: "Retail/wholesale/trade-based supply", bn: "খুচরা/পাইকারি/ব্যবসায়ী ভিত্তিক সরবরাহ" },
  { note: 9, part: 3, kind: "vsv", total: true, en: "Total sales value & total payable taxes", bn: "মোট বিক্রয় মূল্য ও মোট প্রদেয় কর" },
  { note: 10, part: 4, kind: "vv", en: "Zero-rated goods/service — local purchase", bn: "শূন্যহারবিশিষ্ট পণ্য/সেবা — স্থানীয় ক্রয়" },
  { note: 11, part: 4, kind: "vv", en: "Zero-rated goods/service — import", bn: "শূন্যহারবিশিষ্ট পণ্য/সেবা — আমদানি" },
  { note: 12, part: 4, kind: "vv", en: "Exempted goods/service — local purchase", bn: "অব্যাহতিপ্রাপ্ত পণ্য/সেবা — স্থানীয় ক্রয়" },
  { note: 13, part: 4, kind: "vv", en: "Exempted goods/service — import", bn: "অব্যাহতিপ্রাপ্ত পণ্য/সেবা — আমদানি" },
  { note: 14, part: 4, kind: "vv", en: "Standard-rated goods/service — local purchase", bn: "আদর্শ হারবিশিষ্ট পণ্য/সেবা — স্থানীয় ক্রয়" },
  { note: 15, part: 4, kind: "vv", en: "Standard-rated goods/service — import", bn: "আদর্শ হারবিশিষ্ট পণ্য/সেবা — আমদানি" },
  { note: 16, part: 4, kind: "vv", en: "Goods/service other than standard rate — local purchase", bn: "আদর্শ হার ব্যতীত অন্যান্য হার — স্থানীয় ক্রয়" },
  { note: 17, part: 4, kind: "vv", en: "Goods/service other than standard rate — import", bn: "আদর্শ হার ব্যতীত অন্যান্য হার — আমদানি" },
  { note: 18, part: 4, kind: "vv", en: "Goods/service based on specific VAT — local purchase", bn: "সুনির্দিষ্ট করভিত্তিক পণ্য/সেবা — স্থানীয় ক্রয়" },
  { note: 19, part: 4, kind: "vv", en: "Not admissible for credit — from turnover-tax units", bn: "রেয়াত গ্রহণযোগ্য নয় — টার্নওভার করভুক্ত ইউনিট হতে" },
  { note: 20, part: 4, kind: "vv", en: "Not admissible for credit — from unregistered entities", bn: "রেয়াত গ্রহণযোগ্য নয় — অনিবন্ধিত ব্যক্তি হতে" },
  { note: 21, part: 4, kind: "vv", en: "Not admissible for credit (others) — local purchase", bn: "রেয়াত গ্রহণযোগ্য নয় (অন্যান্য) — স্থানীয় ক্রয়" },
  { note: 22, part: 4, kind: "vv", en: "Not admissible for credit (others) — import", bn: "রেয়াত গ্রহণযোগ্য নয় (অন্যান্য) — আমদানি" },
  { note: 23, part: 4, kind: "vv", total: true, en: "Total input tax credit", bn: "মোট উপকরণ কর রেয়াত" },
  { note: 24, part: 5, kind: "amount", en: "Due to VAT deducted at source by the supply receiver", bn: "সরবরাহ গ্রহণকারী কর্তৃক উৎসে কর্তনের কারণে" },
  { note: 25, part: 5, kind: "amount", en: "Payment not made through banking channel", bn: "ব্যাংকিং চ্যানেলে মূল্য পরিশোধ না করার কারণে" },
  { note: 26, part: 5, kind: "amount", en: "Issuance of debit note", bn: "ডেবিট নোট ইস্যুর কারণে" },
  { note: 27, part: 5, kind: "amount", en: "Any other adjustments", bn: "অন্য কোনো সমন্বয়" },
  { note: 28, part: 5, kind: "amount", total: true, en: "Total increasing adjustment", bn: "মোট বৃদ্ধিকারী সমন্বয়" },
  { note: 29, part: 6, kind: "amount", en: "Due to VAT deducted at source from the supplies delivered", bn: "সরবরাহকৃত পণ্য/সেবার উপর উৎসে কর্তনের কারণে" },
  { note: 30, part: 6, kind: "amount", en: "Advance tax paid at import stage", bn: "আমদানি পর্যায়ে পরিশোধিত আগাম কর" },
  { note: 31, part: 6, kind: "amount", en: "Issuance of credit note", bn: "ক্রেডিট নোট ইস্যুর কারণে" },
  { note: 32, part: 6, kind: "amount", en: "Any other adjustments", bn: "অন্য কোনো সমন্বয়" },
  { note: 33, part: 6, kind: "amount", total: true, en: "Total decreasing adjustment", bn: "মোট হ্রাসকারী সমন্বয়" },
  { note: 34, part: 7, kind: "amount", formula: "9c − 23b + 28 − 33", en: "Net payable VAT for the tax period (section 45)", bn: "কর মেয়াদে নিট প্রদেয় মূসক (ধারা ৪৫)" },
  { note: 35, part: 7, kind: "amount", formula: "34 − (52 + 56)", en: "Net payable VAT after adjustment with closing balance and form 18.6 balance", bn: "সমাপনী জের ও মূসক-১৮.৬ এর জের সমন্বয়ের পর নিট প্রদেয় মূসক" },
  { note: 36, part: 7, kind: "amount", formula: "9b + 38 − (39 + 40)", en: "Net payable supplementary duty (before adjustment with closing balance)", bn: "নিট প্রদেয় সম্পূরক শুল্ক (সমাপনী জের সমন্বয়ের পূর্বে)" },
  { note: 37, part: 7, kind: "amount", formula: "36 − (53 + 57)", en: "Net payable supplementary duty after adjustment with closing balance", bn: "সমাপনী জের সমন্বয়ের পর নিট প্রদেয় সম্পূরক শুল্ক" },
  { note: 38, part: 7, kind: "amount", en: "Increasing adjustment of supplementary duty", bn: "সম্পূরক শুল্কের বৃদ্ধিকারী সমন্বয়" },
  { note: 39, part: 7, kind: "amount", en: "Decreasing adjustment of supplementary duty", bn: "সম্পূরক শুল্কের হ্রাসকারী সমন্বয়" },
  { note: 40, part: 7, kind: "amount", en: "Supplementary duty paid on inputs against exports", bn: "রপ্তানির বিপরীতে উপকরণে পরিশোধিত সম্পূরক শুল্ক" },
  { note: 41, part: 7, kind: "amount", en: "Interest on overdue VAT (based on note 35)", bn: "বকেয়া মূসকের উপর সুদ (নোট ৩৫ ভিত্তিক)" },
  { note: 42, part: 7, kind: "amount", en: "Interest on overdue SD (based on note 37)", bn: "বকেয়া সম্পূরক শুল্কের উপর সুদ (নোট ৩৭ ভিত্তিক)" },
  { note: 43, part: 7, kind: "amount", en: "Fine/penalty for non-submission of return", bn: "রিটার্ন দাখিল না করার জন্য জরিমানা" },
  { note: 44, part: 7, kind: "amount", en: "Other fine/penalty/interest", bn: "অন্যান্য জরিমানা/দণ্ড/সুদ" },
  { note: 45, part: 7, kind: "amount", en: "Payable excise duty", bn: "প্রদেয় আবগারি শুল্ক" },
  { note: 46, part: 7, kind: "amount", en: "Payable development surcharge", bn: "প্রদেয় উন্নয়ন সারচার্জ" },
  { note: 47, part: 7, kind: "amount", en: "Payable ICT development surcharge", bn: "প্রদেয় তথ্য প্রযুক্তি উন্নয়ন সারচার্জ" },
  { note: 48, part: 7, kind: "amount", en: "Payable health care surcharge", bn: "প্রদেয় স্বাস্থ্য সুরক্ষা সারচার্জ" },
  { note: 49, part: 7, kind: "amount", en: "Payable environmental protection surcharge", bn: "প্রদেয় পরিবেশ সুরক্ষা সারচার্জ" },
  { note: 50, part: 7, kind: "amount", total: true, formula: "35 + 41 + 43 + 44", en: "Net payable VAT for treasury deposit", bn: "ট্রেজারিতে জমাতব্য নিট প্রদেয় মূসক" },
  { note: 51, part: 7, kind: "amount", total: true, formula: "37 + 42", en: "Net payable SD for treasury deposit", bn: "ট্রেজারিতে জমাতব্য নিট প্রদেয় সম্পূরক শুল্ক" },
  { note: 52, part: 7, kind: "amount", en: "Closing balance of last tax period (VAT)", bn: "বিগত কর মেয়াদের সমাপনী জের (মূসক)" },
  { note: 53, part: 7, kind: "amount", en: "Closing balance of last tax period (SD)", bn: "বিগত কর মেয়াদের সমাপনী জের (সম্পূরক শুল্ক)" },
  { note: 54, part: 8, kind: "amount", en: "Remaining balance (VAT) from Mushak-18.6 [rule 118(5)]", bn: "মূসক-১৮.৬ হতে অবশিষ্ট জের (মূসক) [বিধি ১১৮(৫)]" },
  { note: 55, part: 8, kind: "amount", en: "Remaining balance (SD) from Mushak-18.6 [rule 118(5)]", bn: "মূসক-১৮.৬ হতে অবশিষ্ট জের (সম্পূরক শুল্ক) [বিধি ১১৮(৫)]" },
  { note: 56, part: 8, kind: "amount", en: "Decreasing adjustment for note 54 (up to 30% of note 34)", bn: "নোট ৫৪ এর হ্রাসকারী সমন্বয় (নোট ৩৪ এর সর্বোচ্চ ৩০%)" },
  { note: 57, part: 8, kind: "amount", en: "Decreasing adjustment for note 55 (up to 30% of note 36)", bn: "নোট ৫৫ এর হ্রাসকারী সমন্বয় (নোট ৩৬ এর সর্বোচ্চ ৩০%)" },
  { note: 58, part: 9, kind: "amount", en: "VAT deposit for the current tax period", bn: "চলতি কর মেয়াদের মূসক জমা" },
  { note: 59, part: 9, kind: "amount", en: "SD deposit for the current tax period", bn: "চলতি কর মেয়াদের সম্পূরক শুল্ক জমা" },
  { note: 60, part: 9, kind: "amount", en: "Excise duty", bn: "আবগারি শুল্ক" },
  { note: 61, part: 9, kind: "amount", en: "Development surcharge", bn: "উন্নয়ন সারচার্জ" },
  { note: 62, part: 9, kind: "amount", en: "ICT development surcharge", bn: "তথ্য প্রযুক্তি উন্নয়ন সারচার্জ" },
  { note: 63, part: 9, kind: "amount", en: "Health care surcharge", bn: "স্বাস্থ্য সুরক্ষা সারচার্জ" },
  { note: 64, part: 9, kind: "amount", en: "Environmental protection surcharge", bn: "পরিবেশ সুরক্ষা সারচার্জ" },
  { note: 65, part: 10, kind: "amount", total: true, formula: "58 − (50 + 67)", en: "Closing balance (VAT)", bn: "সমাপনী জের (মূসক)" },
  { note: 66, part: 10, kind: "amount", total: true, formula: "59 − (51 + 68)", en: "Closing balance (SD)", bn: "সমাপনী জের (সম্পূরক শুল্ক)" },
  { note: 67, part: 11, kind: "amount", en: "Requested amount for refund (VAT)", bn: "ফেরতের জন্য আবেদনকৃত অর্থ (মূসক)" },
  { note: 68, part: 11, kind: "amount", en: "Requested amount for refund (SD)", bn: "ফেরতের জন্য আবেদনকৃত অর্থ (সম্পূরক শুল্ক)" },
]
export const noteDef = (n: number) => RETURN_NOTES.find((x) => x.note === n)

/* ── Tax periods ───────────────────────────────────────────────────────── */

/** "2026-09-14" → "2026-09" */
export const periodOf = (date: string) => date.slice(0, 7)
/** Return (and treasury) due date: 15th of the following month. */
export function returnDue(period: string) {
  const [y, m] = period.split("-").map(Number)
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-15`
}
/** Last day of the period. */
export function periodEnd(period: string) {
  const [y, m] = period.split("-").map(Number)
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`
}
export function prevPeriod(period: string) {
  const [y, m] = period.split("-").map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`
}
/** Months from `first` to `last` inclusive, newest first (sorted & de-duplicated — legacy D-15). */
export function periodsBetween(first: string, last: string) {
  const out: string[] = []
  for (let p = last; p >= first; p = prevPeriod(p)) out.push(p)
  return out
}
/** "2026-09" → "09-2026" (the way NBR writes a tax period) */
export const periodLabel = (p: string) => `${p.slice(5, 7)}-${p.slice(0, 4)}`
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
