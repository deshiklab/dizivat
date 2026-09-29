"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, CheckCheck, CopyPlus, Pencil, Printer, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Money, Num } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { DocBanner, HistoryCard } from "@/features/docs/doc-parts"
import { RecordHistory } from "@/features/audit/record-history"
import { api } from "@/lib/api/client"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import { round2 } from "@/lib/vat"
import type { BomRow } from "@/lib/types"
import { useR3Actions } from "@/features/r3/use-r3-actions"
import { BomStatusPill, DetailList, MiniTable } from "./parts"
import { Mushak43 } from "./mushak-43"

/** Read view of one price declaration: coefficients, value addition, version compare, Mushak 4.3 print and history. */
export function BomSheet({ id, onOpenChange, onEdit, onAmend, initialTab }: {
  id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void; onAmend: (id: string) => void; initialTab?: string
}) {
  const t = useTranslations("bom")
  const td = useTranslations("docs")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const [tab, setTab] = React.useState(initialTab ?? "details")
  React.useEffect(() => { setTab(initialTab ?? "details") }, [id, initialTab])
  const { data: d, isLoading, error } = useQuery({ queryKey: ["bom", id], queryFn: () => api.production.boms.get(id!), enabled: !!id })
  const actions = useR3Actions("bom", { onDeleted: () => onOpenChange(false) })
  const draft = d?.process === "Created"
  const print = () => { setTab("mushak"); setTimeout(() => window.print(), 200) }
  const others = (d?.versions ?? []).filter((v) => v.id !== d?.id)
  const hasDraft = (d?.versions ?? []).some((v) => v.process === "Created")

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
        <SheetHeader className="no-print border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2">{d ? <>{d.no} <BomStatusPill status={d.status} /></> : t("titleOne")}</SheetTitle>
          <SheetDescription>{d ? `${d.itemName} · ${t("effectiveFrom", { date: fmtDate(d.effectiveDate, locale) })}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
          : error || !d ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as string)} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="no-print mx-4 mt-3">
                <TabsTrigger value="details">{t("tabDetails")}</TabsTrigger>
                <TabsTrigger value="compare" disabled={!others.length}>{t("tabCompare")}</TabsTrigger>
                <TabsTrigger value="mushak">{t("tabMushak")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
                <DocBanner doc={d} draftNote={t("draftNote")} />
                {d.status === "superseded" && <p role="status" className="rounded-md bg-muted p-3 text-sm">{t("supersededNote", { date: d.supersededAt ? fmtDate(d.supersededAt, locale) : "—" })}</p>}
                <DetailList rows={[
                  [t("field.item"), <span key="i">{d.itemName}<span className="block text-xs text-muted-foreground tabular">{d.sku} · HS {d.hsCode} · {d.uom}</span></span>],
                  [t("field.version"), <span key="v" className="tabular">v{fmtNum(d.version, locale)} {others.length ? `· ${t("versionsCount", { n: fmtNum(others.length + 1, locale) })}` : ""}</span>],
                  [t("field.effectiveDate"), fmtDate(d.effectiveDate, locale)],
                  [t("field.licenseDate"), d.licenseDate ? fmtDate(d.licenseDate, locale) : t("notSubmitted")],
                  ...(d.amendmentReason ? [[t("field.amendmentReason"), d.amendmentReason] as [string, string]] : []),
                  ...(d.note ? [[t("field.note"), d.note] as [string, string]] : []),
                ]} />
                <InputsTable d={d} />
                <CostsTable d={d} />
                <Summary d={d} />
                <HistoryCard history={d.history} />
              </TabsContent>
              <TabsContent value="compare" className="min-h-0 flex-1 overflow-y-auto p-4">{others.length > 0 && <Compare d={d} others={others} />}</TabsContent>
              <TabsContent value="mushak" className="min-h-0 flex-1 overflow-y-auto bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak43 bom={d} /></TabsContent>
              <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-4"><RecordHistory entityId={d.id} /></TabsContent>
            </Tabs>
          )}
        <SheetFooter className="no-print flex-row flex-wrap justify-end gap-2 border-t">
          {d && <Button variant="outline" onClick={print}><Printer /> {t("print")}</Button>}
          {d && d.status === "active" && !hasDraft && can("master.edit") && <Button variant="outline" onClick={() => onAmend(d.id)}><CopyPlus /> {t("amend")}</Button>}
          {d && draft && can("master.edit") && <Button variant="outline" onClick={() => onEdit(d.id)}><Pencil /> {td("edit")}</Button>}
          {d && draft && can("master.edit") && <Button variant="outline" disabled={actions.busy} onClick={() => actions.askDelete(d)}><Trash2 /> {td("delete")}</Button>}
          {d && draft && can("doc.cancel") && <Button variant="destructive" disabled={actions.busy} onClick={() => actions.askCancel(d)}><XCircle /> {td("cancel")}</Button>}
          {d && draft && can("doc.approve") && <Button disabled={actions.busy} onClick={() => actions.approve(d)}><CheckCheck /> {td("approve")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
        {actions.dialog}
      </SheetContent>
    </Sheet>
  )
}

function InputsTable({ d }: { d: BomRow }) {
  const t = useTranslations("bom")
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("inputsTitle", { uom: d.uom })}</h3>
      <MiniTable caption={t("inputsTitle", { uom: d.uom })} minWidth={720} head={[
        { label: t("col.input") }, { label: t("col.qty"), right: true }, { label: t("col.wastagePct"), right: true }, { label: t("col.wastageQty"), right: true },
        { label: t("col.grossQty"), right: true }, { label: t("col.unitPrice"), right: true }, { label: t("col.value"), right: true },
      ]} foot={
        <tr className="border-t bg-muted/30 font-semibold">
          <th scope="row" colSpan={6} className="px-3 py-2 text-left">{t("col.material")}</th>
          <td className="px-3 py-2 text-right"><Money value={d.materialValue} /></td>
        </tr>
      }>
        {d.inputs.map((l) => (
          <tr key={l.itemId} className="border-b last:border-0">
            <td className="px-3 py-2"><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground tabular">{l.sku}</span></td>
            <td className="px-3 py-2 text-right whitespace-nowrap"><Num value={l.qty} digits={4} /> {l.uom}</td>
            <td className="px-3 py-2 text-right tabular"><Num value={l.wastagePct} digits={2} />%</td>
            <td className="px-3 py-2 text-right"><Num value={l.wastageQty} digits={4} /></td>
            <td className="px-3 py-2 text-right font-medium"><Num value={l.grossQty} digits={4} /></td>
            <td className="px-3 py-2 text-right"><Money value={l.price} /></td>
            <td className="px-3 py-2 text-right"><Money value={l.value} /></td>
          </tr>
        ))}
      </MiniTable>
    </section>
  )
}

function CostsTable({ d }: { d: BomRow }) {
  const t = useTranslations("bom")
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("costsTitle")}</h3>
      <MiniTable caption={t("costsTitle")} minWidth={360} head={[{ label: t("col.head") }, { label: t("col.amount"), right: true }]} foot={
        <tr className="border-t bg-muted/30 font-semibold"><th scope="row" className="px-3 py-2 text-left">{t("col.valueAdded")}</th><td className="px-3 py-2 text-right"><Money value={d.valueAdded} /></td></tr>
      }>
        {d.costs.filter((c) => c.amount > 0).map((c) => (
          <tr key={c.head} className="border-b last:border-0"><td className="px-3 py-2">{t(`head.${c.head}`)}</td><td className="px-3 py-2 text-right"><Money value={c.amount} /></td></tr>
        ))}
      </MiniTable>
    </section>
  )
}

function Summary({ d }: { d: BomRow }) {
  const t = useTranslations("bom")
  const locale = useLocale()
  const margin = d.salePrice ? round2(((d.salePrice - d.price) / d.price) * 100) : 0
  return (
    <section className="grid gap-2 rounded-md border p-4 text-sm" aria-label={t("summaryTitle")}>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
        <dt className="text-muted-foreground">{t("col.material")}</dt><dd className="text-right"><Money value={d.materialValue} /></dd>
        <dt className="text-muted-foreground">{t("wastageIncluded")}</dt><dd className="text-right text-muted-foreground"><Money value={d.wastageValue} /></dd>
        <dt className="text-muted-foreground">{t("col.valueAdded")}</dt><dd className="text-right"><Money value={d.valueAdded} /></dd>
        <dt className="border-t pt-1.5 font-semibold">{t("col.price")}</dt><dd className="border-t pt-1.5 text-right font-semibold"><Money value={d.price} /></dd>
        <dt className="text-muted-foreground">{t("col.unitCost")}</dt><dd className="text-right"><Money value={d.unitCost} /></dd>
        <dt className="text-muted-foreground">{t("col.salePrice")}</dt><dd className="text-right"><Money value={d.salePrice} /></dd>
      </dl>
      {d.salePrice > 0 && d.salePrice < d.price && <p role="status" className="rounded-md bg-warning-soft p-2 text-xs">{t("belowDeclared", { pct: fmtNum(Math.abs(margin), locale, 1) })}</p>}
      <p className="text-xs text-muted-foreground">{t("unitCostHint")}</p>
    </section>
  )
}

/** Side-by-side comparison with another version of the same item (default: the previous one). */
function Compare({ d, others }: { d: BomRow; others: BomRow[] }) {
  const t = useTranslations("bom")
  const locale = useLocale()
  const prev = others.filter((o) => o.version < d.version).sort((a, b) => b.version - a.version)[0] ?? others[0]
  const [otherId, setOtherId] = React.useState(prev.id)
  const picked = others.find((x) => x.id === otherId) ?? prev
  // always older → newer, so "change" reads as what the newer version did
  const [o, n] = picked.version < d.version ? [picked, d] : [d, picked]
  const ids = [...new Set([...o.inputs.map((i) => i.itemId), ...n.inputs.map((i) => i.itemId)])]
  const heads = [...new Set([...o.costs, ...n.costs].filter((c) => c.amount > 0).map((c) => c.head))]
  const delta = (a: number, b: number, money = true) => {
    const x = round2(b - a)
    if (Math.abs(x) < 0.00005) return <span className="text-muted-foreground">—</span>
    const Icon = x > 0 ? ArrowUp : ArrowDown
    return <span className={`inline-flex items-center gap-0.5 tabular ${x > 0 ? "text-destructive" : "text-success"}`}><Icon className="size-3" aria-hidden />{money ? fmtMoney(Math.abs(x), locale) : fmtNum(Math.abs(x), locale, 4)}<span className="sr-only">{x > 0 ? t("increase") : t("decrease")}</span></span>
  }
  const label = (b: BomRow) => `v${fmtNum(b.version, locale)} · ${fmtDate(b.effectiveDate, locale)} · ${t(`status.${b.status}`)}`
  const vA = `v${fmtNum(o.version, locale)}`, vB = `v${fmtNum(n.version, locale)}`
  return (
    <div className="grid gap-4">
      <div className="grid max-w-sm gap-1.5">
        <Label htmlFor="compare-with">{t("compareWith")}</Label>
        <Select value={otherId} onValueChange={(v) => setOtherId(v as string)} items={others.map((x) => ({ value: x.id, label: label(x) }))}>
          <SelectTrigger id="compare-with" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{others.map((x) => <SelectItem key={x.id} value={x.id}>{label(x)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <MiniTable caption={t("compareInputs")} minWidth={680} head={[
        { label: t("col.input") }, { label: `${t("col.grossQty")} ${vA}`, right: true }, { label: `${t("col.grossQty")} ${vB}`, right: true }, { label: t("col.change"), right: true },
        { label: `${t("col.value")} ${vA}`, right: true }, { label: `${t("col.value")} ${vB}`, right: true }, { label: t("col.change"), right: true },
      ]}>
        {ids.map((id) => {
          const a = o.inputs.find((i) => i.itemId === id), b = n.inputs.find((i) => i.itemId === id)
          return (
            <tr key={id} className="border-b last:border-0">
              <td className="px-3 py-2">{(b ?? a)!.name}{!a && <span className="ml-1 text-xs text-primary">({t("added")})</span>}{!b && <span className="ml-1 text-xs text-destructive">({t("removed")})</span>}</td>
              <td className="px-3 py-2 text-right">{a ? <Num value={a.grossQty} digits={4} /> : "—"}</td>
              <td className="px-3 py-2 text-right">{b ? <Num value={b.grossQty} digits={4} /> : "—"}</td>
              <td className="px-3 py-2 text-right">{delta(a?.grossQty ?? 0, b?.grossQty ?? 0, false)}</td>
              <td className="px-3 py-2 text-right">{a ? <Money value={a.value} /> : "—"}</td>
              <td className="px-3 py-2 text-right">{b ? <Money value={b.value} /> : "—"}</td>
              <td className="px-3 py-2 text-right">{delta(a?.value ?? 0, b?.value ?? 0)}</td>
            </tr>
          )
        })}
      </MiniTable>
      <MiniTable caption={t("compareTotals")} minWidth={480} head={[{ label: t("col.head") }, { label: vA, right: true }, { label: vB, right: true }, { label: t("col.change"), right: true }]}>
        {[
          ...heads.map((h) => [t(`head.${h}`), o.costs.find((c) => c.head === h)?.amount ?? 0, n.costs.find((c) => c.head === h)?.amount ?? 0] as const),
          [t("col.material"), o.materialValue, n.materialValue] as const,
          [t("col.valueAdded"), o.valueAdded, n.valueAdded] as const,
          [t("col.price"), o.price, n.price] as const,
        ].map(([k, a, b], i, arr) => (
          <tr key={k} className={`border-b last:border-0 ${i === arr.length - 1 ? "font-semibold" : ""}`}>
            <td className="px-3 py-2">{k}</td><td className="px-3 py-2 text-right"><Money value={a} /></td><td className="px-3 py-2 text-right"><Money value={b} /></td><td className="px-3 py-2 text-right">{delta(a, b)}</td>
          </tr>
        ))}
      </MiniTable>
      {n.amendmentReason && <p className="text-sm"><span className="text-muted-foreground">{t("fieln.amendmentReason")}:</span> {n.amendmentReason}</p>}
    </div>
  )
}
