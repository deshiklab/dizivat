"use client"

import { useTranslations } from "next-intl"
import type { Table } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, Columns3, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** Show/hide + reorder columns; labels always come from column meta (prototype showed "(blank)"). */
export function ColumnsMenu<T>({ table, onReset }: { table: Table<T>; onReset: () => void }) {
  const t = useTranslations("table")
  const cols = table.getAllLeafColumns().filter((c) => c.columnDef.meta?.hideable !== false && c.id !== "_select")
  const move = (id: string, dir: -1 | 1) => {
    const ids = table.getAllLeafColumns().map((c) => c.id)
    const cur = table.getState().columnOrder.length ? [...table.getState().columnOrder] : ids
    const i = cur.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= cur.length || cur[j] === "_select") return
    ;[cur[i], cur[j]] = [cur[j], cur[i]]
    table.setColumnOrder(cur)
  }
  const ordered = [...cols].sort((a, b) => a.getIndex() - b.getIndex())
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 /> <span className="hidden lg:inline">{t("columns")}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("columns")}</span>
          <Button variant="ghost" size="xs" onClick={onReset}><RotateCcw /> {t("reset")}</Button>
        </div>
        <ul className="max-h-80 overflow-auto py-1">
          {ordered.map((c, i) => {
            const label = c.columnDef.meta?.label ?? c.id
            const idc = `col-${c.id}`
            return (
              <li key={c.id} className="flex items-center gap-2 px-3 py-1 hover:bg-muted">
                <Checkbox id={idc} checked={c.getIsVisible()} disabled={!c.getCanHide()} onCheckedChange={(v) => c.toggleVisibility(!!v)} />
                <label htmlFor={idc} className="flex-1 cursor-pointer truncate text-sm">{label}</label>
                <Button variant="ghost" size="icon-xs" aria-label={t("moveUp", { col: label })} disabled={i === 0} onClick={() => move(c.id, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-xs" aria-label={t("moveDown", { col: label })} disabled={i === ordered.length - 1} onClick={() => move(c.id, 1)}><ArrowDown /></Button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
