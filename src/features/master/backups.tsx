"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CalendarClock, CheckCircle2, CircleAlert, DatabaseBackup, Download, HardDrive, History, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Pill } from "@/components/common/status-badge"
import { RequirePerm } from "@/components/auth/me-provider"
import { api } from "@/lib/api/client"
import { fmtDateTime, fmtNum } from "@/lib/format"
import type { BackupVerify, RestoreDrill } from "@/lib/types"

const kb = (n: number, locale: string) => (n >= 1048576 ? `${fmtNum(n / 1048576, locale, 1)} MB` : `${fmtNum(Math.max(1, Math.round(n / 1024)), locale)} KB`)

/**
 * R6.2 (GO 16/Mushak/2019 — at least two backups of the VAT data every day): automatic backups at 02:00 and 14:00
 * (Asia/Dhaka), the last 30 kept, each with a SHA-256 checksum that can be re-verified; administrators can take one
 * now and download any (downloads are audited).
 */
export function BackupsPage() {
  return <RequirePerm perm="settings.manage" back="/master/company"><Backups /></RequirePerm>
}

function Backups() {
  const t = useTranslations("backup")
  const locale = useLocale()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ["backups"], queryFn: api.backups.status, refetchInterval: 60_000 })
  const [checks, setChecks] = React.useState<Record<string, BackupVerify>>({})
  const take = useMutation({
    mutationFn: api.backups.create,
    onSuccess: (b) => { qc.invalidateQueries({ queryKey: ["backups"] }); toast.success(t("taken", { size: kb(b.size, locale) })) },
    onError: (e) => toast.error(e.message),
  })
  const verify = useMutation({
    mutationFn: api.backups.verify,
    onSuccess: (r) => { setChecks((c) => ({ ...c, [r.id]: r })); if (r.ok) toast.success(t("verified")); else toast.error(t("verifyFailed")) },
    onError: (e) => toast.error(e.message),
  })
  const d = q.data
  const ok = (d?.today ?? 0) >= 2

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={<Button disabled={take.isPending} onClick={() => take.mutate()}>{take.isPending ? <Loader2 className="animate-spin" /> : <DatabaseBackup />} {t("takeNow")}</Button>} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("error")} hint={q.error.message} /> : d && (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm" className={ok ? "border-success/50" : "border-warning/60"}>
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm">{ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleAlert className="size-4 text-warning" aria-hidden />} {t("today")}</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-semibold tabular">{fmtNum(d.today, locale)}</span> <span className="text-sm text-muted-foreground">/ {fmtNum(d.schedule.length, locale)} {t("required")}</span></CardContent>
            </Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4" aria-hidden /> {t("schedule")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><span className="font-semibold tabular">{d.schedule.join(" · ")}</span> <span className="text-muted-foreground">({d.timezone})</span><p className="mt-1 text-xs text-muted-foreground">{t("next", { at: fmtDateTime(d.next, locale) })}</p></CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><DatabaseBackup className="size-4" aria-hidden /> {t("last")}</CardTitle></CardHeader>
              <CardContent className="text-sm">{d.last ? <><span className="font-semibold">{fmtDateTime(d.last.at, locale)}</span><p className="mt-1 text-xs text-muted-foreground">{kb(d.last.size, locale)} · {t(`kind.${d.last.kind}`)}</p></> : <span className="text-muted-foreground">{t("none")}</span>}</CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><HardDrive className="size-4" aria-hidden /> {t("retention")}</CardTitle></CardHeader>
              <CardContent className="text-sm"><span className="font-semibold tabular">{t("keep", { n: d.retention })}</span><p className="mt-1 text-xs text-muted-foreground">{t(`storage.${d.storage}`)}</p></CardContent></Card>
          </div>
          <DrillPanel drill={d.drill} />
          <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("table")}>
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">{t("table")}</caption>
              <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t("col.at")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.kind")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.size")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.records")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("col.sha")}</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">{t("col.actions")}</span></th>
              </tr></thead>
              <tbody>
                {d.rows.length ? d.rows.map((b) => {
                  const c = checks[b.id]
                  const records = Object.values(b.tables).reduce((a, n) => a + n, 0)
                  return (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(b.at, locale)}<span className="block text-xs text-muted-foreground">{b.by}</span></td>
                      <td className="px-3 py-2"><Pill tone={b.kind === "scheduled" ? "info" : "neutral"}>{t(`kind.${b.kind}`)}</Pill>{b.kind === "scheduled" && <span className="block text-xs text-muted-foreground tabular">{b.slot}</span>}</td>
                      <td className="px-3 py-2 text-right tabular">{kb(b.size, locale)}</td>
                      <td className="px-3 py-2 text-right tabular" title={Object.entries(b.tables).map(([k, n]) => `${k}: ${n}`).join("\n")}>{fmtNum(records, locale)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.sha256.slice(0, 16)}…{c && (c.ok ? <span className="ml-2 inline-flex items-center gap-1 font-sans text-success"><ShieldCheck className="size-3.5" aria-hidden /> {t("intact")}</span> : <span className="ml-2 font-sans text-destructive">{t("corrupt")}</span>)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" disabled={verify.isPending} onClick={() => verify.mutate(b.id)} aria-label={t("verifyOne", { at: fmtDateTime(b.at, locale) })}><ShieldCheck /> {t("verify")}</Button>
                        <Button variant="ghost" size="sm" render={<a href={api.backups.downloadUrl(b.id)} download aria-label={t("downloadOne", { at: fmtDateTime(b.at, locale) })} />}><Download /> {t("download")}</Button>
                      </td>
                    </tr>
                  )
                }) : <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{t("empty")}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("note")}</p>
        </div>
      )}
    </>
  )
}

/** R6.3: the latest restore drill — a backup restored into an empty database, verified and started (docs/BACKUP_RESTORE.md). */
function DrillPanel({ drill }: { drill?: RestoreDrill | null }) {
  const t = useTranslations("backup.drill")
  const locale = useLocale()
  return (
    <section aria-labelledby="drill-h" className={`grid gap-2 rounded-lg border bg-card p-4 ${drill && !drill.ok ? "border-destructive/50" : ""}`} data-testid="restore-drill">
      <h2 id="drill-h" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <History className="size-4" aria-hidden /> {t("title")}
        {drill ? <Pill tone={drill.ok ? "success" : "danger"}>{drill.ok ? t("passed") : t("failed")}</Pill> : <Pill tone="warning">{t("never")}</Pill>}
      </h2>
      {drill ? (
        <>
          <p className="text-sm">{t("summary", { at: fmtDateTime(drill.at, locale), backup: drill.backupId ?? "—", backupAt: drill.backupAt ? fmtDateTime(drill.backupAt, locale) : "—", s: fmtNum(drill.ms / 1000, locale, 1) })}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li>{t("tables", { n: fmtNum(drill.tables, locale), rows: fmtNum(drill.rows, locale) })}</li>
            <li>{t("documents", { n: fmtNum(drill.documents, locale) })}</li>
            <li>{t("chain")}: <span className={drill.auditChain === "broken" ? "font-medium text-destructive" : ""}>{t(`chainState.${drill.auditChain}`)}</span></li>
            <li>{t("boot")}: <span className={drill.boot === "failed" ? "font-medium text-destructive" : ""}>{t(`bootState.${drill.boot}`)}</span></li>
            <li className="tabular">SHA-256 {drill.sha256.slice(0, 12)}…</li>
            <li>{drill.by}</li>
          </ul>
          {drill.mismatches.length > 0 && <ul className="grid gap-0.5 text-xs text-destructive">{drill.mismatches.map((m) => <li key={m}>{m}</li>)}</ul>}
        </>
      ) : <p className="text-sm text-muted-foreground">{t("neverHint")}</p>}
      <p className="text-xs text-muted-foreground">{t("how")}</p>
    </section>
  )
}
