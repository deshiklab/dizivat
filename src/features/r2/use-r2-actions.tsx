"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { DebitNote, OpeningEntry } from "@/lib/types"
import { CancelDialog } from "@/components/common/cancel-dialog"
import { useConfirm } from "@/components/common/confirm"

export type R2Kind = "debit" | "opening"
type Doc = DebitNote | OpeningEntry
export const r2ListKey = (k: R2Kind) => (k === "debit" ? "debitNotes" : "opening")
export const r2Client = (k: R2Kind) => (k === "debit" ? api.debitNotes : api.opening) as unknown as {
  get: (id: string) => Promise<Doc>
  setProcess: (id: string, b: Parameters<typeof api.debitNotes.setProcess>[1]) => Promise<Doc>
  remove: (id: string) => Promise<unknown>
}

/** Everything showing stock, input tax or the purchase must refetch after a debit note / opening entry changes. */
export function useR2Refresh() {
  const qc = useQueryClient()
  return (k: R2Kind, d?: Doc) => {
    for (const key of [r2ListKey(k), "stock", "items", "ledger", "dashboard", "notifications", "audit", "purchases", "purchase", "mushak", "returnable"]) qc.invalidateQueries({ queryKey: [key] })
    if (d) qc.setQueryData([k, d.id], d)
  }
}

/** Approve / cancel-with-reason / delete-draft (list and sheet share it). Messages come from the `debit` / `opening` namespaces. */
export function useR2Actions(kind: R2Kind, opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations(kind)
  const td = useTranslations("docs")
  const confirm = useConfirm()
  const refresh = useR2Refresh()
  const client = r2Client(kind)
  const [cancelling, setCancelling] = React.useState<Doc | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const approve = useMutation({
    mutationFn: (id: string) => client.setProcess(id, { process: "Approved" }),
    onSuccess: (d) => { refresh(kind, d); toast.success(t("approved", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => client.setProcess(id, { process: "Cancelled", reason }),
    onSuccess: (d) => { refresh(kind, d); setCancelOpen(false); toast.success(td("cancelled", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (d: Doc) => client.remove(d.id).then(() => d),
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
