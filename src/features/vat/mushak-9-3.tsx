"use client"

import { useCompany } from "@/components/auth/me-provider"
import { fmtDate } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import { LATE_APPLY_DAYS, LATE_DECIDE_DAYS } from "@/lib/return-apps"
import type { LateFilingReason, LateFilingRow } from "@/lib/types"

const REASON: Record<LateFilingReason, string> = {
  systemFailure: "Failure of the online system / e-return portal",
  disaster: "Natural disaster, fire or other calamity",
  illness: "Illness or death of the person responsible",
  documents: "Books, records or documents not available",
  other: "Other reasonable cause",
}
const d = (x?: string) => (x ? fmtDate(x, "en", "dd/MM/yyyy") : "—")

/**
 * Printable Mushak-9.3 — application to the Commissioner for permission to submit the return late
 * (VAT & SD Act 2012 s.65, rule 48(1)), with the office part (decision) below.
 */
export function Mushak93({ app: r }: { app: LateFilingRow }) {
  const company = useCompany()
  const row = "grid grid-cols-[2rem_minmax(0,16rem)_1fr] gap-x-2 border-b border-neutral-300 py-1.5"
  const decided = r.state === "approved" || r.state === "rejected" || r.state === "deemed"
  return (
    <article className="print-area relative mx-auto w-full max-w-[210mm] bg-white p-6 text-[0.8125rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-10 print:p-0 print:shadow-none print:ring-0" aria-label={`Mushak 9.3 ${r.no}`} data-testid="mushak-93">
      <header className="relative mb-5 text-center">
        <span className="absolute top-0 right-0 rounded border border-neutral-800 px-2 py-0.5 text-sm font-semibold" lang="bn">মূসক-৯.৩</span>
        <p lang="bn" className="text-sm">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার · জাতীয় রাজস্ব বোর্ড</p>
        <h2 lang="bn" className="mt-1 text-lg font-bold">বিলম্বে দাখিলপত্র পেশের অনুমতির আবেদন</h2>
        <p className="text-xs text-neutral-600">Application for permission to submit the return late — section 65, rule 48(1)</p>
      </header>
      <p className="mb-3">To<br />The Commissioner, Customs, Excise &amp; VAT Commissionerate</p>
      <p className="mb-4 text-xs text-neutral-600">Application no. <span className="font-semibold tabular text-neutral-900">{r.no}</span>{r.filedOn && <> · submitted {d(r.filedOn)}{r.filedRef ? ` · ref. ${r.filedRef}` : ""}</>}</p>
      <section aria-label="Applicant and request" className="mb-4">
        <div className={row}><span>1.</span><span className="text-neutral-600">Name of the registered person</span><span className="font-semibold">{company.name}</span></div>
        <div className={row}><span>2.</span><span className="text-neutral-600">BIN</span><span className="tabular">{company.bin}</span></div>
        <div className={row}><span>3.</span><span className="text-neutral-600">Address</span><span>{company.address}</span></div>
        <div className={row}><span>4.</span><span className="text-neutral-600">Tax period</span><span className="tabular">{periodLabel(r.period)}</span></div>
        <div className={row}><span>5.</span><span className="text-neutral-600">Due date of the return</span><span className="tabular">{d(r.due)}</span></div>
        <div className={row}><span>6.</span><span className="text-neutral-600">Date by which permission is sought</span><span className="tabular font-semibold" data-testid="m93-requested">{d(r.requestedDate)}</span></div>
        <div className={row}><span>7.</span><span className="text-neutral-600">Reason</span><span><span className="font-medium">{REASON[r.reasonKind]}</span><span className="block whitespace-pre-line">{r.reason}</span></span></div>
      </section>
      <p className="mb-6 text-xs">I declare that the information above is true and complete. I understand that this permission does not extend the due date for payment of the tax, and that interest under section 127 is payable on any tax paid after the due date.</p>
      <div className="mb-8 grid grid-cols-2 gap-8 text-center text-xs">
        <div className="border-t border-neutral-500 pt-1">Date: {d(r.filedOn)}</div>
        <div className="border-t border-neutral-500 pt-1">Signature and seal — authorised person, {company.name}</div>
      </div>
      <section aria-label="For official use" className="rounded border border-neutral-500 p-3">
        <h3 className="mb-2 text-sm font-semibold">For official use (Commissioner)</h3>
        <div className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-2 gap-y-1 text-xs">
          <span className="text-neutral-600">Decision</span>
          <span className="font-semibold" data-testid="m93-decision">{r.state === "approved" ? "Permission granted" : r.state === "deemed" ? `Deemed granted — no decision within ${LATE_DECIDE_DAYS} days of the application` : r.state === "rejected" ? "Permission refused" : "Pending"}</span>
          <span className="text-neutral-600">Return may be submitted by</span><span className="tabular">{decided && r.effectiveDate ? d(r.effectiveDate) : "—"}</span>
          <span className="text-neutral-600">Date of decision / reference</span><span className="tabular">{r.decidedOn ? `${d(r.decidedOn)}${r.commissionerRef ? ` · ${r.commissionerRef}` : ""}` : r.state === "deemed" ? d(r.deemedOn) : "—"}</span>
          {r.rejectReason && <><span className="text-neutral-600">Reason for refusal</span><span>{r.rejectReason}</span></>}
        </div>
        <div className="mt-8 ml-auto w-64 border-t border-neutral-500 pt-1 text-center text-xs">Commissioner / authorised officer</div>
      </section>
      <p className="mt-4 text-[0.6875rem] text-neutral-600">Apply within {LATE_APPLY_DAYS} days after the end of the tax period (by {d(r.applyBy)} for {periodLabel(r.period)}). Permission may be given for at most one month from the due date ({d(r.maxDate)}). Penalty for late submission is waived up to the permitted date; interest on late payment still runs from the due date.</p>
    </article>
  )
}
