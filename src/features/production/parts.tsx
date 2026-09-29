"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Pill } from "@/components/common/status-badge"
import type { BatchMode, BomStatus, WorkOrder, WorkOrderStatus } from "@/lib/types"
import { BATCH_MODE_TONE } from "@/lib/r3"

export const BOM_STATUS_TONE: Record<BomStatus, "success" | "warning" | "neutral" | "danger"> = { active: "success", draft: "warning", superseded: "neutral", cancelled: "danger" }
export const WO_STATUS_TONE: Record<WorkOrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = { draft: "neutral", open: "info", partial: "warning", completed: "success", cancelled: "danger" }

export function BomStatusPill({ status }: { status: BomStatus }) {
  const t = useTranslations("bom")
  return <Pill tone={BOM_STATUS_TONE[status]}>{t(`status.${status}`)}</Pill>
}
export function WoStatusPill({ status }: { status: WorkOrderStatus }) {
  const t = useTranslations("workOrder")
  return <Pill tone={WO_STATUS_TONE[status]}>{t(`status.${status}`)}</Pill>
}
export function ModePill({ mode }: { mode: BatchMode }) {
  const t = useTranslations("batch")
  return <Pill tone={BATCH_MODE_TONE[mode]}>{t(`mode.${mode}`)}</Pill>
}

/** Two-column definition list used by the production sheets. */
export function DetailList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}
    </dl>
  )
}

/** Progress bar with an accessible value (work-order completion). */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular text-muted-foreground">{pct}%</span>
    </div>
  )
}

/** Plain bordered table with a caption, as used across the sheets. */
export function MiniTable({ caption, head, children, foot, minWidth = 560 }: { caption: string; head: { label: string; right?: boolean }[]; children: React.ReactNode; foot?: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          {head.map((h, i) => <th key={i} scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${h.right ? "text-right" : ""}`}>{h.label}</th>)}
        </tr></thead>
        <tbody>{children}</tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}

/** Share of the ordered quantity already received into stock, 0–100. */
export const woProgress = (w: Pick<WorkOrder, "lines">) => {
  const ordered = w.lines.reduce((a, l) => a + l.qty, 0)
  return ordered ? (w.lines.reduce((a, l) => a + l.received, 0) / ordered) * 100 : 0
}
