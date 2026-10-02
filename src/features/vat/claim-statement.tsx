"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useCompany } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { DRAWBACK_MONTHS } from "@/lib/bond"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { DrawbackClaimRow } from "@/lib/types"

/**
 * Printable statement of a claim — the schedule of exports and of the duties paid on their imported inputs that goes
 * with the Mushak-22 application to the Duty Exemption & Drawback Office (actual-rate claim).
 */
export function ClaimStatement({ claim: c }: { claim: DrawbackClaimRow }) {
  const company = useCompany()
  const settings = useQuery({ queryKey: ["vat", "settings"], queryFn: api.vat.settings, staleTime: 5 * 60_000 })
  const p = settings.data?.profile
  const m = (n: number) => fmtMoney(n, "en")
  const cell = "border border-neutral-400 p-1"
  return (
    <article className="print-area relative mx-auto w-full max-w-[297mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label={`Duty drawback claim ${c.no}`} data-testid="claim-statement">
      <header className="relative mb-4 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-২২</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার · জাতীয় রাজস্ব বোর্ড</p>
        <p className="text-[0.6875rem] text-neutral-600">Duty Exemption &amp; Drawback Office (DEDO)</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">শুল্ক প্রত্যর্পণ (ডিউটি ড্র-ব্যাক) দাবির বিবরণী</h2>
        <p className="text-[0.6875rem] text-neutral-500">Statement of duties paid on imported inputs of exported goods — schedule to the drawback claim (actual rate)</p>
      </header>
      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt className="text-neutral-500">Exporter</dt><dd className="font-semibold">{company.name}</dd>
          <dt className="text-neutral-500">Address</dt><dd>{company.address}</dd>
          <dt className="text-neutral-500">BIN</dt><dd className="tabular">{company.bin}</dd>
          <dt className="text-neutral-500">Bond licence</dt><dd className="tabular">{p?.bondLicenseNo || "—"}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt className="text-neutral-500">Claim no.</dt><dd className="font-semibold tabular">{c.no}</dd>
          <dt className="text-neutral-500">Prepared</dt><dd className="tabular">{fmtDate(c.createdAt.slice(0, 10), "en", "dd/MM/yyyy")}</dd>
          <dt className="text-neutral-500">Filed</dt><dd className="tabular">{c.filedOn ? fmtDate(c.filedOn, "en", "dd/MM/yyyy") : "—"}</dd>
          <dt className="text-neutral-500">DEDO ref.</dt><dd className="tabular">{c.dedoRef || "—"}</dd>
        </dl>
      </section>
      <div className="overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label="Drawback schedule">
        <table className="w-full min-w-[820px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead><tr className="bg-neutral-100 text-left">
            <th scope="col" className={cell}>Sl.</th>
            <th scope="col" className={cell}>Export invoice / Bill of export / date</th>
            <th scope="col" className={cell}>Bill of Entry (import)</th>
            <th scope="col" className={cell}>Input consumed</th>
            <th scope="col" className={`${cell} text-right`}>Quantity</th>
            <th scope="col" className={`${cell} text-right`}>CD (৳)</th>
            <th scope="col" className={`${cell} text-right`}>RD (৳)</th>
            <th scope="col" className={`${cell} text-right`}>Total (৳)</th>
          </tr></thead>
          <tbody>
            {c.lines.map((l, i) => (
              <React.Fragment key={l.saleId}>
                {l.inputs.map((x, j) => (
                  <tr key={`${x.purchaseId}|${x.itemId}`} className="align-top">
                    {j === 0 && <td className={cell} rowSpan={l.inputs.length + 1}>{i + 1}</td>}
                    {j === 0 && <td className={cell} rowSpan={l.inputs.length}><span className="font-semibold tabular">{l.invoiceNo}</span><span className="block tabular">{l.billNo || (l.deemed ? "Deemed export" : "—")}</span><span className="block tabular">{fmtDate(l.exportDate, "en", "dd/MM/yyyy")}</span><span className="block text-neutral-500">{l.customerName}</span></td>}
                    <td className={`${cell} tabular`}>{x.boeNo}<span className="block text-neutral-500">{x.purchaseNo}</span></td>
                    <td className={cell}>{x.name}</td>
                    <td className={`${cell} text-right tabular`}>{fmtNum(x.qty, "en", 3)} {x.uom}</td>
                    <td className={`${cell} text-right tabular`}>{m(x.cd)}</td>
                    <td className={`${cell} text-right tabular`}>{m(x.rd)}</td>
                    <td className={`${cell} text-right tabular`}>{m(x.cd + x.rd)}</td>
                  </tr>
                ))}
                <tr className="bg-neutral-50 font-semibold"><td className={cell} colSpan={4}>Subtotal {l.invoiceNo} — claim by {fmtDate(l.deadline, "en", "dd/MM/yyyy")}</td>
                  <td className={`${cell} text-right tabular`}>{m(l.cd)}</td><td className={`${cell} text-right tabular`}>{m(l.rd)}</td><td className={`${cell} text-right tabular`}>{m(l.total)}</td></tr>
              </React.Fragment>
            ))}
            <tr className="bg-neutral-100 font-bold"><td className={cell} colSpan={5}>Total drawback claimed</td>
              <td className={`${cell} text-right tabular`}>{m(c.cd)}</td><td className={`${cell} text-right tabular`}>{m(c.rd)}</td><td className={`${cell} text-right tabular`} data-testid="claim-statement-total">{m(c.claimed)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.6875rem] text-neutral-600">Consumption is worked out from the approved input–output coefficients (Mushak 4.3) in force on each export date. Customs duty and regulatory duty only: VAT and AT were taken as input credit in the VAT return, SD on inputs of exported goods through Mushak 9.1 note 40, and AIT is an income-tax advance. Claimed within {DRAWBACK_MONTHS} months of each export.</p>
      <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-[0.6875rem]">
        <div className="border-t border-neutral-500 pt-1">Prepared by</div>
        <div className="border-t border-neutral-500 pt-1">Authorised signatory, {company.name}</div>
      </footer>
    </article>
  )
}
