import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { OpeningList } from "@/features/opening/opening-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "opening" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><OpeningList /></Suspense>
}
