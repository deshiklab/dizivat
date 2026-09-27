import { setRequestLocale } from "next-intl/server"
import { SaleEdit } from "@/features/sales/sale-edit"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Edit ${(await params).id}` }
}
export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params
  setRequestLocale(locale)
  return <SaleEdit id={id} />
}
