"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocale, useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { AppShell } from "@/components/shell/app-shell"
import { MeProvider } from "@/components/auth/me-provider"
import { appPathname, appUrl } from "@/lib/base-path"
import type { Me } from "@/lib/auth/roles"

/**
 * Static GitHub Pages demo only: the page HTML is pre-built, so the session check the server layout normally does
 * happens here, in the browser, before the shell renders. Signed-out visitors go to the sign-in page.
 */
export function DemoGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common")
  const locale = useLocale()
  const q = useQuery({
    queryKey: ["demo-session"],
    queryFn: async (): Promise<Me | null> => {
      const res = await fetch("/api/v1/me", { headers: { accept: "application/json" } })
      if (res.status === 401) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    staleTime: Infinity, retry: false,
  })
  React.useEffect(() => {
    if (q.data !== null) return
    const rest = appPathname(window.location.pathname).replace(new RegExp(`^/${locale}`), "") || "/"
    const next = rest + window.location.search
    window.location.replace(appUrl(`/${locale}/login${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`))
  }, [q.data, locale])

  if (!q.data) {
    return (
      <div role="status" className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t("loading")}
      </div>
    )
  }
  const open = !document.cookie.split(/;\s*/).includes("sidebar_state=false")
  return (
    <MeProvider initialMe={q.data}>
      <AppShell defaultOpen={open}>{children}</AppShell>
    </MeProvider>
  )
}
