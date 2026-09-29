import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { amountInWords, fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { Sale } from "@/lib/types"

/**
 * Mushak-6.3 (Tax Invoice) — layout per VAT & SD Rules 2016, rule 40(1)(c)&(f).
 * Rendered as HTML + print CSS today (A4); the same template will feed Gotenberg for server PDFs.
 * Statutory labels are always Bangla with English sub-labels regardless of UI language.
 */
export function Mushak63({ sale }: { sale: Sale }) {
  const company = useCompany()
  // NBR 6.3 prints the address of the branch that issued the invoice (S4-04)
  const { data: profile } = useQuery({ queryKey: ["company"], queryFn: api.company.get, staleTime: 5 * 60_000 })
  const branch = profile?.branches.find((b) => b.id === sale.branchId)
  const issueAddress = branch ? `${branch.name} — ${branch.address}` : company.address
  const m = (n: number) => fmtMoney(n, "en")
  const L = ({ bn, en }: { bn: string; en: string }) => (
    <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  )
  const cols: [string, string][] = [
    ["ক্রমিক সংখ্যা", "Sl."], ["পণ্য বা সেবার বর্ণনা (প্রযোজ্য ক্ষেত্রে ব্র্যান্ড নামসহ)", "Description of goods/services"], ["সরবরাহের একক", "Unit"],
    ["পরিমাণ", "Quantity"], ["একক মূল্য¹ (টাকায়)", "Unit price (Tk)"], ["মোট মূল্য¹ (টাকায়)", "Total price (Tk)"], ["সম্পূরক শুল্কের হার", "SD rate"],
    ["সম্পূরক শুল্কের পরিমাণ (টাকায়)", "SD amount (Tk)"], ["মূল্য সংযোজন করের হার/ সুনির্দিষ্ট কর", "VAT rate / specific tax"],
    ["মূল্য সংযোজন কর/ সুনির্দিষ্ট কর এর পরিমাণ (টাকায়)", "VAT / specific tax amount (Tk)"], ["সকল প্রকার শুল্ক ও করসহ মূল্য", "Value incl. all duties & taxes"],
  ]
  return (
    <article className="print-area relative overflow-hidden mx-auto w-full max-w-[210mm] bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 6.3 tax invoice">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৬.৩</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">কর চালানপত্র</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) ও দফা (চ) দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Tax Invoice — Rule 40(1)(c) &amp; (f), VAT &amp; SD Rules 2016</p>
      </header>

      <section className="mb-4 grid gap-1 border-y border-neutral-300 py-2 text-center">
        <p><span lang="bn">নিবন্ধিত ব্যক্তির নাম</span> / Registered person: <strong>{company.name}</strong></p>
        <p><span lang="bn">নিবন্ধিত ব্যক্তির বিআইএন</span> / BIN: <strong className="tabular">{company.bin}</strong></p>
        <p><span lang="bn">চালানপত্র ইস্যুর ঠিকানা</span> / Address of issue: {issueAddress}</p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="ক্রেতার নাম" en="Buyer" /></dt><dd className="font-semibold">{sale.customerName}</dd>
          <dt><L bn="ক্রেতার বিআইএন" en="Buyer BIN" /></dt><dd className="tabular">{sale.customerBin}</dd>
          <dt><L bn="সরবরাহের গন্তব্যস্থল" en="Destination of supply" /></dt><dd>{sale.deliveryAddress}</dd>
          <dt><L bn="যানবাহনের প্রকৃতি ও নম্বর" en="Vehicle type & no." /></dt><dd>{sale.vehicle || "—"}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt><L bn="চালানপত্র নম্বর" en="Invoice no." /></dt><dd className="font-semibold tabular">{sale.challanNo} <span className="font-normal text-neutral-500">({sale.invoiceNo})</span></dd>
          <dt><L bn="ইস্যুর তারিখ" en="Date of issue" /></dt><dd className="tabular">{fmtDate(sale.issueDate, "en", "dd/MM/yyyy")}</dd>
          <dt><L bn="ইস্যুর সময়" en="Time of issue" /></dt><dd className="tabular">{sale.issueTime}</dd>
        </dl>
      </section>

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[680px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead>
            <tr>{cols.map(([bn, en], i) => <th key={i} scope="col" className="border border-neutral-400 bg-neutral-100 p-1 align-top font-semibold print:bg-neutral-100"><span lang="bn" className="block">{bn}</span><span className="block font-normal text-neutral-500">{en}</span></th>)}</tr>
            <tr>{cols.map((_, i) => <th key={i} className="border border-neutral-400 p-0.5 text-center font-normal text-neutral-500">({fmtNum(i + 1, "bn")})</th>)}</tr>
          </thead>
          <tbody>
            {sale.lines.map((l, i) => (
              <tr key={i} className="tabular">
                <td className="border border-neutral-400 p-1 text-center">{i + 1}</td>
                <td className="border border-neutral-400 p-1">{l.name}<span className="block text-[0.625rem] text-neutral-500">{sale.category === "service" ? "Service code" : "HS"} {l.hsCode}{l.batchNo ? ` · Batch ${l.batchNo}` : ""}</span></td>
                <td className="border border-neutral-400 p-1 text-center">{l.uom}</td>
                <td className="border border-neutral-400 p-1 text-right">{fmtNum(l.qty, "en", 2)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.price)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.subtotal)}</td>
                <td className="border border-neutral-400 p-1 text-right">{l.sdRate}%</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.sd)}</td>
                <td className="border border-neutral-400 p-1 text-right">{l.vatRate}%</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.vat)}</td>
                <td className="border border-neutral-400 p-1 text-right font-medium">{m(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold">
            <tr>
              <td colSpan={5} className="border border-neutral-400 p-1 text-right"><span lang="bn">সর্বমোট</span> / Total</td>
              <td className="border border-neutral-400 p-1 text-right">{m(sale.subtotal)}</td>
              <td className="border border-neutral-400 p-1" />
              <td className="border border-neutral-400 p-1 text-right">{m(sale.sd)}</td>
              <td className="border border-neutral-400 p-1" />
              <td className="border border-neutral-400 p-1 text-right">{m(sale.vat)}</td>
              <td className="border border-neutral-400 p-1 text-right">{m(sale.subtotal + sale.sd + sale.vat)}</td>
            </tr>
            {sale.discount > 0 && (
              <tr><td colSpan={10} className="border border-neutral-400 p-1 text-right font-normal">Less discount</td><td className="border border-neutral-400 p-1 text-right">({m(sale.discount)})</td></tr>
            )}
            {sale.discount > 0 && (
              <tr><td colSpan={10} className="border border-neutral-400 p-1 text-right">Net payable</td><td className="border border-neutral-400 p-1 text-right">{m(sale.netTotal)}</td></tr>
            )}
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[0.6875rem]"><strong>In words:</strong> {amountInWords(sale.netTotal)}</p>
      {sale.mode === "Foreign" && !sale.export?.deemed && <p className="mt-1 text-[0.6875rem]">Zero-rated export supply (VAT 0%) under the First Schedule, VAT &amp; SD Act 2012.</p>}
      {sale.export?.deemed && <p className="mt-1 text-[0.6875rem]">Deemed export — zero-rated local supply against back-to-back LC {sale.export.lcNo} ({fmtDate(sale.export.lcDate, "en", "dd/MM/yyyy")}).</p>}
      {sale.export && !sale.export.deemed && <p className="mt-1 text-[0.6875rem] tabular">LC {sale.export.lcNo} ({fmtDate(sale.export.lcDate, "en", "dd/MM/yyyy")}) · Bill of Export {sale.export.billNo}{sale.export.billDate ? ` (${fmtDate(sale.export.billDate, "en", "dd/MM/yyyy")})` : ""} · {sale.export.country}</p>}

      <footer className="mt-10 grid grid-cols-2 gap-8">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="প্রতিষ্ঠান কর্তৃপক্ষের দায়িত্বপ্রাপ্ত ব্যক্তির নাম" en="Authorised person" /></dt><dd className="self-end">{sale.issuedBy}</dd>
          <dt><L bn="পদবি" en="Designation" /></dt><dd className="self-end">{sale.designation}</dd>
        </dl>
        <div className="flex flex-col items-end justify-end gap-1">
          <div className="h-10 w-48 border-b border-neutral-500" />
          <span><span lang="bn">স্বাক্ষর ও সিল</span> / Signature &amp; seal</span>
        </div>
      </footer>
      <div className="mt-6 grid gap-0.5 border-t border-neutral-300 pt-2 text-[0.625rem] text-neutral-600">
        <p lang="bn">¹ সকল প্রকার কর ব্যতীত মূল্য।</p>
        {sale.vds && <p lang="bn">* উৎসে কর্তনযোগ্য সরবরাহের ক্ষেত্রে ফরমটি সমন্বিত কর চালানপত্র ও উৎসে কর কর্তন সনদপত্র হিসেবে বিবেচিত হইবে এবং উহা উৎসে কর কর্তনযোগ্য সরবরাহের ক্ষেত্রে প্রযোজ্য হইবে।</p>}
        <p>Generated by DiziVAT · {company.name} · {sale.process === "Approved" ? "Approved" : "DRAFT – not valid until approved"}</p>
      </div>
      {sale.process !== "Approved" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-7xl font-bold text-neutral-900/[0.06]">{sale.process === "Cancelled" ? "CANCELLED" : "DRAFT"}</span>
        </div>
      )}
    </article>
  )
}
