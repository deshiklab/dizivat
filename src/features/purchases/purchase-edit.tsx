"use client"

import { RequirePerm } from "@/components/auth/me-provider"
import { DraftGate } from "@/features/docs/draft-gate"
import { api } from "@/lib/api/client"
import { PurchaseForm } from "./purchase-form"

export function PurchaseNew() {
  return <RequirePerm perm="doc.create" back="/purchases"><PurchaseForm /></RequirePerm>
}
export function PurchaseEdit({ id }: { id: string }) {
  return (
    <RequirePerm perm="doc.edit" back={`/purchases/${id}`}>
      <DraftGate qk={["purchase", id]} load={() => api.purchases.get(id)} back="/purchases">{(p) => <PurchaseForm initial={p} />}</DraftGate>
    </RequirePerm>
  )
}
