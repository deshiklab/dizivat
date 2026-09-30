import type { Metadata, Viewport } from "next"
import { Inter, Noto_Sans_Bengali } from "next/font/google"
import { notFound } from "next/navigation"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { Providers } from "@/components/providers"
import { prefsScript } from "@/components/prefs"
import { CREDIT, creditText } from "@/lib/brand"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", weight: ["400", "500", "600", "700"], display: "swap" })

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "meta" })
  return { title: { template: `%s · ${t("app")}`, default: t("app") }, description: t("description"), authors: [{ name: CREDIT.owner, url: CREDIT.url }], other: { copyright: creditText() } }
}

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f7fa" }, { media: "(prefers-color-scheme: dark)", color: "#0a111c" }],
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  return (
    <html lang={locale} suppressHydrationWarning className={`${inter.variable} ${bengali.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
