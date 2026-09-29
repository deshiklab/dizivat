import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { MasterItemsList } from "@/features/master-items/master-items-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "master" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><MasterItemsList /></Suspense>
}
