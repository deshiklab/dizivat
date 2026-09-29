import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { amountInWords, fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { DebitNote } from "@/lib/types"

const REASON_BN: Record<DebitNote["reason"], [string, string]> = {
  damaged: ["ক্ষতিগ্রস্ত পণ্য", "Damaged goods"], quality: ["মানসম্মত নয়", "Quality rejection"], excess: ["অতিরিক্ত সরবরাহ", "Excess supply"],
  wrongItem: ["ভুল পণ্য", "Wrong item supplied"], priceDispute: ["মূল্য সংক্রান্ত বিরোধ", "Price dispute"],
}

/**
 * Mushak-6.8 (Debit Note) — VAT & SD Rules 2016, rule 40(1)(f): issued by the buyer when goods are returned to the
 * supplier; it reduces the input tax taken on the original challan. Statutory labels are Bangla with English sub-labels.
 */
export function Mushak68({ note }: { note: DebitNote }) {
  const company = useCompany()
  const { data: profile } = useQuery({ queryKey: ["company"], queryFn: api.company.get, staleTime: 5 * 60_000 })
  const branch = profile?.branches.find((b) => b.id === note.branchId)
  const m = (n: number) => fmtMoney(n, "en")
  const L = ({ bn, en }: { bn: string; en: string }) => (
    <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  )
  const cols: [string, string][] = [
    ["ক্রমিক সংখ্যা", "Sl."], ["ফেরতপ্রাপ্ত পণ্যের বর্ণনা", "Description of goods returned"], ["একক", "Unit"], ["ক্রয়ের পরিমাণ", "Qty purchased"],
    ["ফেরতের পরিমাণ", "Qty returned"], ["একক মূল্য (টাকায়)", "Unit price (Tk)"], ["মোট মূল্য (টাকায়)", "Value (Tk)"],
    ["সম্পূরক শুল্ক (টাকায়)", "SD (Tk)"], ["মূসক (টাকায়)", "VAT (Tk)"], ["সর্বমোট (টাকায়)", "Total (Tk)"],
  ]
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 6.8 debit note">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৬.৮</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">ডেবিট নোট</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (চ) দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Debit Note — Rule 40(1)(f), VAT &amp; SD Rules 2016</p>
      </header>

      <section className="mb-4 grid gap-1 border-y border-neutral-300 py-2 text-center">
        <p><span lang="bn">ক্রেতার নাম</span> / Buyer (issuer): <strong>{company.name}</strong></p>
        <p><span lang="bn">ক্রেতার বিআইএন</span> / BIN: <strong className="tabular">{company.bin}</strong></p>
        <p><span lang="bn">ইস্যুর ঠিকানা</span> / Address: {branch ? `${branch.name} — ${branch.address}` : company.address}</p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="সরবরাহকারীর নাম" en="Supplier" /></dt><dd className="font-semibold">{note.vendorName}</dd>
          <dt><L bn="সরবরাহকারীর বিআইএন" en="Supplier BIN" /></dt><dd className="tabular">{note.vendorBin}</dd>
          <dt><L bn="ঠিকানা" en="Address" /></dt><dd>{note.vendorAddress}</dd>
          <dt><L bn="মূল চালানপত্র নম্বর ও তারিখ" en="Original challan no. & date" /></dt><dd className="tabular">{note.challanNo} · {fmtDate(note.purchaseDate, "en", "dd/MM/yyyy")} <span className="text-neutral-500">({note.purchaseNo})</span></dd>
          <dt><L bn="ফেরতের কারণ" en="Reason for return" /></dt><dd><span lang="bn">{REASON_BN[note.reason][0]}</span> / {REASON_BN[note.reason][1]}{note.note ? ` — ${note.note}` : ""}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt><L bn="ডেবিট নোট নম্বর" en="Debit note no." /></dt><dd className="font-semibold tabular">{note.no}</dd>
          <dt><L bn="ইস্যুর তারিখ" en="Date of issue" /></dt><dd className="tabular">{fmtDate(note.issueDate, "en", "dd/MM/yyyy")}</dd>
          <dt><L bn="ইস্যুর সময়" en="Time of issue" /></dt><dd className="tabular">{note.issueTime}</dd>
        </dl>
      </section>

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[680px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead>
            <tr>{cols.map(([bn, en], i) => <th key={i} scope="col" className="border border-neutral-400 bg-neutral-100 p-1 align-top font-semibold"><span lang="bn" className="block">{bn}</span><span className="block font-normal text-neutral-500">{en}</span></th>)}</tr>
            <tr>{cols.map((_, i) => <th key={i} className="border border-neutral-400 p-0.5 text-center font-normal text-neutral-500">({fmtNum(i + 1, "bn")})</th>)}</tr>
          </thead>
          <tbody>
            {note.lines.map((l, i) => (
              <tr key={l.itemId} className="tabular">
                <td className="border border-neutral-400 p-1 text-center">{i + 1}</td>
                <td className="border border-neutral-400 p-1">{l.name}<span className="block text-[0.625rem] text-neutral-500">HS {l.hsCode}</span></td>
                <td className="border border-neutral-400 p-1 text-center">{l.uom}</td>
                <td className="border border-neutral-400 p-1 text-right">{fmtNum(l.purchasedQty, "en", 2)}</td>
                <td className="border border-neutral-400 p-1 text-right font-medium">{fmtNum(l.qty, "en", 2)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.price)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.subtotal)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.sd)}</td>
                <td className="border border-neutral-400 p-1 text-right">{m(l.vat)}</td>
                <td className="border border-neutral-400 p-1 text-right font-medium">{m(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold">
            <tr>
              <td colSpan={6} className="border border-neutral-400 p-1 text-right"><span lang="bn">সর্বমোট</span> / Total</td>
              <td className="border border-neutral-400 p-1 text-right">{m(note.subtotal)}</td>
              <td className="border border-neutral-400 p-1 text-right">{m(note.sd)}</td>
              <td className="border border-neutral-400 p-1 text-right">{m(note.vat)}</td>
              <td className="border border-neutral-400 p-1 text-right">{m(note.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[0.6875rem]"><strong>In words:</strong> {amountInWords(note.total)}</p>
      <p className="mt-1 text-[0.6875rem]"><span lang="bn">হ্রাসকারী সমন্বয়যোগ্য উপকরণ কর</span> / Input tax to be reduced (Mushak 9.1, note 24): <strong className="tabular">Tk {m(note.rebate)}</strong></p>

      <footer className="mt-10 grid grid-cols-2 gap-8">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="দায়িত্বপ্রাপ্ত ব্যক্তির নাম" en="Authorised person" /></dt><dd className="self-end">{note.issuedBy}</dd>
          <dt><L bn="পদবি" en="Designation" /></dt><dd className="self-end">{note.designation}</dd>
        </dl>
        <div className="flex flex-col items-end justify-end gap-1">
          <div className="h-10 w-48 border-b border-neutral-500" />
          <span><span lang="bn">স্বাক্ষর ও সিল</span> / Signature &amp; seal</span>
        </div>
      </footer>
      <p className="mt-6 border-t border-neutral-300 pt-2 text-[0.625rem] text-neutral-600">Generated by DiziVAT · {company.name} · {note.process === "Approved" ? "Approved" : "DRAFT – not valid until approved"}</p>
      {note.process !== "Approved" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-7xl font-bold text-neutral-900/[0.06]">{note.process === "Cancelled" ? "CANCELLED" : "DRAFT"}</span>
        </div>
      )}
    </article>
  )
}
