"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { parseAsString, useQueryState } from "nuqs"
import { AlertTriangle, ClipboardCheck, Download, FileStack, Hourglass, Landmark, PackageSearch, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { BondUdsTab } from "@/features/vat/bond-uds"
import { ClaimFromSelection, ClaimPill, ClaimsTab } from "@/features/vat/drawback-claims"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState } from "@/components/common/empty-state"
import { Money } from "@/components/common/money"
import { Pill, type Tone } from "@/components/common/status-badge"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { BOND_EXPIRING_DAYS, BOND_EXTENSION_MONTHS, BOND_PERIOD_MONTHS, DRAWBACK_EXPIRING_DAYS, DRAWBACK_MONTHS } from "@/lib/bond"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtHs, fmtNum } from "@/lib/format"
import type { BondItemRow, BondLot, BondRow, DrawbackRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const ROW_TONE: Record<BondItemRow["state"], Tone> = { ok: "success", shortfall: "danger", overUsed: "warning", idle: "neutral" }
const LOT_TONE: Record<BondLot["state"], Tone> = { open: "success", expiring: "warning", extension: "warning", overdue: "danger", cleared: "neutral" }
const DB_TONE: Record<DrawbackRow["state"], Tone> = { open: "success", expiring: "warning", lapsed: "danger" }
const LIC_TONE: Record<BondRow["state"], Tone> = { valid: "success", expiring: "warning", expired: "danger", missing: "danger" }
const TABS = ["register", "boe", "drawback", "uds", "claims"] as const
type TabKey = (typeof TABS)[number]

const qty = (n: number, locale: string) => fmtNum(n, locale, 3)

/**
 * R6.4 (RMG) — bond consumption register. Inputs warehoused under the customs bond (IM-7 Bills of Entry and go-live
 * carry-forwards) against their consumption in exports through the input–output coefficient (BOM / Mushak 4.3);
 * each Bill of Entry aged against the 24-month bonding period; duty drawback on duty-paid inputs that went into
 * exports. R6.5: our own UDs / UP and their settlement (?tab=uds) and drawback claims (?tab=claims).
 * ?tab=register|boe|drawback|uds|claims, ?from=, ?to=
 */
export function BondRegisterPage() {
  const t = useTranslations("bond")
  const locale = useLocale()
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("register"))
  const [from, setFrom] = useQueryState("from", parseAsString.withDefault(""))
  const [to, setTo] = useQueryState("to", parseAsString.withDefault(""))
  const [draft, setDraft] = React.useState({ from, to })
  React.useEffect(() => setDraft({ from, to }), [from, to])
  const range = { from: from || undefined, to: to || undefined }
  const q = useQuery({ queryKey: ["bond", from, to], queryFn: () => api.vat.bond.get(range), placeholderData: keepPreviousData })
  const d = q.data
  const active = (TABS as readonly string[]).includes(tab) ? (tab as TabKey) : "register"
  const csvView = active === "boe" ? "lots" : active === "drawback" ? "drawback" : "register"
  const [picked, setPicked] = React.useState<string[]>([])
  const lotsAttention = d ? d.totals.lotsExpiring + d.totals.lotsExtension + d.totals.lotsOverdue : 0

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")}
        actions={active === "uds" || active === "claims" ? undefined : <Button variant="outline" render={<a href={api.vat.bond.csvUrl(csvView, range)} download={`bond-${csvView}-${to || TODAY}.csv`} />}><Download /> {t(`csv.${csvView}`)}</Button>} />
      {q.isLoading ? <Skeleton className="h-96" /> : q.error ? <EmptyState title={t("error")} hint={q.error.message} /> : d && (
        <div className="grid gap-4">
          <section aria-label={t("licence.title")} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card p-4" data-testid="bond-licence">
            <div className="flex items-center gap-2"><Landmark className="size-4 text-primary" aria-hidden /><span className="text-sm font-medium">{t("licence.title")}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licence.no")}: </span><span className="font-medium tabular">{d.licence.licenceNo || "—"}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">{t("licence.expiry")}: </span><span className="tabular">{d.licence.expiry ? fmtDate(d.licence.expiry, locale) : "—"}</span>
              {d.licence.daysLeft != null && <span className="ml-1 text-xs text-muted-foreground">({d.licence.daysLeft >= 0 ? t("daysLeft", { days: d.licence.daysLeft }) : t("daysAgo", { days: -d.licence.daysLeft })})</span>}</div>
            <Pill tone={LIC_TONE[d.licence.state]}>{t(`licence.state.${d.licence.state}`)}</Pill>
            <p className="basis-full text-xs text-muted-foreground">{t("licence.note")}</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat icon={ShieldCheck} label={t("totals.secured")} value={<Money value={d.totals.dutyOnBalance} />} hint={t("totals.securedHint", { n: d.totals.bondedItems })} />
            <Stat icon={ShieldAlert} label={t("totals.atRisk")} value={<Money value={d.totals.dutyAtRisk} />} hint={t("totals.atRiskHint", { n: d.totals.shortfallItems })} tone={d.totals.dutyAtRisk > 0 ? "danger" : undefined} testId="bond-at-risk" />
            <Stat icon={Hourglass} label={t("totals.boe")} value={fmtNum(lotsAttention, locale)} hint={t("totals.boeHint", { expiring: d.totals.lotsExpiring, extension: d.totals.lotsExtension, overdue: d.totals.lotsOverdue })} tone={d.totals.lotsOverdue ? "danger" : lotsAttention ? "warning" : undefined} />
            <Stat icon={Undo2} label={t("totals.drawback")} value={<Money value={d.drawback.totals.claimable} />} hint={t("totals.drawbackHint", { amount: fmtNum(d.drawback.totals.expiring, locale, 2) })} tone={d.drawback.totals.expiring > 0 ? "warning" : undefined} />
          </div>

          <form aria-label={t("range.title")} className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
            onSubmit={(e) => { e.preventDefault(); setFrom(draft.from || null); setTo(draft.to || null) }}>
            <div className="grid gap-1.5">
              <label htmlFor="bond-from" className="text-sm font-medium">{t("range.from")}</label>
              <Input id="bond-from" type="date" max={draft.to || TODAY} value={draft.from} onChange={(e) => setDraft((x) => ({ ...x, from: e.target.value }))} className="w-44" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="bond-to" className="text-sm font-medium">{t("range.to")}</label>
              <Input id="bond-to" type="date" min={draft.from || undefined} max={TODAY} value={draft.to} onChange={(e) => setDraft((x) => ({ ...x, to: e.target.value }))} className="w-44" />
            </div>
            <Button type="submit" variant="secondary">{t("range.apply")}</Button>
            {(from || to) && <Button type="button" variant="ghost" onClick={() => { setFrom(null); setTo(null) }}>{t("range.reset")}</Button>}
            <p className="basis-full text-xs text-muted-foreground">{d.to === TODAY ? t("range.asOfToday") : t("range.asOf", { date: fmtDate(d.to, locale) })}</p>
          </form>

          {d.noCoefficient.length > 0 && (
            <div role="alert" className="flex gap-2 rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{t("noCoefficient", { n: d.noCoefficient.length, items: [...new Set(d.noCoefficient.map((x) => x.name))].join(", ") })}</span>
            </div>
          )}

          <Tabs value={active} onValueChange={(v) => setTab(v === "register" ? null : (v as string))} className="gap-4">
            <TabsList>
              <TabsTrigger value="register">{t("tab.register")} <span className="ml-1 text-xs text-muted-foreground tabular">{fmtNum(d.rows.length, locale)}</span></TabsTrigger>
              <TabsTrigger value="boe">{t("tab.boe")}{lotsAttention > 0 && <Hourglass className="ml-1 size-3.5 text-warning" aria-label={t("boeAttention")} />}</TabsTrigger>
              <TabsTrigger value="drawback">{t("tab.drawback")} <span className="ml-1 text-xs text-muted-foreground tabular">{fmtNum(d.drawback.rows.length, locale)}</span></TabsTrigger>
              <TabsTrigger value="uds"><ClipboardCheck className="size-3.5" aria-hidden /> {t("tab.uds")}</TabsTrigger>
              <TabsTrigger value="claims"><FileStack className="size-3.5" aria-hidden /> {t("tab.claims")}</TabsTrigger>
            </TabsList>

            <TabsContent value="register" className="grid gap-3">
              <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("reg.table")}>
                <table className="w-full min-w-[1100px] text-sm">
                  <caption className="sr-only">{t("reg.table")}</caption>
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">{t("reg.item")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.opening")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.bondedIn")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.exportUse")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.closing")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.physical")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.duty")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("reg.status")}</th>
                  </tr></thead>
                  <tbody>
                    {d.rows.length ? d.rows.map((r) => (
                      <tr key={r.itemId} className="border-b align-top last:border-0" data-testid={`bond-row-${r.itemId}`}>
                        <td className="px-3 py-2"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground tabular">{fmtHs(r.hsCode)} · {r.uom}</span></td>
                        <td className="px-3 py-2 text-right tabular">{qty(r.opening, locale)}</td>
                        <td className="px-3 py-2 text-right tabular">{qty(r.bondedIn, locale)}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {qty(r.bondedUsed, locale)}
                          {r.exportUse > 0 && <span className="block text-xs text-muted-foreground">{t("reg.metBy", { total: qty(r.exportUse, locale), paid: qty(r.fromDutyPaid, locale), local: qty(r.fromLocal, locale) })}</span>}
                          {r.unsourced > 0 && <span className="block text-xs text-warning">{t("reg.unsourced", { qty: qty(r.unsourced, locale) })}</span>}
                          {r.clearedOut > 0 && <span className="block text-xs text-muted-foreground" data-testid={`bond-cleared-${r.itemId}`}>{t("reg.clearedOut", { qty: qty(r.clearedOut, locale) })}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular">{qty(r.closing, locale)}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {r.physical == null ? <span className="text-muted-foreground">—</span> : qty(r.physical, locale)}
                          {r.shortfall > 0 && <span className="block text-xs font-medium text-destructive">{t("reg.shortfall", { qty: qty(r.shortfall, locale) })}</span>}
                        </td>
                        <td className="px-3 py-2 text-right"><Money value={r.dutyOnBalance} />{r.dutyAtRisk > 0 && <span className="block text-xs font-medium text-destructive">{t("reg.atRisk")} <Money value={r.dutyAtRisk} muted0={false} /></span>}</td>
                        <td className="px-3 py-2"><Pill tone={ROW_TONE[r.state]}>{t(`reg.state.${r.state}`)}</Pill></td>
                      </tr>
                    )) : <tr><td colSpan={8} className="px-3 py-10"><EmptyState icon={PackageSearch} title={t("reg.empty")} hint={t("reg.emptyHint")} /></td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t("reg.note")}</p>
            </TabsContent>

            <TabsContent value="boe" className="grid gap-3">
              <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("boe.table")}>
                <table className="w-full min-w-[1000px] text-sm">
                  <caption className="sr-only">{t("boe.table")}</caption>
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">{t("boe.boe")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("boe.item")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("boe.qty")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("boe.consumed")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("boe.balance")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("boe.duty")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("boe.due")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("boe.status")}</th>
                  </tr></thead>
                  <tbody>
                    {d.lots.length ? d.lots.map((l) => (
                      <tr key={l.key} className="border-b align-top last:border-0" data-testid={`bond-lot-${l.boeNo}-${l.itemId}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium tabular">{l.boeNo}</span>
                          <span className="block text-xs text-muted-foreground tabular">{fmtDate(l.boeDate, locale)} · {l.source === "import"
                            ? <Link href={`/purchases/${l.docId}`} className="text-primary underline underline-offset-2">{l.docNo}</Link>
                            : <Link href="/purchases/opening" className="text-primary underline underline-offset-2">{t("boe.carried", { no: l.docNo })}</Link>}</span>
                        </td>
                        <td className="px-3 py-2">{l.name}<span className="block text-xs text-muted-foreground">{l.uom}{l.udNo ? <> · {l.udId ? <Link href={`/vat/bond-consumption/uds/${l.udId}`} className="text-primary tabular underline underline-offset-2">{l.udNo}</Link> : <span className="tabular">{l.udNo}</span>}</> : null}</span></td>
                        <td className="px-3 py-2 text-right tabular">{qty(l.qty, locale)}</td>
                        <td className="px-3 py-2 text-right tabular">{qty(l.consumed, locale)}{l.cleared > 0 && <span className="block text-xs text-muted-foreground">{t("boe.cleared", { qty: qty(l.cleared, locale) })}</span>}</td>
                        <td className="px-3 py-2 text-right font-medium tabular">{qty(l.balance, locale)}</td>
                        <td className="px-3 py-2 text-right"><Money value={l.dutyOnBalance} /><span className="block text-xs text-muted-foreground">{t("boe.of")} <Money value={l.dutyForegone} muted0={false} /></span></td>
                        <td className="whitespace-nowrap px-3 py-2 tabular">
                          {fmtDate(l.dueDate, locale)}
                          {l.state !== "cleared" && <span className={cn("block text-xs", l.state === "overdue" ? "text-destructive" : l.state === "extension" || l.state === "expiring" ? "text-warning" : "text-muted-foreground")}>
                            {l.state === "extension" ? t("boe.extensionUntil", { date: fmtDate(l.extendedDue, locale) }) : l.state === "overdue" ? t("boe.overdueSince", { date: fmtDate(l.extendedDue, locale) }) : t("daysLeft", { days: l.daysLeft })}
                          </span>}
                        </td>
                        <td className="px-3 py-2"><Pill tone={LOT_TONE[l.state]}>{t(`boe.state.${l.state}`)}</Pill></td>
                      </tr>
                    )) : <tr><td colSpan={8} className="px-3 py-10"><EmptyState icon={PackageSearch} title={t("boe.empty")} hint={t("boe.emptyHint")} /></td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t("boe.note", { months: BOND_PERIOD_MONTHS, ext: BOND_EXTENSION_MONTHS, days: BOND_EXPIRING_DAYS })}</p>
            </TabsContent>

            <TabsContent value="drawback" className="grid gap-3">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border bg-card p-3"><dt className="text-xs text-muted-foreground">{t("db.claimable")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.drawback.totals.claimable} /></dd></div>
                <div className={cn("rounded-md border bg-card p-3", d.drawback.totals.expiring ? "border-warning/60" : "")}><dt className="text-xs text-muted-foreground">{t("db.expiring", { days: DRAWBACK_EXPIRING_DAYS })}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.drawback.totals.expiring} /></dd></div>
                <div className={cn("rounded-md border bg-card p-3", d.drawback.totals.lapsed ? "border-destructive/50" : "")}><dt className="text-xs text-muted-foreground">{t("db.lapsed")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.drawback.totals.lapsed} /></dd></div>
                <div className="rounded-md border bg-card p-3"><dt className="text-xs text-muted-foreground">{t("db.claimed")}</dt><dd className="mt-1 text-lg font-semibold"><Money value={d.drawback.totals.claimed} /></dd></div>
              </dl>
              <ClaimFromSelection rows={d.drawback.rows} selected={picked.filter((id) => d.drawback.rows.some((r) => r.saleId === id && !r.claim && r.state !== "lapsed"))} onClear={() => setPicked([])} />
              <div className="overflow-x-auto rounded-lg border bg-card" tabIndex={0} role="region" aria-label={t("db.table")}>
                <table className="w-full min-w-[960px] text-sm">
                  <caption className="sr-only">{t("db.table")}</caption>
                  <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-10 px-3 py-2 font-medium"><span className="sr-only">{t("db.pick")}</span></th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("db.export")}</th>
                    <th scope="col" className="w-[30%] px-3 py-2 font-medium">{t("db.inputs")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("db.cd")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("db.rd")}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t("db.total")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("db.deadline")}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t("db.status")}</th>
                  </tr></thead>
                  <tbody>
                    {d.drawback.rows.length ? d.drawback.rows.map((r) => (
                      <tr key={r.saleId} className="border-b align-top last:border-0" data-testid={`drawback-${r.saleId}`}>
                        <td className="px-3 py-2">{!r.claim && r.state !== "lapsed" && (
                          <Checkbox aria-label={t("db.pickOne", { no: r.invoiceNo })} checked={picked.includes(r.saleId)} data-testid={`drawback-pick-${r.saleId}`}
                            onCheckedChange={(v) => setPicked((xs) => (v ? [...xs, r.saleId] : xs.filter((x) => x !== r.saleId)))} />
                        )}</td>
                        <td className="px-3 py-2"><Link href={`/sales/${r.saleId}`} className="font-medium text-primary tabular hover:underline">{r.invoiceNo}</Link>
                          <span className="block text-xs text-muted-foreground tabular">{fmtDate(r.exportDate, locale)}{r.billNo ? ` · ${r.billNo}` : ""}{r.deemed ? ` · ${t("db.deemed")}` : ""}</span>
                          <span className="block text-xs text-muted-foreground">{r.customerName}</span></td>
                        <td className="px-3 py-2">
                          <details>
                            <summary className="cursor-pointer text-sm">{t("db.inputsSummary", { n: r.inputs.length })}</summary>
                            <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                              {r.inputs.map((x) => <li key={`${x.purchaseId}|${x.itemId}`}><Link href={`/purchases/${x.purchaseId}`} className="text-primary tabular underline underline-offset-2">{x.purchaseNo}</Link> · {x.name} · {qty(x.qty, locale)} {x.uom}</li>)}
                            </ul>
                          </details>
                        </td>
                        <td className="px-3 py-2 text-right"><Money value={r.cd} /></td>
                        <td className="px-3 py-2 text-right"><Money value={r.rd} /></td>
                        <td className="px-3 py-2 text-right font-medium"><Money value={r.total} /></td>
                        <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(r.deadline, locale)}<span className={cn("block text-xs", r.claim ? "text-muted-foreground" : r.state === "lapsed" ? "text-destructive" : r.state === "expiring" ? "text-warning" : "text-muted-foreground")}>{r.daysLeft < 0 ? t("daysAgo", { days: -r.daysLeft }) : t("daysLeft", { days: r.daysLeft })}</span></td>
                        <td className="px-3 py-2">{r.claim ? <ClaimPill claim={r.claim} /> : <Pill tone={DB_TONE[r.state]}>{t(`db.state.${r.state}`)}</Pill>}</td>
                      </tr>
                    )) : <tr><td colSpan={8} className="px-3 py-10"><EmptyState icon={Undo2} title={t("db.empty")} hint={t("db.emptyHint")} /></td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">{t("db.note", { months: DRAWBACK_MONTHS })}</p>
            </TabsContent>

            <TabsContent value="uds"><BondUdsTab /></TabsContent>
            <TabsContent value="claims"><ClaimsTab /></TabsContent>
          </Tabs>
        </div>
      )}
    </>
  )
}

function Stat({ icon: Icon, label, value, hint, tone, testId }: { icon: React.ElementType; label: string; value: React.ReactNode; hint?: string; tone?: "warning" | "danger"; testId?: string }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", tone === "danger" ? "border-destructive/50" : tone === "warning" ? "border-warning/60" : "")} data-testid={testId}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={cn("size-4", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-primary")} aria-hidden /> {label}</div>
      <div className="mt-1 text-xl font-semibold tabular">{value}</div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
