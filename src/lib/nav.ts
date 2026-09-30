import {
  LayoutDashboard, ShoppingCart, PackageOpen, Boxes, Factory, Landmark, FileSpreadsheet, Database,
  type LucideIcon,
} from "lucide-react"
import type { Permission } from "@/lib/auth/roles"

/**
 * Single module registry (replaces the prototype's GROUPS object + 851 inline onclick handlers).
 * `release` = the R-milestone from the development plan in which the page ships.
 * `ready` = built (Sprints 1–4 + R2 + R3 + R4) (renders a real page); others render a "Planned for Rx" page.
 */
export type Release = "S1" | "R1" | "R2" | "R3" | "R4"
export interface NavItem { key: string; href: string; release: Release; ready?: boolean; legacy?: string; perm?: Permission }
export interface NavGroup { key: string; icon: LucideIcon; href: string; items: NavItem[]; shortcut?: string }

export const RELEASE_DATES: Record<Release, string> = {
  S1: "2026-10-15",
  R1: "2026-11-19",
  R2: "2026-12-24",
  R3: "2027-01-21",
  R4: "2027-02-25",
}

export const NAV: NavGroup[] = [
  { key: "dashboard", icon: LayoutDashboard, href: "/", shortcut: "g d", items: [] },
  {
    key: "sales", icon: ShoppingCart, href: "/sales", shortcut: "g s",
    items: [
      { key: "salesInvoices", href: "/sales", release: "R3", ready: true, legacy: "/en/sales" },
      { key: "serviceSales", href: "/sales/services", release: "R3", ready: true },
      { key: "creditNotes", href: "/sales/credit-notes", release: "R3", ready: true },
      { key: "exports", href: "/sales/exports", release: "R3", ready: true },
    ],
  },
  {
    key: "purchase", icon: PackageOpen, href: "/purchases", shortcut: "g p",
    items: [
      { key: "purchases", href: "/purchases", release: "R2", ready: true, legacy: "/en/purchase" },
      { key: "servicePurchases", href: "/purchases/services", release: "R2", ready: true },
      { key: "debitNotes", href: "/purchases/debit-notes", release: "R2", ready: true },
      { key: "openingStock", href: "/purchases/opening", release: "R2", ready: true },
    ],
  },
  {
    key: "inventory", icon: Boxes, href: "/inventory/items", shortcut: "g i",
    items: [
      { key: "items", href: "/inventory/items", release: "R2", ready: true, legacy: "/en/item" },
      { key: "finishedGoods", href: "/inventory/finished-goods", release: "R2", ready: true },
      { key: "transfers", href: "/inventory/transfers", release: "R2", ready: true },
      { key: "damage", href: "/inventory/damage", release: "R2", ready: true },
      { key: "masterItems", href: "/inventory/master-items", release: "R2", ready: true },
    ],
  },
  {
    key: "production", icon: Factory, href: "/production/bom",
    items: [
      { key: "bom", href: "/production/bom", release: "R3", ready: true },
      { key: "batches", href: "/production/batches", release: "R3", ready: true },
      { key: "workOrders", href: "/production/work-orders", release: "R3", ready: true },
      { key: "productionOpening", href: "/production/opening", release: "R3", ready: true },
      { key: "productionConfig", href: "/production/config", release: "R3", ready: true, perm: "settings.manage" },
    ],
  },
  {
    key: "accounting", icon: Landmark, href: "/accounting/receipts",
    items: [
      { key: "receipts", href: "/accounting/receipts", release: "R4", ready: true },
      { key: "payments", href: "/accounting/payments", release: "R4", ready: true },
      { key: "bankAccounts", href: "/accounting/bank-accounts", release: "R4", ready: true },
      { key: "statements", href: "/accounting/statements", release: "R4", ready: true },
      { key: "accountingConfig", href: "/accounting/config", release: "R4", ready: true, perm: "settings.manage" },
    ],
  },
  {
    key: "nbrVat", icon: FileSpreadsheet, href: "/vat/mushak",
    items: [
      { key: "mushak43", href: "/vat/mushak-4-3", release: "R4", ready: true },
      { key: "purchaseBook", href: "/vat/mushak-6-1", release: "R2", ready: true },
      { key: "salesBook", href: "/vat/mushak-6-2", release: "R2", ready: true },
      { key: "mushakReports", href: "/vat/mushak", release: "R4", ready: true },
      { key: "return91", href: "/vat/return-9-1", release: "R4", ready: true },
      { key: "treasury", href: "/vat/tr-6", release: "R4", ready: true },
      { key: "vds", href: "/vat/vds", release: "R4", ready: true },
      { key: "adjustments", href: "/vat/adjustments", release: "R4", ready: true },
      { key: "mushak610", href: "/vat/mushak-6-10", release: "R4", ready: true },
      { key: "vatSettings", href: "/vat/settings", release: "R4", ready: true, perm: "settings.manage" },
      { key: "tariff", href: "/vat/tariff", release: "R1", ready: true, legacy: "/en/nbrvat/taxtarrif/" },
    ],
  },
  {
    key: "masterData", icon: Database, href: "/master/customers",
    items: [
      { key: "customers", href: "/master/customers", release: "R1", ready: true, legacy: "/en/customer" },
      { key: "vendors", href: "/master/vendors", release: "R1", ready: true, legacy: "/en/vendor" },
      { key: "units", href: "/master/units", release: "R2", ready: true },
      { key: "users", href: "/master/users", release: "R1", ready: true, perm: "users.manage", legacy: "/en/core/user/" },
      { key: "company", href: "/master/company", release: "R1", ready: true, legacy: "/en/core/domain/" },
      { key: "audit", href: "/master/audit", release: "R1", ready: true, perm: "audit.view" },
    ],
  },
]

/** Resolve the active group/item from a locale-less pathname. Longest-prefix match. */
export function resolveNav(pathname: string) {
  let best: { group: NavGroup; item?: NavItem; len: number } | null = null
  for (const g of NAV) {
    if (g.key === "dashboard") {
      if (pathname === "/" && (!best || best.len < 1)) best = { group: g, len: 1 }
      continue
    }
    for (const it of g.items) {
      const match = pathname === it.href || pathname.startsWith(it.href + "/")
      if (match && (!best || it.href.length > best.len)) best = { group: g, item: it, len: it.href.length }
    }
  }
  return best
}

/** NAV filtered to what the current user may see (items with `perm` are hidden otherwise). */
export const visibleNav = (can: (p?: Permission) => boolean): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.perm)) }))

export const allNavItems = () => NAV.flatMap((g) => (g.items.length ? g.items.map((i) => ({ group: g, item: i })) : []))
