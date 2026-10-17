/**
 * R8.3 seed: the reminder settings a fresh install starts from, the two delivery schedules the demo ships (the
 * monthly VAT digest and the weekly receivables digest), and the one delivered digest the log starts with — its
 * figures are computed from the seeded books (the pure builder in `lib/schedule.ts`), so both runtimes seed the
 * very same row. Everything the schedule fires afterwards is live state.
 */
import { TODAY } from "../company"
import { nextRunAfter, vatDigestDocument } from "../schedule"
import type { DB } from "./db"
import type { DeliveryLogRow, DeliverySchedule, ReminderSettings } from "../types"

const SEEDED = "2025-07-01T03:00:00.000Z"
/** who the demo company's statutory reminders and reports belong to (the seeded users' ids) */
const ADMIN = "u5", ARIF = "u1", FARZANA = "u2"

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  // the return itself gets the long runway (a 9.1 needs the books closed first), the deposit and the VDS
  // certificates only the last week — the factory files what the digest already knows
  return91: { enabled: true, leads: [14, 7, 1] },
  treasury: { enabled: true, leads: [7, 1] },
  vds: { enabled: true, leads: [7, 1] },
  updatedAt: SEEDED, updatedBy: "System Administrator",
}

export function seedDeliverySchedules(): DeliverySchedule[] {
  return [
    {
      id: "dl1", kind: "vatDigest", frequency: "monthly", day: 20, recipients: [ADMIN, ARIF], enabled: true,
      lastRun: "2026-09-20", nextRun: nextRunAfter({ frequency: "monthly", day: 20 }, TODAY),
      createdBy: "System Administrator", createdAt: SEEDED,
      note: "The 9.1 figures as they stand, delivered before the 25th so the books can still be closed.",
    },
    {
      id: "dl2", kind: "receivablesDigest", frequency: "weekly", day: 1, recipients: [ADMIN, FARZANA], enabled: true,
      nextRun: nextRunAfter({ frequency: "weekly", day: 1 }, TODAY), createdBy: "System Administrator", createdAt: SEEDED,
      note: "Open customer invoices and their ageing, Monday mornings.",
    },
  ]
}

/** Last month's VAT digest (the 2026-08 return, filed 15 September), delivered on the 20th — the log and the
 *  document viewer have something to show before the first tick. */
export function seedDeliveryLog(d: DB): DeliveryLogRow[] {
  return [
    {
      id: "dx1", scheduleId: "dl1", kind: "vatDigest", period: "2026-08", asOf: "2026-09-20",
      generatedAt: "2026-09-20T04:30:00.000Z", recipients: [ADMIN, ARIF],
      document: vatDigestDocument(d, "2026-08"),
    },
  ]
}
