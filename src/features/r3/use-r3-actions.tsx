"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, type CancelBody } from "@/lib/api/client"
import type { Process } from "@/lib/types"
import { CancelDialog } from "@/components/common/cancel-dialog"
import { useConfirm } from "@/components/common/confirm"

/** R3 document kinds — each is also the i18n namespace of its messages (approved / deleted / deleteBody). */
export type R3Kind = "credit" | "bom" | "workOrder" | "batch"
type Doc = { id: string; no: string; process: Process }
export const r3ListKey: Record<R3Kind, string> = { credit: "creditNotes", bom: "boms", workOrder: "workOrders", batch: "batches" }
const client = (k: R3Kind) => ({ credit: api.creditNotes, bom: api.production.boms, workOrder: api.production.workOrders, batch: api.production.batches })[k] as unknown as {
  setProcess: (id: string, b: CancelBody) => Promise<Doc>
  remove: (id: string) => Promise<unknown>
}
/** Stock, books and dashboards depend on these documents. */
const DEPENDENT = ["stock", "items", "ledger", "dashboard", "notifications", "audit", "sales", "sale", "mushak", "creditable", "lots", "creditNotes", "boms", "workOrders", "batches", "bom", "workOrder", "batch", "credit"]

export function useR3Refresh() {
  const qc = useQueryClient()
  return (k: R3Kind, d?: Doc) => {
    for (const key of new Set([r3ListKey[k], ...DEPENDENT])) qc.invalidateQueries({ queryKey: [key] })
    if (d) qc.setQueryData([k, d.id], d)
  }
}

/** Approve / cancel-with-reason / delete-draft, shared by lists and sheets. */
export function useR3Actions(kind: R3Kind, opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations(kind)
  const td = useTranslations("docs")
  const confirm = useConfirm()
  const refresh = useR3Refresh()
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
