import type { User } from "@/lib/auth/roles"
import { can, ROLE_PERMS } from "@/lib/auth/roles"
import type { AppNotification } from "@/lib/types"
import { TODAY } from "@/lib/company"
import { auditStore } from "@/lib/mock/audit"
import { db, withStock } from "@/lib/mock/db"
import { userStore } from "@/lib/mock/users"

const WEEK = 7 * 864e5

/** Builds the user's notifications on demand (Symfony will push via Mercure in R3; polling until then). */
export function notificationsFor(user: User): AppNotification[] {
  const perms = ROLE_PERMS[user.role]
  const out: Omit<AppNotification, "read">[] = []
  const now = new Date().toISOString()

  if (user.mustChangePassword)
    out.push({ id: "security:pw", kind: "security", at: now, msg: "mustChangePassword", tone: "danger" })

  if (can(perms, "doc.approve")) {
    const sales = db.sales.filter((d) => d.process === "Created").length
    const purchases = db.purchases.filter((d) => d.process === "Created").length
    if (sales) out.push({ id: `approvals:sale:${sales}`, kind: "approvals", at: now, msg: "approvalsSales", values: { count: sales }, href: "/sales?process=Created", tone: "warning" })
    if (purchases) out.push({ id: `approvals:purchase:${purchases}`, kind: "approvals", at: now, msg: "approvalsPurchases", values: { count: purchases }, href: "/purchases?process=Created", tone: "warning" })
  }

  // Someone else approved or cancelled a document you issued (last 7 days)
  const since = new Date(Date.now() - WEEK).toISOString()
  const mine = new Map([...db.sales, ...db.purchases].filter((d) => d.issuedBy === user.name).map((d) => [d.id, d]))
  const decided = auditStore.events
    .filter((e) => e.at >= since && (e.action === "approved" || e.action === "cancelled") && e.actor !== user.name && e.entityId && mine.has(e.entityId))
    .slice(-10).reverse()
  for (const e of decided) {
    out.push({
      id: `decided:${e.id}`, kind: "decided", at: e.at, msg: e.action === "approved" ? "docApproved" : "docCancelled",
      values: { ref: e.ref, actor: e.actor }, href: `/${e.entity === "sale" ? "sales" : "purchases"}/${e.entityId}`,
      tone: e.action === "approved" ? "success" : "danger",
    })
  }

  // Statutory deadlines (people who file or review returns)
  if (can(perms, "doc.approve") || can(perms, "audit.view")) {
    const [y, m] = TODAY.split("-").map(Number)
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y
    const due = `${ny}-${String(nm).padStart(2, "0")}-15`
    const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5)
    if (days <= 21) {
      out.push({ id: `deadline:tr6:${due}`, kind: "deadline", at: now, msg: "deadline", values: { title: "treasuryDeposit", due: `${due.slice(0, 8)}14`, days: days - 1 }, href: "/vat/tr-6", tone: days <= 7 ? "danger" : "info" })
      out.push({ id: `deadline:r91:${due}`, kind: "deadline", at: now, msg: "deadline", values: { title: "return91", due, days }, href: "/vat/return-9-1", tone: days <= 7 ? "danger" : "info" })
    }
  }

  if (can(perms, "doc.create") || can(perms, "master.edit")) {
    const low = db.items.map(withStock).filter((i) => i.remain < i.reorderLevel)
    if (low.length) out.push({ id: `lowStock:${low.map((i) => i.id).sort().join(",")}`, kind: "lowStock", at: now, msg: "lowStock", values: { count: low.length, first: low[0]!.name }, href: "/inventory/items?stock=out,low", tone: "warning" })
  }

  const read = new Set(userStore.notifRead[user.id]?.ids ?? [])
  return out.map((n) => ({ ...n, read: read.has(n.id) }))
}
