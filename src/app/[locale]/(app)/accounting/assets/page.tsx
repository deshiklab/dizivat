import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AssetList } from "@/features/assets/asset-list"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))(("assets") as never) }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><AssetList /></Suspense>
}
