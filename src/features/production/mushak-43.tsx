import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"
import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { BomRow, CostHead } from "@/lib/types"

const HEAD: Record<CostHead, [string, string]> = {
  labour: ["শ্রমিক মজুরি", "Labour"], power: ["বিদ্যুৎ, গ্যাস ও জ্বালানি", "Power, gas & fuel"], overhead: ["কারখানা উপরিব্যয়", "Factory overhead"],
  packing: ["মোড়ক", "Packing"], admin: ["প্রশাসনিক ব্যয়", "Administrative"], finance: ["আর্থিক ব্যয়", "Financial"], other: ["অন্যান্য", "Other"], profit: ["মুনাফা", "Profit"],
}

/**
 * Mushak-4.3 (Input–Output Coefficient declaration) — VAT & SD Rules 2016, rule 21: filed with the VAT office before the
 * first supply of a manufactured good and again whenever the coefficients or the price change.
 */
export function Mushak43({ bom }: { bom: BomRow }) {
  const company = useCompany()
  const { data: profile } = useQuery({ queryKey: ["company"], queryFn: api.company.get, staleTime: 5 * 60_000 })
  const m = (n: number) => fmtMoney(n, "en")
  const costs = bom.costs.filter((c) => c.amount > 0)
  const rows = Math.max(bom.inputs.length, costs.length, 1)
  const cell = "border border-neutral-400 p-1"
  const L = ({ bn, en }: { bn: string; en: string }) => (
    <span className="block leading-tight"><span lang="bn">{bn}</span><span className="block text-[0.625rem] text-neutral-500">{en}</span></span>
  )
  const H = ({ bn, en, ...rest }: { bn: string; en: string; colSpan?: number; rowSpan?: number }) => (
    <th scope="col" {...rest} className={`${cell} bg-neutral-100 align-top font-semibold`}><span lang="bn" className="block">{bn}</span><span className="block font-normal text-neutral-500">{en}</span></th>
  )
  return (
    <article className="print-area relative mx-auto w-full max-w-[297mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label="Mushak 4.3 input-output coefficient declaration">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৪.৩</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</p>
        <p lang="bn" className="text-sm">জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">উপকরণ-উৎপাদ সহগ (Input-Output Coefficient) ঘোষণা</h2>
        <p className="text-[0.6875rem] text-neutral-600" lang="bn">[বিধি ২১ দ্রষ্টব্য]</p>
        <p className="text-[0.6875rem] text-neutral-500">Declaration of input–output coefficient — Rule 21, VAT &amp; SD Rules 2016</p>
      </header>

      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="প্রতিষ্ঠানের নাম" en="Name of the registered person" /></dt><dd className="font-semibold">{company.name}</dd>
          <dt><L bn="ঠিকানা" en="Address" /></dt><dd>{company.address}</dd>
          <dt><L bn="বিআইএন" en="BIN" /></dt><dd className="tabular">{company.bin}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt><L bn="দাখিলের তারিখ" en="Date of submission" /></dt><dd className="tabular">{bom.licenseDate ? fmtDate(bom.licenseDate, "en", "dd/MM/yyyy") : "—"}</dd>
          <dt><L bn="ঘোষিত মূল্য কার্যকরের তারিখ" en="Effective from" /></dt><dd className="tabular">{fmtDate(bom.effectiveDate, "en", "dd/MM/yyyy")}</dd>
          <dt><L bn="ঘোষণা নম্বর" en="Declaration no." /></dt><dd className="font-semibold tabular">{bom.no}</dd>
        </dl>
      </section>

      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring print:overflow-visible" tabIndex={0} role="region" aria-label="Mushak 4.3">
        <table className="w-full min-w-[900px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead>
            <tr>
              <H bn="ক্রমিক সংখ্যা" en="Sl." rowSpan={2} />
              <H bn="পণ্যের এইচ.এস. কোড" en="HS code" rowSpan={2} />
              <H bn="পণ্যের নাম ও বর্ণনা" en="Name & description of goods" rowSpan={2} />
              <H bn="সরবরাহের একক" en="Unit of supply" rowSpan={2} />
              <H bn="একক পণ্য উৎপাদনে ব্যবহার্য সকল উপকরণ/কাঁচামাল ও প্যাকিং সামগ্রীর বিবরণ" en="Inputs, raw & packing materials per unit (incl. wastage)" colSpan={5} />
              <H bn="মূল্য সংযোজনের বিবরণ" en="Value addition" colSpan={2} />
              <H bn="মন্তব্য" en="Remarks" rowSpan={2} />
            </tr>
            <tr>
              <H bn="বিবরণ" en="Description" />
              <H bn="অপচয়সহ পরিমাণ" en="Qty incl. wastage" />
              <H bn="মূল্য (টাকায়)" en="Value (Tk)" />
              <H bn="অপচয়ের পরিমাণ" en="Wastage qty" />
              <H bn="শতকরা হার" en="Wastage %" />
              <H bn="খাত" en="Head" />
              <H bn="মূল্য (টাকায়)" en="Value (Tk)" />
            </tr>
          </thead>
          <tbody className="tabular">
            {Array.from({ length: rows }, (_, i) => {
              const inp = bom.inputs[i], c = costs[i]
              return (
                <tr key={i}>
                  {i === 0 && (
                    <>
                      <td rowSpan={rows} className={`${cell} text-center align-top`}>1</td>
                      <td rowSpan={rows} className={`${cell} align-top`}>{bom.hsCode}</td>
                      <td rowSpan={rows} className={`${cell} align-top font-medium`}>{bom.itemName}<span className="block text-[0.625rem] font-normal text-neutral-500">{bom.sku} · v{bom.version}</span></td>
                      <td rowSpan={rows} className={`${cell} text-center align-top`}>1 {bom.uom}</td>
                    </>
                  )}
                  <td className={cell}>{inp ? `${inp.name} (${inp.uom})` : ""}</td>
                  <td className={`${cell} text-right`}>{inp ? fmtNum(inp.grossQty, "en", 4) : ""}</td>
                  <td className={`${cell} text-right`}>{inp ? m(inp.value) : ""}</td>
                  <td className={`${cell} text-right`}>{inp ? fmtNum(inp.wastageQty, "en", 4) : ""}</td>
                  <td className={`${cell} text-right`}>{inp ? `${fmtNum(inp.wastagePct, "en", 2)}%` : ""}</td>
                  <td className={cell}>{c ? <><span lang="bn">{HEAD[c.head][0]}</span> / {HEAD[c.head][1]}</> : ""}</td>
                  <td className={`${cell} text-right`}>{c ? m(c.amount) : ""}</td>
                  {i === 0 && <td rowSpan={rows} className={`${cell} align-top`}>{bom.amendmentReason ?? ""}</td>}
                </tr>
              )
            })}
          </tbody>
          <tfoot className="tabular font-semibold">
            <tr>
              <td colSpan={6} className={`${cell} text-right`}><span lang="bn">উপকরণের মোট মূল্য</span> / Total input value</td>
              <td className={`${cell} text-right`}>{m(bom.materialValue)}</td>
              <td colSpan={3} className={`${cell} text-right`}><span lang="bn">মোট মূল্য সংযোজন</span> / Total value addition</td>
              <td className={`${cell} text-right`}>{m(bom.valueAdded)}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[0.6875rem]"><span lang="bn">প্রস্তাবিত একক মূল্য (মূসক ও সম্পূরক শুল্ক ব্যতীত)</span> / Declared unit price excl. VAT &amp; SD: <strong className="tabular">Tk {m(bom.price)}</strong> per {bom.uom}</p>
      <p className="mt-1 text-[0.6875rem] text-neutral-600" lang="bn">আমি এই মর্মে ঘোষণা করিতেছি যে, উপরে প্রদত্ত তথ্য সঠিক ও সম্পূর্ণ।</p>
      <p className="text-[0.6875rem] text-neutral-500">I declare that the information given above is correct and complete.</p>

      <footer className="mt-10 grid grid-cols-2 gap-8">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt><L bn="প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তি" en="Authorised person" /></dt><dd className="self-end">{profile?.signatory.name ?? ""}</dd>
          <dt><L bn="পদবি" en="Designation" /></dt><dd className="self-end">{profile?.signatory.designation ?? ""}</dd>
        </dl>
        <div className="flex flex-col items-end justify-end gap-1">
          <div className="h-10 w-48 border-b border-neutral-500" />
          <span><span lang="bn">স্বাক্ষর ও সিল</span> / Signature &amp; seal</span>
        </div>
      </footer>
      <p className="mt-6 border-t border-neutral-300 pt-2 text-[0.625rem] text-neutral-600">Generated by RBS VAT · {company.name} · {bom.process === "Approved" ? (bom.status === "superseded" ? "Superseded" : "Approved") : "DRAFT – not valid until approved"}</p>
      {bom.process !== "Approved" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-7xl font-bold text-neutral-900/[0.06]">{bom.process === "Cancelled" ? "CANCELLED" : "DRAFT"}</span>
        </div>
      )}
    </article>
  )
}
