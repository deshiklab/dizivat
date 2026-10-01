import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { Transfer } from "@/lib/types"

/**
 * Mushak-6.5 (Goods transfer challan of a centrally registered entity) — VAT & SD Rules 2016, rule 40(1)(e):
 * accompanies goods moved between the company's own branches / warehouses. The value is at cost (no supply, no VAT).
 * R6.2 (NBR enlistment form set).
 */
export function Mushak65({ doc }: { doc: Transfer }) {
  const company = useCompany()
  const { data: profile } = useQuery({ queryKey: ["company"], queryFn: api.company.get, staleTime: 5 * 60_000 })
  const from = profile?.branches.find((b) => b.id === doc.fromBranchId)
  const to = profile?.branches.find((b) => b.id === doc.toBranchId)
  const cell = "border border-neutral-400 p-1"
  const L = ({ bn, en }: { bn: string; en: string }) => (
    <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  )
  const cols: [string, string][] = [["ক্রমিক সংখ্যা", "Sl."], ["পণ্যের বর্ণনা", "Description of goods"], ["পরিমাণ", "Quantity"], ["কর ব্যতীত মূল্য", "Value excl. taxes"], ["প্রযোজ্য করের পরিমাণ", "Applicable tax"], ["মন্তব্য", "Remarks"]]
  const time = doc.createdAt ? new Date(doc.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }) : "—"
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 6.5 goods transfer challan">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৬.৫</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">কেন্দ্রীয় নিবন্ধিত প্রতিষ্ঠানের পণ্য স্থানান্তর চালানপত্র</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ঙ) দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Goods transfer challan of a centrally registered entity — Rule 40(1)(e), VAT &amp; SD Rules 2016</p>
      </header>

      <section className="mb-4 grid gap-1 border-y border-neutral-300 py-2 text-center">
        <p><span lang="bn">নিবন্ধিত ব্যক্তির নাম</span> / Registered person: <strong>{company.name}</strong></p>
        <p><span lang="bn">বিআইএন</span> / BIN: <strong className="tabular">{company.bin}</strong></p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="প্রেরণকারী শাখা / পণ্যাগারের নাম ও ঠিকানা" en="Sending branch / warehouse" /></dt><dd><strong>{doc.fromBranch}</strong>{from ? <span className="block">{from.address}</span> : null}</dd>
          <dt><L bn="গ্রহীতা শাখা / পণ্যাগারের নাম ও ঠিকানা" en="Receiving branch / warehouse" /></dt><dd><strong>{doc.toBranch}</strong>{to ? <span className="block">{to.address}</span> : null}</dd>
          {doc.note && <><dt><L bn="মন্তব্য" en="Remarks" /></dt><dd>{doc.note}</dd></>}
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt><L bn="চালানপত্র নম্বর" en="Challan no." /></dt><dd className="font-semibold tabular">{doc.no}</dd>
          <dt><L bn="ইস্যুর তারিখ" en="Date of issue" /></dt><dd className="tabular">{fmtDate(doc.date, "en", "dd/MM/yyyy")}</dd>
          <dt><L bn="ইস্যুর সময়" en="Time of issue" /></dt><dd className="tabular">{time}</dd>
          <dt><L bn="যানবাহনের প্রকৃতি ও নম্বর" en="Vehicle type & no." /></dt><dd className="tabular">{doc.vehicle || "—"}</dd>
        </dl>
      </section>

      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring print:overflow-visible" tabIndex={0} role="region" aria-label="Mushak 6.5 — goods">
        <table className="w-full min-w-[560px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead>
            <tr>{cols.map(([bn, en], i) => <th key={i} scope="col" className={`${cell} bg-neutral-100 align-top font-semibold`}><span lang="bn" className="block">{bn}</span><span className="block font-normal text-neutral-500">{en}</span></th>)}</tr>
            <tr>{cols.map((_, i) => <th key={i} className={`${cell} p-0.5 text-center font-normal text-neutral-500`}>({fmtNum(i + 1, "bn")})</th>)}</tr>
          </thead>
          <tbody className="tabular">
            {doc.lines.map((l, i) => (
              <tr key={`${l.itemId}-${i}`}>
                <td className={`${cell} text-center`}>{i + 1}</td>
                <td className={cell}>{l.name}<span className="block text-[0.625rem] text-neutral-500">{l.sku}</span></td>
                <td className={`${cell} text-right`}>{fmtNum(l.qty, "en", 2)} {l.uom}</td>
                <td className={`${cell} text-right`}>{fmtMoney(l.value, "en")}</td>
                <td className={`${cell} text-right`}>—</td>
                <td className={cell}><span lang="bn">শাখা স্থানান্তর</span> / own-branch transfer</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold"><tr><td colSpan={2} className={`${cell} text-right`}><span lang="bn">সর্বমোট</span> / Total</td><td className={`${cell} text-right`}>{fmtNum(doc.totalQty, "en", 2)}</td><td className={`${cell} text-right`}>{fmtMoney(doc.totalValue, "en")}</td><td className={cell} /><td className={cell} /></tr></tfoot>
        </table>
      </div>

      <footer className="mt-10 grid grid-cols-2 gap-8">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তির নাম" en="Authorised person" /></dt><dd className="self-end">{doc.issuedBy}</dd>
        </dl>
        <div className="flex flex-col items-end justify-end gap-1">
          <div className="h-10 w-48 border-b border-neutral-500" />
          <span><span lang="bn">স্বাক্ষর ও সিল</span> / Signature &amp; seal</span>
        </div>
      </footer>
      <p className="mt-6 border-t border-neutral-300 pt-2 text-[0.625rem] text-neutral-600">Generated by DiziVAT · {company.name} · {doc.process === "Approved" ? "Approved" : "DRAFT – not valid until approved"}</p>
      {doc.process !== "Approved" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-7xl font-bold text-neutral-900/[0.06]">{doc.process === "Cancelled" ? "CANCELLED" : "DRAFT"}</span>
        </div>
      )}
    </article>
  )
}
