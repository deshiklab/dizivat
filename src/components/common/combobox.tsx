"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"

export interface ComboOption { value: string; label: string; description?: string; keywords?: string[]; disabled?: boolean }

/** Accessible searchable select (replaces select2). */
export const Combobox = React.forwardRef<HTMLButtonElement, {
  id?: string; options: ComboOption[]; value: string; onChange: (v: string) => void; placeholder: string; searchPlaceholder: string; empty: string
  invalid?: boolean; className?: string; describedBy?: string; footer?: React.ReactNode; ariaLabel?: string
}>(function Combobox({ ariaLabel, id, options, value, onChange, placeholder, searchPlaceholder, empty, invalid, className, describedBy, footer }, ref) {
  const [open, setOpen] = React.useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button ref={ref} id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-label={ariaLabel}
            className={cn("h-9 w-full justify-between bg-background px-3 font-normal hover:bg-muted/50 dark:bg-input/30", !current && "text-muted-foreground", className)} />
        }
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronsUpDown className="opacity-50" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.description ?? ""} ${(o.keywords ?? []).join(" ")}`} disabled={o.disabled}
                  onSelect={() => { onChange(o.value); setOpen(false) }}>
                  <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="grid min-w-0">
                    <span className="truncate">{o.label}</span>
                    {o.description && <span className="truncate text-xs text-muted-foreground">{o.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && <div className="border-t p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  )
})
