import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { PurchaseList } from "@/features/purchases/purchase-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "purchases" }))("servicesTitle") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><PurchaseList category="service" /></Suspense>
}
