/**
 * One process-wide mutex around the shared in-memory state (compat requests and audit writes), so a compat
 * request's writes and the JSONB snapshot saved after it are never interleaved with another request.
 */
let tail: Promise<unknown> = Promise.resolve()
export function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => undefined)
  return run
}
