"use client"

import { useTranslations } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/common/empty-state"
import { Link } from "@/i18n/navigation"
import type { Purchase, Sale } from "@/lib/types"

/** Loads a document for editing; only drafts can be edited (approved → cancel & re-issue, per NBR practice). */
export function DraftGate<T extends Sale | Purchase>({ qk, load, back, children }: {
  qk: readonly unknown[]; load: () => Promise<T>; back: string; children: (doc: T) => React.ReactNode
}) {
  const t = useTranslations("docs")
  const { data, isLoading, error } = useQuery({ queryKey: qk, queryFn: load })
  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-16 w-80" /><Skeleton className="h-96" /></div>
  if (error || !data) return <EmptyState title={t("notFound")} hint={error?.message} action={<Button variant="outline" render={<Link href={back} />}><ArrowLeft /> {t("back")}</Button>} />
  if (data.process !== "Created") {
    return <EmptyState icon={Lock} title={t("notEditableTitle", { no: data.invoiceNo })} hint={t("notEditableHint")}
      action={<Button variant="outline" render={<Link href={`${back}/${data.id}`} />}><ArrowLeft /> {t("openDoc")}</Button>} />
  }
  return <>{children(data)}</>
}
