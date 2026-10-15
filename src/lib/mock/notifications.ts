import type { User } from "@/lib/auth/roles"
import { can, ROLE_PERMS } from "@/lib/auth/roles"
import type { AppNotification, DeliveryLogRow, FiredReminder, Item, Purchase, Sale } from "@/lib/types"
import { TODAY } from "@/lib/company"
import { REMINDER_TARGET, reminderTone } from "@/lib/schedule"
import { auditStore } from "@/lib/mock/audit"
import { db, withStock } from "@/lib/mock/db"
import { userStore } from "@/lib/mock/users"

const WEEK = 7 * 864e5

/** What the notifications read: the documents awaiting an approval, the ones the user issued, the stock levels,
 *  and (R8.3) the reminders the schedule has fired and the reports delivered to this user. */
export type NotificationSource = { sales: Sale[]; purchases: Purchase[]; items: Item[]
  reminders?: FiredReminder[]; deliveryLog?: DeliveryLogRow[] }

/** Builds the user's notifications on demand (Symfony will push via Mercure in R3; polling until then). */
export function notificationsFor(user: User, src: NotificationSource = db,
  /** the audit trail to look for other people's decisions in, and the ids this user has already read */
  opts: { events?: { at: string; action: string; actor: string; entity: string; entityId?: string; ref: string; id?: string }[]; read?: string[] } = {}): AppNotification[] {
  const events = opts.events ?? auditStore.events
  const readIds = opts.read ?? userStore.notifRead[user.id]?.ids ?? []
  const perms = ROLE_PERMS[user.role]
  const out: Omit<AppNotification, "read">[] = []
  const now = new Date().toISOString()

  if (user.mustChangePassword)
    out.push({ id: "security:pw", kind: "security", at: now, msg: "mustChangePassword", tone: "danger" })

  if (can(perms, "doc.approve")) {
    const sales = src.sales.filter((d) => d.process === "Created").length
    const purchases = src.purchases.filter((d) => d.process === "Created").length
    if (sales) out.push({ id: `approvals:sale:${sales}`, kind: "approvals", at: now, msg: "approvalsSales", values: { count: sales }, href: "/sales?process=Created", tone: "warning" })
    if (purchases) out.push({ id: `approvals:purchase:${purchases}`, kind: "approvals", at: now, msg: "approvalsPurchases", values: { count: purchases }, href: "/purchases?process=Created", tone: "warning" })
  }

  // Someone else approved or cancelled a document you issued (last 7 days)
  const since = new Date(Date.now() - WEEK).toISOString()
  const mine = new Map([...src.sales, ...src.purchases].filter((d) => d.issuedBy === user.name).map((d) => [d.id, d]))
  const decided = events
    .filter((e) => e.at >= since && (e.action === "approved" || e.action === "cancelled") && e.actor !== user.name && e.entityId && mine.has(e.entityId))
    .slice(-10).reverse()
  for (const e of decided) {
    out.push({
      id: `decided:${e.id}`, kind: "decided", at: e.at, msg: e.action === "approved" ? "docApproved" : "docCancelled",
      values: { ref: e.ref, actor: e.actor }, href: `/${e.entity === "sale" ? "sales" : "purchases"}/${e.entityId}`,
      tone: e.action === "approved" ? "success" : "danger",
    })
  }

  // Statutory deadlines (people who file or review returns) — the R8.3 schedule's own reminders take over a
  // deadline once it has fired for it (they are stored, configurable and persistent); until then the ambient
  // D-21 window keeps showing what the calendar says, exactly as before
  if (can(perms, "doc.approve") || can(perms, "audit.view")) {
    const fired = src.reminders ?? []
    const covered = (kind: "treasury" | "return91", due: string) => fired.some((r) => r.kind === kind && r.due === due)
    for (const r of fired) {
      const days = Math.round((Date.parse(r.due) - Date.parse(TODAY)) / 864e5)
      if (days < -30) continue // long past — the tick prunes these; the feed does not linger on them
      out.push({
        id: r.id, kind: "deadline", at: r.at, msg: "deadline",
        values: { title: REMINDER_TARGET[r.kind].title, due: r.due, days },
        href: REMINDER_TARGET[r.kind].href, tone: reminderTone(days),
      })
    }
    const [y, m] = TODAY.split("-").map(Number)
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y
    const due = `${ny}-${String(nm).padStart(2, "0")}-15`
    const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 864e5)
    if (days <= 21) {
      if (!covered("treasury", `${due.slice(0, 8)}14`))
        out.push({ id: `deadline:tr6:${due}`, kind: "deadline", at: now, msg: "deadline", values: { title: "treasuryDeposit", due: `${due.slice(0, 8)}14`, days: days - 1 }, href: "/vat/tr-6", tone: days <= 7 ? "danger" : "info" })
      if (!covered("return91", due))
        out.push({ id: `deadline:r91:${due}`, kind: "deadline", at: now, msg: "deadline", values: { title: "return91", due, days }, href: "/vat/return-9-1", tone: days <= 7 ? "danger" : "info" })
    }
  }

  // Reports delivered to this user (R8.3) — the log's rows carry the frozen figures; the page opens on the log
  if (can(perms, "settings.manage")) {
    for (const d of (src.deliveryLog ?? []).filter((d) => d.recipients.includes(user.id)).slice(-5).reverse()) {
      out.push({
        id: `delivered:${d.id}`, kind: "delivery", at: d.generatedAt, msg: "reportDelivered",
        values: { report: d.kind, period: d.period ?? d.asOf }, href: "/master/schedule", tone: "success",
      })
    }
  }

  if (can(perms, "doc.create") || can(perms, "master.edit")) {
    const low = src.items.map(withStock).filter((i) => i.remain < i.reorderLevel)
    if (low.length) out.push({ id: `lowStock:${low.map((i) => i.id).sort().join(",")}`, kind: "lowStock", at: now, msg: "lowStock", values: { count: low.length, first: low[0]!.name }, href: "/inventory/items?stock=out,low", tone: "warning" })
  }

  const read = new Set(readIds)
  return out.map((n) => ({ ...n, read: read.has(n.id) }))
}
