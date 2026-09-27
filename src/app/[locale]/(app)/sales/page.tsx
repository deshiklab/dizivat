import { getTranslations, setRequestLocale } from "next-intl/server"
import { Suspense } from "react"
import { SalesList } from "@/features/sales/sales-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "sales" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><SalesList /></Suspense>
}
