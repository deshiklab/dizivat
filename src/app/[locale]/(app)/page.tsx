import { getTranslations, setRequestLocale } from "next-intl/server"
import { Dashboard } from "@/features/dashboard/dashboard"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "nav" })
  return { title: t("dashboard") }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  return <Dashboard />
}
