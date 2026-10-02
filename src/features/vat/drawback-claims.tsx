"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { toast } from "sonner"
import { ArrowLeft, Banknote, CheckCircle2, Download, FilePlus2, FileText, Hourglass, Loader2, Printer, Send, Trash2, Undo2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Field } from "@/components/common/field"
import { PdfButton } from "@/components/common/pdf-button"
import { Pill, type Tone } from "@/components/common/status-badge"
import { useConfirm } from "@/components/common/confirm"
import { useCan } from "@/components/auth/me-provider"
import { RecordHistory } from "@/features/audit/record-history"
import { ClaimStatement } from "@/features/vat/claim-statement"
import { Link, useRouter } from "@/i18n/navigation"
import { api, ApiError } from "@/lib/api/client"
import { DRAWBACK_MONTHS } from "@/lib/bond"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import type { ClaimStatus, DrawbackClaimRow, DrawbackRow } from "@/lib/types"
import { cn } from "@/lib/utils"

export const CLAIM_TONE: Record<ClaimStatus, Tone> = { draft: "neutral", filed: "info", sanctioned: "warning", paid: "success", rejected: "danger" }
type Action = "file" | "sanction" | "pay" | "reject"

/** Claim status pill, linked to the claim. */
export function ClaimPill({ claim }: { claim: NonNullable<DrawbackRow["claim"]> }) {
  const t = useTranslations("claims")
  return (
    <Link href={`/vat/bond-consumption/claims/${claim.id}`} className="inline-flex flex-wrap items-center gap-1 text-xs" data-testid={`claim-link-${claim.no}`}>
      <Pill tone={CLAIM_TONE[claim.status]}>{t(`status.${claim.status}`)}</Pill>
      <span className="text-primary tabular underline underline-offset-2">{claim.no}</span>
    </Link>
  )
}

/** Drawback tab: selected open exports → new draft claim. */
export function ClaimFromSelection({ rows, selected, onClear }: { rows: DrawbackRow[]; selected: string[]; onClear: () => void }) {
  const t = useTranslations("claims")
  const locale = useLocale()
  const qc = useQueryClient()
  const router = useRouter()
  const can = useCan()
  const total = rows.filter((r) => selected.includes(r.saleId)).reduce((a, r) => a + r.total, 0)
  const create = useMutation({
    mutationFn: () => api.vat.claims.create({ saleIds: selected }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["bond"] }); qc.invalidateQueries({ queryKey: ["claims"] })
      toast.success(t("created", { no: c.no })); onClear(); router.push(`/vat/bond-consumption/claims/${c.id}`)
    },
    onError: (e) => toast.error(e instanceof ApiError && e.errors ? t("createFailed", { why: Object.values(e.errors).flat().map((x) => (t.has(`err.${x}`) ? t(`err.${x}`) : x)).join(", ") }) : e.message),
  })
  if (!can("doc.create")) return null
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3" role="region" aria-label={t("selection")}>
      <span className="text-sm" aria-live="polite">{selected.length ? t("selected", { n: selected.length, amount: fmtNum(total, locale, 2) }) : t("selectHint")}</span>
      <div className="ml-auto flex gap-2">
        {selected.length > 0 && <Button variant="ghost" size="sm" onClick={onClear}>{t("clear")}</Button>}
        <Button size="sm" disabled={!selected.length || create.isPending} onClick={() => create.mutate()} data-testid="claim-create">
          {create.isPending ? <Loader2 className="animate-spin" /> : <FilePlus2 />} {t("create")}
        </Button>
      </div>
    </div>
  )
}

/** Claims tab of the bond page. */
export function ClaimsTab() {
  const t = useTranslations("claims")
  const locale = useLocale()
  const [status, setStatus] = useQueryState("claimStatus", parseAsString.withDefault(""))
  const q = useQuery({ queryKey: ["claims", status], queryFn: () => api.vat.claims.list(status || undefined) })
  const d = q.data
  if (q.isLoading) return <Skeleton className="h-72" />
  if (q.error || !d) return <EmptyState title={t("error")} hint={q.error?.message} />
  const STATUSES: ClaimStatus[] = ["draft", "filed", "sanctioned", "paid", "rejected"]
  return (
    <div className="grid gap-3">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label={t("tot.draft")} value={d.totals.draft} />
        <Tile label={t("tot.pending")} value={d.totals.pending} icon={Hourglass} />
        <Tile label={t("tot.sanctioned")} value={d.totals.sanctioned} icon={CheckCircle2} tone={d.totals.sanctioned ? "warning" : undefined} testId="claims-sanctioned" />
        <Tile label={t("tot.refunded")} value={d.totals.refunded} icon={Banknote} testId="claims-refunded" />
        <Tile label={t("tot.disallowed")} value={d.totals.disallowed} icon={XCircle} tone={d.totals.disallowed ? "danger" : undefined} />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filter")}>
          <Button size="xs" variant={!status ? "secondary" : "outline"} aria-pressed={!status} onClick={() => setStatus(null)}>{t("all")}</Button>
          {STATUSES.map((s) => <Button key={s} size="xs" variant={status === s ? "secondary" : "outline"} aria-pressed={status === s} onClick={() => setStatus(s)}>{t(`status.${s}`)}</Button>)}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" render={<a href={api.vat.claims.csvUrl()} download={`drawback-claims-${TODAY}.csv`} />}><Download /> {t("csv")}</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("table")}>
        <table className="w-full min-w-[960px] text-sm">
          <caption className="sr-only">{t("table")}</caption>
          <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("col.claim")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.exports")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.claimed")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.filed")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.sanctioned")}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{t("col.refunded")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("col.status")}</th>
          </tr></thead>
          <tbody>
            {d.rows.length ? d.rows.map((c) => (
              <tr key={c.id} className="border-b align-top last:border-0" data-testid={`claim-row-${c.no}`}>
                <td className="px-3 py-2"><Link href={`/vat/bond-consumption/claims/${c.id}`} className="font-medium text-primary tabular underline underline-offset-2">{c.no}</Link>
                  <span className="block text-xs text-muted-foreground">{fmtDate(c.createdAt.slice(0, 10), locale)} · {c.createdBy}</span></td>
                <td className="px-3 py-2 text-xs"><span className="tabular">{c.lines.map((l) => l.invoiceNo).join(", ")}</span>
                  {c.status === "draft" && <span className={cn("block", c.daysLeft < 0 ? "text-destructive" : c.daysLeft <= 30 ? "text-warning" : "text-muted-foreground")}>{c.daysLeft < 0 ? t("lapsedSince", { date: fmtDate(c.deadline, locale) }) : t("fileBy", { date: fmtDate(c.deadline, locale), days: c.daysLeft })}</span>}</td>
                <td className="px-3 py-2 text-right font-medium"><Money value={c.claimed} /></td>
                <td className="px-3 py-2 text-xs tabular">{c.filedOn ? <>{fmtDate(c.filedOn, locale)}<span className="block text-muted-foreground">{c.dedoRef ?? ""}</span></> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-right">{c.sanctioned != null ? <><Money value={c.sanctioned} />{c.disallowed > 0 && <span className="block text-xs text-destructive">{t("disallowed")} <Money value={c.disallowed} muted0={false} /></span>}</> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 text-right">{c.paid != null ? <><Money value={c.paid} /><span className="block text-xs text-muted-foreground tabular">{fmtDate(c.paidOn!, locale)}</span></> : <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2"><Pill tone={CLAIM_TONE[c.status]}>{t(`status.${c.status}`)}</Pill></td>
              </tr>
            )) : <tr><td colSpan={7} className="px-3 py-10"><EmptyState icon={Undo2} title={t("empty")} hint={t("emptyHint")} /></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("note", { months: DRAWBACK_MONTHS })}</p>
    </div>
  )
}

function Tile({ label, value, icon: Icon, tone, testId }: { label: string; value: number; icon?: React.ElementType; tone?: "warning" | "danger"; testId?: string }) {
  return (
    <div className={cn("rounded-md border bg-card p-3", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : "")} data-testid={testId}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{Icon && <Icon className="size-3.5" aria-hidden />}{label}</dt>
      <dd className="mt-1 text-lg font-semibold"><Money value={value} /></dd>
    </div>
  )
}

/** /vat/bond-consumption/claims/[id] — one claim, its lifecycle actions and the printable statement. */
export function ClaimDetailPage({ id }: { id: string }) {
  const t = useTranslations("claims")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  const qc = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const [tab, setTab] = React.useState("statement")
  const [action, setAction] = React.useState<Action | null>(null)
  const q = useQuery({ queryKey: ["claims", "one", id], queryFn: () => api.vat.claims.get(id) })
  const c = q.data
  const remove = useMutation({
    mutationFn: () => api.vat.claims.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["claims"] }); qc.invalidateQueries({ queryKey: ["bond"] }); toast.success(t("deleted", { no: c?.no ?? "" })); router.push("/vat/bond-consumption?tab=claims") },
    onError: (e) => toast.error(e.message),
  })
  const back = <Button variant="outline" render={<Link href="/vat/bond-consumption?tab=claims" />}><ArrowLeft /> {t("back")}</Button>
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !c) return <EmptyState title={t("notFound")} action={back} />
  const actions: { a: Action; icon: React.ElementType; perm: "doc.create" | "doc.approve"; variant?: "outline" | "destructive" }[] =
    c.status === "draft" ? [{ a: "file", icon: Send, perm: "doc.create" }]
      : c.status === "filed" ? [{ a: "sanction", icon: CheckCircle2, perm: "doc.approve" }, { a: "reject", icon: XCircle, perm: "doc.approve", variant: "outline" }]
        : c.status === "sanctioned" ? [{ a: "pay", icon: Banknote, perm: "doc.approve" }] : []
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("crumb"), href: "/vat/bond-consumption?tab=claims" }, { label: c.no }]}
        title={<span className="flex flex-wrap items-center gap-2">{t("detailTitle", { no: c.no })} <Pill tone={CLAIM_TONE[c.status]}>{t(`status.${c.status}`)}</Pill></span>}
        description={t("detailSub", { n: c.lines.length, amount: fmtNum(c.claimed, locale, 2) })}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setTab("statement"); setTimeout(() => window.print(), 200) }}><Printer /> {tc("print")}</Button>
          <PdfButton filename={`Drawback-claim_${c.no}`} prepare={() => setTab("statement")} />
          {actions.filter((x) => can(x.perm)).map((x) => <Button key={x.a} size="sm" variant={x.variant ?? "default"} onClick={() => setAction(x.a)} data-testid={`claim-action-${x.a}`}><x.icon /> {t(`action.${x.a}`)}</Button>)}
          {c.status === "draft" && can("doc.delete") && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: t("deleteTitle", { no: c.no }), description: t("deleteBody"), confirm: t("delete"), cancel: tc("cancel"), destructive: true })) remove.mutate() }}><Trash2 /> {t("delete")}</Button>}
        </>}
      />
      <section aria-label={t("summary")} className="no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("col.claimed")} value={<Money value={c.claimed} />} hint={t("cdRd", { cd: fmtNum(c.cd, locale, 2), rd: fmtNum(c.rd, locale, 2) })} />
        <Fact label={t("col.filed")} value={c.filedOn ? fmtDate(c.filedOn, locale) : "—"} hint={c.dedoRef ?? (c.status === "draft" ? (c.daysLeft < 0 ? t("lapsedSince", { date: fmtDate(c.deadline, locale) }) : t("fileBy", { date: fmtDate(c.deadline, locale), days: c.daysLeft })) : undefined)}
          tone={c.status === "draft" && c.daysLeft <= 30 ? (c.daysLeft < 0 ? "danger" : "warning") : undefined} />
        <Fact label={t("col.sanctioned")} value={c.sanctioned != null ? <Money value={c.sanctioned} /> : "—"} hint={c.sanctionedOn ? `${fmtDate(c.sanctionedOn, locale)}${c.disallowed > 0 ? ` · ${t("disallowed")} ${fmtMoney(c.disallowed, locale)}` : ""}` : undefined} />
        <Fact label={t("col.refunded")} value={c.paid != null ? <Money value={c.paid} /> : "—"} hint={c.paidOn ? `${fmtDate(c.paidOn, locale)}${c.payRef ? ` · ${c.payRef}` : ""}` : undefined} />
      </section>
      {(c.disallowedReason || c.rejectReason) && (
        <p role="note" className={cn("no-print mb-4 rounded-md border p-3 text-sm", c.rejectReason ? "border-destructive/50 bg-destructive/5" : "border-warning/60 bg-warning/10")} data-testid="claim-reason">
          <span className="font-medium">{c.rejectReason ? t("rejectedOn", { date: fmtDate(c.rejectedOn!, locale) }) : t("disallowedWhy")}</span> {c.rejectReason ?? c.disallowedReason}
        </p>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <TabsList className="no-print mb-4">
          <TabsTrigger value="statement"><FileText className="size-4" aria-hidden /> {t("tabStatement")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="statement" className="bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><ClaimStatement claim={c} /></TabsContent>
        <TabsContent value="history" className="max-w-3xl"><RecordHistory entityId={c.id} /></TabsContent>
      </Tabs>
      <ClaimActionDialog claim={c} action={action} onOpenChange={(o) => !o && setAction(null)} />
    </>
  )
}

function Fact({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warning" | "danger" }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : "")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular">{value}</div>
      {hint && <p className={cn("mt-0.5 text-xs", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-muted-foreground")}>{hint}</p>}
    </div>
  )
}

/** File / sanction / pay / reject. */
function ClaimActionDialog({ claim: c, action, onOpenChange }: { claim: DrawbackClaimRow; action: Action | null; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("claims")
  const tc = useTranslations("common")
  const qc = useQueryClient()
  const [v, setV] = React.useState({ date: TODAY, ref: "", amount: "", reason: "" })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    if (!action) return
    setErrors({})
    setV({ date: TODAY, ref: "", amount: action === "sanction" ? String(c.claimed) : action === "pay" ? String(c.sanctioned ?? "") : "", reason: "" })
  }, [action]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: () => api.vat.claims.action(c.id, { action: action!, date: v.date, ref: v.ref || undefined, amount: v.amount ? Number(v.amount) : undefined, reason: v.reason || undefined }),
    onSuccess: (r) => {
      qc.setQueryData(["claims", "one", c.id], r); qc.invalidateQueries({ queryKey: ["claims"] }); qc.invalidateQueries({ queryKey: ["bond"] })
      toast.success(t(`done.${action}`, { no: r.no })); onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, x]) => [k.startsWith("lines.") ? "date" : k, t.has(`err.${x[0]}`) ? t(`err.${x[0]}`) : x[0]])))
      else toast.error(e.message)
    },
  })
  const short = action === "sanction" && Number(v.amount) > 0 && Number(v.amount) < c.claimed - 0.005
  const needReason = action === "reject" || short
  if (!action) return null
  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run.mutate() }}>
          <DialogHeader>
            <DialogTitle>{t(`dialog.${action}.title`, { no: c.no })}</DialogTitle>
            <DialogDescription>{t(`dialog.${action}.body`)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ca-date" label={t(`dialog.${action}.date`)} required error={errors.date}>{(a) => <Input type="date" max={TODAY} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} {...a} />}</Field>
            {action !== "reject" && <Field id="ca-ref" label={t(`dialog.${action}.ref`)} error={errors.ref}>{(a) => <Input autoComplete="off" className="tabular" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} {...a} />}</Field>}
            {(action === "sanction" || action === "pay") && (
              <Field id="ca-amount" label={t(`dialog.${action}.amount`)} required error={errors.amount} hint={action === "sanction" ? t("dialog.sanction.amountHint", { amount: fmtNum(c.claimed, "en", 2) }) : undefined}>
                {(a) => <Input type="number" inputMode="decimal" step="0.01" min={0} className="text-right tabular" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} {...a} />}
              </Field>
            )}
            {needReason && (
              <Field id="ca-reason" label={action === "reject" ? t("dialog.reject.reason") : t("dialog.sanction.reason")} required error={errors.reason} className="sm:col-span-2">
                {(a) => <Textarea rows={3} maxLength={300} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} {...a} />}
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
            <Button type="submit" variant={action === "reject" ? "destructive" : "default"} disabled={run.isPending} data-testid="claim-action-submit">{run.isPending && <Loader2 className="animate-spin" />} {t(`action.${action}`)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
