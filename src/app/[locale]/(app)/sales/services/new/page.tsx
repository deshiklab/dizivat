import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { ServiceSaleNew } from "@/features/sales/sale-edit"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "sales" }))("services.newTitle") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><ServiceSaleNew /></Suspense>
}
