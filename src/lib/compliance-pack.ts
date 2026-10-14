import { efilingDocument } from "./efiling"
import { toCSV } from "./mock/query"
import type { ComplianceSummary, Company, M610Row, Purchase, Sale, TreasuryDeposit, VdsEntry, VatReturn } from "./types"

/**
 * R7.2 — the monthly compliance pack: one zip with everything a tax period's submission set needs — the two
 * invoice registers, Mushak 6.10, the TR-6 challans and the VDS certificates of the period, the 9.1 return as
 * filed (or its draft computation), and a manifest + checklist that say what is inside and what is still open.
 *
 * Shared by both runtimes: the mock's route and the native controller pass their own copies of the same
 * collections (the mock its in-memory db, the API its tables), the same compliance answer and the same
 * Mushak 6.10 book — so the bytes cannot drift between the two.
 */

/** The zip is written uncompressed (STORED): the members are CSV and JSON, gzip would add little. */
export function zipStore(files: { name: string; content: string }[]): Buffer {
  const enc = new TextEncoder()
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.content)
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)            // version needed
    head.writeUInt16LE(0x0800, 6)        // UTF-8 names
    head.writeUInt16LE(0, 8)             // method: stored
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28)
    chunks.push(head, Buffer.from(name), Buffer.from(data))
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(dosTime, 12); dir.writeUInt16LE(dosDate, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(name.length, 28); dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34); dir.writeUInt16LE(0, 36); dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([dir, Buffer.from(name)]))
    offset += head.length + name.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, cd, end])
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()
const crc32 = (data: Uint8Array) => {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** What the pack reads: the collections its members list, and the 9.1 row of the period. */
export interface PackSource {
  sales: Sale[]; purchases: Purchase[]; treasury: TreasuryDeposit[]; vds: VdsEntry[]; returns: VatReturn[]
}

const csvCell = (v: unknown) => (v === undefined || v === null ? "" : String(v))

/** Deterministic file order: the manifest first, the registers, then the return. */
export function compliancePack(period: string, src: PackSource, company: Company,
  extra: { summary: ComplianceSummary; m610: { rows: M610Row[]; columns: { key: string; label: string }[] } }): Buffer {
  const inP = (d: string) => d.slice(0, 7) === period
  const sales = src.sales.filter((s) => inP(s.issueDate))
  const purchases = src.purchases.filter((p) => inP(p.issueDate))
  const tr6 = src.treasury.filter((t) => t.taxPeriod === period)
  const vds = src.vds.filter((v) => v.taxPeriod === period)
  const ret = src.returns.find((r) => r.period === period) ?? null

  const salesCsv = toCSV(sales, [
    { key: "issueDate", label: "Date" }, { key: "invoiceNo", label: "Invoice" }, { key: "challanNo", label: "Challan" },
    { key: "customerName", label: "Customer" }, { key: "customerBin", label: "BIN" }, { key: "mode", label: "Mode" },
    { key: "subtotal", label: "Value" }, { key: "sd", label: "SD" }, { key: "vat", label: "VAT" }, { key: "netTotal", label: "Total" }, { key: "process", label: "Status" },
  ])
  const purchasesCsv = toCSV(purchases, [
    { key: "issueDate", label: "Date" }, { key: "invoiceNo", label: "Invoice" }, { key: "challanNo", label: "Challan" },
    { key: "vendorName", label: "Vendor" }, { key: "vendorBin", label: "BIN" }, { key: "mode", label: "Mode" },
    { key: "tti", label: "TTI" }, { key: "rebate", label: "Rebate" }, { key: "vat", label: "VAT" }, { key: "netTotal", label: "Total" }, { key: "process", label: "Status" },
  ])
  const tr6Csv = toCSV(tr6, [
    { key: "challanNo", label: "Challan" }, { key: "challanDate", label: "Date" }, { key: "head", label: "Head" }, { key: "code", label: "Economic code" },
    { key: "amount", label: "Amount" }, { key: "mode", label: "Mode" }, { key: "bank", label: "Bank" }, { key: "process", label: "Status" },
  ])
  const vdsCsv = toCSV(vds, [
    { key: "no", label: "VDS no" }, { key: "mode", label: "Mode" }, { key: "docNo", label: "Document" }, { key: "docDate", label: "Document date" },
    { key: "partyName", label: "Party" }, { key: "partyBin", label: "BIN" }, { key: "docValue", label: "Value" }, { key: "amount", label: "VDS withheld" },
    { key: "certificateNo", label: "Certificate" }, { key: "certificateDate", label: "Certificate date" },
  ])

  const c = extra.summary.computation
  const files = [
    { name: `manifest-${period}.json`, content: JSON.stringify({
      period, company: { name: company.name, bin: company.bin },
      summary: extra.summary,
      files: [
        { name: `mushak-6.2-sales-${period}.csv`, rows: sales.length },
        { name: `mushak-6.1-purchases-${period}.csv`, rows: purchases.length },
        { name: `mushak-6.10-${period}.csv`, rows: extra.m610.rows.length },
        { name: `tr-6-${period}.csv`, rows: tr6.length },
        { name: `vds-6.6-${period}.csv`, rows: vds.length },
        { name: `return-9.1-${period}.json`, present: !!ret },
        { name: `efiling-9.1-${period}.json`, present: true },
      ],
    }, null, 2) },
    { name: `checklist-${period}.txt`, content: [
      `Compliance pack — ${period}`,
      `${company.name} · BIN ${company.bin}`,
      "",
      `Return: ${ret ? `${extra.summary.status}${extra.summary.submissionDate ? ` (submitted ${extra.summary.submissionDate}${extra.summary.ackNo ? `, ack ${extra.summary.ackNo}` : ""})` : ""}` : "not started"}`,
      `Due ${extra.summary.due} — ${extra.summary.daysLeft} day(s) left`,
      "",
      `Output VAT ${csvCell(c.outputVat)} · input VAT ${csvCell(c.inputVat)} · net ${csvCell(c.netVat)}`,
      `Payable VAT ${csvCell(c.payableVat)} + SD ${csvCell(c.payableSd)} · deposited ${csvCell(c.depositedVat)} · shortfall VAT ${csvCell(c.shortVat)} / SD ${csvCell(c.shortSd)}`,
      `Drafts counted in: ${c.drafts}`,
      "",
      `TR-6 deposits: ${extra.summary.deposits.count} (${extra.summary.deposits.pending} pending), ${extra.summary.deposits.amount} deposited`,
      `VDS to issue: ${extra.summary.vds.toIssue} (${extra.summary.vds.toIssueAmount})${extra.summary.vds.issueBy ? ` — by ${extra.summary.vds.issueBy}` : ""}`,
      `VDS awaited: ${extra.summary.vds.awaited} (${extra.summary.vds.awaitedAmount})`,
      "",
      "Inside this pack:",
      `  mushak-6.2-sales-${period}.csv        the period's sales invoices (${sales.length})`,
      `  mushak-6.1-purchases-${period}.csv    the period's purchases (${purchases.length})`,
      `  mushak-6.10-${period}.csv             invoices above the 2-lakh limit (${extra.m610.rows.length})`,
      `  tr-6-${period}.csv                    the period's treasury challans (${tr6.length})`,
      `  vds-6.6-${period}.csv                 the period's VDS certificates (${vds.length})`,
      ret ? `  return-9.1-${period}.json           the 9.1 return as it stands` : "  (no 9.1 return started yet — the manifest marks it absent)",
      `  efiling-9.1-${period}.json           the 9.1's figures keyed for the VAT portal`,
    ].join("\r\n") + "\r\n" },
    { name: `mushak-6.2-sales-${period}.csv`, content: salesCsv },
    { name: `mushak-6.1-purchases-${period}.csv`, content: purchasesCsv },
    { name: `mushak-6.10-${period}.csv`, content: toCSV(extra.m610.rows, extra.m610.columns) },
    { name: `tr-6-${period}.csv`, content: tr6Csv },
    { name: `vds-6.6-${period}.csv`, content: vdsCsv },
    { name: `return-9.1-${period}.json`, content: JSON.stringify(ret, null, 2) },
    { name: `efiling-9.1-${period}.json`, content: JSON.stringify(
      efilingDocument(period, src, company, { summary: extra.summary, software: "DiziVAT" }), null, 2) },
  ]
  return zipStore(files)
}
