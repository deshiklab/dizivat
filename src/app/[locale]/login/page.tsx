import { Suspense } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { LoginForm, LoginFormFromUrl } from "@/features/auth/login-form"
import { DEMO_PASSWORD, userStore, users } from "@/lib/mock/users"
import { companySummary } from "@/lib/mock/company"
import { STATIC_DEMO } from "@/lib/base-path"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return { title: (await getTranslations({ locale, namespace: "auth" }))("title") }
}

export default async function LoginPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; reason?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  // Mock backend only: the demo accounts list is rendered so reviewers can try every role
  // (only active accounts still on the demo password — invited/reset users have their own)
  const demo = users.filter((u) => u.active && !userStore.passwords[u.id]).map(({ username, name, designation, role }) => ({ username, name, designation, role }))
  const { name, bin } = companySummary()
  const props = { demo, demoPassword: DEMO_PASSWORD, company: { name, bin } }
  // Static GitHub Pages demo: the page is pre-built, so ?next / ?reason are read in the browser
  if (STATIC_DEMO) {
    return <Suspense fallback={<LoginForm {...props} next={null} reason={null} />}><LoginFormFromUrl {...props} /></Suspense>
  }
  const sp = await searchParams
  return <LoginForm {...props} next={sp.next ?? null} reason={sp.reason ?? null} />
}
