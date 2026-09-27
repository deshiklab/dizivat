"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { endOfMonth, startOfMonth, subDays, subMonths, parseISO, startOfQuarter } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarDays, Check, PlusCircle, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { TODAY } from "@/lib/company"
import { fmtDate, fmtNum, toISODate } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = React.useState(value)
  React.useEffect(() => setV(value), [value])
  React.useEffect(() => {
    if (v === value) return
    const h = setTimeout(() => onChange(v), 300)
    return () => clearTimeout(h)
  }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8" />
    </div>
  )
}

export interface FacetOption { value: string; label: string }

export function FacetFilter({ title, options, selected, onChange, counts }: {
  title: string; options: FacetOption[]; selected: string[]; onChange: (v: string[]) => void; counts?: Record<string, number>
}) {
  const t = useTranslations("table")
  const locale = useLocale()
  const set = new Set(selected)
  const toggle = (v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); onChange([...n]) }
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className={cn("border-dashed", set.size && "border-solid border-primary/50 bg-accent text-accent-foreground")} />}>
        <PlusCircle /> {title}
        {set.size > 0 && <span className="ml-1 rounded bg-primary px-1.5 text-xs text-primary-foreground">{fmtNum(set.size, locale)}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          {options.length > 6 && <CommandInput placeholder={t("filterOptions", { title })} />}
          <CommandList>
            <CommandEmpty>{t("noOptions")}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = set.has(o.value)
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)} data-checked={on} aria-selected={on}>
                    <span className={cn("grid size-4 place-items-center rounded-[4px] border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden>
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                    {counts && <span className="ml-auto text-xs tabular text-muted-foreground">{fmtNum(counts[o.value] ?? 0, locale)}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {set.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup><CommandItem onSelect={() => onChange([])} className="justify-center">{t("clearFilter")}</CommandItem></CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** VAT-aware presets: current VAT period (month), previous period, quarter, fiscal year (Jul–Jun). */
export function DateRangeFilter({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  const t = useTranslations("table")
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const today = parseISO(TODAY)
  const fyStart = new Date(today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1, 6, 1)
  const presets: { key: string; range: [Date, Date] }[] = [
    { key: "today", range: [today, today] },
    { key: "last7", range: [subDays(today, 6), today] },
    { key: "thisPeriod", range: [startOfMonth(today), endOfMonth(today)] },
    { key: "lastPeriod", range: [startOfMonth(subMonths(today, 1)), endOfMonth(subMonths(today, 1))] },
    { key: "thisQuarter", range: [startOfQuarter(today), today] },
    { key: "thisFy", range: [fyStart, today] },
    { key: "lastFy", range: [new Date(fyStart.getFullYear() - 1, 6, 1), new Date(fyStart.getFullYear(), 5, 30)] },
  ]
  const sel: DateRange | undefined = from ? { from: parseISO(from), to: to ? parseISO(to) : undefined } : undefined
  const active = presets.find((p) => toISODate(p.range[0]) === from && toISODate(p.range[1]) === to)
  const label = active ? t(`presets.${active.key}`) : from ? `${fmtDate(from, locale, "dd MMM yy")} – ${to ? fmtDate(to, locale, "dd MMM yy") : "…"}` : t("dateRange")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className={cn("border-dashed", from && "border-solid border-primary/50 bg-accent text-accent-foreground")} />}>
        <CalendarDays /> {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <ul className="flex flex-wrap gap-1 border-b p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0" aria-label={t("presetsLabel")}>
            {presets.map((p) => (
              <li key={p.key}>
                <Button variant={active?.key === p.key ? "secondary" : "ghost"} size="sm" className="w-full justify-start" onClick={() => { onChange(toISODate(p.range[0]), toISODate(p.range[1])); setOpen(false) }}>
                  {t(`presets.${p.key}`)}
                </Button>
              </li>
            ))}
            {from && <li><Button variant="ghost" size="sm" className="w-full justify-start text-destructive" onClick={() => { onChange(null, null); setOpen(false) }}><X /> {t("clearFilter")}</Button></li>}
          </ul>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={sel?.from ?? subMonths(today, 1)}
            selected={sel}
            onSelect={(r) => onChange(r?.from ? toISODate(r.from) : null, r?.to ? toISODate(r.to) : r?.from ? toISODate(r.from) : null)}
            disabled={{ after: today }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FilterChips({ chips, onClearAll }: { chips: { key: string; label: string; onRemove: () => void }[]; onClearAll: () => void }) {
  const t = useTranslations("table")
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2" aria-label={t("activeFilters")}>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-7 items-center gap-1 rounded-full border bg-background pr-1 pl-2.5 text-xs">
          {c.label}
          <button type="button" onClick={c.onRemove} className="grid size-5 place-items-center rounded-full hover:bg-muted" aria-label={t("removeFilter", { filter: c.label })}><X className="size-3" /></button>
        </span>
      ))}
      <Button variant="link" size="xs" onClick={onClearAll}>{t("clearAll")}</Button>
    </div>
  )
}
