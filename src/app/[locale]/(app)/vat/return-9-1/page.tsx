import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { ReturnPage } from "@/features/vat/return-page"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("return91") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><ReturnPage /></Suspense>
}
