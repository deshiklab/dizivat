import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { CreditList } from "@/features/credit/credit-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "credit" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><CreditList /></Suspense>
}
