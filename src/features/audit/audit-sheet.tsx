"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, ExternalLink, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Pill } from "@/components/common/status-badge"
import { useCan } from "@/components/auth/me-provider"
import { Link } from "@/i18n/navigation"
import { fmtDateTime } from "@/lib/format"
import type { AuditEvent } from "@/lib/types"
import { ACTION_ICON, ACTION_TONE, entityHref } from "./audit-meta"

/** Detail of one audit event: who, when, what — with the field-level before/after table. */
export function AuditSheet({ event, onOpenChange, onRecordHistory }: {
  event: AuditEvent | null; onOpenChange: (o: boolean) => void; onRecordHistory: (e: AuditEvent) => void
}) {
  const t = useTranslations("audit")
  const tc = useTranslations("common")
  const locale = useLocale()
  const can = useCan()
  // keep the last event while the sheet animates out
  const [ev, setEv] = React.useState(event)
  React.useEffect(() => { if (event) setEv(event) }, [event])
  const href = ev ? entityHref(ev) : null
  const reachable = href && (ev?.entity !== "user" || can("users.manage"))
  const fieldLabel = (f: string) => (t.has(`fields.${f}`) ? t(`fields.${f}`) : f)
  return (
    <Sheet open={!!event} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {ev && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2">
                {React.createElement(ACTION_ICON[ev.action], { className: "size-4 text-primary", "aria-hidden": true })}
                {t(`action.${ev.action}`)} · {t(`entity.${ev.entity}`)}
              </SheetTitle>
              <SheetDescription>{ev.ref}</SheetDescription>
            </SheetHeader>
            <div className="grid flex-1 content-start gap-5 overflow-y-auto p-4">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("col.at")}</dt><dd className="tabular">{fmtDateTime(ev.at, locale)} <span className="text-xs text-muted-foreground">({t("dhaka")})</span></dd>
                <dt className="text-muted-foreground">{t("col.actor")}</dt><dd>{ev.actor}</dd>
                <dt className="text-muted-foreground">{t("col.action")}</dt><dd><Pill tone={ACTION_TONE[ev.action] ?? "neutral"}>{t(`action.${ev.action}`)}</Pill></dd>
                <dt className="text-muted-foreground">{t("col.entity")}</dt><dd>{t(`entity.${ev.entity}`)}</dd>
                <dt className="text-muted-foreground">{t("col.ref")}</dt><dd className="font-medium">{ev.ref}</dd>
                {ev.note && <><dt className="text-muted-foreground">{t("note")}</dt><dd>{ev.note}</dd></>}
                <dt className="text-muted-foreground">{t("eventId")}</dt><dd><code className="text-xs">{ev.id}</code></dd>
              </dl>
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold">{t("changes")}</h3>
                {ev.changes?.length ? (
                  <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("changes")}>
                    <table className="w-full text-sm">
                      <caption className="sr-only">{t("changes")}</caption>
                      <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">{t("field")}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t("before")}</th>
                        <th scope="col" className="w-6 px-0 py-2"><span className="sr-only">{t("to")}</span></th>
                        <th scope="col" className="px-3 py-2 font-medium">{t("after")}</th>
                      </tr></thead>
                      <tbody>
                        {ev.changes.map((c) => (
                          <tr key={c.field} className="border-b align-top last:border-0">
                            <th scope="row" className="px-3 py-2 text-left font-medium">{fieldLabel(c.field)}</th>
                            <td className="px-3 py-2 text-muted-foreground line-through decoration-danger/50 break-words">{c.from}</td>
                            <td className="px-0 py-2"><ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /></td>
                            <td className="px-3 py-2 break-words">{c.to}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-muted-foreground">{t("noChanges")}</p>}
              </section>
            </div>
            <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
              {ev.entityId && <Button variant="outline" onClick={() => onRecordHistory(ev)}><History /> {t("recordHistory")}</Button>}
              {reachable && <Button variant="outline" render={<Link href={href!} />}><ExternalLink /> {t("openRecord")}</Button>}
              <Button onClick={() => onOpenChange(false)}>{tc("close")}</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
