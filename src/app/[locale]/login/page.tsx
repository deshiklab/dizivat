import { getTranslations, setRequestLocale } from "next-intl/server"
import { LoginForm } from "@/features/auth/login-form"
import { DEMO_PASSWORD, userStore, users } from "@/lib/mock/users"
import { companySummary } from "@/lib/mock/company"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "auth" }))("title") }
}

export default async function LoginPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; reason?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const sp = await searchParams
  // Mock backend only: the demo accounts list is rendered so reviewers can try every role
  // (only active accounts still on the demo password — invited/reset users have their own)
  const demo = users.filter((u) => u.active && !userStore.passwords[u.id]).map(({ username, name, designation, role }) => ({ username, name, designation, role }))
  const { name, bin } = companySummary()
  return <LoginForm demo={demo} demoPassword={DEMO_PASSWORD} company={{ name, bin }} next={sp.next ?? null} reason={sp.reason ?? null} />
}
