/**
 * R5.6 — the Mushak books, the dashboard, the search, the notifications, the service codes and the bulk import.
 *
 * These are the last of the readers: nothing here stores a row of its own. Each adds up documents that live
 * elsewhere — an item's book every movement that touched it, the dashboard the year's invoices and the return's
 * own shortfall, the search the invoice registers and both party books, the notifications the drafts awaiting an
 * approval and the audit trail's decisions, the import the SKUs and the parties it is about to create. Every one of
 * those families has a table, so all six are served from the database: the documents are read back by the modules
 * that own them, and the derivation is the mock's own code (`src/app/api/v1/_derived.ts` and `mushak610` in `_r4.ts`,
 * `notificationsFor` and `bulkImport` in `_r62.ts`, reused through the compat bundle), so the rows, the totals, the
 * deadlines, the hits and the import's issues cannot drift between the two runtimes.
 *
 * That is the end of these endpoints' dependence on the in-memory copies for reading: what the compat layer still
 * holds arrives here through the mirror, which the modules that own those tables keep in step. The one writer among
 * them, the bulk import, still creates through the mirror's arrays — the party and item write-backs carry what it
 * creates into their tables in the same transaction as everything else, the way a compat handler's write does.
 *
 * All of them but the import are reads, so there is nothing to migrate: no new table, no snapshot change and no
 * upgrade path of their own. What they read is what the R5.2–R5.6 migrations already put there.
 */
import { Controller, Get, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"
import type { ZodError } from "zod"
import type { User } from "@/lib/auth/roles"
import { toCSV } from "@/lib/mock/query"
import type { ChequeEvent, DeliveryLogRow, FiredReminder, Item, MoneyDoc, OpeningEntry, Party, Purchase, Sale } from "@/lib/types"
import type { OnboardingWorld } from "@/app/api/v1/_r62"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, zodErrors } from "../common/http"
import { withStateLock } from "../common/lock"
import { lockState } from "../common/state-guard"
import { deltaEmpty } from "../common/writeback"
import { compat, mirror } from "../state"
import { users } from "../db/schema"
import { eq } from "drizzle-orm"
import { db, type Tx } from "../db/client"
import { AuditService } from "./audit"
import { DerivedService } from "./derived"
import { applyPartyDelta, commitPartyDelta, partyDelta } from "./parties"
import { applyItemDelta, applyMasterDelta, commitItemDelta, commitMasterDelta, itemDelta, masterDelta } from "./items"
import type { MovementSource } from "@/lib/mock/db"
import { returnSource, type ReturnSource } from "./returns"
import { OpeningsService } from "./openings"
import { PurchasesService } from "./purchases"
import { SalesService } from "./sales"

type DashboardSource = MovementSource & ReturnSource
/** What the ⌘K palette searches: the two invoice registers, the SKUs and both party books. */
type SearchSource = { sales: Sale[]; purchases: Purchase[]; items: Item[]; customers: Party[]; vendors: Party[] }
/** What the notifications read: the documents awaiting an approval, the ones the user issued, and the stock levels. */
type NotificationSource = { sales: Sale[]; purchases: Purchase[]; items: Item[]; reminders?: FiredReminder[]; deliveryLog?: DeliveryLogRow[]
  moneyDocs?: MoneyDoc[]; chequeEvents?: ChequeEvent[] }
/** What a bulk import reads and writes: the SKUs and the two party books. */
type ImportSource = { items: Item[]; customers: Party[]; vendors: Party[] }

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class BooksService {
  constructor(
    @Inject(DerivedService) private readonly derived: DerivedService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  /**
   * The bulk import's transaction. It still creates its SKUs and its parties through the mirror's arrays, so the
   * party, item and master-item write-backs carry what it created into the tables — the last users of the
   * write-back machine now that every other family writes its own rows and the compat snapshot is gone. The
   * audit entries it records go straight to `audit_events` in their own locked transactions.
   */
  save<T>(fn: () => T | Promise<T>): Promise<T> {
    return withStateLock(async () => {
      const out = await fn()
      const parts = partyDelta(), its = itemDelta(), masters = masterDelta()
      if (!deltaEmpty(parts) || !deltaEmpty(its) || !deltaEmpty(masters)) {
        await db.transaction(async (tx: Tx) => {
          await lockState(tx)
          await applyPartyDelta(tx, parts)
          await applyItemDelta(tx, its)
          await applyMasterDelta(tx, masters)
        })
        commitPartyDelta(parts); commitItemDelta(its); commitMasterDelta(masters)
      }
      return out
    })
  }

  /** Every movement document, read from its own table by the module that owns it. */
  movement(): Promise<MovementSource> { return this.derived.source() }

  /**
   * What the dashboard adds up: every movement document, and everything the Mushak 9.1's own computation reads —
   * the parties, the deposits, the certificates and the adjustments — because its deadlines are that computation's
   * shortfall, the certificates still to issue and the two returns themselves. Where the two overlap the movement
   * documents win: they are the same rows, read by the module that owns them.
   */
  async dashboard(): Promise<DashboardSource> {
    const [movement, ret] = await Promise.all([this.derived.source(), returnSource()])
    return { ...ret, ...movement }
  }

  /** The five families the ⌘K palette searches, live rows only. */
  async search(): Promise<SearchSource> {
    const movement = await this.derived.source()
    return { sales: movement.sales, purchases: movement.purchases, items: movement.items,
      customers: mirror.parties("customer"), vendors: mirror.parties("vendor") }
  }

  /**
   * The notifications are built on demand, from the drafts awaiting an approval, the audit trail's decisions on the
   * documents this user issued and the stock below its re-order level — plus the ids the user has already read,
   * which live in the snapshot with the rest of the user store.
   */
  async notifications(user: User) {
    const movement = await this.derived.source()
    // R8.3: the reminders the schedule has fired and the reports delivered to this user ride along — they are
    // rows now, kept in step with the tables, so the feed never serves yesterday's reminders
    const src: NotificationSource = { sales: movement.sales, purchases: movement.purchases, items: movement.items,
      reminders: mirror.reminders(), deliveryLog: mirror.deliveryLog(),
      // R9.1: the money documents and the cheque lifecycle — a bounced cheque is the register's bad news
      moneyDocs: mirror.moneyDocs(), chequeEvents: mirror.chequeEvents() }
    const events = mirror.audit().events
    return compat().notificationsFor(user, src, { events, read: mirror.notifRead(user.id) })
  }

  /** Marking them read is a write to the user's own row — the last user-store bit the compat snapshot carried. */
  async notificationsRead(user: User, ids: string[]) {
    const merged = [...new Set([...mirror.notifRead(user.id), ...ids])].slice(-500)
    await db.update(users).set({ notifRead: merged }).where(eq(users.id, user.id))
    mirror.putNotifRead(user.id, merged)
  }

  /**
   * The bulk import's world: the SKUs and the two party books it checks its rows against — and creates in. The
   * party and item write-backs carry what it creates into the tables, in the same transaction as everything else.
   */
  importSource(): ImportSource {
    return { items: mirror.items(), customers: mirror.parties("customer"), vendors: mirror.parties("vendor") }
  }

  /** One audit entry per thing the import created, and one for the import itself. */
  record(user: User, e: { entity: "item" | "customer" | "vendor" | "opening" | "purchase" | "sale" | "import"; entityId?: string; ref: string; note?: string }) {
    return this.audits.record({
      at: new Date().toISOString(), actor: user, entity: e.entity, entityId: e.entityId ?? "", ref: e.ref,
      action: e.entity === "import" ? "imported" : "created", note: e.note,
    })
  }
}

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * The Mushak books: 6.1 (inputs), 6.2 (finished goods) and 6.2.1 (traded goods) over one item and a range, and
 * 6.10's purchases and sales above the limit. `format=csv` exports either; the range, the item a form may be asked
 * for and the 404 that points 9.1 at the return that now owns it are the mock's own rules.
 */
@Controller("api/v1/mushak")
export class MushakController {
  constructor(@Inject(BooksService) private readonly svc: BooksService) {}

  @Get(":form") @Authed()
  async one(@Param("form") form: string, @Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const q = { item: sp.get("item"), from: sp.get("from"), to: sp.get("to") }
    const a = form === "6.10"
      ? c.mushak610Book(q, await returnSource(), mirror.company())
      : c.mushakBook(form, q, mirror.company(), await this.svc.movement())
    if ("status" in a) throw new Problem(a.status, a.title, a.errors)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(a.rows as never[], a.columns as never[]), a.csvName)
      return
    }
    res.json(a.book)
  }
}

/** The home screen: this month against last, twelve months of the same, and the four statutory deadlines. */
@Controller("api/v1/dashboard")
export class DashboardController {
  constructor(@Inject(BooksService) private readonly svc: BooksService) {}

  @Get() @Authed()
  async one(@Res() res: Response) {
    res.json(compat().dashboardAnswer(await this.svc.dashboard()))
  }
}

/** One query across the invoice registers, the SKUs and both party books (the ⌘K palette). */
@Controller("api/v1/search")
export class SearchController {
  constructor(@Inject(BooksService) private readonly svc: BooksService) {}

  @Get() @Authed()
  async one(@Req() req: Request, @Res() res: Response) {
    res.json(compat().searchAnswer(searchParams(req).get("q") ?? "", await this.svc.search()))
  }
}

/** Notifications, built on demand, and the mark-as-read that dismisses them. */
@Controller("api/v1/notifications")
export class NotificationsController {
  constructor(@Inject(BooksService) private readonly svc: BooksService) {}

  @Get() @Authed()
  async list(@Req() req: AuthedRequest, @Res() res: Response) {
    const items = await this.svc.notifications(req.dz!.user)
    res.json({ items, unread: items.filter((n) => !n.read).length })
  }

  /** `{ ids: [...] }` or `{ all: true }` — the security reminder cannot be dismissed. */
  @Post("read") @Authed()
  async read(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = compat().notifReadInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const current = (await this.svc.notifications(user)).filter((n) => n.kind !== "security").map((n) => n.id)
    const ids = "all" in parsed.data ? current : parsed.data.ids.filter((id) => !id.startsWith("security:"))
    await this.svc.notificationsRead(user, ids)
    const items = await this.svc.notifications(user)
    res.status(200).json({ items, unread: items.filter((n) => !n.read).length }) // the mock answered 200, not 201
  }
}

/** The NBR service codes — a constant, so the only thing to port was the route. */
@Controller("api/v1/services")
export class ServicesController {
  @Get() @Authed()
  list(@Res() res: Response) { res.json(compat().SERVICES) }
}

/** …and the services the company sells. */
@Controller("api/v1/sale-services")
export class SaleServicesController {
  @Get() @Authed()
  list(@Res() res: Response) { res.json(compat().SALE_SERVICES) }
}

/**
 * The bulk master-data import: rows are validated first, and either every valid row is created or none is
 * (created = 0, issues listed), with records already on file skipped. `dryRun` validates only.
 */
@Controller("api/v1/import")
export class ImportController {
  constructor(
    @Inject(BooksService) private readonly svc: BooksService,
    @Inject(OpeningsService) private readonly openings: OpeningsService,
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(SalesService) private readonly sales: SalesService,
  ) {}

  /**
   * R7.4: the onboarding import's world — the live registers it resolves names against, and the two creators
   * that make the drafts through the opening and purchase services, so every row lands in the tables exactly
   * the way a single keyed document does (own transaction, own number, own history).
   */
  private async onboardingWorld(): Promise<OnboardingWorld> {
    const c = compat()
    const ret = await returnSource()
    const branches = mirror.company().branches
    const main = (branches.find((b) => b.category === "factory") ?? branches[0]).id
    return {
      items: mirror.items(), vendors: mirror.parties("vendor"), openings: mirror.openings(), purchases: mirror.purchases(),
      customers: mirror.parties("customer"), sales: mirror.sales(),
      returns: ret.returns, branches, mainBranchId: main,
      createOpening: async (body, user) => {
        const built = c.buildOpening(body)
        if ("status" in built) return built
        const at = new Date().toISOString()
        return this.openings.create(built.fields.date, (ident) => {
          const o: OpeningEntry = { ...built.fields, ...ident, process: "Created", issuedBy: user.name, createdAt: at, history: [] }
          c.claimOpeningId()
          c.stampOpeningHistory(o, user.name, "created", undefined, at)
          return o
        })
      },
      createPurchase: async (body, user) => {
        const r = c.parsePurchase(body)
        if ("status" in r) return r
        const fields = c.buildPurchaseFields(r.data, r.vendor)
        const at = new Date().toISOString()
        return this.purchases.create(r.data.category ?? "goods", r.data.issueDate, (ident) => {
          const p: Purchase = { ...fields, ...ident, createdAt: at, process: "Created", history: [] }
          c.stampDocHistory(p, user.name, "created", undefined, at)
          return p
        })
      },
      createSale: async (body, user) => {
        const r = c.parseSale(body)
        if ("status" in r) return r
        const at = new Date().toISOString()
        return this.sales.create(r.data.category ?? "goods", r.data.issueDate, (ident) => {
          const s: Sale = { ...r.fields, ...ident, createdAt: at, process: "Created", history: [] }
          c.stampDocHistory(s, user.name, "created", undefined, at)
          return s
        })
      },
    }
  }

  @Post() @Authed("master.edit")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = compat().bulkImportInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const { entity, dryRun, rows } = parsed.data
    const user = req.dz!.user
    const record = (e: Parameters<BooksService["record"]>[1]) => void this.svc.record(user, e)
    const r = entity === "openingStock" || entity === "purchases" || entity === "sales"
      ? await withStateLock(async () => compat().importOnboarding(entity, rows, dryRun, user, record, await this.onboardingWorld()))
      : await this.svc.save(() => compat().bulkImport(entity, rows, dryRun, user, record, this.svc.importSource()))
    res.status(!dryRun && r.created ? 201 : 200).json(r)
  }
}
