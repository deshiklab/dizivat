import { verifyAudit } from "@/lib/mock/audit"
import { json, withAuth } from "../../_lib"

/**
 * R6: verifies the tamper-evident audit chain (SHA-256, each event linked to the previous one) and returns the chain
 * head — the value to note down or export as a daily anchor. Native in the NestJS API (reads audit_events).
 */
export const GET = withAuth("audit.view", async () => json(verifyAudit()))
