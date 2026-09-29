"use client"

import { useSearchParams } from "next/navigation"
import { RequirePerm } from "@/components/auth/me-provider"
import { DraftGate } from "@/features/docs/draft-gate"
import { api } from "@/lib/api/client"
import { PurchaseForm } from "./purchase-form"
import { ImportForm } from "./import-form"

/** /purchases/new (goods) · ?type=import (Bill of Entry) — /purchases/services/new renders the service variant. */
export function PurchaseNew({ category }: { category?: "service" } = {}) {
  const sp = useSearchParams()
  const isImport = !category && sp.get("type") === "import"
  return (
    <RequirePerm perm="doc.create" back={category ? "/purchases/services" : "/purchases"}>
      {isImport ? <ImportForm /> : <PurchaseForm category={category} key={category ?? "goods"} />}
    </RequirePerm>
  )
}
/** Edit a draft: the form is picked by the document — service, import (has a Bill of Entry) or goods. */
export function PurchaseEdit({ id }: { id: string }) {
  return (
    <RequirePerm perm="doc.edit" back={`/purchases/${id}`}>
      <DraftGate qk={["purchase", id]} load={() => api.purchases.get(id)} back="/purchases">
        {(p) => (p.boe || (p.mode === "Foreign" && p.category !== "service") ? <ImportForm initial={p} /> : <PurchaseForm initial={p} />)}
      </DraftGate>
    </RequirePerm>
  )
}
