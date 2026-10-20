"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CreditCard, Download, FileSpreadsheet, Link2, RotateCcw, Sparkles, Upload } from "lucide-react"
import { toast } from "sonner"
import { useCan } from "@/components/auth/me-provider"
import { PageHeader } from "@/components/common/page-header"
import { Pill } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BASE_PATH } from "@/lib/base-path"
import { fmtDate, fmtMoney } from "@/lib/format"
import type { Page, PosSale, PosTerminalLine, PosTerminalStatement } from "@/lib/types"

const apiUrl = (path: string) => `${BASE_PATH}/api/v1${path}`

interface SettlementRow extends PosTerminalStatement {
  matched: number
  open: number
  charges: number
  unexplained: number
  reconciled: boolean
  gross: number
  fee: number
  net: number
}

interface SettlementDetail {
  statement: PosTerminalStatement
  lines: PosTerminalLine[]
  posExpectedGross: number
  statementGross: number
  totalFees: number
  netSettled: number
  difference: number
  unexplained: number
  open: number
  matched: number
  charges: number
  ignored: number
  reconciled: boolean
}

interface DryRunPlan {
  accountId: string
  accountName: string
  channel: "card" | "bkash" | "nagad"
  total: number
  valid: number
  matched: number
  open: number
  totals: { gross: number; fee: number; net: number }
  issues: { row: number; errors: Record<string, string> }[]
  lines: PosTerminalLine[]
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { title?: string })?.title || `Request failed (${res.status})`)
  }
  return data as T
}

const SAMPLE_BKASH_ROWS = [
  {
    date: "2026-09-24",
    channel: "bkash",
    reference: "BKX90411A",
    narration: "bKash Merchant QR payment · POS-09260002",
    gross: 8975,
    fee: 166.04,
  },
  {
    date: "2026-09-24",
    channel: "bkash",
    reference: "BKM-SETTLE-FEE-09",
    narration: "bKash merchant gateway settlement charge",
    gross: 0,
    fee: 75,
  },
]

export function PosReconcilePage() {
  const t = useTranslations("posReconcilePage")
  const tPos = useTranslations("posPage")
  const locale = useLocale()
  const qc = useQueryClient()
  const can = useCan()
  const sp = useSearchParams()

  const [selectedId, setSelectedId] = useState<string>(sp.get("id") || "ts1")
  const [importOpen, setImportOpen] = useState(false)
  const [accountId, setAccountId] = useState("ac4")
  const [channel, setChannel] = useState<"card" | "bkash" | "nagad">("bkash")
  const [sourceFile, setSourceFile] = useState("bkash-merchant-settlement-0924.csv")
  const [rowsJson, setRowsJson] = useState(() => JSON.stringify(SAMPLE_BKASH_ROWS, null, 2))
  const [dryPlan, setDryPlan] = useState<DryRunPlan | null>(null)
  const [matchLineId, setMatchLineId] = useState<string | null>(null)
  const [matchSaleId, setMatchSaleId] = useState<string>("")

  const statementsQ = useQuery({
    queryKey: ["pos", "settlements"],
    queryFn: () => fetchJson<Page<SettlementRow>>("/pos/settlements?size=50"),
  })

  const activeStatementId = selectedId || statementsQ.data?.data?.[0]?.id || "ts1"

  const detailQ = useQuery({
    queryKey: ["pos", "settlement", activeStatementId],
    queryFn: () => fetchJson<SettlementDetail>(`/pos/settlements/${encodeURIComponent(activeStatementId)}`),
    enabled: Boolean(activeStatementId),
  })

  const salesQ = useQuery({
    queryKey: ["pos", "sales", "all"],
    queryFn: () => fetchJson<Page<PosSale>>("/pos/sales?size=100"),
  })

  const patchLineMut = useMutation({
    mutationFn: ({ lineId, status, note }: { lineId: string; status: "open" | "charge" | "ignored"; note?: string }) =>
      fetchJson<SettlementDetail>(
        `/pos/settlements/${encodeURIComponent(activeStatementId)}/lines/${encodeURIComponent(lineId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status, note }),
        },
      ),
    onSuccess: (view) => {
      toast.success(view.reconciled ? `${view.statement.no} is now 100% reconciled` : "Statement line updated")
      void qc.invalidateQueries({ queryKey: ["pos", "settlements"] })
      void qc.invalidateQueries({ queryKey: ["pos", "settlement", activeStatementId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const matchLineMut = useMutation({
    mutationFn: ({ lineId, saleId }: { lineId: string; saleId: string }) =>
      fetchJson<SettlementDetail>(
        `/pos/settlements/${encodeURIComponent(activeStatementId)}/lines/${encodeURIComponent(lineId)}/match`,
        {
          method: "POST",
          body: JSON.stringify({ saleId }),
        },
      ),
    onSuccess: () => {
      toast.success("Matched terminal line to POS invoice")
      setMatchLineId(null)
      setMatchSaleId("")
      void qc.invalidateQueries({ queryKey: ["pos", "settlements"] })
      void qc.invalidateQueries({ queryKey: ["pos", "settlement", activeStatementId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const dryRunMut = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(rowsJson) as unknown[]
      return fetchJson<DryRunPlan>("/pos/settlements/import", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          channel,
          source: sourceFile,
          dryRun: true,
          rows: parsed,
        }),
      })
    },
    onSuccess: (plan) => setDryPlan(plan),
    onError: (e: Error) => toast.error(e.message),
  })

  const importMut = useMutation({
    mutationFn: async () => {
      const parsed = JSON.parse(rowsJson) as unknown[]
      return fetchJson<SettlementDetail>("/pos/settlements/import", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          channel,
          source: sourceFile,
          dryRun: false,
          rows: parsed,
        }),
      })
    },
    onSuccess: (view) => {
      toast.success(`Imported ${view.statement.no} (${view.matched} matched, ${view.open} open)`)
      setImportOpen(false)
      setDryPlan(null)
      setSelectedId(view.statement.id)
      void qc.invalidateQueries({ queryKey: ["pos", "settlements"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const detail = detailQ.data

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" render={<a href={apiUrl("/pos/settlements?format=csv")} download="pos-settlements.csv" />}>
              <Download className="mr-1.5 size-4" />
              CSV
            </Button>
            {can("doc.create") && (
              <Button size="sm" onClick={() => setImportOpen(true)} data-testid="pos-import-settlement-btn">
                <Upload className="mr-1.5 size-4" />
                {t("importBtn")}
              </Button>
            )}
          </div>
        }
      />

      {/* Statements selector pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface p-3">
        {(statementsQ.data?.data ?? []).map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => setSelectedId(st.id)}
            data-testid={`pos-settlement-tab-${st.no}`}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
              activeStatementId === st.id
                ? "border-primary bg-accent text-accent-foreground font-semibold"
                : "bg-background hover:bg-muted"
            }`}
          >
            <CreditCard className="size-3.5" />
            <span className="font-mono">{st.no}</span>
            <span className="uppercase text-muted-foreground">({st.channel})</span>
            <Pill tone={st.reconciled ? "success" : "warning"}>
              {st.reconciled ? t("reconciled") : `${st.open} open`}
            </Pill>
          </button>
        ))}
      </div>

      {/* Selected Statement Detail */}
      {detail && (
        <div className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-xs text-muted-foreground">{t("posExpected")}</div>
              <div className="mt-1 font-mono text-base font-bold">{fmtMoney(detail.posExpectedGross, locale)}</div>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-xs text-muted-foreground">{t("statementGross")}</div>
              <div className="mt-1 font-mono text-base font-bold">{fmtMoney(detail.statementGross, locale)}</div>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-xs text-muted-foreground">{t("totalFees")}</div>
              <div className="mt-1 font-mono text-base font-bold text-warning">
                {fmtMoney(detail.totalFees, locale)}
              </div>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-xs text-muted-foreground">{t("netSettled")}</div>
              <div className="mt-1 font-mono text-base font-bold text-primary">
                {fmtMoney(detail.netSettled, locale)}
              </div>
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-xs text-muted-foreground">{t("unexplained")}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="font-mono text-base font-bold" data-testid="pos-settlement-unexplained">
                  {fmtMoney(detail.unexplained, locale)}
                </span>
                <Pill tone={detail.reconciled ? "success" : "warning"}>
                  {detail.reconciled ? t("reconciled") : `${detail.open} open`}
                </Pill>
              </div>
            </div>
          </div>

          {/* Lines table */}
          <section className="rounded-lg border bg-surface p-4" aria-label={detail.statement.no}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {detail.statement.no} · {detail.statement.accountName} ({detail.statement.source})
                </h2>
                <p className="text-xs text-muted-foreground">
                  {fmtDate(detail.statement.from, locale)} → {fmtDate(detail.statement.to, locale)} ·{" "}
                  {t("summaryLine", {
                    matched: detail.matched,
                    charges: detail.charges,
                    open: detail.open,
                  })}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-3">{t("col.date")}</th>
                    <th className="py-2 pr-3">{t("col.reference")}</th>
                    <th className="py-2 pr-3">{t("col.narration")}</th>
                    <th className="py-2 pr-3 text-right">{t("col.gross")}</th>
                    <th className="py-2 pr-3 text-right">{t("col.fee")}</th>
                    <th className="py-2 pr-3 text-right">{t("col.net")}</th>
                    <th className="py-2 pr-3">{t("col.matchedInvoice")}</th>
                    <th className="py-2 pr-3">{t("col.status")}</th>
                    <th className="py-2 text-right">{t("col.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id} className="border-b" data-testid={`pos-settlement-line-${line.rowNo}`}>
                      <td className="py-2.5 pr-2 font-mono text-xs">{line.rowNo}</td>
                      <td className="py-2.5 pr-3 text-xs">{fmtDate(line.date, locale)}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{line.reference || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs">
                        <div>{line.narration}</div>
                        {line.note && (
                          <div className="text-[11px] text-muted-foreground">
                            {t("notePrefix")}: {line.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-xs">{fmtMoney(line.gross, locale)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-xs text-warning">
                        {fmtMoney(line.fee, locale)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-xs font-semibold">
                        {fmtMoney(line.net, locale)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {line.invoiceNo ? (
                          <span className="inline-flex items-center gap-1 font-mono font-semibold text-success">
                            <CheckCircle2 className="size-3.5" />
                            {line.invoiceNo}
                          </span>
                        ) : line.suggestion ? (
                          <span className="font-mono text-xs text-info">
                            {t("suggested")}: {line.suggestion.invoiceNo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Pill
                          tone={
                            line.status === "matched"
                              ? "success"
                              : line.status === "charge"
                                ? "info"
                                : line.status === "ignored"
                                  ? "neutral"
                                  : "warning"
                          }
                        >
                          {line.status}
                        </Pill>
                      </td>
                      <td className="py-2.5 text-right">
                        {can("doc.edit") && line.status === "open" && (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                patchLineMut.mutate({
                                  lineId: line.id,
                                  status: "charge",
                                  note: "Parked as terminal commission / service charge",
                                })
                              }
                              data-testid={`pos-line-park-charge-${line.rowNo}`}
                            >
                              {t("parkAsCharge")}
                            </Button>
                            {line.gross > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setMatchLineId(line.id)
                                  setMatchSaleId(line.suggestion?.invoiceNo ?? "")
                                }}
                              >
                                <Link2 className="mr-1 size-3.5" />
                                {t("matchInvoice")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => patchLineMut.mutate({ lineId: line.id, status: "ignored" })}
                            >
                              {t("ignoreLine")}
                            </Button>
                          </div>
                        )}
                        {can("doc.edit") && (line.status === "charge" || line.status === "ignored") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => patchLineMut.mutate({ lineId: line.id, status: "open" })}
                          >
                            <RotateCcw className="mr-1 size-3.5" />
                            {t("reopenLine")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* DIALOG 1: IMPORT TERMINAL STATEMENT */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("importBtn")}</DialogTitle>
            <DialogDescription>{t("subtitle")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="pos-term-account">{t("account")}</Label>
                <select
                  id="pos-term-account"
                  value={accountId}
                  onChange={(e) => {
                    const v = e.target.value
                    setAccountId(v)
                    setChannel(v === "ac1" || v === "ac2" ? "card" : v === "ac5" ? "nagad" : "bkash")
                  }}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="ac4">AC4</option>
                  <option value="ac5">AC5</option>
                  <option value="ac1">AC1</option>
                  <option value="ac2">AC2</option>
                </select>
              </div>
              <div>
                <Label htmlFor="pos-term-channel">{t("channel")}</Label>
                <select
                  id="pos-term-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as "card" | "bkash" | "nagad")}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="bkash">{tPos("tenderMethod.bkash")}</option>
                  <option value="nagad">{tPos("tenderMethod.nagad")}</option>
                  <option value="card">{tPos("tenderMethod.card")}</option>
                </select>
              </div>
              <div>
                <Label htmlFor="pos-term-source">{t("sourceFile")}</Label>
                <Input
                  id="pos-term-source"
                  value={sourceFile}
                  onChange={(e) => setSourceFile(e.target.value)}
                  className="mt-1 h-9 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="pos-term-rows">{t("rowsJson")}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAccountId("ac4")
                  setChannel("bkash")
                  setSourceFile("bkash-merchant-settlement-0924.csv")
                  setRowsJson(JSON.stringify(SAMPLE_BKASH_ROWS, null, 2))
                }}
              >
                <Sparkles className="mr-1 size-3.5" />
                {t("loadDemoBatch")}
              </Button>
            </div>
            <textarea
              id="pos-term-rows"
              value={rowsJson}
              onChange={(e) => setRowsJson(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs"
            />

            {dryPlan && (
              <div className="rounded-md border bg-muted/40 p-3" data-testid="pos-dryrun-summary">
                <div className="font-semibold">
                  {t("dryRunSummary", {
                    matched: dryPlan.matched,
                    open: dryPlan.open,
                    gross: fmtMoney(dryPlan.totals.gross, locale),
                    fee: fmtMoney(dryPlan.totals.fee, locale),
                    net: fmtMoney(dryPlan.totals.net, locale),
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => dryRunMut.mutate()}
              disabled={dryRunMut.isPending}
              data-testid="pos-dryrun-btn"
            >
              <FileSpreadsheet className="mr-1.5 size-4" />
              {t("dryRunBtn")}
            </Button>
            <Button
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending}
              data-testid="pos-commit-import-btn"
            >
              <Upload className="mr-1.5 size-4" />
              {t("commitBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: MANUAL MATCH LINE TO POS SALE */}
      <Dialog open={Boolean(matchLineId)} onOpenChange={(o) => !o && setMatchLineId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("matchInvoice")}</DialogTitle>
            <DialogDescription>{t("matchDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="pos-match-sale-select">{t("col.matchedInvoice")}</Label>
            <select
              id="pos-match-sale-select"
              value={matchSaleId}
              onChange={(e) => setMatchSaleId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
            >
              <option value="">{t("selectInvoice")}</option>
              {(salesQ.data?.data ?? []).map((s) => (
                <option key={s.id} value={s.invoiceNo}>
                  {s.invoiceNo} — {s.customerName} (৳{s.netTotal})
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              disabled={!matchLineId || !matchSaleId || matchLineMut.isPending}
              onClick={() => matchLineId && matchLineMut.mutate({ lineId: matchLineId, saleId: matchSaleId })}
            >
              {t("matchInvoice")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
