"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { ArrowLeft, ShieldAlert } from "lucide-react"
import { api } from "@/lib/api/client"
import { can, type Me, type Permission } from "@/lib/auth/roles"
import { usePrefs } from "@/components/prefs"
import { EmptyState } from "@/components/common/empty-state"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"

const MeCtx = React.createContext<Me | null>(null)

/** Seeds the "me" query from the server-rendered session (no loading flash) and applies server-stored preferences once. */
export function MeProvider({ initialMe, children }: { initialMe: Me; children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ["me"], queryFn: api.me.get, initialData: initialMe, staleTime: 5 * 60_000 })
  const prefs = usePrefs()
  const { setTheme } = useTheme()
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (applied.current) return
    applied.current = true
    const p = data.preferences
    const { theme, ...rest } = p
    if (Object.keys(rest).length) prefs.set(rest)
    if (theme) setTheme(theme)
  }, [data.preferences, prefs, setTheme])
  return <MeCtx.Provider value={data}>{children}</MeCtx.Provider>
}

export function useMe(): Me {
  const me = React.useContext(MeCtx)
  if (!me) throw new Error("useMe must be used inside <MeProvider>")
  return me
}

/** Company summary (name, BIN, address) from the session — updates everywhere when the profile is saved. */
export function useCompany() {
  return useMe().company
}

export function useCan() {
  const me = React.useContext(MeCtx)
  return React.useCallback((p?: Permission) => can(me?.permissions, p), [me])
}

/** Hides children when the user lacks the permission. */
export function Can({ perm, children, fallback = null }: { perm: Permission; children: React.ReactNode; fallback?: React.ReactNode }) {
  return useCan()(perm) ? <>{children}</> : <>{fallback}</>
}

/** Page-level gate: renders a "no access" state instead of the page. The API enforces the same rule (403). */
export function RequirePerm({ perm, back, children }: { perm: Permission; back: string; children: React.ReactNode }) {
  const t = useTranslations("auth")
  if (useCan()(perm)) return <>{children}</>
  return (
    <EmptyState icon={ShieldAlert} title={t("noAccessTitle")} hint={t("noAccessHint")}
      action={<Button variant="outline" render={<Link href={back} />}><ArrowLeft /> {t("goBack")}</Button>} />
  )
}

/** Persists a preference change to the server (fire-and-forget; localStorage already applied it). */
export function useSavePrefs() {
  const qc = useQueryClient()
  return React.useCallback((p: Me["preferences"]) => {
    api.me.savePrefs(p).then((prefs) => qc.setQueryData<Me>(["me"], (m) => (m ? { ...m, preferences: prefs } : m))).catch(() => {})
  }, [qc])
}
