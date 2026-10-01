import { z } from "zod"
import { db } from "@/lib/mock/db"
import { udFitForSale } from "@/lib/rmg"
import { json, withAuth, zodProblem } from "../../../_lib"

const body = z.object({
  saleId: z.string().optional(), customerId: z.string().min(1), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), udNo: z.string().optional().default(""),
  lines: z.array(z.object({ itemId: z.string(), qty: z.number() })).default([]),
})

/**
 * R6.2: does this deemed-export invoice fit inside the exporter's UD? Read-only — used live by the sales form and the
 * invoice view. Returns null when the UD number is not in the register (the five R6 conditions still apply).
 */
export const POST = withAuth(null, async (req) => {
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  const d = parsed.data
  const fit = udFitForSale({ id: d.saleId ?? "", customerId: d.customerId, issueDate: d.issueDate, lines: d.lines as never, export: { deemed: true, udNo: d.udNo } as never }, db.uds, db.sales)
  return json(fit)
})
