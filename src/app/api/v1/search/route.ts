import { json, withAuth } from "../_lib"
import { searchAnswer } from "../_derived"

/** Global search for the ⌘K palette — one endpoint across record types. */
export const GET = withAuth(null, (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim()
  return json(searchAnswer(q))
})
