"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { StockDoc, StockDocKind } from "@/lib/types"
import { CancelDialog } from "@/components/common/cancel-dialog"
import { useConfirm } from "@/components/common/confirm"

export const stockClient = (k: StockDocKind) => (k === "transfer" ? api.transfers : api.damage) as unknown as {
  get: (id: string) => Promise<StockDoc>
  setProcess: (id: string, b: Parameters<typeof api.transfers.setProcess>[1]) => Promise<StockDoc>
  remove: (id: string) => Promise<unknown>
}
export const stockListKey = (k: StockDocKind) => (k === "transfer" ? "transfers" : "damage")

/** Everything that shows stock must refetch after a stock document changes state. */
export function useStockRefresh() {
  const qc = useQueryClient()
  return (k: StockDocKind, d?: StockDoc) => {
    for (const key of [stockListKey(k), "stock", "items", "ledger", "dashboard", "notifications", "audit"]) qc.invalidateQueries({ queryKey: [key] })
    if (d) qc.setQueryData([k, d.id], d)
  }
}

/** Approve / cancel-with-reason / delete-draft for transfers and damage entries (list and sheet share it). */
export function useStockActions(kind: StockDocKind, opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations("stock")
  const td = useTranslations("docs")
  const confirm = useConfirm()
  const refresh = useStockRefresh()
  const client = stockClient(kind)
  const [cancelling, setCancelling] = React.useState<StockDoc | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)

  const approve = useMutation({
    mutationFn: (id: string) => client.setProcess(id, { process: "Approved" }),
    onSuccess: (d) => { refresh(kind, d); toast.success(t(`${kind}.approved`, { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => client.setProcess(id, { process: "Cancelled", reason }),
    onSuccess: (d) => { refresh(kind, d); setCancelOpen(false); toast.success(td("cancelled", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (d: StockDoc) => client.remove(d.id).then(() => d),
    onSuccess: (d) => { refresh(kind); opts.onDeleted?.(); toast.success(t("deleted", { no: d.no })) },
    onError: (e) => toast.error(e.message),
  })
  const askDelete = async (d: StockDoc) => {
    if (await confirm({ title: td("deleteTitle", { no: d.no }), description: t("deleteBody"), confirm: td("deleteConfirm"), cancel: td("keep"), destructive: true })) remove.mutate(d)
  }
  const dialog = (
    <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} docNo={cancelling?.no ?? ""} approved={cancelling?.process === "Approved"}
      pending={cancel.isPending} onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })} />
  )
  return {
    approve: (d: StockDoc) => approve.mutate(d.id),
    askCancel: (d: StockDoc) => { setCancelling(d); setCancelOpen(true) },
    askDelete,
    busy: approve.isPending || cancel.isPending || remove.isPending,
    dialog,
  }
}
