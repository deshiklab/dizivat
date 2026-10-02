"use client"

import { useCompany } from "@/components/auth/me-provider"
import { fmtDate, fmtMoney } from "@/lib/format"
import { noteDef, periodLabel } from "@/lib/r4"
import { AMEND_DECIDE_DAYS, AMEND_YEARS } from "@/lib/return-apps"
import type { AmendField, AmendReason, ReturnAmendmentRow } from "@/lib/types"

const REASON: Record<AmendReason, string> = {
  clerical: "Clerical / computational error",
  underpaid: "Tax under-declared (payable increases)",
  overpaid: "Tax over-declared (payable decreases)",
  other: "Other error or omission",
}
const FIELD: Record<AmendField, string> = { value: "Value", sd: "SD", vat: "VAT", amount: "Amount" }
const d = (x?: string) => (x ? fmtDate(x, "en", "dd/MM/yyyy") : "—")
const m = (n: number) => fmtMoney(n, "en")
const signed = (n: number) => (Math.abs(n) < 0.005 ? "0.00" : `${n > 0 ? "+" : "−"}${m(Math.abs(n))}`)

/**
 * Printable Mushak-9.4 — application to the Commissioner to submit an amended return (s.66, rule 49(2)): the errors
 * found note by note, the effect on the net tax, and the office part (decision).
 */
export function Mushak94({ app: r }: { app: ReturnAmendmentRow }) {
  const company = useCompany()
  const e = r.effect
  const cell = "border border-neutral-400 p-1"
  const row = "grid grid-cols-[2rem_minmax(0,16rem)_1fr] gap-x-2 border-b border-neutral-300 py-1.5"
  const decision = r.decidedOn && r.state !== "rejected" ? "Permission granted"
    : r.state === "deemed" || (r.state === "amended" && r.deemedOn) ? `Deemed granted — no decision within ${AMEND_DECIDE_DAYS} days of the application`
      : r.state === "rejected" ? "Permission refused"
        : r.state === "amended" ? "Not required — the amendment does not decrease the tax"
          : r.state === "draft" ? "—" : "Pending"
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] bg-white p-6 text-[0.8125rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-10 print:p-0 print:shadow-none print:ring-0" aria-label={`Mushak 9.4 ${r.no}`} data-testid="mushak-94">
      <header className="relative mb-5 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৯.৪</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার · জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">সংশোধিত দাখিলপত্র পেশের আবেদন</h2>
        <p className="text-xs text-neutral-600">Application for permission to submit an amended return — section 66, rule 49(2)</p>
      </header>
      <p className="mb-3">To<br />The Commissioner, Customs, Excise &amp; VAT Commissionerate</p>
      <p className="mb-4 text-xs text-neutral-600">Application no. <span className="font-semibold tabular text-neutral-900">{r.no}</span>{r.filedOn && <> · submitted {d(r.filedOn)}{r.filedRef ? ` · ref. ${r.filedRef}` : ""}</>}</p>
      <section aria-label="Applicant and return" className="mb-4">
        <div className={row}><span>1.</span><span className="text-neutral-600">Name of the registered person</span><span className="font-semibold">{company.name}</span></div>
        <div className={row}><span>2.</span><span className="text-neutral-600">BIN</span><span className="tabular">{company.bin}</span></div>
        <div className={row}><span>3.</span><span className="text-neutral-600">Address</span><span>{company.address}</span></div>
        <div className={row}><span>4.</span><span className="text-neutral-600">Tax period of the return</span><span className="tabular">{periodLabel(r.period)}{r.revision > 1 ? ` (amendment no. ${r.revision})` : ""}</span></div>
        <div className={row}><span>5.</span><span className="text-neutral-600">Return submitted on / acknowledgement</span><span className="tabular">{d(r.original.submissionDate)} · {r.original.ackNo ?? "—"}</span></div>
        <div className={row}><span>6.</span><span className="text-neutral-600">Nature of the error</span><span><span className="font-medium">{REASON[r.reasonKind]}</span><span className="block whitespace-pre-line">{r.description}</span></span></div>
      </section>
      <h3 className="mb-1 text-sm font-semibold">7. Particulars of the corrections (Mushak 9.1)</h3>
      <div className="mb-4 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label="Corrections">
        <table className="w-full min-w-[640px] border-collapse text-xs print:min-w-0">
          <thead><tr className="bg-neutral-100 text-left">
            <th scope="col" className={cell}>Note</th>
            <th scope="col" className={cell}>Description</th>
            <th scope="col" className={cell}>Column</th>
            <th scope="col" className={`${cell} text-right`}>As submitted (৳)</th>
            <th scope="col" className={`${cell} text-right`}>Correct (৳)</th>
            <th scope="col" className={`${cell} text-right`}>Difference (৳)</th>
          </tr></thead>
          <tbody>
            {r.corrections.map((c) => (
              <tr key={`${c.note}|${c.field}`} className="align-top">
                <td className={`${cell} tabular`}>{c.note}</td>
                <td className={cell}>{noteDef(c.note)?.en ?? ""}<span className="block text-neutral-600">{c.explanation}</span></td>
                <td className={cell}>{FIELD[c.field]}</td>
                <td className={`${cell} text-right tabular`}>{m(c.from)}</td>
                <td className={`${cell} text-right tabular`}>{m(c.to)}</td>
                <td className={`${cell} text-right tabular`}>{signed(c.to - c.from)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mb-1 text-sm font-semibold">8. Effect on the net tax</h3>
      <table className="mb-4 w-full border-collapse text-xs">
        <thead><tr className="bg-neutral-100 text-left">
          <th scope="col" className={cell}></th>
          <th scope="col" className={`${cell} text-right`}>As submitted (৳)</th>
          <th scope="col" className={`${cell} text-right`}>Amended (৳)</th>
          <th scope="col" className={`${cell} text-right`}>Difference (৳)</th>
        </tr></thead>
        <tbody>
          <tr><th scope="row" className={`${cell} text-left font-normal`}>Net VAT payable (note 34)</th><td className={`${cell} text-right tabular`}>{m(e.netVatFrom)}</td><td className={`${cell} text-right tabular`}>{m(e.netVatTo)}</td><td className={`${cell} text-right tabular`} data-testid="m94-delta-vat">{signed(e.deltaVat)}</td></tr>
          <tr><th scope="row" className={`${cell} text-left font-normal`}>Net SD payable (note 36)</th><td className={`${cell} text-right tabular`}>{m(e.netSdFrom)}</td><td className={`${cell} text-right tabular`}>{m(e.netSdTo)}</td><td className={`${cell} text-right tabular`}>{signed(e.deltaSd)}</td></tr>
        </tbody>
      </table>
      <p className="mb-4 text-xs" data-testid="m94-effect">
        {e.direction === "increase" ? <>The tax payable increases. The difference of ৳ {m(e.deltaVat > 0 ? e.deltaVat : 0)} VAT{e.deltaSd > 0 ? ` and ৳ ${m(e.deltaSd)} SD` : ""} is paid with interest under section 127 of ৳ {m(e.interestVat + e.interestSd)} ({e.months} month(s) from the due date to {d(e.paidOn)}): total ৳ {m(e.toPay)}. No penalty is payable on a self-declared amendment.</>
          : e.direction === "decrease" ? <>The tax payable decreases by ৳ {m(e.decreaseVat + e.decreaseSd)}. A decreasing adjustment is requested in the tax period the Commissioner allows (VAT: note 32; SD: note 39).</>
            : <>The corrections do not change the net tax payable.</>}
      </p>
      <p className="mb-6 text-xs">I declare that no VAT audit, investigation or enquiry has started for this tax period, that the error was not discovered by a VAT officer, and that this application does not seek an input tax credit or decreasing adjustment whose time limit has passed. The information above is true and complete.</p>
      <div className="mb-8 grid grid-cols-2 gap-8 text-center text-xs">
        <div className="border-t border-neutral-500 pt-1">Date: {d(r.filedOn)}</div>
        <div className="border-t border-neutral-500 pt-1">Signature and seal — authorised person, {company.name}</div>
      </div>
      <section aria-label="For official use" className="rounded border border-neutral-500 p-3">
        <h3 className="mb-2 text-sm font-semibold">For official use (Commissioner)</h3>
        <div className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-2 gap-y-1 text-xs">
          <span className="text-neutral-600">Decision</span>
          <span className="font-semibold" data-testid="m94-decision">{decision}</span>
          <span className="text-neutral-600">Date of decision / reference</span><span className="tabular">{r.decidedOn ? `${d(r.decidedOn)}${r.commissionerRef ? ` · ${r.commissionerRef}` : ""}` : "—"}</span>
          {r.adjustPeriod && <><span className="text-neutral-600">Decreasing adjustment allowed in</span><span className="tabular">{periodLabel(r.adjustPeriod)}</span></>}
          {r.rejectReason && <><span className="text-neutral-600">Reason for refusal</span><span>{r.rejectReason}</span></>}
          {r.amended && <><span className="text-neutral-600">Amended return (9.1, type C)</span><span className="tabular">{d(r.amended.date)} · {r.amended.ackNo}{r.amended.payment ? ` · challan ${r.amended.payment.challanNo} ৳ ${m(r.amended.payment.amount)}` : ""}</span></>}
        </div>
        <div className="mt-8 ml-auto w-64 border-t border-neutral-500 pt-1 text-center text-xs">Commissioner / authorised officer</div>
      </section>
      <p className="mt-4 text-[0.6875rem] text-neutral-600">An amended return may be applied for within {AMEND_YEARS} years of submitting the original return (by {d(r.applyBy)}), and not after an audit or enquiry has started. Where the amendment decreases the tax, the Commissioner decides within {AMEND_DECIDE_DAYS} days, failing which permission is deemed granted.</p>
    </article>
  )
}
