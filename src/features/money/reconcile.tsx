"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { toast } from "sonner"
import { ArrowLeft, Banknote, BookOpen, CircleAlert, FileSpreadsheet, FileUp, Landmark, Loader2, Scale, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Pill, type Tone } from "@/components/common/status-badge"
import { api, ApiError } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { mapBankRows, readSheet } from "@/lib/sheet"
import type { BankStatementLine, MoneyAccountRow, MoneyDoc, StatementPlanAnswer, StatementView } from "@/lib/types"
import { cn } from "@/lib/utils"

export const LINE_TONE: Record<BankStatementLine["status"], Tone> = { matched: "success", receipt: "info", charge: "neutral", ignored: "neutral", open: "warning" }
const selectCls = "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

/**
 * /accounting/reconcile — R8.2: the bank statement as ground truth. Import a statement (CSV / XLSX, dry-run
 * first), let the matcher explain its lines (TR-6 challans, receipts / payments already on the books, a
 * customer's or vendor's name in the narration), and work the rest: a receipt or voucher created from a line
 * goes through the ordinary creators and links back; a bank charge is parked; the books-vs-bank strip says
 * what is still unexplained.
 */
export function ReconcilePage() {
  const t = useTranslations("reconcile")
  const tn = useTranslations("nav")
  const [id, setId] = useQueryState("s", parseAsString.withDefault(""))
  const [imp, setImp] = React.useState(false)
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ["bankStatements"], queryFn: () => api.accounting.bankStatements({ size: 100 }) })
  const accounts = useQuery({ queryKey: ["bankAccounts"], queryFn: api.accounting.accounts.options })
  const one = useQuery({ queryKey: ["bankStatement", id], queryFn: () => api.accounting.bankStatement(id), enabled: !!id })

  return (
    <>
      <PageHeader title={tn("reconcile")} description={t("intro")}
        actions={<>
          {id && <Button variant="outline" size="sm" onClick={() => setId("")}><ArrowLeft /> {t("back")}</Button>}
          <Button size="sm" data-testid="reconcile-import" onClick={() => setImp(true)}><Upload /> {t("imp.title")}</Button>
        </>} />
      {!id ? (
        list.isLoading ? <Skeleton className="h-96" /> : list.error || !list.data ? <EmptyState title={t("error")} hint={list.error?.message} /> :
          !list.data.data.length ? <EmptyState title={t("empty")} hint={t("emptyHint")} /> : (
            <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("table")}>
              <table className="w-full min-w-[820px] text-sm">
                <caption className="sr-only">{t("table")}</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("col.no")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.account")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.period")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("col.lines")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("col.in")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("col.out")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.source")}</th>
                    <th className="px-3 py-2 font-medium">{t("col.imported")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((s) => (
                    <tr key={s.id} className="cursor-pointer border-b transition-colors hover:bg-muted/40" onClick={() => setId(s.id)} data-testid={`reconcile-row-${s.id}`}>
                      <td className="px-3 py-2 font-medium">{s.no}</td>
                      <td className="px-3 py-2">{s.accountName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.from} → {s.to}</td>
                      <td className="px-3 py-2 text-right tabular">{s.lineCount}</td>
                      <td className="px-3 py-2 text-right tabular"><Money value={s.totals.deposit} /></td>
                      <td className="px-3 py-2 text-right tabular"><Money value={s.totals.withdrawal} /></td>
                      <td className="max-w-56 truncate px-3 py-2" title={s.source}>{s.source}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(s.importedAt)} · {s.importedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      ) : (
        one.isLoading ? <Skeleton className="h-96" /> : one.error || !one.data ? <EmptyState title={t("error")} hint={one.error?.message} /> :
          <StatementDetail v={one.data} accounts={accounts.data ?? []} onChange={() => { void qc.invalidateQueries({ queryKey: ["bankStatement", id] }); void qc.invalidateQueries({ queryKey: ["bankStatements"] }) }} />
      )}
      <ImportDialog open={imp} onOpenChange={(v) => { setImp(v); if (!v) void qc.invalidateQueries({ queryKey: ["bankStatements"] }) }} accounts={accounts.data ?? []} />
    </>
  )
}

/* ── one statement: the books-vs-bank strip and its lines ── */

function StatementDetail({ v, accounts, onChange }: { v: StatementView; accounts: MoneyAccountRow[]; onChange: () => void }) {
  const t = useTranslations("reconcile")
  const [line, setLine] = React.useState<BankStatementLine | null>(null)
  const s = v.statement
  return (
    <div className="grid gap-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border bg-card p-3" data-testid="reconcile-books">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><BookOpen className="size-3.5" aria-hidden />{t("books")}</dt>
          <dd className="mt-1 text-lg font-semibold"><Money value={v.books} /></dd>
          <dd className="text-xs text-muted-foreground">{s.accountName}</dd>
        </div>
        <div className="rounded-md border bg-card p-3" data-testid="reconcile-bank">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Landmark className="size-3.5" aria-hidden />{t("bank")}</dt>
          <dd className="mt-1 text-lg font-semibold"><Money value={v.statementBalance} /></dd>
          <dd className="text-xs text-muted-foreground">{t("atDate", { date: s.to })}</dd>
        </div>
        <div className={cn("rounded-md border bg-card p-3", v.difference !== 0 && "border-warning/60")} data-testid="reconcile-diff">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Scale className="size-3.5" aria-hidden />{t("difference")}</dt>
          <dd className="mt-1 text-lg font-semibold"><Money value={v.difference} /></dd>
          <dd className="text-xs text-muted-foreground">{v.difference === 0 ? t("explained") : t("unexplained")}</dd>
        </div>
        <div className={cn("rounded-md border bg-card p-3", v.open > 0 && "border-warning/60")} data-testid="reconcile-open">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleAlert className="size-3.5" aria-hidden />{t("openLines")}</dt>
          <dd className="mt-1 text-lg font-semibold">{v.open}</dd>
          <dd className="text-xs text-muted-foreground">{t("ofLines", { n: v.lines.length })}</dd>
        </div>
      </dl>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("linesTable")}>
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">{t("linesTable")}</caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">{t("col.date")}</th>
              <th className="px-3 py-2 font-medium">{t("col.narration")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col.deposit")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("col.withdrawal")}</th>
              <th className="px-3 py-2 font-medium">{t("col.state")}</th>
              <th className="px-3 py-2 font-medium text-right">{t("col.action")}</th>
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.id} className="border-b" data-testid={`reconcile-line-${l.rowNo}`}>
                <td className="px-3 py-2 text-muted-foreground tabular">{l.rowNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.date}</td>
                <td className="max-w-96 px-3 py-2">
                  <p className="truncate" title={l.narration}>{l.narration}</p>
                  {(l.reference || l.chequeNo) && <p className="text-xs text-muted-foreground">{[l.chequeNo, l.reference].filter(Boolean).join(" · ")}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular">{l.deposit ? <Money value={l.deposit} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-right tabular">{l.withdrawal ? <Money value={l.withdrawal} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Pill tone={LINE_TONE[l.status]}>{t(`state.${l.status}`)}</Pill>
                    {l.status === "matched" && <span className="text-xs text-muted-foreground">{t(`kind.${l.matchKind}`)} {l.matchNo}</span>}
                    {l.moneyNo && <span className="text-xs text-muted-foreground">{l.moneyNo}</span>}
                    {l.status === "open" && "suggestion" in l && l.suggestion && (
                      <span className="text-xs text-muted-foreground" data-testid={`reconcile-sugg-${l.rowNo}`}>{l.suggestion.partyName}{l.suggestion.invoices ? ` · ${t("due", { n: l.suggestion.invoices })}` : ""}</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <LineActions line={l} onReceipt={() => setLine(l as BankStatementLine)} onChange={onChange} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReceiptDialog statement={s.id} account={s.accountId} line={line} accounts={accounts} onClose={() => setLine(null)} onDone={() => { setLine(null); onChange() }} />
    </div>
  )
}

/* ── one line's actions ── */

function LineActions({ line, onReceipt, onChange }: { line: BankStatementLine; onReceipt: () => void; onChange: () => void }) {
  const t = useTranslations("reconcile")
  const patch = useMutation({
    mutationFn: (status: "open" | "charge" | "ignored") => api.accounting.patchBankLine(line.statementId, line.id, { status }),
    onSuccess: () => { toast.success(t("parked")); onChange() },
    onError: (e) => { if (e instanceof ApiError) toast.error(e.message) },
  })
  if (line.status === "matched") return <span className="text-xs text-muted-foreground">{t("onBooks")}</span>
  if (line.moneyId) return <span className="text-xs text-muted-foreground">{t("linked")}</span>
  return (
    <span className="inline-flex justify-end gap-1">
      {line.deposit > 0 && <Button variant="outline" size="sm" className="h-7 px-2" data-testid={`reconcile-receipt-${line.rowNo}`} onClick={onReceipt}><Banknote aria-hidden /> {t("act.receipt")}</Button>}
      {line.status === "open" ? (
        <>
          <Button variant="ghost" size="sm" className="h-7 px-2" disabled={patch.isPending} onClick={() => patch.mutate("charge")}>{t("act.charge")}</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" disabled={patch.isPending} onClick={() => patch.mutate("ignored")}>{t("act.ignore")}</Button>
        </>
      ) : <Button variant="ghost" size="sm" className="h-7 px-2" disabled={patch.isPending} onClick={() => patch.mutate("open")}>{t("act.reopen")}</Button>}
    </span>
  )
}

/* ── create the receipt an open deposit line is about ── */

function ReceiptDialog({ statement, account, line, accounts, onClose, onDone }: { statement: string; account: string; line: BankStatementLine | null; accounts: MoneyAccountRow[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("reconcile")
  const tc = useTranslations("common")
  const sugg = line && "suggestion" in line ? (line as { suggestion?: { partyId: string; partyName: string } }).suggestion : undefined
  const [party, setParty] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [auto, setAuto] = React.useState(true)
  React.useEffect(() => { if (line) { setParty(sugg?.partyId ?? ""); setAmount(String(line.deposit)); setAuto(true) } }, [line]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useQuery({ queryKey: ["openInvoices", "receipt", party], queryFn: () => api.accounting.openInvoices("receipt", party), enabled: !!party && !!line })
  const create = useMutation({
    mutationFn: () => {
      const allocs: { docId: string; amount: number }[] = []
      let left = Number(amount)
      if (auto) for (const o of (open.data ?? []).filter((o) => o.due > 0)) {
        if (left <= 0.004) break
        const take = Math.min(o.due, left)
        allocs.push({ docId: o.id, amount: Math.round(take * 100) / 100 })
        left = Math.round((left - take) * 100) / 100
      }
      return api.accounting.receiptFromLine(statement, line!.id, {
        partyId: party, date: line!.date, method: line!.chequeNo ? "cheque" : "bankTransfer",
        accountId: account ?? accounts.find((a) => a.kind === "bank")?.id ?? accounts[0]?.id,
        chequeNo: line!.chequeNo ?? "", chequeDate: line!.chequeNo ? line!.date : undefined, chequeBank: line!.chequeNo ? "" : undefined,
        reference: line!.reference ?? "", amount: Number(amount), charge: 0, allocations: allocs, process: "Created",
      })
    },
    onSuccess: (d: MoneyDoc) => { toast.success(t("receiptCreated", { no: d.no })); onDone() },
    onError: (e) => { if (e instanceof ApiError) toast.error(e.message) },
  })
  return (
    <Dialog open={!!line} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("receipt.title")}</DialogTitle>
          <DialogDescription>{line ? `${line.date} · ${line.narration}` : ""}</DialogDescription>
        </DialogHeader>
        {line && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="rc-party">{t("receipt.party")}</Label>
              <select id="rc-party" className={selectCls} value={party} onChange={(e) => setParty(e.target.value)} aria-required>
                <option value="">{t("receipt.chooseParty")}</option>
                <PartyOptions suggested={sugg} />
              </select>
              {sugg && <p className="text-xs text-muted-foreground">{t("receipt.suggested", { name: sugg.partyName })}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rc-amount">{t("receipt.amount")}</Label>
              <Input id="rc-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" />
            </div>
            {party && open.data && open.data.some((o) => o.due > 0) && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-4 accent-primary" />
                {t("receipt.auto", { n: open.data.length })}
              </label>
            )}
            <p className="rounded-md bg-info-soft p-3 text-xs">{t("receipt.draftNote")}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tc("cancel")}</Button>
          <Button data-testid="reconcile-receipt-save" disabled={!party || !(Number(amount) > 0) || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="animate-spin" aria-hidden />} {t("receipt.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The party picker: active customers, the suggestion first when there is one. */
function PartyOptions({ suggested }: { suggested?: { partyId: string; partyName: string } }) {
  const q = useQuery({ queryKey: ["customers", "options"], queryFn: () => api.customers.options() })
  const rows = (q.data ?? []).filter((p) => p.id !== suggested?.partyId)
  return <>
    {suggested && <option value={suggested.partyId}>{suggested.partyName}</option>}
    {rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
  </>
}

/* ── the import dialog: dry-run first, all-or-nothing on apply ── */

interface Loaded { source: string; rows: Record<string, unknown>[]; unknown: string[]; missing: string[]; columns: string[] }

function ImportDialog({ open, onOpenChange, accounts }: { open: boolean; onOpenChange: (v: boolean) => void; accounts: MoneyAccountRow[] }) {
  const t = useTranslations("reconcile")
  const tc = useTranslations("common")
  const [accountId, setAccountId] = React.useState("")
  const [closing, setClosing] = React.useState("")
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [readError, setReadError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<StatementPlanAnswer | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const bankAccounts = accounts.filter((a) => a.kind === "bank" && a.active !== false)
  React.useEffect(() => { if (open && !accountId && bankAccounts.length === 1) setAccountId(bankAccounts[0].id) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setLoaded(null); setResult(null); setReadError(null); setClosing(""); if (fileRef.current) fileRef.current.value = "" }
  const close = (v: boolean) => { onOpenChange(v); if (!v) reset() }

  const onFile = async (f: File | undefined) => {
    setResult(null); setReadError(null)
    if (!f) return
    try {
      const m = mapBankRows(await readSheet(f))
      if (!m.rows.length) { setLoaded(null); setReadError(t("imp.noRows")); return }
      setLoaded({ source: f.name, ...m })
    } catch {
      setLoaded(null); setReadError(t("imp.readFailed"))
    }
  }

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.accounting.importBankStatement({
      accountId, source: loaded!.source, closingBalance: closing === "" ? undefined : Number(closing), dryRun, rows: loaded!.rows,
    }),
    onSuccess: (r) => {
      setResult(r)
      if (r.no) { toast.success(t("imp.applied", { no: r.no, n: r.valid })); close(false) }
    },
    onError: (e) => { if (e instanceof ApiError && e.status !== 422) toast.error(e.message) },
  })

  const issues = result?.issues ?? []
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="size-4" aria-hidden /> {t("imp.title")}</DialogTitle>
          <DialogDescription>{t("imp.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="rc-account">{t("imp.account")}</Label>
            <select id="rc-account" className={selectCls} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-required>
              <option value="">{t("imp.chooseAccount")}</option>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.provider} · {a.accountNo}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rc-file">{t("imp.file")}</Label>
            <input ref={fileRef} id="rc-file" type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="justify-start">
              <FileUp aria-hidden /> {loaded ? loaded.source : t("imp.choose")}
            </Button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rc-closing">{t("imp.closing")}</Label>
            <Input id="rc-closing" type="number" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="—" className="w-40" />
            <p className="text-xs text-muted-foreground">{t("imp.closingHelp")}</p>
          </div>
          {readError && <p className="flex items-start gap-2 text-sm text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {readError}</p>}
          {loaded && (
            <p className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-sm">
              <FileSpreadsheet className="mt-0.5 size-4 shrink-0" aria-hidden />
              {loaded.missing.length
                ? t("imp.missing", { fields: loaded.missing.join(", ") })
                : t("imp.loaded", { n: loaded.rows.length, columns: loaded.columns.length })
                  + (loaded.unknown.length ? " " + t("imp.unknown", { n: loaded.unknown.length }) : "")}
            </p>
          )}
          {result && (
            <div className="grid gap-2 rounded-md border p-3 text-sm">
              <p className="font-medium">{t("imp.preview")}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular">
                {([["valid", result.valid], ["matched", result.matched], ["open", result.open]] as const)
                  .map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted-foreground">{t(`imp.${k}`)}</dt><dd>{v}</dd></div>)}
              </dl>
              {result.lines.filter((l) => l.status === "matched").slice(0, 8).map((l) => (
                <p key={l.rowNo} className="truncate text-xs text-muted-foreground">✓ {t(`kind.${l.matchKind}`)} — {l.narration}</p>
              ))}
              {issues.length > 0 && (
                <ul className="mt-1 grid max-h-36 gap-1 overflow-y-auto text-xs">
                  {issues.slice(0, 50).map((x, i) => (
                    <li key={i} className="flex items-start gap-2 text-danger"><CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("imp.issue", { row: x.row, field: x.field, message: x.message })}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{tc("cancel")}</Button>
          <Button variant="outline" disabled={!loaded || !accountId || run.isPending} onClick={() => run.mutate(true)}>
            {run.isPending && run.variables === true ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("imp.validate")}
          </Button>
          <Button disabled={!loaded || !accountId || run.isPending || issues.length > 0} onClick={() => run.mutate(false)}>
            {run.isPending && run.variables === false ? <Loader2 className="animate-spin" aria-hidden /> : null} {t("imp.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
