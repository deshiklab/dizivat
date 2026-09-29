import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtMoney } from "@/lib/format"
import type { VdsEntry } from "@/lib/types"

/**
 * Mushak-6.6 — certificate of VAT deducted at source, VAT & SD Rules 2016 rule 40(1)(f). The withholding entity issues it to
 * the supplier. Purchase VDS: we are the withholding entity. Sales VDS: the customer issued it to us (copy for our records).
 */
export function Mushak66({ v }: { v: VdsEntry }) {
  const company = useCompany()
  const m = (n: number) => fmtMoney(n, "en")
  const withholder = v.mode === "purchase" ? { name: company.name, address: company.address, bin: company.bin } : { name: v.partyName, address: v.partyAddress, bin: v.partyBin }
  const supplier = v.mode === "purchase" ? { name: v.partyName, bin: v.partyBin } : { name: company.name, bin: company.bin }
  const L = ({ bn, en }: { bn: string; en: string }) => <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  const cols: [string, string][] = [
    ["ক্রমিক সংখ্যা", "Sl."], ["সরবরাহকারীর নাম", "Supplier"], ["সরবরাহকারীর বিআইএন", "Supplier BIN"], ["কর চালানপত্র নম্বর", "Tax invoice no"],
    ["কর চালানপত্র ইস্যুর তারিখ", "Invoice date"], ["মোট সরবরাহ মূল্য", "Value of supply"], ["মূসকের পরিমাণ", "VAT"], ["উৎসে কর্তনকৃত মূসকের পরিমাণ", "VAT deducted at source"],
  ]
  const cell = "border border-neutral-400 px-2 py-1.5 align-top"
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 6.6 VDS certificate">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৬.৬</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">উৎসে কর কর্তন সনদপত্র</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (চ) দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Certificate of VAT deducted at source — Rule 40(1)(f), VAT &amp; SD Rules 2016</p>
      </header>
      <section className="mb-4 grid gap-1 border-y border-neutral-300 py-2">
        <p><span lang="bn">উৎসে কর কর্তনকারী সত্তার নাম</span> / Withholding entity: <strong>{withholder.name}</strong></p>
        <p><span lang="bn">ঠিকানা</span> / Address: {withholder.address}</p>
        <p><span lang="bn">বিআইএন (প্রযোজ্য ক্ষেত্রে)</span> / BIN: <span className="tabular">{withholder.bin}</span></p>
        <div className="mt-1 flex flex-wrap justify-between gap-2">
          <p><span lang="bn">উৎসে কর কর্তন সনদপত্র নং</span> / Certificate no: <strong className="tabular">{v.certificateNo || v.no}</strong></p>
          <p><span lang="bn">জারির তারিখ</span> / Issue date: <strong className="tabular">{fmtDate(v.certificateDate, "en")}</strong></p>
        </div>
      </section>
      <p className="mb-2" lang="bn">এতদ্বারা প্রত্যয়ন করা যাইতেছে যে, আইনের ধারা ৪৯ অনুযায়ী উৎসে কর কর্তনযোগ্য সরবরাহ হইতে প্রযোজ্য মূসক বাবদ উৎসে কর কর্তন করা হইল। কর্তনকৃত মূসকের অর্থ বুক ট্রান্সফার/ট্রেজারি চালান/দাখিলপত্রে বৃদ্ধিকারী সমন্বয়ের মাধ্যমে সরকারি কোষাগারে জমা প্রদান করা হইয়াছে।</p>
      <p className="mb-3 text-[0.6875rem] text-neutral-500">Certified that VAT has been deducted at source under section 49 of the Act from the supplies below and deposited to the government treasury.</p>
      <table className="w-full border-collapse">
        <thead><tr className="bg-neutral-100 text-left">{cols.map(([bn, en]) => <th key={en} scope="col" className={cell}><L bn={bn} en={en} /></th>)}</tr></thead>
        <tbody>
          <tr>
            <td className={cell}>1</td>
            <td className={cell}>{supplier.name}</td>
            <td className={`${cell} tabular`}>{supplier.bin}</td>
            <td className={`${cell} tabular`}>{v.challanNo}<span className="block text-neutral-500">{v.docNo}</span></td>
            <td className={`${cell} tabular`}>{fmtDate(v.docDate, "en")}</td>
            <td className={`${cell} text-right tabular`}>{m(v.docValue)}</td>
            <td className={`${cell} text-right tabular`}>{m(v.docVat)}</td>
            <td className={`${cell} text-right font-semibold tabular`}>{m(v.amount)}</td>
          </tr>
        </tbody>
        <tfoot><tr className="font-semibold"><th scope="row" colSpan={5} className={`${cell} text-right`}><span lang="bn">সর্বমোট</span> / Total</th><td className={`${cell} text-right tabular`}>{m(v.docValue)}</td><td className={`${cell} text-right tabular`}>{m(v.docVat)}</td><td className={`${cell} text-right tabular`}>{m(v.amount)}</td></tr></tfoot>
      </table>
      {v.treasuryChallan && <p className="mt-2"><span lang="bn">ট্রেজারি চালান নং</span> / Treasury challan: <span className="tabular">{v.treasuryChallan}</span></p>}
      <footer className="mt-12 grid grid-cols-2 gap-8 text-[0.6875rem]">
        <div />
        <div className="border-t border-neutral-500 pt-1 text-center">
          <p lang="bn">দায়িত্বপ্রাপ্ত কর্মকর্তার স্বাক্ষর</p>
          <p className="text-neutral-500">Signature of the authorised officer</p>
          <p className="mt-1">{v.mode === "purchase" ? v.issuedBy : ""}</p>
        </div>
      </footer>
    </article>
  )
}
