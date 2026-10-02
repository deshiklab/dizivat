import { setRequestLocale } from "next-intl/server"
import { BondUdDetailPage } from "@/features/vat/bond-uds"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `UD settlement ${decodeURIComponent(id)}` }
}
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  setRequestLocale(locale)
  return <BondUdDetailPage id={decodeURIComponent(id)} />
}
