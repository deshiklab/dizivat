import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { DebitList } from "@/features/debit/debit-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "debit" }))("title") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><DebitList /></Suspense>
}
