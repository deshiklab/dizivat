import { format as dfFormat, parseISO } from "date-fns"
import { bn as bnLocale } from "date-fns/locale/bn"

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(locale: string, opts: Intl.NumberFormatOptions) {
  const key = locale + JSON.stringify(opts)
  let f = nfCache.get(key)
  if (!f) {
    // en → en-IN gives lakh/crore grouping (12,34,567.00); bn → bn-BD gives Bengali digits with lakh grouping
    f = new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-IN", opts)
    nfCache.set(key, f)
  }
  return f
}

export const fmtMoney = (n: number | null | undefined, locale = "en") =>
  nf(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)

/** Whole numbers stay clean (1,250); fractional values are padded to `digits` so a column never mixes 6,608.4 with 5,384.81 */
export const fmtNum = (n: number | null | undefined, locale = "en", digits = 0) => {
  const v = n ?? 0
  const whole = Math.abs(v - Math.round(v)) < 0.5 * 10 ** -digits
  return nf(locale, { minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: digits }).format(v)
}

/** 1.62 Cr / 16.2 L / 45.3K — for KPI cards and chart axes */
export function fmtCompact(n: number, locale = "en") {
  const abs = Math.abs(n)
  const f = (v: number, s: string) => `${nf(locale, { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 }).format(v)}${s}`
  // U+00A0 so "3.66 Cr" never wraps between number and unit
  const cr = locale === "bn" ? "\u00a0কোটি" : "\u00a0Cr"
  const lk = locale === "bn" ? "\u00a0লাখ" : "\u00a0L"
  const k = locale === "bn" ? "\u00a0হা" : "K"
  if (abs >= 1e7) return f(n / 1e7, cr)
  if (abs >= 1e5) return f(n / 1e5, lk)
  if (abs >= 1e3) return f(n / 1e3, k)
  return f(n, "")
}

export const fmtPct = (n: number, locale = "en") => nf(locale, { maximumFractionDigits: 1 }).format(n) + "%"

export function fmtDate(iso: string | undefined | null, locale = "en", pattern = "dd MMM yyyy") {
  if (!iso) return "—"
  const d = iso.length <= 10 ? parseISO(iso) : new Date(iso)
  if (locale !== "bn") return dfFormat(d, pattern)
  return toBnDigits(dfFormat(d, pattern, { locale: bnLocale }))
}

const BN = "০১২৩৪৫৬৭৮৯"
export const toBnDigits = (s: string) => s.replace(/[0-9]/g, (c) => BN[Number(c)])

export const toISODate = (d: Date) => dfFormat(d, "yyyy-MM-dd")

/** Bangladesh fiscal year label (Jul–Jun) */
export function fiscalYear(iso: string) {
  const d = parseISO(iso)
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}

/** Amount in words (BDT, lakh/crore system) for printed Mushak documents */
export function amountInWords(n: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`)
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x))
  const words = (x: number): string => {
    if (x === 0) return "Zero"
    const parts: string[] = []
    const crore = Math.floor(x / 1e7); x %= 1e7
    const lakh = Math.floor(x / 1e5); x %= 1e5
    const thousand = Math.floor(x / 1e3); x %= 1e3
    if (crore) parts.push(`${words(crore)} Crore`)
    if (lakh) parts.push(`${two(lakh)} Lakh`)
    if (thousand) parts.push(`${two(thousand)} Thousand`)
    if (x) parts.push(three(x))
    return parts.join(" ")
  }
  const taka = Math.floor(n)
  const paisa = Math.round((n - taka) * 100)
  return `Taka ${words(taka)}${paisa ? ` and ${two(paisa)} Paisa` : ""} Only`
}

/** UTC instant → "25 Sep 2026 14:05" in Bangladesh time (UTC+6), whatever the browser's zone. */
export function fmtDateTime(iso: string | undefined | null, locale = "en") {
  if (!iso) return "—"
  const d = new Date(iso)
  const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })
  const hm = d.toLocaleTimeString(locale === "bn" ? "bn-BD" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Dhaka" }) // 24 h in both locales — bn CLDR would print a Latin "PM"
  return `${fmtDate(day, locale)} ${hm}`
}

/** "76071110" → "7607.11.10" (as printed in the NBR schedule) */
export const fmtHs = (hs: string) => (hs.length === 8 ? `${hs.slice(0, 4)}.${hs.slice(4, 6)}.${hs.slice(6)}` : hs)
