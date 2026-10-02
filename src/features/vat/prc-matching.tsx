"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, Banknote, CalendarClock, Download, FileSpreadsheet, Hourglass, Loader2, Plus, Send, Trash2, Undo2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Field } from "@/components/common/field"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { PROCEEDS_TONE } from "@/features/vat/proceeds"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum } from "@/lib/format"
import { mapPrcRows, PRC_MAX_ROWS, PRC_REVIEW, PRC_SKIP, PRC_TEMPLATE_HEAD } from "@/lib/proceeds"
import { PROCEEDS_DAYS } from "@/lib/rmg"
import { parseCsv, readSheet } from "@/lib/sheet"
import type { PrcBasis, PrcBatch, PrcMatchResult, PrcMatchRow, PrcRowState, ProceedsOverview } from "@/lib/types"
import { cn } from "@/lib/utils"

export const PRC_TONE: Record<PrcRowState, Tone> = { matched: "success", partial: "info", split: "info", excess: "warning", ambiguous: "warning", unmatched: "warning", duplicate: "neutral", invalid: "danger" }
type Alloc = { saleId: string; invoiceNo: string; fcAmount: string; basis: PrcBasis }
type Edit = { on: boolean; allocs: Alloc[] }
const r2 = (n: number) => Math.round(n * 100) / 100
const selectCls = "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

/** /vat/proceeds — export proceeds: match the bank's PRC file, what is outstanding against the 120-day limit, batches. */
export function ProceedsPage() {
  const t = useTranslations("prc")
  const tn = useTranslations("nav")
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("open"))
  const q = useQuery({ queryKey: ["proceeds"], queryFn: api.vat.proceeds.overview })
  const d = q.data
  return (
    <>
      <PageHeader title={tn("exportProceeds")} description={t("intro", { days: PROCEEDS_DAYS })}
        actions={<>
          <Button variant="outline" size="sm" render={<a href={api.vat.proceeds.csvUrl()} download={`export-proceeds-open-${TODAY}.csv`} />}><Download /> {t("csv")}</Button>
          <Button variant="outline" size="sm" render={<a href={`data:text/csv;charset=utf-8,${encodeURIComponent(PRC_TEMPLATE_HEAD.join(",") + "\r\n")}`} download="bank-prc-template.csv" />}><FileSpreadsheet /> {t("template")}</Button>
        </>} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error || !d ? <EmptyState title={t("error")} hint={q.error?.message} /> : (
        <>
          <dl className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("tot.outstanding")} n={d.outstanding.count} bdt={d.outstanding.bdt} icon={Hourglass} testId="prc-outstanding" />
            <Tile label={t("tot.overdue", { days: PROCEEDS_DAYS })} n={d.overdue.count} bdt={d.overdue.bdt} icon={AlertTriangle} tone={d.overdue.count ? "danger" : undefined} testId="prc-overdue" />
            <Tile label={t("tot.dueSoon")} n={d.dueSoon.count} bdt={d.dueSoon.bdt} icon={CalendarClock} tone={d.dueSoon.count ? "warning" : undefined} />
            <Tile label={t("tot.realisedFy")} n={d.realisedFy.count} bdt={d.realisedFy.bdt} icon={Banknote} testId="prc-realised" />
          </dl>
          <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
            <TabsList className="mb-4">
              <TabsTrigger value="open">{t("tab.open")}</TabsTrigger>
              <TabsTrigger value="import" data-testid="prc-tab-import">{t("tab.import")}</TabsTrigger>
              <TabsTrigger value="batches">{t("tab.batches")}</TabsTrigger>
            </TabsList>
            <TabsContent value="open"><OpenTab d={d} /></TabsContent>
            <TabsContent value="import"><ImportTab d={d} /></TabsContent>
            <TabsContent value="batches"><BatchesTab d={d} /></TabsContent>
          </Tabs>
        </>
      )}
    </>
  )
}

function Tile({ label, n, bdt, icon: Icon, tone, testId }: { label: string; n: number; bdt: number; icon?: React.ElementType; tone?: "warning" | "danger"; testId?: string }) {
  const t = useTranslations("prc")
  return (
    <div className={cn("rounded-md border bg-card p-3", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : "")} data-testid={testId}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" aria-hidden />}{label}</dt>
      <dd className="mt-1 text-lg font-semibold"><Money value={bdt} /></dd>
      <dd className="text-xs text-muted-foreground" data-testid={testId ? `${testId}-n` : undefined}>{t("invoices", { n })}</dd>
    </div>
  )
}

function OpenTab({ d }: { d: ProceedsOverview }) {
  const t = useTranslations("prc")
  const tp = useTranslations("proceeds")
  const locale = useLocale()
  const max = Math.max(1, ...d.ageing.map((a) => a.bdt))
  return (
    <div className="grid gap-4">
      <section aria-labelledby="prc-ageing" className="rounded-lg border bg-card p-3">
        <h2 id="prc-ageing" className="mb-2 text-sm font-medium">{t("ageing")}</h2>
        <ul className="grid gap-2">
          {d.ageing.map((a) => (
            <li key={a.bucket} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[12rem_1fr_auto]" data-testid={`prc-age-${a.bucket}`}>
              <span>{t(`bucket.${a.bucket}`)}</span>
              <span className="h-2.5 overflow-hidden rounded bg-muted" aria-hidden><span className={cn("block h-full rounded", a.bucket === "overdue" ? "bg-destructive" : a.bucket === "d30" ? "bg-warning" : "bg-primary/70")} style={{ width: `${(a.bdt / max) * 100}%` }} /></span>
              <span className="tabular">{t("invoices", { n: a.count })} · <Money value={a.bdt} /></span>
            </li>
          ))}
        </ul>
      </section>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("openTable")}>
        <table className="w-full min-w-[960px] text-sm">
          <caption className="sr-only">{t("openTable")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.invoice")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.buyer")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.refs")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.value")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.outstanding")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.due")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.state")}</th>
          </tr></thead>
          <tbody>
            {d.open.length ? d.open.map((o) => (
              <tr key={o.saleId} className="border-b align-top last:border-0" data-testid={`prc-open-${o.invoiceNo}`}>
                <td className="px-3 py-2"><Link href={`/sales/${o.saleId}`} className="font-medium text-primary tabular underline underline-offset-2">{o.invoiceNo}</Link><span className="block text-xs text-muted-foreground tabular">{fmtDate(o.date, locale)}</span></td>
                <td className="px-3 py-2">{o.customer}</td>
                <td className="px-3 py-2 text-xs tabular">{o.expNo ?? <span className="text-warning">{t("noExp")}</span>}<span className="block text-muted-foreground">{o.lcNo ?? "—"}</span></td>
                <td className="px-3 py-2 text-right tabular">{o.currency} {fmtNum(o.fcValue, locale, 2)}</td>
                <td className="px-3 py-2 text-right font-medium tabular">{o.currency} {fmtNum(o.outstandingFc, locale, 2)}<span className="block text-xs font-normal text-muted-foreground"><Money value={r2(o.outstandingFc * o.rate)} /></span></td>
                <td className={cn("px-3 py-2 text-xs tabular", o.daysLeft < 0 ? "text-destructive" : o.daysLeft <= 30 ? "text-warning" : "")}>{fmtDate(o.due, locale)}<span className="block">{o.daysLeft < 0 ? t("daysOver", { n: -o.daysLeft }) : t("daysLeft", { n: o.daysLeft })}</span></td>
                <td className="px-3 py-2"><Pill tone={PROCEEDS_TONE[o.state]}>{tp(`state.${o.state}`)}</Pill></td>
              </tr>
            )) : <tr><td colSpan={7} className="px-3 py-10"><EmptyState icon={Banknote} title={t("allRealised")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("note", { days: PROCEEDS_DAYS })}</p>
    </div>
  )
}

/** Import tab: read the bank file, match it, adjust the allocations, post. */
function ImportTab({ d }: { d: ProceedsOverview }) {
  const t = useTranslations("prc")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const router = useRouter()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = React.useState("")
  const [readErr, setReadErr] = React.useState("")
  const [result, setResult] = React.useState<PrcMatchResult | null>(null)
  const [edits, setEdits] = React.useState<Record<number, Edit>>({})
  const [errors, setErrors] = React.useState<Record<number, string>>({})
  const match = useMutation({
    mutationFn: (b: { fileName: string; rows: ReturnType<typeof mapPrcRows>["rows"] }) => api.vat.proceeds.match(b),
    onSuccess: (r) => {
      setResult(r); setErrors({})
      setEdits(Object.fromEntries(r.rows.map((x) => [x.line, { on: x.allocations.length > 0 && !PRC_REVIEW.includes(x.state) && !PRC_SKIP.includes(x.state), allocs: x.allocations.map((a) => ({ saleId: a.saleId, invoiceNo: a.invoiceNo, fcAmount: String(a.fcAmount), basis: a.basis })) }])))
    },
    onError: (e) => setReadErr(e.message),
  })
  const load = async (name: string, table: string[][]) => {
    setReadErr(""); setResult(null); setFileName(name)
    const { rows, missing } = mapPrcRows(table)
    if (missing.length) return setReadErr(t("missing", { cols: missing.map((m) => t(`field.${m}`)).join(", ") }))
    if (!rows.length) return setReadErr(t("noRows"))
    if (rows.length > PRC_MAX_ROWS) return setReadErr(t("tooMany", { max: PRC_MAX_ROWS }))
    match.mutate({ fileName: name, rows })
  }
  const onFile = async (f?: File) => {
    if (!f) return
    try { await load(f.name, await readSheet(f)) } catch { setReadErr(t("unreadable")) }
    if (fileRef.current) fileRef.current.value = ""
  }
  const sample = async () => {
    try {
      const res = await fetch(api.vat.proceeds.sampleUrl(), { credentials: "same-origin" })
      if (!res.ok) throw new Error(String(res.status))
      await load(`bank-prc-sample-${TODAY}.csv`, parseCsv(await res.text()))
    } catch { setReadErr(t("unreadable")) }
  }
  const chosen = result ? result.rows.filter((r) => edits[r.line]?.on && edits[r.line].allocs.length) : []
  const post = useMutation({
    mutationFn: () => api.vat.proceeds.post({
      fileName, skipped: result!.rows.length - chosen.length - result!.rows.filter((r) => edits[r.line]?.on && !edits[r.line].allocs.length).length,
      rows: chosen.map((r) => ({ line: r.line, date: r.date, prcNo: r.prcNo, bank: r.bank, currency: r.currency, fcAmount: r.fcAmount, rate: r.rate, expNo: r.expNo, lcNo: r.lcNo, invoiceRef: r.invoiceRef, remitter: r.remitter,
        allocations: edits[r.line].allocs.map((a) => ({ saleId: a.saleId, fcAmount: Number(a.fcAmount) || 0, basis: a.basis })) })),
    }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["proceeds"] }); qc.invalidateQueries({ queryKey: ["vat", "exports"] }); qc.invalidateQueries({ queryKey: ["sales"] }); qc.invalidateQueries({ queryKey: ["bond"] }); qc.invalidateQueries({ queryKey: ["claims"] })
      toast.success(t("posted", { no: b.no, n: b.lines.length })); setResult(null); setFileName(""); router.push(`/vat/proceeds/batches/${b.id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) {
        const by: Record<number, string> = {}
        for (const [k, v] of Object.entries(e.errors)) {
          const m = /^rows\.(\d+)/.exec(k)
          const line = m ? chosen[Number(m[1])]?.line : undefined
          const msg = t.has(`err.${v[0]}`) ? t(`err.${v[0]}`) : v[0]
          if (line != null) by[line] = msg; else toast.error(msg)
        }
        setErrors(by)
      } else toast.error(e.message)
    },
  })
  const setEdit = (line: number, f: (e: Edit) => Edit) => setEdits((x) => ({ ...x, [line]: f(x[line] ?? { on: false, allocs: [] }) }))
  const postBdt = r2(chosen.reduce((a, r) => a + edits[r.line].allocs.reduce((s, x) => s + (Number(x.fcAmount) || 0), 0) * r.rate, 0))
  if (!can("doc.edit")) return <EmptyState title={t("readOnly")} />
  return (
    <div className="grid gap-4">
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" aria-labelledby="prc-file">
        <h2 id="prc-file" className="sr-only">{t("fileTitle")}</h2>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" id="prc-input" aria-label={t("choose")} tabIndex={-1} data-testid="prc-file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={match.isPending}><Upload /> {t("choose")}</Button>
        <Button size="sm" variant="outline" onClick={sample} disabled={match.isPending} data-testid="prc-sample"><FileSpreadsheet /> {t("useSample")}</Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">{match.isPending ? t("matching") : fileName || t("fileHint")}</span>
      </section>
      {readErr && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm" data-testid="prc-read-error">{readErr}</p>}
      {result && (
        <>
          <p className="text-sm" data-testid="prc-summary">{t("summary", { rows: result.totals.rows, matched: result.totals.matched, review: result.totals.review, skipped: result.totals.skipped })}</p>
          <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("previewTable")}>
            <table className="w-full min-w-[1080px] text-sm">
              <caption className="sr-only">{t("previewTable")}</caption>
              <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="w-10 px-3 py-2 font-medium"><span className="sr-only">{t("col.post")}</span></th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.prc")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.fileRefs")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.amount")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.allocations")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.state")}</th>
              </tr></thead>
              <tbody>{result.rows.map((r) => renderRow(r))}</tbody>
            </table>
          </div>
          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
            <span className="text-sm" aria-live="polite" data-testid="prc-post-summary">{t("toPost", { n: chosen.length, amount: fmtNum(postBdt, locale, 2) })}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setResult(null); setFileName("") }}><X /> {t("discard")}</Button>
              <Button size="sm" disabled={!chosen.length || post.isPending} onClick={() => post.mutate()} data-testid="prc-post">{post.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t("post")}</Button>
            </div>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("importNote")}</p>
    </div>
  )

  function renderRow(r: PrcMatchRow) {
    const e = edits[r.line] ?? { on: false, allocs: [] }
    const skip = PRC_SKIP.includes(r.state)
    const sum = r2(e.allocs.reduce((a, x) => a + (Number(x.fcAmount) || 0), 0))
    const over = sum > r.fcAmount + 0.01
    const used = new Set(e.allocs.map((a) => a.saleId))
    // what other ticked rows of this file already take from each invoice
    const elsewhere = (sid: string) => r2((result?.rows ?? []).reduce((acc, x) => (x.line !== r.line && edits[x.line]?.on ? acc + edits[x.line].allocs.filter((y) => y.saleId === sid).reduce((t2, y) => t2 + (Number(y.fcAmount) || 0), 0) : acc), 0))
    const remaining = (o: ProceedsOverview["open"][number]) => r2(o.outstandingFc - elsewhere(o.saleId))
    const pickable = d.open.filter((o) => o.currency === r.currency && !used.has(o.saleId) && o.date <= r.date && remaining(o) > 0.005)
    return (
      <tr key={r.line} className={cn("border-b align-top last:border-0", skip && "opacity-70")} data-testid={`prc-row-${r.line}`}>
        <td className="px-3 py-2">
          <Checkbox aria-label={t("postOne", { no: r.prcNo || String(r.line) })} checked={e.on} disabled={skip} data-testid={`prc-on-${r.line}`} onCheckedChange={(v) => setEdit(r.line, (x) => ({ ...x, on: !!v }))} />
        </td>
        <td className="px-3 py-2"><span className="font-medium tabular">{r.prcNo || "—"}</span>
          <span className="block text-xs text-muted-foreground">{t("line", { n: r.line })} · {r.date ? fmtDate(r.date, locale) : "—"}</span>
          <span className="block text-xs text-muted-foreground">{r.bank}</span></td>
        <td className="px-3 py-2 text-xs tabular">
          {r.expNo && <span className="block">{t("ref.exp")} {r.expNo}</span>}
          {r.invoiceRef && <span className="block">{t("ref.invoice")} {r.invoiceRef}</span>}
          {r.lcNo && <span className="block">{t("ref.lc")} {r.lcNo}</span>}
          {r.remitter && <span className="block text-muted-foreground">{r.remitter}</span>}
          {!r.expNo && !r.invoiceRef && !r.lcNo && <span className="text-muted-foreground">{t("ref.none")}</span>}
        </td>
        <td className="px-3 py-2 text-right tabular"><span className="font-medium">{r.currency} {fmtNum(r.fcAmount, locale, 2)}</span><span className="block text-xs text-muted-foreground">@ {fmtNum(r.rate, locale, 4)}</span></td>
        <td className="px-3 py-2">
          {skip ? <span className="text-xs text-muted-foreground">{t("notPosted")}</span> : (
            <div className="grid gap-1.5">
              {e.allocs.map((a, j) => (
                <div key={a.saleId} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs tabular">{a.invoiceNo}<span className="block text-muted-foreground">{t(`basis.${a.basis}`)}</span></span>
                  <Input type="number" inputMode="decimal" step="0.01" min={0} className="h-8 w-32 text-right tabular" aria-label={t("allocAmount", { no: a.invoiceNo })} value={a.fcAmount} data-testid={`prc-amt-${r.line}-${j}`}
                    onChange={(ev) => setEdit(r.line, (x) => ({ ...x, allocs: x.allocs.map((y, k) => (k === j ? { ...y, fcAmount: ev.target.value } : y)) }))} />
                  <Button variant="ghost" size="icon-sm" aria-label={t("removeAlloc", { no: a.invoiceNo })} onClick={() => setEdit(r.line, (x) => ({ ...x, allocs: x.allocs.filter((_, k) => k !== j) }))}><Trash2 /></Button>
                </div>
              ))}
              {pickable.length > 0 && (
                <div className="flex items-center gap-2">
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <select className={selectCls} aria-label={t("addInvoice", { no: r.prcNo || String(r.line) })} value="" data-testid={`prc-add-${r.line}`}
                    onChange={(ev) => {
                      const o = d.open.find((x) => x.saleId === ev.target.value)
                      if (!o) return
                      setEdit(r.line, (x) => {
                        const left = r2(r.fcAmount - x.allocs.reduce((s, y) => s + (Number(y.fcAmount) || 0), 0))
                        return { on: true, allocs: [...x.allocs, { saleId: o.saleId, invoiceNo: o.invoiceNo, fcAmount: String(r2(Math.max(0, Math.min(left, remaining(o))))), basis: "manual" }] }
                      })
                    }}>
                    <option value="">{r.candidates.length ? t("pickSuggested", { n: r.candidates.length }) : t("pickInvoice")}</option>
                    {[...pickable].sort((a, b) => Number(!r.candidates.some((c) => c.saleId === a.saleId)) - Number(!r.candidates.some((c) => c.saleId === b.saleId))).map((o) => (
                      <option key={o.saleId} value={o.saleId}>{r.candidates.some((c) => c.saleId === o.saleId) ? "★ " : ""}{o.invoiceNo} · {o.customer} · {o.currency} {fmtNum(remaining(o), locale, 2)}</option>
                    ))}
                  </select>
                </div>
              )}
              <span className={cn("text-xs", over ? "text-destructive" : "text-muted-foreground")} data-testid={`prc-left-${r.line}`}>{over ? t("over", { amount: fmtNum(r2(sum - r.fcAmount), locale, 2) }) : t("unallocated", { amount: fmtNum(r2(r.fcAmount - sum), locale, 2) })}</span>
            </div>
          )}
          {errors[r.line] && <p role="alert" className="mt-1 text-xs text-destructive">{errors[r.line]}</p>}
        </td>
        <td className="px-3 py-2"><Pill tone={PRC_TONE[r.state]}>{t(`state.${r.state}`)}</Pill>
          {r.problems.length > 0 && <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">{r.problems.map((p) => <li key={p}>{t(`problem.${p}`)}</li>)}</ul>}</td>
      </tr>
    )
  }
}

function BatchesTab({ d }: { d: ProceedsOverview }) {
  const t = useTranslations("prc")
  const locale = useLocale()
  return (
    <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("batchesTable")}>
      <table className="w-full min-w-[820px] text-sm">
        <caption className="sr-only">{t("batchesTable")}</caption>
        <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <th scope="col" className="px-3 py-2 font-medium">{t("col.batch")}</th>
          <th scope="col" className="px-3 py-2 font-medium">{t("col.file")}</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.invoicesN")}</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.fc")}</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.bdt")}</th>
          <th scope="col" className="px-3 py-2 font-medium">{t("col.state")}</th>
        </tr></thead>
        <tbody>
          {d.batches.length ? d.batches.map((b) => (
            <tr key={b.id} className="border-b align-top last:border-0" data-testid={`prc-batch-${b.no}`}>
              <td className="px-3 py-2"><Link href={`/vat/proceeds/batches/${b.id}`} className="font-medium text-primary tabular underline underline-offset-2">{b.no}</Link>
                <span className="block text-xs text-muted-foreground">{fmtDate(b.createdAt.slice(0, 10), locale)} · {b.createdBy}</span></td>
              <td className="px-3 py-2 text-xs">{b.fileName}{b.skipped > 0 && <span className="block text-muted-foreground">{t("skippedN", { n: b.skipped })}</span>}</td>
              <td className="px-3 py-2 text-right tabular">{b.invoices}</td>
              <td className="px-3 py-2 text-right text-xs tabular">{b.fcTotals.map((c) => <span key={c.currency} className="block">{c.currency} {fmtNum(c.fc, locale, 2)}</span>)}</td>
              <td className="px-3 py-2 text-right font-medium"><Money value={b.bdt} /></td>
              <td className="px-3 py-2"><Pill tone={b.status === "posted" ? "success" : "neutral"}>{t(`batchState.${b.status}`)}</Pill></td>
            </tr>
          )) : <tr><td colSpan={6} className="px-3 py-10"><EmptyState icon={Upload} title={t("noBatches")} hint={t("noBatchesHint")} /></td></tr>}
        </tbody>
      </table>
    </div>
  )
}

/** /vat/proceeds/batches/[id] — one posted bank file: its PRCs, where each went, reversal. */
export function BatchDetailPage({ id }: { id: string }) {
  const t = useTranslations("prc")
  const locale = useLocale()
  const can = useCan()
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState("lines")
  const q = useQuery({ queryKey: ["proceeds", "batch", id], queryFn: () => api.vat.proceeds.batch(id) })
  const b = q.data
  const back = <Button variant="outline" render={<Link href="/vat/proceeds?tab=batches" />}><ArrowLeft /> {t("back")}</Button>
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !b) return <EmptyState title={t("batchNotFound")} action={back} />
  return (
    <>
      <PageHeader crumbs={[{ label: t("crumbBatches"), href: "/vat/proceeds?tab=batches" }, { label: b.no }]}
        title={<span className="flex flex-wrap items-center gap-2">{t("batchTitle", { no: b.no })} <Pill tone={b.status === "posted" ? "success" : "neutral"}>{t(`batchState.${b.status}`)}</Pill></span>}
        description={t("batchSub", { file: b.fileName, n: b.lines.length, by: b.createdBy, date: fmtDate(b.createdAt.slice(0, 10), locale) })}
        actions={b.status === "posted" && can("doc.approve") ? <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="prc-reverse"><Undo2 /> {t("reverse")}</Button> : undefined} />
      {b.status === "reversed" && <p role="note" className="mb-4 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm" data-testid="prc-reversed">{t("reversedOn", { date: fmtDate(b.reversedOn!, locale) })} {b.reverseReason}</p>}
      <section aria-label={t("batchSummary")} className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{t("col.bdt")}</div><div className="mt-1 text-lg font-semibold"><Money value={b.bdt} /></div></div>
        <div className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{t("col.fc")}</div><div className="mt-1 text-lg font-semibold tabular">{b.fcTotals.map((c) => `${c.currency} ${fmtNum(c.fc, locale, 2)}`).join(" · ") || "—"}</div></div>
        <div className="rounded-lg border bg-card p-3"><div className="text-xs text-muted-foreground">{t("col.invoicesN")}</div><div className="mt-1 text-lg font-semibold tabular">{b.invoices}</div>{b.skipped > 0 && <p className="text-xs text-muted-foreground">{t("skippedN", { n: b.skipped })}</p>}</div>
      </section>
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="mb-4"><TabsTrigger value="lines">{t("tabLines")}</TabsTrigger><TabsTrigger value="history">{t("tabHistory")}</TabsTrigger></TabsList>
        <TabsContent value="lines">
          <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("linesTable")}>
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">{t("linesTable")}</caption>
              <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t("col.prc")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.fileRefs")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.amount")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.allocations")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.bdt")}</th>
              </tr></thead>
              <tbody>
                {b.lines.map((l) => (
                  <tr key={l.line} className="border-b align-top last:border-0" data-testid={`prc-line-${l.prcNo}`}>
                    <td className="px-3 py-2"><span className="font-medium tabular">{l.prcNo}</span><span className="block text-xs text-muted-foreground">{fmtDate(l.date, locale)} · {l.bank}</span></td>
                    <td className="px-3 py-2 text-xs tabular">{[l.expNo, l.invoiceRef, l.lcNo].filter(Boolean).join(" · ") || "—"}{l.remitter && <span className="block text-muted-foreground">{l.remitter}</span>}</td>
                    <td className="px-3 py-2 text-right tabular">{l.currency} {fmtNum(l.fcAmount, locale, 2)}<span className="block text-xs text-muted-foreground">@ {fmtNum(l.rate, locale, 4)}</span></td>
                    <td className="px-3 py-2 text-xs"><ul className="grid gap-0.5">{l.allocations.map((a) => <li key={a.realisationId}><Link href={`/sales/${a.saleId}`} className="text-primary tabular underline underline-offset-2">{a.invoiceNo}</Link> · {a.customer} · <span className="tabular">{l.currency} {fmtNum(a.fcAmount, locale, 2)}</span> <span className="text-muted-foreground">({t(`basis.${a.basis}`)})</span></li>)}</ul></td>
                    <td className="px-3 py-2 text-right font-medium"><Money value={l.bdt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={b.id} /></TabsContent>
      </Tabs>
      <ReverseDialog batch={b} open={open} onOpenChange={setOpen} />
    </>
  )
}

function ReverseDialog({ batch: b, open, onOpenChange }: { batch: PrcBatch; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("prc")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const [v, setV] = React.useState({ date: TODAY, reason: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => { if (open) { setV({ date: TODAY, reason: "" }); setErrors({}) } }, [open])
  const run = useMutation({
    mutationFn: () => api.vat.proceeds.reverse(b.id, v),
    onSuccess: (x) => {
      qc.setQueryData(["proceeds", "batch", b.id], x); qc.invalidateQueries({ queryKey: ["proceeds"] }); qc.invalidateQueries({ queryKey: ["vat", "exports"] }); qc.invalidateQueries({ queryKey: ["sales"] })
      toast.success(t("reversedToast", { no: x.no })); onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, x]) => [k, t.has(`err.${x[0]}`) ? t(`err.${x[0]}`) : x[0]])))
      else toast.error(e.message)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run.mutate() }}>
          <DialogHeader><DialogTitle>{t("reverseTitle", { no: b.no })}</DialogTitle><DialogDescription>{t("reverseBody", { n: b.lines.reduce((a, l) => a + l.allocations.length, 0) })}</DialogDescription></DialogHeader>
          <Field id="pr-date" label={t("reverseDate")} required error={errors.date}>{(a) => <Input type="date" max={TODAY} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} {...a} />}</Field>
          <Field id="pr-reason" label={t("reverseReason")} required error={errors.reason}>{(a) => <Textarea rows={3} maxLength={300} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} {...a} />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant="destructive" disabled={run.isPending} data-testid="prc-reverse-submit">{run.isPending && <Loader2 className="animate-spin" />} {t("reverse")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Export proceeds of a drawback claim / UD: one pill per export, linked to the invoice; a note when any is unrealised. */
export function ProceedsList({ p, note }: { p: { exports: number; pending: number; overdue: number; lines: { saleId: string; invoiceNo: string; currency?: string; fcValue: number; realisedFc: number; state: import("@/lib/types").ProceedsState; prcNos: string[] }[] }; note?: string }) {
  const t = useTranslations("prc")
  const tp = useTranslations("proceeds")
  const locale = useLocale()
  if (!p.exports) return null
  return (
    <section aria-labelledby="pl-h" className={cn("grid gap-2 rounded-lg border bg-card p-4", p.overdue ? "border-destructive/50" : p.pending ? "border-warning/60" : "")} data-testid="proceeds-list">
      <h2 id="pl-h" className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Banknote className="size-4" aria-hidden /> {t("pl.title")}
        <span className="text-xs font-normal text-muted-foreground">{t("pl.summary", { realised: p.exports - p.pending, n: p.exports })}</span></h2>
      <ul className="grid gap-1 text-sm">
        {p.lines.map((l) => (
          <li key={l.saleId} className="flex flex-wrap items-center gap-2">
            <Link href={`/sales/${l.saleId}`} className="text-primary tabular underline underline-offset-2">{l.invoiceNo}</Link>
            <Pill tone={PROCEEDS_TONE[l.state]}>{tp(`state.${l.state}`)}</Pill>
            <span className="text-xs text-muted-foreground tabular">{l.currency} {fmtNum(l.realisedFc, locale, 2)} / {fmtNum(l.fcValue, locale, 2)}{l.prcNos.length ? ` · ${l.prcNos.join(", ")}` : ""}</span>
          </li>
        ))}
      </ul>
      {p.pending > 0 && note && <p className="text-xs text-muted-foreground">{note} <Link href="/vat/proceeds" className="underline">{t("pl.open")}</Link></p>}
    </section>
  )
}
