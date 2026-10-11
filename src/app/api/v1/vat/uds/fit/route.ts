import { zodProblem, json, withAuth } from "../../../_lib"
import { udFitAnswer, udFitInput } from "../../../_r62"

/**
 * R6.2: does this deemed-export invoice fit inside the exporter's UD? Read-only — used live by the sales form and the
 * invoice view. Returns null when the UD number is not in the register (the five R6 conditions still apply).
 */
export const POST = withAuth(null, async (req) => {
  const parsed = udFitInput.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return zodProblem(parsed.error)
  return json(udFitAnswer(parsed.data))
})
