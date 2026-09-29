import { SALE_SERVICES } from "@/lib/r3"
import { json, withAuth } from "../_lib"

/** Services the company sells (illustrative NBR service codes until R4). */
export const GET = withAuth(null, async () => json(SALE_SERVICES))
