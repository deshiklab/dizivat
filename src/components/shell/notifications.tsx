"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CalendarClock, CheckCheck, CheckCircle2, FileClock, KeyRound, PackageX, XCircle, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Link } from "@/i18n/navigation"
import { api } from "@/lib/api/client"
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format"
import type { AppNotification } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useShell } from "./shell-context"

const TONE = { info: "text-info", warning: "text-warning", success: "text-success", danger: "text-danger" } as const
const icon = (n: AppNotification): LucideIcon =>
  n.kind === "approvals" ? FileClock : n.kind === "deadline" ? CalendarClock : n.kind === "lowStock" ? PackageX
    : n.kind === "security" ? KeyRound : n.msg === "docApproved" ? CheckCircle2 : XCircle

/** Server-driven notifications, polled every 60 s (Mercure push replaces polling in R3). */
export function Notifications() {
  const t = useTranslations("notifications")
  const ts = useTranslations("shell")
  const td = useTranslations("dashboard")
  const locale = useLocale()
  const qc = useQueryClient()
  const { setPwOpen } = useShell()
  const [open, setOpen] = React.useState(false)
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: api.notifications.list, refetchInterval: 60_000, refetchOnWindowFocus: true })
  const mark = useMutation({
    mutationFn: api.notifications.read,
    onSuccess: (r) => qc.setQueryData(["notifications"], r),
  })
  const items = data?.items ?? []
  const unread = data?.unread ?? 0

  const text = (n: AppNotification) => {
    const v = n.values ?? {}
    switch (n.msg) {
      case "deadline": return t("deadline", { title: td(`deadline.${v.title}`), date: fmtDate(String(v.due), locale), days: fmtNum(Number(v.days), locale), n: Number(v.days) })
      case "approvalsSales": case "approvalsPurchases": case "lowStock": return t(n.msg, { count: Number(v.count), n: fmtNum(Number(v.count), locale), first: String(v.first ?? "") })
      default: return t(n.msg, v as Record<string, string>)
    }
  }
  const onItem = (n: AppNotification) => {
    if (!n.read && n.kind !== "security") mark.mutate({ ids: [n.id] })
    if (n.kind === "security") setPwOpen(true)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={ts("notificationsCount", { count: unread })} />}>
        <Bell />
        {unread > 0 && <span aria-hidden className="absolute top-0.5 right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-xs font-semibold leading-none text-white">{unread > 9 ? "9+" : fmtNum(unread, locale)}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="font-semibold">{ts("notifications")}</span>
          <Button variant="ghost" size="sm" disabled={!unread || mark.isPending} onClick={() => mark.mutate({ all: true })}><CheckCheck /> {t("markAll")}</Button>
        </div>
        <ul className="max-h-96 divide-y overflow-auto" aria-live="polite">
          {items.map((n) => {
            const Icon = icon(n)
            const body = (
              <>
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[n.tone ?? "info"])} aria-hidden />
                <span className="grid min-w-0 flex-1 gap-0.5 text-sm">
                  <span className={cn(!n.read && "font-medium")}>{text(n)}</span>
                  {n.kind === "decided" && <span className="text-xs text-muted-foreground">{fmtDateTime(n.at, locale)}</span>}
                </span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"><span className="sr-only">{t("unread")}</span></span>}
              </>
            )
            const cls = cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-muted", !n.read && "bg-primary/5")
            return (
              <li key={n.id}>
                {n.href
                  ? <Link href={n.href} className={cls} onClick={() => onItem(n)}>{body}</Link>
                  : <button type="button" className={cls} onClick={() => onItem(n)}>{body}</button>}
              </li>
            )
          })}
          {items.length === 0 && <li className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><CheckCircle2 className="size-4" aria-hidden /> {ts("noNotifications")}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
