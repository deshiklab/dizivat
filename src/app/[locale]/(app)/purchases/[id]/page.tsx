import { setRequestLocale } from "next-intl/server"
import { PurchaseDetail } from "@/features/purchases/purchase-detail"
import { isPlaceholder, PlaceholderRoute } from "@/components/common/placeholder-route"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: isPlaceholder(`/purchases/${id}`) ? "Purchase" : `Purchase ${id}` }
}
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  setRequestLocale(locale)
  if (isPlaceholder(`/purchases/${id}`)) return <PlaceholderRoute path={`/purchases/${id}`} />
  return <PurchaseDetail id={id} />
}
