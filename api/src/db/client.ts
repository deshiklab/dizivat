import { Pool, types } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "./schema"

// DATE stays "YYYY-MM-DD" (no timezone shift); BIGINT ids fit in a JS number here
types.setTypeParser(1082, (v) => v)
types.setTypeParser(20, (v) => Number(v))

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dizivat:dizivat@127.0.0.1:5432/dizivat"

/**
 * Neon hands out `…?sslmode=require&channel_binding=require`. node-postgres ignores channel_binding in the URL and
 * warns about sslmode=require; Neon certificates are publicly trusted, so verify them fully and bind the channel.
 */
function connection(url: string) {
  try {
    const u = new URL(url)
    const binding = u.searchParams.get("channel_binding") === "require"
    u.searchParams.delete("channel_binding")
    const mode = u.searchParams.get("sslmode")
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") u.searchParams.set("sslmode", "verify-full")
    return { connectionString: u.toString(), enableChannelBinding: binding }
  } catch {
    return { connectionString: url }
  }
}

export const pool = new Pool({
  ...connection(DATABASE_URL),
  max: Number(process.env.DB_POOL_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  // Neon suspends idle computes; the first query after a pause reconnects
  connectionTimeoutMillis: 15_000,
})
// An idle client dropped by the server must not crash the process
pool.on("error", (e) => console.error("[db] idle client error:", e.message))

export const db = drizzle(pool, { schema })
export type Db = typeof db
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
