"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Money } from "@/components/common/money"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { EmptyState } from "@/components/common/empty-state"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtNum } from "@/lib/format"
import { DefList } from "@/features/r4/r4-actions"

/** Account details, balance build-up and the latest receipts / payments through it. */
export function AccountSheet({ id, onOpenChange, onEdit }: { id: string | null; onOpenChange: (o: boolean) => void; onEdit: (id: string) => void }) {
  const t = useTranslations("acct")
  const tm = useTranslations("money")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const { data: a, isLoading, error } = useQuery({ queryKey: ["account", id], queryFn: () => api.accounting.accounts.get(id!), enabled: !!id })
  const rec = useQuery({ queryKey: ["receipts", "account", id], queryFn: () => api.accounting.receipts.list({ account: id!, size: 8, sort: "date.desc" }), enabled: !!id })
  const pay = useQuery({ queryKey: ["payments", "account", id], queryFn: () => api.accounting.payments.list({ account: id!, size: 8, sort: "date.desc" }), enabled: !!id })
  const moves = [...(rec.data?.data ?? []), ...(pay.data?.data ?? [])].sort((x, y) => y.date.localeCompare(x.date) || y.no.localeCompare(x.no)).slice(0, 10)

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{a ? a.provider : t("titleOne")}</SheetTitle>
          <SheetDescription>{a ? `${t(`kind.${a.kind}`)} · ${a.accountNo || "—"}` : "\u00a0"}</SheetDescription>
        </SheetHeader>
        {isLoading ? <div className="grid gap-3 p-4"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
          : error || !a ? <EmptyState title={t("notFound")} hint={error?.message} />
          : (
            <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">{t("field.openingBalance")}</p><Money value={a.openingBalance} /></div>
                <div><p className="text-xs text-muted-foreground">{t("col.inflow")}</p><Money value={a.inflow} /></div>
                <div><p className="text-xs text-muted-foreground">{t("col.outflow")}</p><Money value={a.outflow} /></div>
                <div><p className="text-xs text-muted-foreground">{t("col.balance")}</p><Money value={a.balance} className="font-semibold" /></div>
              </div>
              <DefList rows={[
                [t("field.owner"), a.owner],
                [t("col.type"), a.bankType ? t(`bankType.${a.bankType}`) : a.walletType ? t(`walletType.${a.walletType}`) : "—"],
                [t("field.branch"), a.branch || "—"],
                [t("field.authorised"), a.authorised || "—"],
                [t("field.serviceCharge"), `${fmtNum(a.serviceCharge, locale, 2)}%`],
                [t("field.openingDate"), fmtDate(a.openingDate, locale)],
                [t("field.address"), a.address || "—"],
                [t("col.status"), <Pill key="s" tone={a.active ? "success" : "neutral"}>{t(a.active ? "active" : "inactive")}</Pill>],
              ]} />
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">{t("recent")}</h3>
                {!moves.length ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{t("noMoves")}</p> : (
                  <ul className="divide-y rounded-md border text-sm">
                    {moves.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="grid flex-1">
                          <Link href={`/accounting/${m.kind === "receipt" ? "receipts" : "payments"}?view=${m.id}`} className="font-medium text-primary hover:underline tabular">{m.no}</Link>
                          <span className="truncate text-xs text-muted-foreground">{fmtDate(m.date, locale)} · {m.partyName} · {tm(`method.${m.method}`)}</span>
                        </span>
                        <ProcessBadge value={m.process} />
                        <Money value={m.kind === "receipt" ? m.amount : -m.amount} className={m.kind === "receipt" ? "text-success" : ""} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="grid gap-2"><h3 className="text-sm font-semibold">{t("history")}</h3><RecordHistory entityId={a.id} /></section>
            </div>
          )}
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          {a && can("master.edit") && <Button variant="outline" onClick={() => onEdit(a.id)}><Pencil /> {tc("edit")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("close")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
