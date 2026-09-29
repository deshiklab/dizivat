import { setRequestLocale } from "next-intl/server"
import { PlaceholderRoute } from "@/components/common/placeholder-route"

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  return <PlaceholderRoute path={`/${slug.join("/")}`} />
}
