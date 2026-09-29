"use client"

import dynamic from "next/dynamic"
import { useMe } from "@/components/auth/me-provider"
import { useOnceOpen } from "@/hooks/use-once-open"
import { useShell } from "./shell-context"

// The dialog pulls in react-hook-form, zod and the schema module — load them only when it first opens
// (menu → Change password, or a forced change after a reset) so they stay off every page's critical path.
const PasswordDialog = dynamic(() => import("./password-dialog").then((m) => m.PasswordDialog), { ssr: false })

export function LazyPasswordDialog() {
  const me = useMe()
  const { pwOpen } = useShell()
  const mounted = useOnceOpen(!!me.user.mustChangePassword || pwOpen)
  return mounted ? <PasswordDialog /> : null
}
