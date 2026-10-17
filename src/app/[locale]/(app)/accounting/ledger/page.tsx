import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { LedgerView } from "@/features/gl/ledger-view"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("ledger") }
}
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ account?: string }> }) {
  setRequestLocale((await params).locale)
  const { account } = await searchParams
  return <Suspense><LedgerView account={account} /></Suspense>
}
