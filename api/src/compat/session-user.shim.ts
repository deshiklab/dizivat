/**
 * Replaces src/lib/auth/session-user.ts inside the compat bundle. NestJS has already authenticated the request
 * (AuthGuard → sessions table); the handler reads that user from the request context instead of the cookie.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type { Me, User } from "@/lib/auth/roles"
import type { SessionPayload } from "@/lib/auth/session"

export interface CompatCtx { user: User | null; session: SessionPayload | null; me: (u: User) => Me }
const g = globalThis as unknown as { __dzCompatCtx?: AsyncLocalStorage<CompatCtx> }
export const compatCtx: AsyncLocalStorage<CompatCtx> = (g.__dzCompatCtx ??= new AsyncLocalStorage<CompatCtx>())

export const currentUser = async (_req: Request): Promise<User | null> => compatCtx.getStore()?.user ?? null
export const sessionOf = async (_req: Request): Promise<SessionPayload | null> => compatCtx.getStore()?.session ?? null
export const userFromToken = async (): Promise<User | null> => compatCtx.getStore()?.user ?? null
export const meFor = (user: User): Me => {
  const c = compatCtx.getStore()
  if (!c) throw new Error("meFor outside a compat request")
  return c.me(user)
}
const nativeOnly = () => { throw new Error("sessions are issued by the native auth module") }
export const issueSession = async (..._a: unknown[]) => nativeOnly()
export const clearSession = (..._a: unknown[]) => nativeOnly()
