import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { ComplianceHub } from "@/features/vat/compliance-hub"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("mushakReports") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><ComplianceHub /></Suspense>
}
