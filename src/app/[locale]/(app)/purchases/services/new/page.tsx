import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { PurchaseNew } from "@/features/purchases/purchase-edit"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "purchases" }))("newServiceTitle") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><PurchaseNew category="service" /></Suspense>
}
