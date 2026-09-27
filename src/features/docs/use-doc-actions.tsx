"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
import type { Purchase, Sale } from "@/lib/types"
import { CancelDialog } from "@/components/common/cancel-dialog"
import { useConfirm } from "@/components/common/confirm"

type Kind = "sale" | "purchase"
type Doc = Sale | Purchase

/**
 * Approve / cancel-with-reason / delete-draft (with Undo) for sales invoices and purchases.
 * One place for the mutations, cache invalidation and feedback so list and detail pages behave identically.
 */
export function useDocActions(kind: Kind, opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations("docs")
  const qc = useQueryClient()
  const confirm = useConfirm()
  // Both clients share the same shape; widen to the union so mutations are typed as Doc
  const client = (kind === "sale" ? api.sales : api.purchases) as unknown as {
    setProcess: (id: string, b: Parameters<typeof api.sales.setProcess>[1]) => Promise<Doc>
    remove: (id: string) => Promise<unknown>
    restore: (id: string) => Promise<Doc>
  }
  const listKey = kind === "sale" ? "sales" : "purchases"
  // `cancelling` is kept after close so the dialog text doesn't blank out during its exit animation
  const [cancelling, setCancelling] = React.useState<Doc | null>(null)
  const [cancelOpen, setCancelOpen] = React.useState(false)

  const refresh = (d?: Doc) => {
    qc.invalidateQueries({ queryKey: [listKey] })
    qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["notifications"] })
    qc.invalidateQueries({ queryKey: ["items"] })
    qc.invalidateQueries({ queryKey: ["ledger"] }); qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["audit"] })
    if (d) qc.setQueryData([kind, d.id], d)
  }

  const approve = useMutation({
    mutationFn: (id: string) => client.setProcess(id, { process: "Approved" }),
    onSuccess: (d) => { refresh(d); toast.success(t("approved", { no: d.invoiceNo })) },
    onError: (e) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => client.setProcess(id, { process: "Cancelled", reason }),
    onSuccess: (d) => { refresh(d); setCancelOpen(false); toast.success(t("cancelled", { no: d.invoiceNo })) },
    onError: (e) => toast.error(e.message),
  })
  const restore = useMutation({
    mutationFn: (id: string) => client.restore(id),
    onSuccess: (d) => { refresh(d); toast.success(t("restored", { no: d.invoiceNo })) },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (d: Doc) => client.remove(d.id).then(() => d),
    onSuccess: (d) => {
      refresh()
      qc.removeQueries({ queryKey: [kind, d.id] })
      opts.onDeleted?.()
      toast(t("deleted", { no: d.invoiceNo }), { duration: 10_000, action: { label: t("undo"), onClick: () => restore.mutate(d.id) } })
    },
    onError: (e) => toast.error(e.message),
  })

  const askDelete = async (d: Doc) => {
    if (await confirm({ title: t("deleteTitle", { no: d.invoiceNo }), description: t("deleteBody"), confirm: t("deleteConfirm"), cancel: t("keep"), destructive: true })) remove.mutate(d)
  }

  const dialog = (
    <CancelDialog
      open={cancelOpen}
      onOpenChange={setCancelOpen}
      docNo={cancelling?.invoiceNo ?? ""}
      approved={cancelling?.process === "Approved"}
      pending={cancel.isPending}
      onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })}
    />
  )

  return {
    approve: (d: Doc) => approve.mutate(d.id),
    askCancel: (d: Doc) => { setCancelling(d); setCancelOpen(true) },
    askDelete,
    busy: approve.isPending || cancel.isPending || remove.isPending,
    dialog,
  }
}
