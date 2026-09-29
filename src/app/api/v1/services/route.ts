import { SERVICES } from "@/lib/r2"
import { json, withAuth } from "../_lib"

/** NBR service codes available on service purchases (illustrative subset until R4). */
export const GET = withAuth(null, async () => json(SERVICES))
