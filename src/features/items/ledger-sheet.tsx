"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Download, Info, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Num } from "@/components/common/money"
import { Pill } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import type { LedgerEntry, LedgerType } from "@/lib/types"

type Filter = "all" | "purchase" | "sale" | "production" | "other"
const FILTERS: Filter[] = ["all", "purchase", "sale", "production", "other"]
const inFilter = (f: Filter, e: LedgerEntry) =>
  f === "all" || (f === "production" ? e.type === "prodReceive" || e.type === "prodIssue" : f === "other" ? e.type === "opening" || e.type === "damage" : e.type === f)
const TONE: Record<LedgerType, "neutral" | "info" | "success" | "warning" | "danger"> = {
  opening: "neutral", purchase: "info", sale: "success", prodReceive: "info", prodIssue: "warning", damage: "danger",
}

/**
 * Stock ledger (Mushak 6.1/6.2-style movement card) for one item: every movement with running balance.
 * Opened from the Items list or global search via ?ledger=<id>, so it is linkable.
 */
export function LedgerSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit?: (id: string) => void }) {
  const t = useTranslations("ledger")
  const locale = useLocale()
  const can = useCan()
  const [filter, setFilter] = React.useState<Filter>("all")
  React.useEffect(() => { setFilter("all") }, [id])
  const { data, isLoading, error } = useQuery({ queryKey: ["ledger", id], queryFn: () => api.items.ledger(id!), enabled: !!id })
  const rows = (data?.entries ?? []).filter((e) => inFilter(filter, e))
  const it = data?.item
  const hasSummary = data?.entries.some((e) => e.summary)

  const csv = React.useMemo(() => {
    if (!data) return ""
    const head = ["Date", "Type", "Reference", "Party", "In", "Out", "Balance"]
    const body = data.entries.map((e) => [e.date, t(`type.${e.type}`), e.ref ?? "", e.party ?? "", e.in || "", e.out || "", e.balance])
    return "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + [head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n"))
  }, [data, t])

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>{it ? t("title", { name: it.name }) : t("titlePlain")}</SheetTitle>
          <SheetDescription>{it ? `${it.sku} · HS ${it.hsCode} · ${it.unit}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-80" /></div>
          : error || !data || !it ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <div className="flex min-h-0 flex-1 flex-col">
              <dl className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
                {[
                  [t("opening"), it.opening, ""],
                  [t("in"), data.totals.in - it.opening, "text-success"],
                  [t("out"), data.totals.out, "text-destructive"],
                  [t("closing"), it.remain, "font-semibold"],
                ].map(([k, v, cls]) => (
                  <div key={k as string} className="bg-card px-4 py-3">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className={`text-lg tabular ${cls}`}><Num value={v as number} /> <span className="text-xs font-normal text-muted-foreground">{it.unit}</span></dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <ToggleGroup aria-label={t("filter")} variant="outline" size="sm" value={[filter]} onValueChange={(v: string[]) => v[0] && setFilter(v[0] as Filter)}>
                  {FILTERS.map((f) => <ToggleGroupItem key={f} value={f}>{t(`filterBy.${f}`)}</ToggleGroupItem>)}
                </ToggleGroup>
                <div className="flex gap-2">
                  {onEdit && can("master.edit") && <Button variant="outline" size="sm" onClick={() => onEdit(it.id)}><Pencil /> {t("editItem")}</Button>}
                  <Button variant="outline" size="sm" render={<a href={csv} download={`ledger-${it.sku}.csv`} />}><Download /> CSV</Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto border-t" tabIndex={0} role="region" aria-label={t("titlePlain")}>
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("title", { name: it.name })}</caption>
                  <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                    <tr className="text-left text-xs text-muted-foreground">
                      {[t("col.date"), t("col.type"), t("col.ref"), t("col.in"), t("col.out"), t("col.balance")].map((h, i) => (
                        <th key={h} scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 3 ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-3 py-2 whitespace-nowrap tabular">{fmtDate(e.date, locale)}</td>
                        <td className="px-3 py-2"><Pill tone={TONE[e.type]}>{t(`type.${e.type}`)}</Pill>{e.summary && <span className="ml-1 text-xs text-muted-foreground" title={t("summaryRow")}>Σ</span>}</td>
                        <td className="max-w-64 px-3 py-2">
                          {e.refId ? <Link href={`/${e.type === "sale" ? "sales" : "purchases"}/${e.refId}`} className="font-medium text-primary hover:underline">{e.ref}</Link> : <span className="text-muted-foreground">{e.summary ? t("monthly") : "—"}</span>}
                          {e.party && <span className="block truncate text-xs text-muted-foreground" title={e.party}>{e.party}</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-success">{e.in ? <Num value={e.in} /> : ""}</td>
                        <td className="px-3 py-2 text-right text-destructive">{e.out ? <Num value={e.out} /> : ""}</td>
                        <td className="px-3 py-2 text-right font-medium"><Num value={e.balance} /></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">{t("empty")}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="flex items-start gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("footer", { n: fmtNum(data.entries.length, locale) })} {hasSummary && t("summaryNote")}
              </p>
            </div>
          )}
      </SheetContent>
    </Sheet>
  )
}
