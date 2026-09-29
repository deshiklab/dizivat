import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { Mushak610Page } from "@/features/vat/mushak-610"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("mushak610") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><Mushak610Page /></Suspense>
}
