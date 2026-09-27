import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getLocale } from "next-intl/server"
import { AppShell } from "@/components/shell/app-shell"
import { MeProvider } from "@/components/auth/me-provider"
import { currentMe } from "@/lib/auth/server"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already bounces anonymous requests; this also covers a deleted/disabled user with a still-valid cookie.
  const me = await currentMe()
  if (!me) redirect(`/${await getLocale()}/login`)
  const jar = await cookies()
  const open = jar.get("sidebar_state")?.value !== "false"
  return (
    <MeProvider initialMe={me}>
      <AppShell defaultOpen={open}>{children}</AppShell>
    </MeProvider>
  )
}
