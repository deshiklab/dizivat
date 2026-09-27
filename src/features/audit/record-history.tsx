"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, ExternalLink, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDateTime, fmtNum } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ACTION_ICON, ACTION_TONE } from "./audit-meta"

/**
 * Field-level history of one record from the audit trail (`/audit?entityId=`), newest first (S4-06).
 * Needs `audit.view`; everyone else sees a short explanation (documents keep their own status timeline).
 */
export function RecordHistory({ entityId, className, compact }: { entityId: string; className?: string; compact?: boolean }) {
  const t = useTranslations("audit")
  const locale = useLocale()
  const can = useCan()
  const allowed = can("audit.view")
  const q = useQuery({
    queryKey: ["audit", "record", entityId],
    queryFn: () => api.audit.list({ entityId, size: 100, sort: "at.desc" }),
    enabled: allowed && !!entityId,
    staleTime: 0,
  })
  const fieldLabel = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)

  if (!allowed) {
    return (
      <div className={cn("flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground", className)}>
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{t("historyNoAccess")}</p>
      </div>
    )
  }
  if (q.isLoading) return <div className={cn("grid gap-2", className)}><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
  if (q.error) return <p role="alert" className={cn("text-sm text-destructive", className)}>{q.error.message}</p>
  const events = q.data?.data ?? []

  return (
    <section className={cn("grid gap-3", className)} aria-label={t("recordHistory")}>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p> : (
        <ol className="grid gap-3">
          {events.map((e) => {
            const Icon = ACTION_ICON[e.action]
            return (
              <li key={e.id} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
                <span className={cn("grid size-7 place-items-center rounded-full bg-muted text-muted-foreground",
                  ACTION_TONE[e.action] === "success" && "bg-success/10 text-success", ACTION_TONE[e.action] === "danger" && "bg-destructive/10 text-destructive")}>
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Pill tone={ACTION_TONE[e.action] ?? "neutral"}>{t(`action.${e.action}`)}</Pill>
                    <span className="font-medium">{e.actor}</span>
                    <time dateTime={e.at} className="text-xs text-muted-foreground tabular">{fmtDateTime(e.at, locale)}</time>
                  </p>
                  {e.note && <p className="mt-1 rounded bg-muted/60 px-2 py-1 text-xs break-words">{e.note}</p>}
                  {!!e.changes?.length && (
                    <ul className="mt-1.5 grid gap-1 text-xs" aria-label={t("changes")}>
                      {e.changes.slice(0, compact ? 4 : undefined).map((c) => (
                        <li key={c.field} className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-2">
                          <span className="font-medium text-foreground">{fieldLabel(c.field)}</span>
                          <span className="min-w-0 break-words">
                            <span className="text-muted-foreground line-through decoration-danger/50">{c.from || "—"}</span>
                            <ArrowRight className="mx-1 inline size-3 text-muted-foreground" aria-label={t("to")} />
                            <span>{c.to || "—"}</span>
                          </span>
                        </li>
                      ))}
                      {compact && e.changes.length > 4 && <li className="text-muted-foreground">{t("moreChanges", { n: fmtNum(e.changes.length - 4, locale) })}</li>}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <div>
        <Button variant="outline" size="sm" render={<Link href={`/master/audit?entityId=${encodeURIComponent(entityId)}`} />}>
          <ExternalLink /> {t("openInAudit")}
        </Button>
      </div>
    </section>
  )
}

/** Collapsible "History" block for edit sheets (party, item, user, unit). Loads only when opened. */
export function HistorySection({ entityId, className }: { entityId: string; className?: string }) {
  const t = useTranslations("audit")
  const [open, setOpen] = React.useState(false)
  return (
    <details className={cn("group rounded-md border", className)} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {t("recordHistory")}
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
      </summary>
      {open && <div className="border-t p-3"><RecordHistory entityId={entityId} compact /></div>}
    </details>
  )
}
