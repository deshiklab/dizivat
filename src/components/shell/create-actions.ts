"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Building2, FilePlus2, PackagePlus, ShoppingCart, UserPlus, type LucideIcon } from "lucide-react"
import { useCan } from "@/components/auth/me-provider"
import type { Permission } from "@/lib/auth/roles"

export interface CreateAction { key: string; href: string; label: string; icon: LucideIcon; group: string; perm: Permission }

const ALL = [
  { key: "newSale", href: "/sales/new", icon: ShoppingCart, group: "sales", perm: "doc.create" },
  { key: "newPurchase", href: "/purchases/new", icon: FilePlus2, group: "purchase", perm: "doc.create" },
  { key: "newItem", href: "/inventory/items?new=1", icon: PackagePlus, group: "inventory", perm: "master.edit" },
  { key: "newCustomer", href: "/master/customers?new=1", icon: UserPlus, group: "masterData", perm: "master.edit" },
  { key: "newVendor", href: "/master/vendors?new=1", icon: Building2, group: "masterData", perm: "master.edit" },
] as const

/** "New …" shortcuts the current user is allowed to use (top bar, palette, `n` hotkey). */
export function useCreateActions(): CreateAction[] {
  const t = useTranslations("shell")
  const can = useCan()
  return React.useMemo(() => ALL.filter((a) => can(a.perm)).map((a) => ({ ...a, label: t(a.key) })), [can, t])
}
