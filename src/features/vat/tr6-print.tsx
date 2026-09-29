import { useCompany } from "@/components/auth/me-provider"
import { amountInWords, fmtDate, fmtMoney } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import type { TreasuryDeposit } from "@/lib/types"

const MODE: Record<TreasuryDeposit["mode"], string> = { cash: "নগদ / Cash", cheque: "চেক / Cheque", payOrder: "পে-অর্ডার / Pay order", draft: "ব্যাংক ড্রাফট / Draft", online: "অনলাইন (এ-চালান) / Online (A-challan)" }

/**
 * Treasury challan — T.R. Form No. 6 (S.R. 37). Deposited at Bangladesh Bank / Sonali Bank under the economic code;
 * the challan number and date feed Part 9 (notes 58–64) of the Mushak 9.1 return.
 */
export function Tr6Print({ d }: { d: TreasuryDeposit }) {
  const company = useCompany()
  const [taka, paisa] = fmtMoney(d.amount, "en").replace(/[^\d.,]/g, "").split(".")
  const L = ({ bn, en }: { bn: string; en: string }) => <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  const cell = "border border-neutral-400 px-2 py-1.5 align-top"
  return (
    <article className="print-area relative mx-auto w-full max-w-[297mm] bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="TR-6 treasury challan">
      <header className="relative mb-3 text-center">
        <span className="absolute top-0 right-0 text-[0.6875rem]" lang="bn">টি, আর ফরম নং ৬ <span className="block text-neutral-500">(এস, আর ৩৭ দ্রষ্টব্য)</span></span>
        <p className="text-base font-bold" lang="bn">ট্রেজারি চালান</p>
        <p className="text-[0.6875rem] text-neutral-500">Treasury Challan — T.R. Form No. 6 (S.R. 37)</p>
        <p className="mt-2"><span lang="bn">চালান নং</span> / Challan No: <strong className="tabular">{d.challanNo}</strong> &nbsp; <span lang="bn">তারিখ</span> / Date: <strong className="tabular">{fmtDate(d.challanDate, "en")}</strong></p>
        <p><span lang="bn">বাংলাদেশ ব্যাংক / সোনালী ব্যাংকের</span> {d.bank}, {d.bankBranch} <span lang="bn">শাখা, জেলা</span>: {d.district}</p>
      </header>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-neutral-100 text-left">
            <th scope="col" colSpan={5} className={`${cell} text-center`}><L bn="জমা প্রদানকারী কর্তৃক পূরণ করিতে হইবে" en="To be filled in by the depositor" /></th>
            <th scope="col" colSpan={2} className={`${cell} text-center`}><L bn="টাকার অঙ্ক" en="Amount" /></th>
            <th scope="col" rowSpan={2} className={cell}><L bn="বিভাগের নাম এবং চালানের পৃষ্ঠাংকনকারী কর্মকর্তার নাম, পদবী ও দপ্তর" en="Department / officer endorsing the challan" /></th>
          </tr>
          <tr className="bg-neutral-100 text-left">
            <th scope="col" className={cell}><L bn="যে ব্যক্তির/প্রতিষ্ঠানের পক্ষ হইতে টাকা প্রদত্ত হইল তাহার নাম ও ঠিকানা" en="On behalf of (name & address)" /></th>
            <th scope="col" className={cell}><L bn="যে ব্যক্তির মারফত টাকা প্রদত্ত হইল তাহার নাম ও ঠিকানা" en="Paid by (name & address)" /></th>
            <th scope="col" className={cell}><L bn="টাকা প্রদানের উদ্দেশ্য" en="Purpose of payment" /></th>
            <th scope="col" className={cell}><L bn="মুদ্রা ও নোটের বিবরণ / ড্রাফট, পে-অর্ডার ও চেকের বিবরণ" en="Mode of payment" /></th>
            <th scope="col" className={cell}><L bn="কোড নং" en="Economic code" /></th>
            <th scope="col" className={cell}><L bn="টাকা" en="Taka" /></th>
            <th scope="col" className={cell}><L bn="পয়সা" en="Paisa" /></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}><strong>{company.name}</strong><span className="block">{company.address}</span><span className="block tabular">BIN: {company.bin}</span></td>
            <td className={cell}>{d.depositor}{d.designation ? `, ${d.designation}` : ""}<span className="block">{d.address}</span></td>
            <td className={cell}>{d.description}<span className="block text-neutral-500"><span lang="bn">কর মেয়াদ</span> / Tax period: {periodLabel(d.taxPeriod)}</span></td>
            <td className={cell}>{MODE[d.mode]}</td>
            <td className={`${cell} tabular font-semibold`}>{d.code}</td>
            <td className={`${cell} text-right tabular`}>{taka}</td>
            <td className={`${cell} text-right tabular`}>{paisa ?? "00"}</td>
            <td className={cell}><span lang="bn">জাতীয় রাজস্ব বোর্ড (মূসক)</span></td>
          </tr>
          <tr className="font-semibold">
            <th scope="row" colSpan={5} className={`${cell} text-right`}><span lang="bn">মোট টাকা</span> / Total</th>
            <td className={`${cell} text-right tabular`}>{taka}</td>
            <td className={`${cell} text-right tabular`}>{paisa ?? "00"}</td>
            <td className={cell} />
          </tr>
        </tbody>
      </table>
      <p className="mt-2"><span lang="bn">টাকা (কথায়)</span> / In words: <strong>{amountInWords(d.amount)}</strong></p>
      <footer className="mt-12 grid grid-cols-3 gap-8 text-center text-[0.6875rem]">
        <p className="border-t border-neutral-500 pt-1"><span lang="bn">জমা প্রদানকারীর স্বাক্ষর</span><span className="block text-neutral-500">Depositor</span></p>
        <p className="border-t border-neutral-500 pt-1"><span lang="bn">টাকা পাওয়া গেল</span><span className="block text-neutral-500">Received</span></p>
        <p className="border-t border-neutral-500 pt-1"><span lang="bn">ম্যানেজার / ট্রেজারি অফিসার</span><span className="block text-neutral-500">Manager / Treasury officer</span></p>
      </footer>
    </article>
  )
}
