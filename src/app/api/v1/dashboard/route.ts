import { delay } from "@/lib/mock/query"
import { json, withAuth } from "../_lib"
import { dashboardAnswer } from "../_derived"

/** KPIs, charts, deadlines and low stock for the current VAT period. */
export const GET = withAuth(null, async () => {
  await delay(250)
  return json(dashboardAnswer())
})
