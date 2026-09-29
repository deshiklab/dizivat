"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { CheckCheck, Pencil, Printer, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan, useCompany } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { amountInWords, fmtDate, fmtMoney } from "@/lib/format"
import { METHOD_TONE } from "@/lib/r4"
import type { MoneyDoc, MoneyKind } from "@/lib/types"
import { DefList, useR4Actions } from "@/features/r4/r4-actions"

/** Read view of a receipt / payment with its printable money receipt / payment voucher and history. */
export function MoneySheet({ kind, id, onOpenChange, onEdit, initialTab }: { kind: MoneyKind; id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; initialTab?: string }) {
  const t = useTranslations("money")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const res = kind === "receipt" ? api.accounting.receipts : api.accounting.payments
  const { data: d, isLoading, error } = useQuery({ queryKey: ["r4doc", kind, id], queryFn: () => res.get(id!), enabled: !!id })
  const actions = useR4Actions(kind, { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const print = () => { setTab("print"); setTimeout(() => window.print(), 200) }
  const invHref = (docId: string) => (kind === "receipt" ? `/sales/${docId}` : `/purchases/${docId}`)

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ProcessBadge value={d.process} /></> : t(`${kind}.titleOne`)}</SheetTitle>
          <SheetDescription>{d ? `${d.partyName} · ${fmtDate(d.date, locale)}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="no-print mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="print">{t(`${kind}.tabPrint`)}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t(`${kind}.draftNote`)} />
                <DefList rows={[
                  [t(`${kind}.party`), <span key="p">{d.partyName}<span className="block text-xs text-muted-foreground tabular">{d.partyBin}</span></span>],
                  [t("field.date"), fmtDate(d.date, locale)],
                  [t("field.method"), <Pill key="m" tone={METHOD_TONE[d.method]}>{t(`method.${d.method}`)}</Pill>],
                  [t(`${kind}.account`), d.accountName],
                  ...(d.method === "cheque" ? [[t("field.cheque"), `${d.chequeNo} · ${d.chequeDate ? fmtDate(d.chequeDate, locale) : ""}${d.chequeBank ? ` · ${d.chequeBank}` : ""}`] as [string, React.ReactNode]] : []),
                  [t(d.method === "mobile" ? "field.trxId" : "field.reference"), d.reference || "—"],
                  [t("field.amount"), <Money key="a" value={d.amount} className="font-semibold" />],
                  ...(kind === "receipt" ? [[t("field.charge"), <Money key="c" value={d.charge} />] as [string, React.ReactNode]] : []),
                  [t("field.note"), d.note || "—"],
                  [t("field.issuedBy"), d.issuedBy || "—"],
                ]} />
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("allocations")}</h3>
                  <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("allocations")}>
                    <table className="w-full min-w-[480px] text-sm">
                      <caption className="sr-only">{t("allocations")}</caption>
                      <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">{t("col.invoice")}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t("col.date")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.total")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.allocated")}</th>
                      </tr></thead>
                      <tbody>
                        {d.allocations.map((a) => (
                          <tr key={a.docId} className="border-b last:border-0">
                            <td className="px-3 py-2"><Link href={invHref(a.docId)} className="font-medium text-primary hover:underline tabular">{a.docNo}</Link></td>
                            <td className="px-3 py-2 tabular">{fmtDate(a.docDate, locale)}</td>
                            <td className="px-3 py-2 text-right"><Money value={a.docTotal} /></td>
                            <td className="px-3 py-2 text-right font-medium"><Money value={a.amount} /></td>
                          </tr>
                        ))}
                        {d.unallocated > 0 && (
                          <tr className="border-b last:border-0"><td colSpan={3} className="px-3 py-2"><Pill tone="info">{t("advance")}</Pill> <span className="text-xs text-muted-foreground">{t("advanceNote")}</span></td><td className="px-3 py-2 text-right"><Money value={d.unallocated} /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="print" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><MoneyPrint d={d} /></TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="no-print flex-row flex-wrap justify-end gap-2 border-t">
          {d && <Button variant="outline" onClick={print}><Printer /> {t("print")}</Button>}
          {d && draft && can("doc.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("doc.delete") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && d.process !== "Cancelled" && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}

/** Money receipt (customer) / payment voucher (supplier), A5-style printout. */
function MoneyPrint({ d }: { d: MoneyDoc }) {
  const t = useTranslations("money")
  const company = useCompany()
  const k = d.kind
  const m = (n: number) => fmtMoney(n, "en")
  return (
    <article className="print-area mx-auto w-full max-w-[210mm] bg-white p-6 text-[0.8125rem] text-neutral-900 shadow-sm ring-1 ring-neutral-200 sm:p-8 print:p-0 print:shadow-none print:ring-0" aria-label={t(`${k}.printTitle`)}>
      <header className="mb-4 border-b border-neutral-300 pb-3 text-center">
        <p className="text-base font-bold">{company.name}</p>
        <p className="text-xs text-neutral-600">{company.address} · BIN {company.bin}</p>
        <h2 className="mt-2 text-lg font-semibold tracking-wide uppercase">{t(`${k}.printTitle`)}</h2>
      </header>
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <div className="flex gap-2"><dt className="text-neutral-500">{t("col.no")}:</dt><dd className="font-medium tabular">{d.no}</dd></div>
        <div className="flex justify-end gap-2"><dt className="text-neutral-500">{t("col.date")}:</dt><dd className="tabular">{fmtDate(d.date, "en")}</dd></div>
        <div className="col-span-2 flex gap-2"><dt className="text-neutral-500">{t(`${k}.printParty`)}:</dt><dd className="font-medium">{d.partyName} <span className="text-neutral-500 tabular">(BIN {d.partyBin})</span></dd></div>
        <div className="col-span-2 flex gap-2"><dt className="text-neutral-500">{t("field.method")}:</dt><dd>{t(`method.${d.method}`)} — {d.accountName}{d.chequeNo ? ` · ${t("field.cheque")} ${d.chequeNo} (${d.chequeDate})` : ""}{d.reference ? ` · ${d.reference}` : ""}</dd></div>
      </dl>
      <table className="mb-3 w-full border-collapse text-xs">
        <thead><tr className="bg-neutral-100 text-left">
          <th scope="col" className="border border-neutral-300 px-2 py-1">{t("col.invoice")}</th>
          <th scope="col" className="border border-neutral-300 px-2 py-1">{t("col.date")}</th>
          <th scope="col" className="border border-neutral-300 px-2 py-1 text-right">{t("col.total")}</th>
          <th scope="col" className="border border-neutral-300 px-2 py-1 text-right">{t("col.allocated")}</th>
        </tr></thead>
        <tbody>
          {d.allocations.map((a) => <tr key={a.docId}><td className="border border-neutral-300 px-2 py-1 tabular">{a.docNo}</td><td className="border border-neutral-300 px-2 py-1 tabular">{fmtDate(a.docDate, "en")}</td><td className="border border-neutral-300 px-2 py-1 text-right tabular">{m(a.docTotal)}</td><td className="border border-neutral-300 px-2 py-1 text-right tabular">{m(a.amount)}</td></tr>)}
          {d.unallocated > 0 && <tr><td colSpan={3} className="border border-neutral-300 px-2 py-1">{t("advance")}</td><td className="border border-neutral-300 px-2 py-1 text-right tabular">{m(d.unallocated)}</td></tr>}
        </tbody>
        <tfoot><tr className="font-semibold"><th scope="row" colSpan={3} className="border border-neutral-300 px-2 py-1 text-left">{t("field.amount")}</th><td className="border border-neutral-300 px-2 py-1 text-right tabular">{m(d.amount)}</td></tr></tfoot>
      </table>
      <p className="mb-10 text-xs"><span className="text-neutral-500">{t("inWords")}:</span> {amountInWords(d.amount)}</p>
      <footer className="grid grid-cols-3 gap-6 text-center text-xs">
        {(["preparedBy", "checkedBy", k === "receipt" ? "receivedBy" : "authorisedBy"] as const).map((s) => <p key={s} className="border-t border-neutral-400 pt-1">{t(`sign.${s}`)}</p>)}
      </footer>
    </article>
  )
}
