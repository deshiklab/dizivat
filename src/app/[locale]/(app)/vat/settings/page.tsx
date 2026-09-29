import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { VatSettingsPage } from "@/features/vat/vat-settings"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("vatSettings") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><VatSettingsPage /></Suspense>
}
