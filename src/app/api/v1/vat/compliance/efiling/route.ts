import { complianceAnswer, CURRENT } from "@/app/api/v1/_r4"
import { company } from "@/lib/mock/company"
import { db } from "@/lib/mock/db"
import { efilingDocument } from "@/lib/efiling"
import { ruleResponse, withAuth } from "../../../_lib"

/**
 * R7.5 — the e-filing document: the 9.1's figures as one JSON named the way the VAT portal asks for them
 * (BIN, tax period, output/input VAT, rate-wise turnover, the TR-6 deposits with economic codes). The same
 * shared `src/lib/efiling.ts` the native controller runs, against the same collections — no second
 * computation: the figures are the compliance centre's own answer.
 */
export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const period = sp.get("period") || CURRENT
  const answer = complianceAnswer(period)
  if ("title" in answer) return ruleResponse(answer) // the answer carries a `status` of its own
  const doc = efilingDocument(period, db, company, { summary: answer, software: "DiziVAT" })
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="efiling-9.1-${period}.json"` },
  })
})
