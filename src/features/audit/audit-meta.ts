import {
  ArrowRightLeft, Building2, CheckCheck, PackageX, Ruler, CircleDot, FilePen, FilePlus2, KeyRound, LogIn, LogOut, Pencil, Power, PowerOff, RotateCcw,
  ShieldAlert, ShieldCheck, Trash2, UserPlus, XCircle, type LucideIcon,
} from "lucide-react"
import type { AuditAction, AuditEntity, AuditEvent } from "@/lib/types"
import type { Tone } from "@/components/common/status-badge"

export const AUDIT_ACTIONS: AuditAction[] = [
  "created", "edited", "approved", "cancelled", "deleted", "restored", "updated", "activated", "deactivated",
  "roleChanged", "invited", "passwordReset", "passwordChanged", "signedIn", "signedOut", "signInFailed",
]
export const AUDIT_ENTITIES: AuditEntity[] = ["sale", "purchase", "transfer", "damage", "customer", "vendor", "item", "unit", "user", "company", "session"]

export const ACTION_ICON: Record<AuditAction, LucideIcon> = {
  created: FilePlus2, edited: FilePen, approved: CheckCheck, cancelled: XCircle, deleted: Trash2, restored: RotateCcw,
  updated: Pencil, activated: Power, deactivated: PowerOff, roleChanged: ShieldCheck, invited: UserPlus,
  passwordReset: KeyRound, passwordChanged: KeyRound, signedIn: LogIn, signedOut: LogOut, signInFailed: ShieldAlert,
}
export const ACTION_TONE: Partial<Record<AuditAction, Tone>> = {
  approved: "success", activated: "success", cancelled: "danger", deleted: "danger", deactivated: "danger", signInFailed: "danger",
  passwordReset: "warning", roleChanged: "warning", created: "info", invited: "info",
}
export const entityIcon = (e: AuditEntity): LucideIcon => (e === "company" ? Building2 : e === "session" ? LogIn : e === "user" ? UserPlus : e === "transfer" ? ArrowRightLeft : e === "damage" ? PackageX : e === "unit" ? Ruler : CircleDot)

/** Where a record lives in the app (null when there is no page, e.g. sign-ins or deleted records). */
export function entityHref(e: AuditEvent): string | null {
  if (!e.entityId && e.entity !== "company") return null
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
    default: return null
  }
}
