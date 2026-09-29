import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { SalesList } from "@/features/sales/sales-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "sales" }))("services.title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><SalesList variant="service" /></Suspense>
}
