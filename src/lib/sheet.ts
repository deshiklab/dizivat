/**
 * R6.2 — spreadsheet reading for bulk import, in the browser, without a library:
 *  - CSV (RFC 4180: quoted fields, doubled quotes, CR/LF, a UTF-8 BOM; comma or semicolon separated)
 *  - XLSX (first worksheet): the ZIP container is read from its central directory and entries are inflated with the
 *    platform's DecompressionStream("deflate-raw"); cells are taken from the sheet XML and the shared-strings table.
 * Returns rows as arrays of strings; header mapping happens in `mapRows`.
 */
import type { ImportEntity } from "./types"

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "")
  const firstLine = s.slice(0, s.indexOf("\n") >>> 0)
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ","
  const rows: string[][] = []
  let row: string[] = [], field = "", q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"' && field === "") q = true
    else if (c === sep) { row.push(field); field = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += c
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ""))
}

/* ── XLSX ── */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw")
  const out = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Read the named entries of a ZIP archive (stored or deflated). */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf), u8 = new Uint8Array(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error("notXlsx")
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = new Map<string, string>()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("notXlsx")
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    const lNameLen = v.getUint16(local + 26, true), lExtraLen = v.getUint16(local + 28, true)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = u8.subarray(start, start + size)
    const bytes = method === 0 ? raw : method === 8 ? await inflate(raw) : null
    if (bytes) out.set(name, dec.decode(bytes))
  }
  return out
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }

export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const xml = (s?: string) => (s ? new DOMParser().parseFromString(s, "application/xml") : null)
  const shared = [...(xml(files.get("xl/sharedStrings.xml"))?.getElementsByTagName("si") ?? [])].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "").join(""))
  // first sheet in workbook order → its target via the relationships file
  let target = "xl/worksheets/sheet1.xml"
  const wb = xml(files.get("xl/workbook.xml")), rels = xml(files.get("xl/_rels/workbook.xml.rels"))
  const first = wb?.getElementsByTagName("sheet")[0]
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
  const rel = rid ? [...(rels?.getElementsByTagName("Relationship") ?? [])].find((r) => r.getAttribute("Id") === rid) : undefined
  if (rel) { const t = rel.getAttribute("Target") ?? ""; target = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}` }
  const sheet = xml(files.get(target) ?? [...files.entries()].find(([k]) => k.startsWith("xl/worksheets/"))?.[1])
  if (!sheet) throw new Error("notXlsx")
  const rows: string[][] = []
  for (const r of sheet.getElementsByTagName("row")) {
    const row: string[] = []
    for (const c of r.getElementsByTagName("c")) {
      const ref = c.getAttribute("r"), type = c.getAttribute("t")
      const i = ref ? colIndex(ref) : row.length
      const v = c.getElementsByTagName("v")[0]?.textContent ?? ""
      row[i] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : v
    }
    rows.push(Array.from(row, (x) => x ?? ""))
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""))
}

export async function readSheet(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) return parseXlsx(await file.arrayBuffer())
  if (/\.(csv|txt)$/i.test(file.name)) return parseCsv(await file.text())
  throw new Error("unsupported")
}

/* ── header mapping ── */

export const IMPORT_FIELDS: Record<ImportEntity, string[]> = {
  items: ["name", "sku", "hsCode", "group", "unit", "purchasePrice", "salePrice", "vatRate", "sdRate", "reorderLevel", "active"],
  customers: ["name", "mode", "bin", "country", "mobile", "email", "contactPerson", "address", "exporterType", "bondLicenseNo", "bondLicenseExpiry", "associationNo", "active"],
  vendors: ["name", "mode", "bin", "country", "mobile", "email", "contactPerson", "address", "active"],
}
export const REQUIRED_FIELDS: Record<ImportEntity, string[]> = { items: ["name", "sku", "hsCode", "group", "unit"], customers: ["name", "address"], vendors: ["name", "address"] }

const ALIASES: Record<string, string> = {
  itemname: "name", description: "name", product: "name", partyname: "name", customer: "name", vendor: "name", supplier: "name",
  hs: "hsCode", hscode: "hsCode", hcode: "hsCode", category: "group", itemgroup: "group", uom: "unit", units: "unit",
  code: "sku", itemcode: "sku", productcode: "sku", cost: "purchasePrice", purchaseprice: "purchasePrice", price: "salePrice", saleprice: "salePrice",
  vat: "vatRate", vatrate: "vatRate", sd: "sdRate", sdrate: "sdRate", reorder: "reorderLevel", reorderlevel: "reorderLevel", status: "active",
  type: "mode", registration: "mode", binnid: "bin", nid: "bin", phone: "mobile", contact: "contactPerson", contactperson: "contactPerson",
  exporter: "exporterType", exportertype: "exporterType", bond: "bondLicenseNo", bondlicence: "bondLicenseNo", bondlicense: "bondLicenseNo", bondlicenseno: "bondLicenseNo", bondlicenceno: "bondLicenseNo",
  bondexpiry: "bondLicenseExpiry", bondlicenseexpiry: "bondLicenseExpiry", bondlicenceexpiry: "bondLicenseExpiry", association: "associationNo", associationno: "associationNo", bgmea: "associationNo", bkmea: "associationNo",
}
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Excel stores dates as day serials (1900 system); turn them into YYYY-MM-DD. */
const excelDate = (v: string) => /^\d{5}(\.\d+)?$/.test(v) ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 864e5).toISOString().slice(0, 10) : v

/** Header row → field names; returns the mapped records plus unrecognised and missing required columns. */
export function mapRows(entity: ImportEntity, table: string[][]) {
  const [head = [], ...body] = table
  const fields = IMPORT_FIELDS[entity]
  const byNorm = new Map(fields.map((f) => [norm(f), f]))
  const cols = head.map((h) => { const n = norm(String(h)); const f = byNorm.get(n) ?? ALIASES[n]; return f && fields.includes(f) ? f : null })
  const unknown = head.filter((_, i) => !cols[i]).map(String).filter((h) => h.trim())
  const missing = REQUIRED_FIELDS[entity].filter((f) => !cols.includes(f))
  const rows = body.map((r) => {
    const o: Record<string, string> = {}
    cols.forEach((f, i) => { if (f) o[f] = f === "bondLicenseExpiry" ? excelDate(String(r[i] ?? "").trim()) : String(r[i] ?? "").trim() })
    return o
  })
  return { rows, unknown, missing, columns: cols.filter(Boolean) as string[] }
}

/** CSV template for an entity (header + one example row). */
export function templateCsv(entity: ImportEntity): string {
  const ex: Record<ImportEntity, string[]> = {
    items: ["Corrugated export carton, 5-ply", "CTN-5P-01", "48191000", "Finished Goods", "Pcs", "38", "52", "15", "0", "500", "yes"],
    customers: ["SAMPLE KNIT COMPOSITE LTD", "Local", "000000000-0101", "", "01711-000000", "accounts@example.com", "Accounts Manager", "Plot 1, Sample EPZ, Savar, Dhaka", "deemed", "", "", "BKMEA-0000", "yes"],
    vendors: ["SAMPLE TRIMS LTD", "Local", "000000000-0202", "", "01811-000000", "sales@example.com", "Sales Manager", "Road 2, Tongi I/A, Gazipur", "yes"],
  }
  const q = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return [IMPORT_FIELDS[entity].join(","), ex[entity].map(q).join(",")].join("\r\n") + "\r\n"
}
