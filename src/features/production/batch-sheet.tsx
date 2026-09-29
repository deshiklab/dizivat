"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCheck, Loader2, PackageCheck, Pencil, Printer, Trash2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money, Num } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import type { Batch } from "@/lib/types"
import { useR3Actions, useR3Refresh } from "@/features/r3/use-r3-actions"
import { DetailList, MiniTable, ModePill } from "./parts"
import { Mushak64 } from "./mushak-64"

/** Read view of a production batch: output lines, input consumption, contractual receipt, Mushak 6.4 print and history. */
export function BatchSheet({ id, onOpenChange, onEdit, initialTab }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; initialTab?: string }) {
  const t = useTranslations("batch")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["batch", id], queryFn: () => api.production.batches.get(id!), enabled: !!id })
  const actions = useR3Actions("batch", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const contractual = d?.mode === "contractual"
  const awaiting = !!d && contractual && d.process === "Approved" && !d.receivedAt
  const canReceive = awaiting && can("doc.edit")
  const print = () => { setTab("mushak"); setTimeout(() => window.print(), 200) }
  const current = tab === "receive" && !canReceive ? "details" : tab === "mushak" && !contractual ? "details" : tab

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <ModePill mode={d.mode} /> <ProcessBadge value={d.process} />{awaiting && <Pill tone="warning">{t("awaiting")}</Pill>}</> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${fmtDate(d.issueDate, locale)}${d.vendorName ? ` · ${d.vendorName}` : ""} · ${d.branchName}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={current} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="no-print mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                {canReceive && <TabsTrigger value="receive">{t("tabReceive")}</TabsTrigger>}
                {contractual && <TabsTrigger value="mushak">{t("tabMushak")}</TabsTrigger>}
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t(d.mode === "opening" ? "draftNoteOpening" : "draftNote")} />
                <DetailList rows={[
                  [t("field.mode"), <ModePill key="m" mode={d.mode} />],
                  [t("field.issueDate"), `${fmtDate(d.issueDate, locale)}${d.issueTime ? ` · ${d.issueTime}` : ""}`],
                  [t("field.receiveDate"), d.receiveDate ? fmtDate(d.receiveDate, locale) : awaiting ? t("awaiting") : "—"],
                  ...(contractual ? [
                    [t("field.vendor"), <span key="v">{d.vendorName}<span className="block text-xs text-muted-foreground tabular">{d.vendorBin}</span></span>],
                    [t("field.address"), d.address || d.vendorAddress || "—"],
                  ] as [string, React.ReactNode][] : []),
                  [t("field.branch"), d.branchName],
                  [t("field.issuedBy"), `${d.issuedBy} · ${d.designation}`],
                  [t("field.remark"), d.remark || "—"],
                ]} />
                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("outputTitle")}</h3>
                  <MiniTable caption={t("outputTitle")} minWidth={760} head={[
                    { label: t("col.item") }, { label: t("col.workOrder") }, { label: t("col.issue"), right: true }, { label: t("col.receive"), right: true },
                    { label: t("col.damage"), right: true }, { label: t("col.unitCost"), right: true }, { label: t("col.value"), right: true },
                  ]} foot={
                    <tr className="border-t bg-muted/30 font-semibold">
                      <th scope="row" colSpan={2} className="px-3 py-2 text-left">{t("col.total")}</th>
                      <td className="px-3 py-2 text-right"><Num value={d.totalIssue} digits={2} /></td>
                      <td className="px-3 py-2 text-right"><Num value={d.totalReceive} digits={2} /></td>
                      <td className="px-3 py-2 text-right"><Num value={d.totalDamage} digits={2} /></td>
                      <td />
                      <td className="px-3 py-2 text-right"><Money value={d.value} /></td>
                    </tr>
                  }>
                    {d.lines.map((l, i) => (
                      <tr key={`${l.itemId}-${i}`} className="border-b last:border-0">
                        <td className="px-3 py-2"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground tabular">{l.sku}{l.bomVersion ? ` · ${t("bomV", { v: l.bomVersion })}` : ""}</span></td>
                        <td className="px-3 py-2 tabular">{l.workOrderId ? <Link href={`/production/work-orders?view=${l.workOrderId}`} className="hover:underline">{l.workOrderNo}</Link> : "—"}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={l.issueQty} digits={2} /> {l.uom}</td>
                        <td className="px-3 py-2 text-right"><Num value={l.receiveQty} digits={2} /></td>
                        <td className="px-3 py-2 text-right"><Num value={l.damageQty} digits={2} /></td>
                        <td className="px-3 py-2 text-right"><Money value={l.unitCost} /></td>
                        <td className="px-3 py-2 text-right font-medium"><Money value={l.value} /></td>
                      </tr>
                    ))}
                  </MiniTable>
                </section>
                {d.consumption.length > 0 && (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-semibold">{t("consumptionTitle")}</h3>
                    <MiniTable caption={t("consumptionTitle")} minWidth={520} head={[{ label: t("col.input") }, { label: t("col.qty"), right: true }, { label: t("col.unitPrice"), right: true }, { label: t("col.value"), right: true }]}
                      foot={<tr className="border-t bg-muted/30 font-semibold"><th scope="row" colSpan={3} className="px-3 py-2 text-left">{t("col.material")}</th><td className="px-3 py-2 text-right"><Money value={d.materialValue} /></td></tr>}>
                      {d.consumption.map((c) => (
                        <tr key={c.itemId} className="border-b last:border-0">
                          <td className="px-3 py-2">{c.name}<span className="block text-xs text-muted-foreground tabular">{c.sku}</span></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={c.qty} digits={3} /> {c.uom}</td>
                          <td className="px-3 py-2 text-right"><Money value={c.price} /></td>
                          <td className="px-3 py-2 text-right"><Money value={c.value} /></td>
                        </tr>
                      ))}
                    </MiniTable>
                    <p className="text-xs text-muted-foreground">{t(d.process === "Approved" ? "consumptionPosted" : "consumptionPending")}</p>
                  </section>
                )}
                <HistoryCard history={d.history} />
              </TabsContent>
              {canReceive && <TabsContent value="receive" className="min-h-0 flex-1 overflow-y-auto p-4"><ReceiveForm d={d} onDone={() => setTab("details")} /></TabsContent>}
              {contractual && <TabsContent value="mushak" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak64 batch={d} /></TabsContent>}
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="no-print flex-row flex-wrap justify-end gap-2 border-t">
          {d && contractual && <Button variant="outline" onClick={print}><Printer /> {t("print")}</Button>}
          {canReceive && current !== "receive" && <Button variant="outline" onClick={() => setTab("receive")}><PackageCheck /> {t("receive")}</Button>}
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

/** Contractual batch: record the finished goods returned by the contract manufacturer (received + damaged ≤ issued). */
function ReceiveForm({ d, onDone }: { d: Batch; onDone: () => void }) {
  const t = useTranslations("batch")
  const tv = useTranslations("validation")
  const refresh = useR3Refresh()
  const [date, setDate] = React.useState(TODAY)
  const [rows, setRows] = React.useState(() => d.lines.map((l) => ({ receiveQty: l.issueQty, damageQty: 0 })))
  const [errs, setErrs] = React.useState<Record<string, string>>({})
  const over = rows.map((r, i) => r.receiveQty + r.damageQty > d.lines[i].issueQty + 1e-9)
  const save = useMutation({
    mutationFn: () => api.production.batches.receive(d.id, { receiveDate: date, lines: rows }),
    onSuccess: (b) => { refresh("batch", b); toast.success(t("received", { no: b.no })); onDone() },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrs(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])))
      toast.error(e.message)
    },
  })
  const set = (i: number, k: "receiveQty" | "damageQty", v: number) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: Number.isFinite(v) ? v : 0 } : x)))
  const msg = (k: string) => (errs[k] ? (tv.has(errs[k]) ? tv(errs[k]) : errs[k]) : undefined)
  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); if (!over.some(Boolean)) save.mutate() }}>
      <p className="text-sm text-muted-foreground">{t("receiveSub", { vendor: d.vendorName ?? "" })}</p>
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="receiveDate">{t("field.receiveDate")}<span className="text-destructive" aria-hidden> *</span></Label>
        <Input id="receiveDate" type="date" min={d.issueDate} max={TODAY} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errs.receiveDate || undefined} aria-describedby={errs.receiveDate ? "receiveDate-err" : undefined} />
        {errs.receiveDate && <p id="receiveDate-err" className="text-xs font-medium text-destructive">{msg("receiveDate")}</p>}
      </div>
      <MiniTable caption={t("outputTitle")} minWidth={560} head={[{ label: t("col.item") }, { label: t("col.issue"), right: true }, { label: t("col.receive"), right: true }, { label: t("col.damage"), right: true }]}>
        {d.lines.map((l, i) => (
          <tr key={`${l.itemId}-${i}`} className="border-b last:border-0 align-top">
            <td className="px-3 py-2">{l.name}{over[i] && <span role="alert" className="block text-xs font-medium text-destructive">{tv("exceedsIssue")}</span>}{msg(`lines.${i}.receiveQty`) && <span className="block text-xs text-destructive">{msg(`lines.${i}.receiveQty`)}</span>}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={l.issueQty} digits={2} /> {l.uom}</td>
            <td className="px-3 py-2"><Input type="number" inputMode="decimal" step="any" min={0} className="ml-auto w-28 text-right tabular" aria-label={t("receiveQtyFor", { item: l.name })} aria-invalid={over[i] || undefined} value={rows[i].receiveQty} onChange={(e) => set(i, "receiveQty", e.target.valueAsNumber)} /></td>
            <td className="px-3 py-2"><Input type="number" inputMode="decimal" step="any" min={0} className="ml-auto w-28 text-right tabular" aria-label={t("damageQtyFor", { item: l.name })} aria-invalid={over[i] || undefined} value={rows[i].damageQty} onChange={(e) => set(i, "damageQty", e.target.valueAsNumber)} /></td>
          </tr>
        ))}
      </MiniTable>
      <p className="text-xs text-muted-foreground">{t("receiveNote")}</p>
      <Button type="submit" className="justify-self-start" disabled={save.isPending || over.some(Boolean)}>{save.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />} {t("saveReceive")}</Button>
    </form>
  )
}
