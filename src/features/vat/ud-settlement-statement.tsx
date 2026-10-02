"use client"

import { useQuery } from "@tanstack/react-query"
import { useCompany } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { BondUdRow } from "@/lib/types"

/** Printable UD settlement statement (imports against the UD vs consumption by its exports, and the disposal). */
export function UdSettlementStatement({ ud }: { ud: BondUdRow }) {
  const company = useCompany()
  const settings = useQuery({ queryKey: ["vat", "settings"], queryFn: api.vat.settings, staleTime: 5 * 60_000 })
  const p = settings.data?.profile
  const n3 = (n: number) => fmtNum(n, "en", 3)
  const m = (n: number) => fmtMoney(n, "en")
  const cell = "border border-neutral-400 p-1"
  const s = ud.settlement
  const issuer = { BGMEA: "BGMEA", BKMEA: "BKMEA", Customs: "Customs Bond Commissionerate" }[ud.issuer]
  return (
    <article className="print-area relative mx-auto w-full max-w-[297mm] overflow-hidden bg-white p-6 text-[0.75rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label={`UD settlement statement ${ud.no}`} data-testid="ud-statement">
      <header className="mb-4 text-center">
        <p className="text-[0.6875rem] text-neutral-600">Customs Bond Commissionerate — bonded warehouse (Customs Act 1969, s.114)</p>
        <h2 className="mt-1 text-lg font-bold">{ud.kind === "UD" ? "Utilization Declaration" : "Utilization Permission"} settlement statement</h2>
        <p lang="bn" className="text-sm">ইউডি/ইউপি নিষ্পত্তি বিবরণী</p>
        {!s && <p className="mt-1 inline-block rounded border border-neutral-500 px-2 text-[0.6875rem] font-semibold uppercase">Draft — not yet settled</p>}
      </header>
      <section className="mb-4 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 print:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt className="text-neutral-500">Licensee</dt><dd className="font-semibold">{company.name}</dd>
          <dt className="text-neutral-500">BIN</dt><dd className="tabular">{company.bin}</dd>
          <dt className="text-neutral-500">Bond licence</dt><dd className="tabular">{p?.bondLicenseNo || "—"}</dd>
          <dt className="text-neutral-500">Buyer</dt><dd>{ud.buyer ?? "—"}</dd>
        </dl>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-2 gap-y-1">
          <dt className="text-neutral-500">{ud.kind} no.</dt><dd className="font-semibold tabular">{ud.no} ({issuer})</dd>
          <dt className="text-neutral-500">Date / expiry</dt><dd className="tabular">{fmtDate(ud.date, "en", "dd/MM/yyyy")} — {fmtDate(ud.expiry, "en", "dd/MM/yyyy")}</dd>
          <dt className="text-neutral-500">Export LC / contract</dt><dd className="tabular">{ud.masterLcNo}{ud.masterLcValue ? ` · ${ud.currency ?? "USD"} ${fmtNum(ud.masterLcValue, "en", 2)}` : ""}</dd>
          <dt className="text-neutral-500">Settled</dt><dd className="tabular">{s ? `${fmtDate(s.date, "en", "dd/MM/yyyy")} · ${s.bondRef}` : "—"}</dd>
        </dl>
      </section>
      <h3 className="mb-1 font-semibold">A. Goods exported under the {ud.kind}</h3>
      <table className="mb-4 w-full border-collapse text-[0.6875rem]">
        <thead><tr className="bg-neutral-100 text-left"><th scope="col" className={cell}>Garment</th><th scope="col" className={`${cell} text-right`}>Ordered</th><th scope="col" className={`${cell} text-right`}>Exported</th><th scope="col" className={cell}>Export invoices</th></tr></thead>
        <tbody>{ud.garmentsProgress.map((g) => (
          <tr key={g.itemId}><td className={cell}>{g.name}</td><td className={`${cell} text-right tabular`}>{n3(g.ordered)} {g.uom}</td><td className={`${cell} text-right tabular`}>{n3(g.shipped)} {g.uom}</td>
            <td className={`${cell} tabular`}>{g.exports.map((x) => `${x.invoiceNo} (${fmtDate(x.date, "en", "dd/MM/yyyy")}, ${n3(x.qty)})`).join("; ") || "—"}</td></tr>
        ))}</tbody>
      </table>
      <h3 className="mb-1 font-semibold">B. Bonded inputs — brought in vs consumed (input–output coefficient)</h3>
      <div className="overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label="Settlement statement">
        <table className="w-full min-w-[900px] border-collapse text-[0.6875rem] print:min-w-0">
          <thead><tr className="bg-neutral-100 text-left">
            <th scope="col" className={cell}>Input</th>
            <th scope="col" className={`${cell} text-right`}>{ud.kind} qty</th>
            <th scope="col" className={`${cell} text-right`}>Brought fwd</th>
            <th scope="col" className={`${cell} text-right`}>Imported</th>
            <th scope="col" className={`${cell} text-right`}>Consumed</th>
            <th scope="col" className={`${cell} text-right`}>From other stock</th>
            <th scope="col" className={`${cell} text-right`}>Balance</th>
            <th scope="col" className={`${cell} text-right`}>Duty on balance (৳)</th>
            <th scope="col" className={cell}>Disposal</th>
          </tr></thead>
          <tbody>{ud.lines.map((l) => {
            const sl = s?.lines.find((x) => x.itemId === l.itemId)
            return (
              <tr key={l.itemId} className="align-top" data-testid={`ud-line-${l.itemId}`}>
                <td className={cell}>{l.name}<span className="block text-neutral-500 tabular">{l.boes.map((b) => b.boeNo).join(", ")}{l.carriedIn.length ? ` · from ${l.carriedIn.map((c) => c.fromUd).join(", ")}` : ""}</span></td>
                <td className={`${cell} text-right tabular`}>{n3(l.permitted)}</td>
                <td className={`${cell} text-right tabular`}>{n3(l.broughtForward)}</td>
                <td className={`${cell} text-right tabular`}>{n3(l.imported)}{l.excessImport > 0 && <span className="block font-semibold">+{n3(l.excessImport)} over</span>}</td>
                <td className={`${cell} text-right tabular`}>{n3(l.consumed)}</td>
                <td className={`${cell} text-right tabular`}>{n3(l.fromOtherStock)}</td>
                <td className={`${cell} text-right font-semibold tabular`}>{n3(l.balance)} {l.uom}</td>
                <td className={`${cell} text-right tabular`}>{m(l.dutyOnBalance)}</td>
                <td className={cell}>{sl ? [sl.dutyPaidQty > 0 ? `Duty paid on ${n3(sl.dutyPaidQty)}: ৳ ${m(sl.dutyPaid)}` : "", sl.carryQty > 0 ? `Carried to ${sl.carryTo}: ${n3(sl.carryQty)}` : ""].filter(Boolean).join("; ") || "Nil" : l.balance > 0 ? "To be settled" : "Nil"}</td>
              </tr>
            )
          })}
            {s && <tr className="bg-neutral-100 font-bold"><td className={cell} colSpan={8}>Duty paid on settlement{s.paymentRef ? ` (${s.paymentRef})` : ""}</td><td className={`${cell} tabular`}>৳ {m(s.dutyPaid)}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[0.6875rem] text-neutral-600">Consumption = garments exported × the gross input quantity (incl. wastage) of the approved Mushak 4.3 coefficient in force on each export date. Consumption beyond the inputs brought in under this {ud.kind} was met from duty-paid, local or other bonded stock. A balance is carried to another {ud.kind} of the licensee or cleared on payment of the full duty; imports beyond the {ud.kind} quantity attract duty.</p>
      <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-[0.6875rem]">
        <div className="border-t border-neutral-500 pt-1">Authorised signatory, {company.name}</div>
        <div className="border-t border-neutral-500 pt-1">Revenue Officer, Customs Bond Commissionerate</div>
      </footer>
    </article>
  )
}
