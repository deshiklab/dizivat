/**
 * Authentication: server-side sessions (PostgreSQL) behind the signed cookie, and role permissions.
 * 401 without a live session, 403 without the permission — the same responses the mock's withAuth() gave.
 */
import { randomBytes } from "node:crypto"
import { createParamDecorator, Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import type { Request, Response } from "express"
import { accessExpired, ROLE_PERMS, type Permission, type User } from "@/lib/auth/roles"
import { db } from "../db/client"
import { sessions } from "../db/schema"
import { mirror } from "../state"
import { isHttps, Problem, readCookie, setCookie, type CookieOptions } from "./http"
import { SESSION_COOKIE, SESSION_TTL_LONG, SESSION_TTL_SHORT, signToken, verifyToken, type TokenPayload } from "./session"

export interface AuthedRequest extends Request { dz?: { user: User; token: TokenPayload; remember: boolean } }

const PERM_KEY = "dz:perm"
/** Route needs a session; with a permission also the role check. Routes without @Authed are public. */
export const Authed = (perm: Permission | null = null) => SetMetadata(PERM_KEY, perm)
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().dz!.user)

interface Cached { userId: string; expiresAt: number; remember: boolean; loadedAt: number; seenAt: number }
const CACHE_MS = 60_000

@Injectable()
export class SessionService {
  /** sid → session; revocations go through this service, so the cache never serves a revoked session */
  private cache = new Map<string, Cached | null>()

  async create(req: Request, res: Response, user: User, remember: boolean) {
    const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT
    const now = Math.floor(Date.now() / 1000)
    const sid = randomBytes(18).toString("base64url")
    const expiresAt = new Date((now + ttl) * 1000)
    await db.insert(sessions).values({
      id: sid, userId: user.id, remember, expiresAt,
      userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) || null,
      ip: String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim() || null,
    })
    this.cache.set(sid, { userId: user.id, expiresAt: expiresAt.getTime(), remember, loadedAt: Date.now(), seenAt: Date.now() })
    setCookie(res, SESSION_COOKIE, signToken({ uid: user.id, sid, exp: now + ttl, iat: now }), { httpOnly: true, path: "/", maxAge: ttl, ...cookieMode(req) })
  }

  /** The signed-in user for this request, or null (bad signature, expired, revoked, deactivated). */
  async resolve(req: Request): Promise<{ user: User; token: TokenPayload; remember: boolean } | null> {
    const token = verifyToken(readCookie(req, SESSION_COOKIE))
    if (!token) return null
    let s = this.cache.get(token.sid)
    if (s === undefined || (s && Date.now() - s.loadedAt > CACHE_MS)) {
      const [row] = await db.select().from(sessions).where(and(eq(sessions.id, token.sid), isNull(sessions.revokedAt)))
      s = row ? { userId: row.userId, expiresAt: row.expiresAt.getTime(), remember: row.remember, loadedAt: Date.now(), seenAt: row.lastSeenAt?.getTime() ?? 0 } : null
      this.cache.set(token.sid, s)
    }
    if (!s || s.userId !== token.uid || s.expiresAt <= Date.now()) return null
    const user = mirror.findUser(s.userId)
    if (!user || !user.active || accessExpired(user)) return null // R6.2: an officer's access period ends at midnight Dhaka
    if (Date.now() - s.seenAt > 5 * 60_000) { // throttled "last seen" for the sessions list
      s.seenAt = Date.now()
      void db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, token.sid)).catch(() => undefined)
    }
    return { user, token, remember: s.remember }
  }

  async revoke(sid: string, reason: string) {
    await db.update(sessions).set({ revokedAt: sql`now()`, revokeReason: reason }).where(and(eq(sessions.id, sid), isNull(sessions.revokedAt)))
    this.cache.set(sid, null)
  }

  /** Signs the user out everywhere (optionally except one session). */
  async revokeUser(userId: string, reason: string, exceptSid?: string) {
    const where = exceptSid
      ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSid))
      : and(eq(sessions.userId, userId), isNull(sessions.revokedAt))
    const rows = await db.update(sessions).set({ revokedAt: sql`now()`, revokeReason: reason }).where(where).returning({ id: sessions.id })
    for (const r of rows) this.cache.set(r.id, null)
    for (const [sid, c] of this.cache) if (c?.userId === userId && sid !== exceptSid) this.cache.set(sid, null)
  }

  /** Clears both cookie variants (a partitioned cookie can only be removed by a partitioned Set-Cookie). */
  clearCookie(res: Response) {
    setCookie(res, SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 })
    setCookie(res, SESSION_COOKIE, "", { httpOnly: true, sameSite: "none", secure: true, partitioned: true, path: "/", maxAge: 0 })
  }
}

/** Over HTTPS: SameSite=None + Secure + Partitioned (works inside hosted-preview iframes); plain http: Lax. */
function cookieMode(req: Request): Pick<CookieOptions, "sameSite" | "secure" | "partitioned"> {
  return isHttps(req) ? { sameSite: "none", secure: true, partitioned: true } : { sameSite: "lax" }
}

/** Records a VAT officer's read of a native endpoint (compat handlers log through the mock's withAuth). */
export interface AccessLogger { officerAccess(user: User, req: Request): void }
export const ACCESS_LOGGER = "dz:accessLogger"

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ACCESS_LOGGER) private readonly access: AccessLogger,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const perm = this.reflector.getAllAndOverride<Permission | null | undefined>(PERM_KEY, [ctx.getHandler(), ctx.getClass()])
    if (perm === undefined) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const s = await this.sessions.resolve(req)
    if (!s) throw new Problem(401, "Your session has expired. Please sign in again.")
    if (perm && !ROLE_PERMS[s.user.role].includes(perm)) throw new Problem(403, `Your role (${s.user.role}) is not allowed to do this (${perm}).`)
    req.dz = s
    // R6.2 (GO 16/Mushak/2019): VAT officials' audit access is itself audited
    if (s.user.role === "vatOfficer") this.access.officerAccess(s.user, req)
    return true
  }
}
