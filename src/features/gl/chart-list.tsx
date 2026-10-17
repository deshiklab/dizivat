"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, Download, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/common/page-header"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api/client"
import { fmtNum } from "@/lib/format"

const KIND_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const

/**
 * R9.2 — the chart of accounts: the RMG template plus one row per money account, each with the movement the
 * documents have derived for it. Nothing here is typed twice — the figures come from the same fold the
 * journal register shows. The footer carries the trial balance: every entry is balanced by construction, so
 * the two sides of the chart always agree to the poisha.
 */
export function ChartList() {
  const t = useTranslations("chart")
  const tt = useTranslations("table")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [group, setGroup] = React.useState<string>("all")
  const q = useQuery({ queryKey: ["chart"], queryFn: () => api.accounting.chart.list() })

  const rows = React.useMemo(() => q.data ?? [], [q.data])
  const groups = React.useMemo(() => [...new Set(rows.map((r) => r.group))], [rows])
  const shown = React.useMemo(() => (group === "all" ? rows : rows.filter((r) => r.group === group)), [rows, group])
  const debit = rows.reduce((s, r) => s + r.debit, 0)
  const credit = rows.reduce((s, r) => s + r.credit, 0)
  const balanced = Math.abs(debit - credit) < 0.005

  return (
    <>
      <PageHeader
        title={t("title")}
        description={q.data ? t("summary", { accounts: fmtNum(rows.length, locale), entries: fmtNum(rows.reduce((s, r) => s + r.entries, 0), locale) }) : t("subtitle")}
        actions={
          <Button variant="outline" size="sm" render={<a href={api.accounting.chart.csvUrl()} download />}>
            <Download /> <span className="hidden lg:inline">{tt("exportCsv")}</span>
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={group === "all" ? "default" : "outline"} onClick={() => setGroup("all")}>{t("allGroups")}</Button>
        {groups.map((g) => (
          <Button key={g} size="sm" variant={group === g ? "default" : "outline"} onClick={() => setGroup(g)}>{g}</Button>
        ))}
      </div>
      {q.isLoading ? <Skeleton className="h-96" />
        : q.error ? <EmptyState title={tc("error")} hint={q.error.message} />
        : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("title")}</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th scope="col" className="p-2 font-medium">{t("col.code")}</th>
                  <th scope="col" className="p-2 font-medium">{t("col.account")}</th>
                  <th scope="col" className="p-2 font-medium">{t("col.group")}</th>
                  <th scope="col" className="p-2 text-right font-medium">{t("col.debit")}</th>
                  <th scope="col" className="p-2 text-right font-medium">{t("col.credit")}</th>
                  <th scope="col" className="p-2 text-right font-medium">{t("col.balance")}</th>
                  <th scope="col" className="p-2 text-right font-medium">{t("col.entries")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2 font-medium tabular">{r.code}</td>
                    <td className="p-2">
                      <Link href={`/accounting/ledger?account=${encodeURIComponent(r.code)}`} className="hover:underline">{r.name}</Link>
                      {!r.active && <span className="ml-2 text-xs text-muted-foreground">({t("inactive")})</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.group}</td>
                    <td className="p-2 text-right tabular">{r.debit ? <Money value={r.debit} /> : "—"}</td>
                    <td className="p-2 text-right tabular">{r.credit ? <Money value={r.credit} /> : "—"}</td>
                    <td className="p-2 text-right font-medium tabular">{r.balance ? <Money value={r.balance} /> : "—"}</td>
                    <td className="p-2 text-right tabular text-muted-foreground">{r.entries || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/50 font-medium">
                  <td colSpan={3} className="p-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Scale className={balanced ? "size-3.5 text-success" : "size-3.5 text-destructive"} aria-hidden />
                      {balanced ? t("trialBalanced") : t("trialOff")}
                    </span>
                  </td>
                  <td className="p-2 text-right tabular"><Money value={Math.round(debit * 100) / 100} /></td>
                  <td className="p-2 text-right tabular"><Money value={Math.round(credit * 100) / 100} /></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground"><BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t("derivedNote")}</p>
    </>
  )
}

export { KIND_ORDER }
