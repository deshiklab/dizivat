import { Suspense } from "react"
import { setRequestLocale } from "next-intl/server"
import { SaleDetail } from "@/features/sales/sale-detail"
import { isPlaceholder, PlaceholderRoute } from "@/components/common/placeholder-route"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: isPlaceholder(`/sales/${id}`) ? "Sales" : `Sales invoice ${id}` }
}
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  setRequestLocale(locale)
  if (isPlaceholder(`/sales/${id}`)) return <PlaceholderRoute path={`/sales/${id}`} />
  return <Suspense><SaleDetail id={id} /></Suspense>
}
