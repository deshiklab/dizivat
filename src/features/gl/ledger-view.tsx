"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api/client"
import { TODAY } from "@/lib/company"
import { fmtDate } from "@/lib/format"
import { round2 } from "@/lib/vat"

/**
 * R9.2 — one account's ledger: what it opened at, every movement in range with the running balance, and what
 * it closed at. Reached from the chart (every account row links here) and worth bookmarking for the accounts
 * the month-end close always looks at.
 */
export function LedgerView({ account: accountParam }: { account?: string }) {
  const t = useTranslations("ledgerPage")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [account, setAccount] = React.useState(accountParam ?? "")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  React.useEffect(() => { if (accountParam && accountParam !== account) setAccount(accountParam) }, [accountParam]) // eslint-disable-line react-hooks/exhaustive-deps
  const chart = useQuery({ queryKey: ["chart"], queryFn: () => api.accounting.chart.list() })
  const q = useQuery({
    queryKey: ["glLedger", account, from, to],
    queryFn: () => api.accounting.ledger({ account, from: from || undefined, to: to || undefined }),
    enabled: !!account,
  })

  const picked = chart.data?.find((a) => a.code === account)
  const debit = round2(q.data?.rows.reduce((s, r) => s + r.debit, 0) ?? 0)
  const credit = round2(q.data?.rows.reduce((s, r) => s + r.credit, 0) ?? 0)

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { account: q.data.account.code, name: q.data.account.name, rows: q.data.rows.length }) : t("subtitle")}
        actions={<Button variant="outline" size="sm" render={<Link href="/accounting/chart" />}><ArrowLeft /> {t("backToChart")}</Button>}
      />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Select value={account} onValueChange={(v) => setAccount(v ?? "")} items={(chart.data ?? []).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))}>
          <SelectTrigger aria-label={t("pickAccount")}><SelectValue placeholder={t("pickAccount")} /></SelectTrigger>
          <SelectContent>{(chart.data ?? []).map((a) => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" className="sm:w-40" aria-label={t("from")} value={from} max={TODAY} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="sm:w-40" aria-label={t("to")} value={to} max={TODAY} onChange={(e) => setTo(e.target.value)} />
      </div>
      {!account ? <EmptyState title={t("pickFirst")} />
        : q.isLoading ? <Skeleton className="h-96" />
        : q.error ? <EmptyState title={tc("error")} hint={q.error.message} />
        : q.data && (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t("opening"), q.data.opening],
                [t("totalDebit"), q.data.totals.debit],
                [t("totalCredit"), q.data.totals.credit],
                [t("closing"), q.data.closing],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-medium tabular"><Money value={value as number} /></dd>
                </div>
              ))}
            </dl>
            {q.data.rows.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <caption className="sr-only">{picked?.name ?? account}</caption>
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th scope="col" className="p-2 font-medium">{t("col.date")}</th>
                      <th scope="col" className="p-2 font-medium">{t("col.memo")}</th>
                      <th scope="col" className="p-2 font-medium">{t("col.no")}</th>
                      <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.debit")}</th>
                      <th scope="col" className="w-32 p-2 text-right font-medium">{t("col.credit")}</th>
                      <th scope="col" className="w-40 p-2 text-right font-medium">{t("col.balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.rows.map((r, i) => (
                      <tr key={`${r.entryId}-${i}`} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="whitespace-nowrap p-2 tabular">{fmtDate(r.date, locale)}</td>
                        <td className="p-2"><span className="block max-w-96 truncate" title={r.memo}>{r.memo}</span></td>
                        <td className="whitespace-nowrap p-2 tabular text-muted-foreground">{r.no}</td>
                        <td className="p-2 text-right tabular">{r.debit ? <Money value={r.debit} /> : "—"}</td>
                        <td className="p-2 text-right tabular">{r.credit ? <Money value={r.credit} /> : "—"}</td>
                        <td className="p-2 text-right font-medium tabular"><Money value={r.balance} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/50 font-medium">
                      <td colSpan={3} className="p-2"><span className="inline-flex items-center gap-1.5"><Scale className="size-3.5 text-muted-foreground" aria-hidden />{t("inRange")}</span></td>
                      <td className="p-2 text-right tabular"><Money value={debit} /></td>
                      <td className="p-2 text-right tabular"><Money value={credit} /></td>
                      <td className="p-2 text-right tabular"><Money value={q.data.closing} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : <EmptyState title={t("empty")} hint={t("emptyHint")} />}
          </>
        )}
    </>
  )
}
