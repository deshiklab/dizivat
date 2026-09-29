"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/common/money"
import { EmptyState } from "@/components/common/empty-state"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { noteDef, periodLabel } from "@/lib/r4"

/** Mushak 9.1 sub-form: the source documents behind one note; totals equal the note. */
export function SubFormSheet({ period, note, onOpenChange }: { period: string; note: number | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("ret")
  const tc = useTranslations("common")
  const locale = useLocale()
  const def = note != null ? noteDef(note) : undefined
  const q = useQuery({ queryKey: ["return", period, "note", note], queryFn: () => api.vat.returns.note(period, note!), enabled: note != null })
  const withSd = def?.kind === "vsv"
  const amountOnly = def?.kind === "amount" && !q.data?.total.value
  const title = def ? (locale === "bn" ? def.bn : def.en) : ""
  return (
    <Sheet open={note != null} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>{t("subformTitle", { n: note ?? 0 })}</SheetTitle>
          <SheetDescription>{title} · {periodLabel(period)}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isLoading ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
            : q.error ? <EmptyState title={t("error")} hint={q.error.message} />
            : !q.data?.rows.length ? <EmptyState title={t("subformEmpty")} />
            : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("subformTitle", { n: note ?? 0 })}>
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">{t("subformTitle", { n: note ?? 0 })}</caption>
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium">{t("sub.date")}</th>
                    <th scope="col" className="px-2 py-2 font-medium">{t("sub.ref")}</th>
                    <th scope="col" className="px-2 py-2 font-medium">{t("sub.party")}</th>
                    {!amountOnly && <th scope="col" className="px-2 py-2 text-right font-medium">{t("col.value")}</th>}
                    {withSd && <th scope="col" className="px-2 py-2 text-right font-medium">{t("col.sd")}</th>}
                    <th scope="col" className="px-4 py-2 text-right font-medium">{amountOnly ? t("col.amount") : t("col.vat")}</th>
                  </tr></thead>
                  <tbody>
                    {q.data.rows.map((r, i) => (
                      <tr key={`${r.ref}-${i}`} className="border-b">
                        <td className="px-4 py-1.5 tabular whitespace-nowrap">{fmtDate(r.date, locale)}</td>
                        <td className="px-2 py-1.5 tabular">{r.href ? <Link href={r.href} className="text-primary hover:underline">{r.ref}</Link> : r.ref}{r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}</td>
                        <td className="px-2 py-1.5">{r.party ?? "—"}{r.bin && <span className="block text-xs text-muted-foreground tabular">{r.bin}</span>}</td>
                        {!amountOnly && <td className="px-2 py-1.5 text-right"><Money value={r.value} /></td>}
                        {withSd && <td className="px-2 py-1.5 text-right"><Money value={r.sd ?? 0} /></td>}
                        <td className="px-4 py-1.5 text-right"><Money value={r.vat} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-muted/40 font-semibold">
                    <th scope="row" colSpan={3} className="px-4 py-2 text-left">{t("sub.total", { n: q.data.rows.length })}</th>
                    {!amountOnly && <td className="px-2 py-2 text-right"><Money value={q.data.total.value} /></td>}
                    {withSd && <td className="px-2 py-2 text-right"><Money value={q.data.total.sd} /></td>}
                    <td className="px-4 py-2 text-right"><Money value={q.data.total.vat} /></td>
                  </tr></tfoot>
                </table>
              </div>
            )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          {note != null && <Button variant="outline" render={<a href={api.vat.returns.noteCsvUrl(period, note)} download />}><Download /> CSV</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
