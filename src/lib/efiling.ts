import { round2 } from "./vat"
import type { Company, ComplianceSummary, Purchase, Sale, TreasuryDeposit, VdsEntry, VatReturn } from "./types"

/**
 * R7.5 — the e-filing document: the 9.1's figures as one machine-readable JSON, named the way the VAT
 * portal asks for them (BIN, tax period, output/input VAT, rate-wise turnover, TR-6 deposits with their
 * economic codes), so a filer can key the return — or feed a bulk upload — without re-reading the books.
 *
 * There is no published open schema for NBR's portal, so this is DiziVAT's own stable format
 * (`dizivat-efiling-9.1/1`): versioned, deterministic apart from `generatedAt`, and derived entirely from
 * the same compliance answer and invoice registers both runtimes already serve — never a second
 * computation. The same document is also a member of the monthly compliance pack.
 */

/** What the document reads: the collections whose period rows it lists, and the 9.1 row of the period. */
export interface EfilingSource {
  sales: Sale[]; purchases: Purchase[]; treasury: TreasuryDeposit[]; vds: VdsEntry[]; returns: VatReturn[]
}

export interface EfilingDocument {
  format: "dizivat-efiling-9.1/1"
  generatedAt: string
  software: string
  taxpayer: { name: string; bin: string }
  taxPeriod: string
  dueDate: string
  returnStatus: ComplianceSummary["status"]
  submissionDate?: string
  ackNo?: string
  /** the 9.1's own boxes — the compliance answer's computation verbatim, plus the registers' mode splits */
  figures: Record<string, number>
  /** rate-wise turnover of the period's approved invoices, for the portal's rate boxes and bulk uploads */
  salesByVatRate: { rate: number; value: number; vat: number; invoices: number }[]
  purchasesByVatRate: { rate: number; value: number; vat: number; invoices: number }[]
  /** the period's TR-6 challans as deposited — the proof behind `figures.depositedVat` */
  deposits: { challanNo: string; challanDate: string; economicCode: string; head: string; amount: number; mode: string; status: string }[]
  registers: {
    sales: { count: number; value: number; sd: number; vat: number; file: string }
    purchases: { count: number; value: number; sd: number; vat: number; rebate: number; file: string }
  }
  vds: { toIssue: number; toIssueAmount: number; issueBy?: string; awaited: number; awaitedAmount: number }
  /** what to key where — short, plain, in filing order */
  toKey: string[]
}

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

export function efilingDocument(period: string, src: EfilingSource, company: Company,
  extra: { summary: ComplianceSummary; software: string; generatedAt?: string }): EfilingDocument {
  const inP = (d: string) => d.slice(0, 7) === period
  const sales = src.sales.filter((s) => inP(s.issueDate))
  const purchases = src.purchases.filter((p) => inP(p.issueDate))
  const tr6 = src.treasury.filter((t) => t.taxPeriod === period)
  // the return's own basis: approved documents only — drafts stay in `figures.draftDocumentsNotCounted`
  const okSales = sales.filter((s) => s.process === "Approved")
  const okPurchases = purchases.filter((p) => p.process === "Approved")

  const c = extra.summary.computation
  const figures: Record<string, number> = {
    // the computation, verbatim — the 9.1's bottom line
    outputVat: c.outputVat, inputTaxCredit: c.inputVat,
    increasingAdjustments: c.increasing, decreasingAdjustments: c.decreasing,
    netVat: c.netVat, payableVat: c.payableVat, payableSd: c.payableSd,
    depositedVat: c.depositedVat, shortfallVat: c.shortVat, shortfallSd: c.shortSd,
    openingCredit: c.openingVat, closingCredit: c.closingVat,
    draftDocumentsNotCounted: c.drafts,
    // the registers' own mode splits (approved invoices, the return's basis)
    localPurchaseValue: sum(okPurchases.filter((p) => p.mode === "Local").map((p) => p.subtotal)),
    localPurchaseVat: sum(okPurchases.filter((p) => p.mode === "Local").map((p) => p.vat)),
    importedPurchaseValue: sum(okPurchases.filter((p) => p.mode === "Foreign").map((p) => p.subtotal)),
    importedPurchaseVat: sum(okPurchases.filter((p) => p.mode === "Foreign").map((p) => p.vat)),
    nonRegisteredPurchaseValue: sum(okPurchases.filter((p) => p.mode === "Non-registered").map((p) => p.subtotal)),
    nonRegisteredPurchaseVat: sum(okPurchases.filter((p) => p.mode === "Non-registered").map((p) => p.vat)),
    localSaleValue: sum(okSales.filter((s) => s.mode === "Local").map((s) => s.subtotal)),
    localSaleVat: sum(okSales.filter((s) => s.mode === "Local").map((s) => s.vat)),
    exportValue: sum(okSales.filter((s) => s.mode === "Foreign").map((s) => s.subtotal)),
  }

  const byRate = (docs: (Sale | Purchase)[]) => {
    const buckets = new Map<number, { value: number; vat: number }>()
    const seen = new Map<number, Set<string>>()
    for (const d of docs) {
      for (const l of d.lines) {
        const b = buckets.get(l.vatRate) ?? { value: 0, vat: 0 }
        b.value = round2(b.value + l.subtotal); b.vat = round2(b.vat + l.vat)
        buckets.set(l.vatRate, b)
        const s = seen.get(l.vatRate) ?? new Set<string>()
        s.add(d.id); seen.set(l.vatRate, s)
      }
    }
    return [...buckets.entries()].map(([rate, b]) => ({ rate, ...b, invoices: seen.get(rate)?.size ?? 0 }))
      .sort((x, y) => y.rate - x.rate)
  }
  const salesByVatRate = byRate(okSales)
  const purchasesByVatRate = byRate(okPurchases)

  const doc: EfilingDocument = {
    format: "dizivat-efiling-9.1/1",
    generatedAt: extra.generatedAt ?? new Date().toISOString(),
    software: extra.software,
    taxpayer: { name: company.name, bin: company.bin },
    taxPeriod: period,
    dueDate: extra.summary.due,
    returnStatus: extra.summary.status,
    submissionDate: extra.summary.submissionDate,
    ackNo: extra.summary.ackNo,
    figures,
    salesByVatRate,
    purchasesByVatRate,
    deposits: tr6.map((t) => ({ challanNo: t.challanNo, challanDate: t.challanDate, economicCode: t.code, head: t.head, amount: t.amount, mode: t.mode, status: t.process })),
    registers: {
      sales: { count: sales.length, value: sum(sales.map((s) => s.subtotal)), sd: sum(sales.map((s) => s.sd)), vat: sum(sales.map((s) => s.vat)), file: `mushak-6.2-sales-${period}.csv` },
      purchases: { count: purchases.length, value: sum(purchases.map((p) => p.subtotal)), sd: sum(purchases.map((p) => p.sd)), vat: sum(purchases.map((p) => p.vat)), rebate: sum(purchases.map((p) => p.rebate)), file: `mushak-6.1-purchases-${period}.csv` },
    },
    vds: { toIssue: extra.summary.vds.toIssue, toIssueAmount: extra.summary.vds.toIssueAmount,
      issueBy: extra.summary.vds.issueBy, awaited: extra.summary.vds.awaited, awaitedAmount: extra.summary.vds.awaitedAmount },
    toKey: [
      `Sign in to the VAT portal with BIN ${company.bin} and open the ${period} Mushak 9.1.`,
      `Key figures.outputVat / inputTaxCredit (and the adjustments) into the return's boxes; the rate-wise turnover is in salesByVatRate / purchasesByVatRate.`,
      `Upload or key the invoice details from the registers in the compliance pack (${`mushak-6.2-sales-${period}.csv`}, ${`mushak-6.1-purchases-${period}.csv`}).`,
      tr6.length ? `Match the deposits against the TR-6 challans listed in deposits (economic codes included).` : `No TR-6 challan is recorded for this period — deposit any shortfall before submitting.`,
      `Drafts dated in the period are not counted (figures.draftDocumentsNotCounted) — approve or cancel them first.`,
    ],
  }
  return doc
}
