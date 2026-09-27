import type { AuditEvent } from "@/lib/types"
import { auditStore } from "@/lib/mock/audit"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { json, withAuth } from "../_lib"

const spec = {
  search: (e: AuditEvent) => `${e.ref} ${e.actor} ${e.note ?? ""} ${e.changes?.map((c) => `${c.field} ${c.from} ${c.to}`).join(" ") ?? ""}`,
  dateField: "day" as const,
  facets: { entity: (e: AuditEvent) => e.entity, action: (e: AuditEvent) => e.action, actor: (e: AuditEvent) => e.actor },
}

/**
 * Global audit trail (append-only). Filters: q, from/to (Dhaka calendar day), entity, action, actor,
 * entityId (history of one record). Newest first by default.
 */
export const GET = withAuth("audit.view", async (req) => {
  const sp = new URL(req.url).searchParams
  if (!sp.get("sort")) sp.set("sort", "at.desc")
  const entityId = sp.get("entityId")
  const rows = entityId ? auditStore.events.filter((e) => e.entityId === entityId) : auditStore.events
  const r = runQuery(rows, sp, spec)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(r.all, [
      { key: "at", label: "Time (UTC)" }, { key: "day", label: "Date (Dhaka)" }, { key: "actor", label: "User" },
      { key: "action", label: "Action" }, { key: "entity", label: "Record type" }, { key: "ref", label: "Reference" },
      { key: "changes", label: "Changes", get: (e) => e.changes?.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(" | ") ?? "" },
      { key: "note", label: "Note" },
    ]), `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`)
  }
  await delay(150)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json(page)
})
