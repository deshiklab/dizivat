"use client"

import { useSearchParams } from "next/navigation"
import { RequirePerm } from "@/components/auth/me-provider"
import { DraftGate } from "@/features/docs/draft-gate"
import { api } from "@/lib/api/client"
import { SaleForm } from "./sale-form"

export function SaleNew() {
  const type = useSearchParams().get("type")
  return <RequirePerm perm="doc.create" back="/sales"><SaleForm preset={type === "export" ? "export" : undefined} /></RequirePerm>
}
/** R3: new service sale (SS- numbering, service codes, no stock movement). */
export function ServiceSaleNew() {
  return <RequirePerm perm="doc.create" back="/sales/services"><SaleForm category="service" /></RequirePerm>
}
export function SaleEdit({ id }: { id: string }) {
  return (
    <RequirePerm perm="doc.edit" back={`/sales/${id}`}>
      <DraftGate qk={["sale", id]} load={() => api.sales.get(id)} back="/sales">{(s) => <SaleForm initial={s} />}</DraftGate>
    </RequirePerm>
  )
}
