import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { Batch } from "@/lib/types"

/**
 * Mushak-6.4 (Contractual production challan) — VAT & SD Rules 2016, rule 40(1)(d): accompanies the inputs sent to a
 * contract manufacturer and records the finished goods to be returned.
 */
export function Mushak64({ batch }: { batch: Batch }) {
  const company = useCompany()
  const { data: profile } = useQuery({ queryKey: ["company"], queryFn: api.company.get, staleTime: 5 * 60_000 })
  const branch = profile?.branches.find((b) => b.id === batch.branchId)
  const m = (n: number) => fmtMoney(n, "en")
  const cell = "border border-neutral-400 p-1"
  const L = ({ bn, en }: { bn: string; en: string }) => (
    <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  )
  const Head = ({ cols }: { cols: [string, string][] }) => (
    <thead>
      <tr>{cols.map(([bn, en], i) => <th key={i} scope="col" className={`${cell} bg-neutral-100 align-top font-semibold`}><span lang="bn" className="block">{bn}</span><span className="block font-normal text-neutral-500">{en}</span></th>)}</tr>
      <tr>{cols.map((_, i) => <th key={i} className={`${cell} p-0.5 text-center font-normal text-neutral-500`}>({fmtNum(i + 1, "bn")})</th>)}</tr>
    </thead>
  )
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 6.4 contractual production challan">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৬.৪</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">চুক্তিভিত্তিক উৎপাদনের চালানপত্র</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঘ) দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Contractual production challan — Rule 40(1)(d), VAT &amp; SD Rules 2016</p>
      </header>

      <section className="mb-4 grid gap-1 border-y border-neutral-300 py-2 text-center">
        <p><span lang="bn">উপকরণ প্রেরণকারীর নাম</span> / Sender: <strong>{company.name}</strong></p>
        <p><span lang="bn">বিআইএন</span> / BIN: <strong className="tabular">{company.bin}</strong></p>
        <p><span lang="bn">প্রেরণের ঠিকানা</span> / Dispatched from: {branch ? `${branch.name} — ${branch.address}` : company.address}</p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="চুক্তিভিত্তিক উৎপাদনকারীর নাম" en="Contract manufacturer" /></dt><dd className="font-semibold">{batch.vendorName}</dd>
          <dt><L bn="বিআইএন" en="BIN" /></dt><dd className="tabular">{batch.vendorBin || "—"}</dd>
          <dt><L bn="উপকরণ সরবরাহের ঠিকানা" en="Delivered to" /></dt><dd>{batch.address || batch.vendorAddress}</dd>
          {batch.remark && <><dt><L bn="মন্তব্য" en="Remarks" /></dt><dd>{batch.remark}</dd></>}
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt><L bn="চালানপত্র নম্বর" en="Challan no." /></dt><dd className="font-semibold tabular">{batch.no}</dd>
          <dt><L bn="ইস্যুর তারিখ" en="Date of issue" /></dt><dd className="tabular">{fmtDate(batch.issueDate, "en", "dd/MM/yyyy")}</dd>
          <dt><L bn="ইস্যুর সময়" en="Time of issue" /></dt><dd className="tabular">{batch.issueTime ?? "—"}</dd>
          <dt><L bn="ফেরত গ্রহণের তারিখ" en="Goods received back" /></dt><dd className="tabular">{batch.receivedAt ? fmtDate(batch.receiveDate ?? batch.receivedAt, "en", "dd/MM/yyyy") : "—"}</dd>
        </dl>
      </section>

      <h3 className="mb-1 font-semibold"><span lang="bn">ক. প্রেরিত উপকরণ</span> / A. Inputs sent</h3>
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring print:overflow-visible" tabIndex={0} role="region" aria-label="Mushak 6.4 — inputs">
        <table className="w-full min-w-[560px] border-collapse text-[0.6875rem] print:min-w-0">
          <Head cols={[["ক্রমিক সংখ্যা", "Sl."], ["উপকরণের বর্ণনা", "Description of inputs"], ["একক", "Unit"], ["পরিমাণ", "Quantity"], ["একক মূল্য (টাকায়)", "Unit price (Tk)"], ["মোট মূল্য (টাকায়)", "Value (Tk)"]]} />
          <tbody className="tabular">
            {batch.consumption.map((c, i) => (
              <tr key={c.itemId}>
                <td className={`${cell} text-center`}>{i + 1}</td><td className={cell}>{c.name}<span className="block text-[0.625rem] text-neutral-500">{c.sku}</span></td>
                <td className={`${cell} text-center`}>{c.uom}</td><td className={`${cell} text-right`}>{fmtNum(c.qty, "en", 3)}</td>
                <td className={`${cell} text-right`}>{m(c.price)}</td><td className={`${cell} text-right`}>{m(c.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold"><tr><td colSpan={5} className={`${cell} text-right`}><span lang="bn">সর্বমোট</span> / Total</td><td className={`${cell} text-right`}>{m(batch.materialValue)}</td></tr></tfoot>
        </table>
      </div>

      <h3 className="mt-4 mb-1 font-semibold"><span lang="bn">খ. উৎপাদিতব্য ও ফেরতযোগ্য পণ্য</span> / B. Goods to be produced &amp; returned</h3>
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring print:overflow-visible" tabIndex={0} role="region" aria-label="Mushak 6.4 — finished goods">
        <table className="w-full min-w-[560px] border-collapse text-[0.6875rem] print:min-w-0">
          <Head cols={[["ক্রমিক সংখ্যা", "Sl."], ["পণ্যের বর্ণনা", "Description of goods"], ["একক", "Unit"], ["উৎপাদিতব্য পরিমাণ", "Qty to produce"], ["ফেরত প্রাপ্ত পরিমাণ", "Qty received"], ["নষ্ট/ঘাটতি", "Damaged / short"]]} />
          <tbody className="tabular">
            {batch.lines.map((l, i) => (
              <tr key={`${l.itemId}-${i}`}>
                <td className={`${cell} text-center`}>{i + 1}</td><td className={cell}>{l.name}<span className="block text-[0.625rem] text-neutral-500">{l.sku}{l.workOrderNo ? ` · ${l.workOrderNo}` : ""}</span></td>
                <td className={`${cell} text-center`}>{l.uom}</td><td className={`${cell} text-right`}>{fmtNum(l.issueQty, "en", 2)}</td>
                <td className={`${cell} text-right`}>{batch.receivedAt ? fmtNum(l.receiveQty, "en", 2) : ""}</td><td className={`${cell} text-right`}>{batch.receivedAt ? fmtNum(l.damageQty, "en", 2) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="mt-10 grid grid-cols-2 gap-8">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="দায়িত্বপ্রাপ্ত ব্যক্তির নাম" en="Authorised person" /></dt><dd className="self-end">{batch.issuedBy}</dd>
          <dt><L bn="পদবি" en="Designation" /></dt><dd className="self-end">{batch.designation}</dd>
        </dl>
        <div className="flex flex-col items-end justify-end gap-1">
          <div className="h-10 w-48 border-b border-neutral-500" />
          <span><span lang="bn">স্বাক্ষর ও সিল</span> / Signature &amp; seal</span>
        </div>
      </footer>
      <p className="mt-6 border-t border-neutral-300 pt-2 text-[0.625rem] text-neutral-600">Generated by DiziVAT · {company.name} · {batch.process === "Approved" ? "Approved" : "DRAFT – not valid until approved"}</p>
      {batch.process !== "Approved" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-7xl font-bold text-neutral-900/[0.06]">{batch.process === "Cancelled" ? "CANCELLED" : "DRAFT"}</span>
        </div>
      )}
    </article>
  )
}
