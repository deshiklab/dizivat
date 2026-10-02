import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { BondRegisterPage } from "@/features/vat/bond-register"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("bondRegister") }
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return <Suspense><BondRegisterPage /></Suspense>
}
