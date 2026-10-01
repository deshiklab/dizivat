"use client"

import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { fmtDateTime, fmtNum } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * R6 (NBR enlistment — tamper protection): result of re-computing the SHA-256 hash chain over the whole audit trail.
 * Every event stores the hash of the previous one, so editing or deleting any record breaks the chain from that point.
 */
export function IntegrityCard() {
  const t = useTranslations("rmg.integrity")
  const locale = useLocale()
  const q = useQuery({ queryKey: ["audit", "verify"], queryFn: api.audit.verify, staleTime: 60_000 })
  const d = q.data
  const ok = d?.ok
  return (
    <section aria-labelledby="integrity-title" aria-live="polite"
      className={cn("mb-4 flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm", !d ? "bg-card" : ok ? "border-success/40 bg-success-soft" : "border-destructive/50 bg-destructive/10")}>
      {!d ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : ok ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id="integrity-title" className="font-medium">
          {t("title")}{d && <> — {ok ? t("ok", { count: fmtNum(d.count, locale) }) : t("broken", { ref: d.broken?.ref ?? "", at: d.broken ? fmtDateTime(d.broken.at, locale) : "" })}</>}
          {q.error && <> — {t("error")}</>}
        </h2>
        {d && !ok && d.broken && <p className="text-destructive">{t(`reason.${d.broken.reason}`)}</p>}
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        {d && <p className="truncate text-xs text-muted-foreground"><span>{t("head", { alg: d.algorithm })}</span> <code className="font-mono" title={d.head}>{d.head.slice(0, 16)}…</code> · {t("checked", { when: fmtDateTime(d.checkedAt, locale) })}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("verify")}</Button>
    </section>
  )
}
