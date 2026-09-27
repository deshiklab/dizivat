"use client"

import { RequirePerm } from "@/components/auth/me-provider"
import { DraftGate } from "@/features/docs/draft-gate"
import { api } from "@/lib/api/client"
import { SaleForm } from "./sale-form"

export function SaleNew() {
  return <RequirePerm perm="doc.create" back="/sales"><SaleForm /></RequirePerm>
}
export function SaleEdit({ id }: { id: string }) {
  return (
    <RequirePerm perm="doc.edit" back={`/sales/${id}`}>
      <DraftGate qk={["sale", id]} load={() => api.sales.get(id)} back="/sales">{(s) => <SaleForm initial={s} />}</DraftGate>
    </RequirePerm>
  )
}
