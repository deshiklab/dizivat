"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Lock } from "lucide-react"
import { api, type CancelBody } from "@/lib/api/client"
import { fmtDate } from "@/lib/format"
import { periodLabel } from "@/lib/r4"
import type { Process } from "@/lib/types"
import { CancelDialog } from "@/components/common/cancel-dialog"
import { useConfirm } from "@/components/common/confirm"

/** R4 document kinds and the i18n namespace holding their approved / saved / deleted / deleteBody messages. */
export type R4Kind = "receipt" | "payment" | "treasury" | "vds" | "adjustment"
export const R4_NS: Record<R4Kind, string> = { receipt: "money", payment: "money", treasury: "treasury", vds: "vds", adjustment: "adjust" }
export const r4ListKey: Record<R4Kind, string> = { receipt: "receipts", payment: "payments", treasury: "treasury", vds: "vds", adjustment: "adjustments" }
type Doc = { id: string; no: string; process: Process }
const client = (k: R4Kind) => ({ receipt: api.accounting.receipts, payment: api.accounting.payments, treasury: api.vat.treasury, vds: api.vat.vds, adjustment: api.vat.adjustments })[k] as unknown as {
  setProcess: (id: string, b: CancelBody) => Promise<Doc>
  remove: (id: string) => Promise<unknown>
}
/** Invoices, balances, statements and the VAT return all depend on these documents. */
const DEPENDENT = ["sales", "sale", "purchases", "purchase", "dashboard", "audit", "notifications", "receipts", "payments", "accounts", "account", "statement", "openInvoices",
  "treasury", "vds", "vdsEligible", "adjustments", "returns", "return", "compliance", "periods", "subform", "r4doc"]

export function useR4Refresh() {
  const qc = useQueryClient()
  return (k?: R4Kind, d?: Doc) => {
    for (const key of new Set([...(k ? [r4ListKey[k]] : []), ...DEPENDENT])) qc.invalidateQueries({ queryKey: [key] })
    if (k && d) qc.setQueryData(["r4doc", k, d.id], d)
  }
}

/** Approve / cancel-with-reason / delete-draft for R4 documents, shared by lists and sheets. */
export function useR4Actions(kind: R4Kind, opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations(R4_NS[kind])
  const td = useTranslations("docs")
  const confirm = useConfirm()
  const refresh = useR4Refresh()
  const c = client(kind)
  const [cancelling, setCancelling] = React.useState<Doc | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const approve = useMutation({
    mutationFn: (id: string) => c.setProcess(id, { process: "Approved" }),
    onSuccess: (d) => { refresh(kind, d); toast.success(t("approved", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => c.setProcess(id, { process: "Cancelled", reason }),
    onSuccess: (d) => { refresh(kind, d); setCancelOpen(false); toast.success(td("cancelled", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (d: Doc) => c.remove(d.id).then(() => d),
    onSuccess: (d) => { refresh(kind); opts.onDeleted?.(); toast.success(t("deleted", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const askDelete = async (d: Doc) => {
    if (await confirm({ title: td("deleteTitle", { no: d.no }), description: t("deleteBody"), confirm: td("deleteConfirm"), cancel: td("keep"), destructive: true })) remove.mutate(d)
  }
  const dialog = (
    <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} docNo={cancelling?.no ?? ""} approved={cancelling?.process === "Approved"}
      pending={cancel.isPending} onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })} />
  )
  return {
    approve: (d: Doc) => approve.mutate(d.id),
    askCancel: (d: Doc) => { setCancelling(d); setCancelOpen(true) },
    askDelete,
    busy: approve.isPending || cancel.isPending || remove.isPending,
    dialog,
  }
}

/** Tax periods (sorted newest first, one entry each — legacy list was unsorted with duplicates, D-15). */
export function usePeriods() {
  return useQuery({ queryKey: ["periods"], queryFn: () => api.vat.periods(), staleTime: 30_000 })
}

/** "Tax period locked" note for documents dated in a period whose Mushak 9.1 return has been submitted. */
export function PeriodLockNote({ date }: { date?: string }) {
  const t = useTranslations("ret")
  const locale = useLocale()
  const periods = usePeriods()
  if (!date) return null
  const p = periods.data?.find((x) => x.period === date.slice(0, 7) && x.locked)
  if (!p) return null
  return (
    <div role="status" className="no-print mb-4 flex gap-3 rounded-lg border border-info/30 bg-info-soft p-3 text-sm">
      <Lock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <p>{t("lockedNote", { period: periodLabel(p.period), date: p.submittedAt ? fmtDate(p.submittedAt, locale) : "" })}</p>
    </div>
  )
}

/** Two-column definition list used by the R4 sheets. */
export function DefList({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => <div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words">{v ?? "—"}</dd></div>)}
    </dl>
  )
}
