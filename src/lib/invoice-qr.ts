import type { Sale } from "./types"

/**
 * R8.1 (e-invoicing): the signed verification token printed as a QR on every Mushak 6.3.
 * Finance Bill 2026 lets enlisted ERP software issue the 6.3 — this makes each printed copy verifiable:
 * the QR carries a short URL (`/verify/6.3/<token>`) anyone can scan; the page re-computes the signature
 * server-side (the secret never leaves the server) and compares it with the books.
 *
 * The token is `<invoiceNo>.<YYYYMMDD>.<netTotal poisha>.<vat poisha>.<sig>` where sig is the first 20 hex
 * chars of HMAC-SHA256 over the canonical invoice core — number, date, net total, VAT, the seller's BIN and
 * name. Verification recomputes over the record as it stands NOW, so a copy whose figures were later edited
 * (or a hand-crafted token) fails, while a genuine copy of an unaltered invoice passes even after it is
 * cancelled — the answer says so. No new tables: the signature is deterministic over existing columns.
 */

/** The fields the signature covers — all present on both runtimes' Sale rows. */
export interface InvoiceQrCore {
  invoiceNo: string
  issueDate: string
  netTotal: number
  vat: number
  sellerBin: string
  sellerName: string
}

/** What a verification answers. `altered` = the token itself is genuine but the invoice no longer matches it. */
export type QrVerdict =
  | { valid: true; reason?: undefined }
  | { valid: false; reason: "malformed" | "notFound" | "altered" | "badSignature" }

const SECRET = () => process.env.SESSION_SECRET ?? "dizivat-dev-secret-change-in-production"
const enc = new TextEncoder()

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("")

async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return crypto.subtle.sign("HMAC", key, enc.encode(data))
}

/** The canonical string the signature covers (amounts to the taka, exactly as the books round them). */
export const qrCanonical = (c: InvoiceQrCore) =>
  `dizivat-6.3/1|${c.invoiceNo}|${c.issueDate}|${c.netTotal.toFixed(2)}|${c.vat.toFixed(2)}|${c.sellerBin}|${c.sellerName}`

async function sign(c: InvoiceQrCore) {
  return hex(await hmac(qrCanonical(c))).slice(0, 20)
}

const POIS = (n: number) => String(Math.round(n * 100))

/** The token printed in the QR — async only because WebCrypto is. */
export async function invoiceQrToken(c: InvoiceQrCore): Promise<string> {
  return [c.invoiceNo, c.issueDate.replace(/-/g, ""), POIS(c.netTotal), POIS(c.vat), await sign(c)].join(".")
}

const TOKEN_RE = /^([A-Za-z0-9\/-]{1,40})\.(\d{8})\.(\d{1,15})\.(\d{1,15})\.([0-9a-f]{20})$/

/** Parse a scanned token; null when it is not one of ours at all. */
export function parseQrToken(t: string) {
  const m = TOKEN_RE.exec(t.trim())
  if (!m) return null
  return {
    invoiceNo: m[1],
    issueDate: `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`,
    netTotal: Number(m[3]) / 100,
    vat: Number(m[4]) / 100,
    sig: m[5],
  }
}

/**
 * Verify a token against the invoice as it stands now (null when no such invoice exists — deleted drafts
 * included, so a destroyed document does not verify). Shared by both runtimes' public endpoints.
 */
export async function verifyQrToken(t: string, current: InvoiceQrCore | null): Promise<QrVerdict> {
  const p = parseQrToken(t)
  if (!p) return { valid: false, reason: "malformed" }
  if (!current) return { valid: false, reason: "notFound" }
  // First: is the token a genuine signature of what it claims (not hand-crafted)?
  const claimedSig = await sign({ ...p, sellerBin: current.sellerBin, sellerName: current.sellerName })
  if (claimedSig !== p.sig) return { valid: false, reason: "badSignature" }
  // Then: does the record still say the same thing the copy printed?
  if (current.invoiceNo !== p.invoiceNo || current.issueDate !== p.issueDate
    || Math.abs(current.netTotal - p.netTotal) > 0.005 || Math.abs(current.vat - p.vat) > 0.005)
    return { valid: false, reason: "altered" }
  return { valid: true }
}

/** The core of a sale row, as the signature sees it. */
export const saleQrCore = (s: Pick<Sale, "invoiceNo" | "issueDate" | "netTotal" | "vat">, seller: { bin: string; name: string }): InvoiceQrCore =>
  ({ invoiceNo: s.invoiceNo, issueDate: s.issueDate, netTotal: s.netTotal, vat: s.vat, sellerBin: seller.bin, sellerName: seller.name })

/** The public verification answer document — the same bytes from both runtimes. */
export async function verifyInvoiceAnswer(t: string, sale: Sale | null, seller: { bin: string; name: string }) {
  const v = await verifyQrToken(t, sale ? saleQrCore(sale, seller) : null)
  if (!v.valid || !sale) return { token: t, ...v }
  return {
    token: t, ...v,
    invoice: {
      invoiceNo: sale.invoiceNo, issueDate: sale.issueDate, process: sale.process, category: sale.category ?? "goods",
      seller: { name: seller.name, bin: seller.bin },
      buyer: { name: sale.customerName, bin: sale.customerBin },
      netTotal: sale.netTotal, vat: sale.vat, currency: "BDT",
    },
  }
}
