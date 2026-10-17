import { complianceAnswer, CURRENT } from "@/app/api/v1/_r4"
import { mushak610Book } from "@/app/api/v1/_derived"
import { company } from "@/lib/mock/company"
import { db } from "@/lib/mock/db"
import { compliancePack } from "@/lib/compliance-pack"
import { ruleResponse, withAuth } from "../../../_lib"

/**
 * R7.2 — one tax period's submission set as a zip: the sales and purchase registers, Mushak 6.10, the TR-6
 * challans and VDS certificates of the period, the 9.1 return as it stands, and a manifest + checklist.
 * The same shared `src/lib/compliance-pack.ts` the native controller runs, against the same collections.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const period = sp.get("period") || CURRENT
  const answer = complianceAnswer(period)
  if ("title" in answer) return ruleResponse(answer) // the answer carries a `status` of its own
  const [y, m] = period.split("-").map(Number)
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const m610 = mushak610Book({ from: `${period}-01`, to })
  if ("status" in m610) return ruleResponse(m610) // unreachable: the range is the period's own
  const zip = compliancePack(period, db, company, { summary: answer, m610 })
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="compliance-pack-${period}.zip"` } })
})
