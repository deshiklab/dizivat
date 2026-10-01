import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { Mushak621Page } from "@/features/book/mushak-621"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "book" }))("b621.title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><Mushak621Page /></Suspense>
}
