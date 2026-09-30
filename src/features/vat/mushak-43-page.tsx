"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { ExternalLink, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PdfButton } from "@/components/common/pdf-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Pill } from "@/components/common/status-badge"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format"
import { Mushak43 } from "@/features/production/mushak-43"
import type { BomRow, BomStatus } from "@/lib/types"

const SHOW = ["active", "draft", "all"] as const
type Show = (typeof SHOW)[number]
const TONE: Record<BomStatus, "success" | "warning" | "neutral" | "danger"> = { active: "success", draft: "warning", superseded: "neutral", cancelled: "danger" }

/**
 * Mushak 4.3 register under NBR VAT: every input–output coefficient declaration (Rule 21) in one place, with the
 * official form rendered alongside for printing / Save as PDF. Declarations themselves are created and amended in
 * Production › Price declarations; this page is the "find and print the 4.3" entry point.
 * URL state: ?show=active|draft|all, ?q=<text>, ?id=<bomId>.
 */
export function Mushak43Page() {
  const t = useTranslations("m43")
  const tb = useTranslations("bom")
  const locale = useLocale()
  const [showQ, setShow] = useQueryState("show", parseAsString.withDefault("active"))
  const show: Show = (SHOW as readonly string[]).includes(showQ) ? (showQ as Show) : "active"
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""))
  const [id, setId] = useQueryState("id", parseAsString)
  const list = useQuery({
    queryKey: ["boms", "m43", show, q],
    queryFn: () => api.production.boms.list({ size: 200, sort: "sku.asc", q: q || undefined, status: show === "all" ? undefined : [show] }),
    placeholderData: keepPreviousData,
  })
  const rows = list.data?.data ?? []
  const selectedId = id && rows.some((r) => r.id === id) ? id : id ?? rows[0]?.id ?? null
  const one = useQuery({ queryKey: ["bom", selectedId], queryFn: () => api.production.boms.get(selectedId!), enabled: !!selectedId })
  const d = one.data

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={
          <>
            <Button variant="outline" render={<Link href={d ? `/production/bom?view=${d.id}` : "/production/bom"} />}><ExternalLink /> {t("manage")}</Button>
            {d && <PdfButton size="default" filename={`Mushak-4.3_${d.no}`} />}
            {d && <Button onClick={() => window.print()}><Printer /> {t("print")}</Button>}
          </>
        } />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section aria-label={t("listTitle")} className="no-print grid content-start gap-3 rounded-lg border bg-card p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="m43-show">{t("show")}</Label>
            <Select value={show} onValueChange={(v) => { setShow(v === "active" ? null : (v as string)); setId(null) }} items={SHOW.map((s) => ({ value: s, label: t(`showOpt.${s}`) }))}>
              <SelectTrigger id="m43-show" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SHOW.map((s) => <SelectItem key={s} value={s}>{t(`showOpt.${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m43-q">{t("search")}</Label>
            <Input id="m43-q" type="search" value={q} placeholder={tb("searchPlaceholder")} onChange={(e) => { setQ(e.target.value || null); setId(null) }} />
          </div>
          <p className="text-xs text-muted-foreground" role="status">{list.data ? t("count", { n: fmtNum(list.data.total, locale), count: list.data.total }) : "\u00a0"}</p>
          {list.isLoading ? <div className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
            : list.error ? <EmptyState title={t("error")} hint={list.error.message} />
            : !rows.length ? <EmptyState title={t("empty")} hint={t("emptyHint")} />
            : (
              <ul className="grid max-h-[70vh] gap-1.5 overflow-y-auto pr-1" aria-label={t("listTitle")} tabIndex={0}>
                {rows.map((r) => <DeclarationButton key={r.id} r={r} selected={r.id === selectedId} onSelect={() => setId(r.id)} />)}
              </ul>
            )}
        </section>
        <section aria-label={t("formTitle")} className="min-w-0">
          {!selectedId ? (list.isLoading ? <Skeleton className="h-96" /> : null)
            : one.isLoading ? <Skeleton className="h-96" />
            : one.error || !d ? <EmptyState title={tb("notFound")} hint={one.error?.message} />
            : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
                <div className="no-print flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold tabular">{d.no}</span>
                  <Pill tone={TONE[d.status]}>{tb(`status.${d.status}`)}</Pill>
                  <span className="text-muted-foreground">{d.itemName} · v{fmtNum(d.version, locale)} · {tb("effectiveFrom", { date: fmtDate(d.effectiveDate, locale) })}</span>
                </div>
                {d.status === "draft" && <p role="status" className="no-print rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">{t("draftWarn")}</p>}
                {d.status === "superseded" && <p role="status" className="no-print rounded-md bg-muted p-3 text-sm">{tb("supersededNote", { date: d.supersededAt ? fmtDate(d.supersededAt, locale) : "—" })}</p>}
                <div className="min-w-0 rounded-lg bg-muted/60 p-2 sm:p-4 print:bg-transparent print:p-0"><Mushak43 bom={d} /></div>
                <p className="no-print text-xs text-muted-foreground">{t("pdfHint")} <Link href="/help/bom" className="text-primary underline underline-offset-2">{t("learnMore")}</Link></p>
              </div>
            )}
        </section>
      </div>
    </>
  )
}

function DeclarationButton({ r, selected, onSelect }: { r: BomRow; selected: boolean; onSelect: () => void }) {
  const tb = useTranslations("bom")
  const locale = useLocale()
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}
        className={`grid min-h-11 w-full gap-0.5 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}>
        <span className="flex items-center justify-between gap-2"><span className="font-medium tabular">{r.no}</span><Pill tone={TONE[r.status]}>{tb(`status.${r.status}`)}</Pill></span>
        <span className="truncate" title={r.itemName}>{r.itemName}</span>
        <span className="text-xs text-muted-foreground tabular">{r.sku} · HS {r.hsCode} · v{fmtNum(r.version, locale)} · {fmtMoney(r.price, locale)}</span>
      </button>
    </li>
  )
}
