import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { ReconcilePage } from "@/features/money/reconcile"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("reconcile") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><ReconcilePage /></Suspense>
}
