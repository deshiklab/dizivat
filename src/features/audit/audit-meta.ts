import {
  ArrowRightLeft, Building2, CheckCheck, PackageX, Ruler, CircleDot, FilePen, FilePlus2, KeyRound, LogIn, LogOut, Pencil, Power, PowerOff, RotateCcw,
  Send, ShieldAlert, ShieldCheck, Trash2, UserPlus, XCircle, type LucideIcon,
} from "lucide-react"
import type { AuditAction, AuditEntity, AuditEvent } from "@/lib/types"
import type { Tone } from "@/components/common/status-badge"

export const AUDIT_ACTIONS: AuditAction[] = [
  "created", "edited", "approved", "cancelled", "deleted", "restored", "updated", "activated", "deactivated",
  "roleChanged", "invited", "passwordReset", "passwordChanged", "signedIn", "signedOut", "signInFailed", "submitted",
]
export const AUDIT_ENTITIES: AuditEntity[] = [
  "sale", "purchase", "creditNote", "debitNote", "opening", "transfer", "damage", "bom", "workOrder", "batch", "productionConfig",
  "receipt", "payment", "account", "accountingConfig", "vatReturn", "treasury", "vds", "adjustment", "vatSettings",
  "customer", "vendor", "item", "masterItem", "unit", "user", "company", "session",
]

export const ACTION_ICON: Record<AuditAction, LucideIcon> = {
  created: FilePlus2, edited: FilePen, approved: CheckCheck, cancelled: XCircle, deleted: Trash2, restored: RotateCcw,
  updated: Pencil, activated: Power, deactivated: PowerOff, roleChanged: ShieldCheck, invited: UserPlus,
  passwordReset: KeyRound, passwordChanged: KeyRound, signedIn: LogIn, signedOut: LogOut, signInFailed: ShieldAlert, submitted: Send,
}
export const ACTION_TONE: Partial<Record<AuditAction, Tone>> = {
  approved: "success", activated: "success", cancelled: "danger", deleted: "danger", deactivated: "danger", signInFailed: "danger",
  passwordReset: "warning", roleChanged: "warning", created: "info", invited: "info", submitted: "success",
}
export const entityIcon = (e: AuditEntity): LucideIcon => (e === "company" ? Building2 : e === "session" ? LogIn : e === "user" ? UserPlus : e === "transfer" ? ArrowRightLeft : e === "damage" ? PackageX : e === "unit" ? Ruler : CircleDot)

/** Where a record lives in the app (null when there is no page, e.g. sign-ins or deleted records). */
export function entityHref(e: AuditEvent): string | null {
  if (!e.entityId && e.entity !== "company" && e.entity !== "productionConfig" && e.entity !== "accountingConfig" && e.entity !== "vatSettings") return null
  switch (e.entity) {
    case "sale": return `/sales/${e.entityId}`
    case "purchase": return `/purchases/${e.entityId}`
    case "customer": return `/master/customers?edit=${e.entityId}`
    case "vendor": return `/master/vendors?edit=${e.entityId}`
    case "item": return `/inventory/items?edit=${e.entityId}`
    case "transfer": return `/inventory/transfers?view=${e.entityId}`
    case "damage": return `/inventory/damage?view=${e.entityId}`
    case "unit": return `/master/units?edit=${e.entityId}`
    case "user": return `/master/users?edit=${e.entityId}`
    case "company": return "/master/company"
    case "creditNote": return `/sales/credit-notes?view=${e.entityId}`
    case "debitNote": return `/purchases/debit-notes?view=${e.entityId}`
    case "opening": return `/purchases/opening?view=${e.entityId}`
    case "masterItem": return `/inventory/master-items?edit=${e.entityId}`
    case "bom": return `/production/bom?view=${e.entityId}`
    case "workOrder": return `/production/work-orders?view=${e.entityId}`
    case "batch": return `/production/batches?view=${e.entityId}`
    case "productionConfig": return "/production/config"
    case "receipt": return `/accounting/receipts?view=${e.entityId}`
    case "payment": return `/accounting/payments?view=${e.entityId}`
    case "account": return `/accounting/bank-accounts?edit=${e.entityId}`
    case "accountingConfig": return "/accounting/config"
    case "vatReturn": return `/vat/return-9-1?period=${e.entityId}`
    case "treasury": return `/vat/tr-6?view=${e.entityId}`
    case "vds": return `/vat/vds?view=${e.entityId}`
    case "adjustment": return `/vat/adjustments?view=${e.entityId}`
    case "vatSettings": return "/vat/settings"
    default: return null
  }
}
