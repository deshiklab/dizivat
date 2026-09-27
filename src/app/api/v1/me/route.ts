import { meFor } from "@/lib/auth/server"
import { json, withAuth } from "../_lib"

export const GET = withAuth(null, (_req, _ctx, user) => json(meFor(user)))
