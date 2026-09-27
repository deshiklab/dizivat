import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AuditPage } from "@/features/audit/audit-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "audit" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><AuditPage /></Suspense>
}
