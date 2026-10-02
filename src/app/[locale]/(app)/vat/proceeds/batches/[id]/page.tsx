import { setRequestLocale } from "next-intl/server"
import { BatchDetailPage } from "@/features/vat/prc-matching"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Bank file ${id}` }
}
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  setRequestLocale(locale)
  return <BatchDetailPage id={id} />
}
