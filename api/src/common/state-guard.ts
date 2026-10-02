/**
 * Cross-process guard for the shared state (audit hash chain + compat snapshot).
 *
 * `withStateLock` only serialises requests inside one Node process. During a Render deploy the old and the new
 * instance briefly run side by side on the same database: the new one re-seeds while the old one may still be
 * answering a request. Without this guard the old instance could (a) chain an audit event to a head the re-seed
 * just replaced, breaking the SHA-256 chain, and (b) upsert its stale compat snapshot over the fresh demo data.
 *
 * `lockState(tx)` must be the FIRST statement of every transaction that re-seeds, appends to the audit chain or
 * saves the compat snapshot:
 *  1. a transaction-scoped PostgreSQL advisory lock serialises those transactions across processes;
 *  2. the epoch check (meta.seeded_at as seen at boot) makes a process whose data set has been replaced by another
 *     process's re-seed refuse to write (503) instead of clobbering it.
 */
import { sql } from "drizzle-orm"
import { Problem } from "./http"

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> }

/** Advisory-lock key ("DZVA"). */
export const STATE_LOCK_KEY = 0x445a5641

let epoch: string | null = null

/** The meta.seeded_at value this process booted with (set after seeding / restoring). */
export function setEpoch(v: string | null | undefined) { epoch = v ?? null }
export function currentEpoch() { return epoch }

export async function lockState(tx: Exec, opts: { checkEpoch?: boolean } = {}) {
  await tx.execute(sql`select pg_advisory_xact_lock(${STATE_LOCK_KEY})`)
  if (opts.checkEpoch === false || epoch === null) return
  const r = await tx.execute(sql`select value from meta where key = 'seeded_at'`)
  const now = (r.rows[0] as { value?: string } | undefined)?.value ?? null
  if (now !== epoch) {
    console.error(`[state-guard] database re-seeded by another instance (${epoch} → ${now}); refusing to write stale state`)
    throw new Problem(503, "The service is being updated — please retry in a minute")
  }
}
