import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { PosDevicesPage } from "@/features/pos/pos-devices-page"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "nav" }))("posDevices") }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale)
  return (
    <Suspense>
      <PosDevicesPage />
    </Suspense>
  )
}
