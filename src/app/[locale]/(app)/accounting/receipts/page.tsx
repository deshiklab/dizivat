import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { MoneyList } from "@/features/money/money-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("receipts") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><MoneyList kind="receipt" /></Suspense>
}
