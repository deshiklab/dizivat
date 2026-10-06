/**
 * R5.4/R5.5 — the derived endpoints, which store nothing of their own: the branch split (`/stock`) and one item's
 * stock ledger (`/items/{id}/ledger`), and since R5.5 the two registers the rest of production is watched by — the
 * finished-goods lots (`/production/lots`) and the subcontracting register (`/production/subcontract`). Each adds up
 * documents that live elsewhere: the branch split and the ledger every movement document — purchases, sales, credit
 * and debit notes, transfers, damage entries, opening entries and production batches — the lots the batches that
 * received goods and the invoices that drew on them, and the subcontracting register the contractual batches. Every
 * one of those families has a table, so all four are served from the database: the documents are read back from their
 * tables by the modules that own them, and the derivation is the mock's own code (`src/app/api/v1/_derived.ts`,
 * `_ledger.ts`, `branchSplit` in `src/lib/mock/db.ts`, `lotsAnswer` in `_r3.ts` and `subconRegister` in `_r62.ts`,
 * reused through the compat bundle), so the rows, the facets, the valuations, the CSV columns, the running balance,
 * the lot availability, the days at a contractor and the totals cannot drift between the two runtimes.
 *
 * That is the end of these registers' dependence on the in-memory copies: until now an approval had to write back
 * into the snapshot's arrays for `/stock`, the ledger, the lots and the subcontracting register to see it. The
 * write-backs stay — the VAT returns and the Mushak books are still compat routes and still read memory — but these
 * four endpoints answer from the tables alone.
 *
 * All four are reads, so there is nothing to migrate: no new table, no snapshot change and no upgrade path of their
 * own. What they read is what the R5.2–R5.5 migrations already put there.
 */
import { Controller, Get, Inject, Injectable, Param, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"
import type { MovementSource } from "@/lib/mock/db"
import { toCSV } from "@/lib/mock/query"
import { TODAY } from "@/lib/company"
import type { Batch, CreditNote, Damage, DebitNote, ItemLedger, Transfer } from "@/lib/types"
import type { LotSource } from "@/app/api/v1/_r3"
import { Authed } from "../common/auth"
import { Problem, searchParams, sendCsv } from "../common/http"
import { compat } from "../state"
import { BatchesService } from "./batches"
import { ItemsService, toItem } from "./items"
import { NotesService } from "./notes"
import { OpeningsService } from "./openings"
import { PurchasesService } from "./purchases"
import { SalesService } from "./sales"
import { StockService } from "./stock"

const today = () => new Date().toISOString().slice(0, 10)

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class DerivedService {
  constructor(
    @Inject(ItemsService) private readonly items: ItemsService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(NotesService) private readonly notes: NotesService,
    @Inject(StockService) private readonly docs: StockService,
    @Inject(OpeningsService) private readonly openings: OpeningsService,
    @Inject(BatchesService) private readonly batches: BatchesService,
  ) {}

  /**
   * Every movement document, read from its own table and mapped back to the contract shape by the module that owns
   * it — the same documents the in-memory copies hold, so the derivation answers exactly as the mock's does. Live
   * rows only: a trashed draft never moved stock, and a deleted one is stamped in its table.
   */
  async source(): Promise<MovementSource> {
    const [items, sales, purchases, creditNotes, debitNotes, transfers, damages, openings, batches] = await Promise.all([
      this.items.allItems(),
      this.sales.all(),
      this.purchases.all(),
      this.notes.all("credit") as Promise<CreditNote[]>,
      this.notes.all("debit") as Promise<DebitNote[]>,
      this.docs.all("transfer") as Promise<Transfer[]>,
      this.docs.all("damage") as Promise<Damage[]>,
      this.openings.all(),
      this.batches.all(),
    ])
    return { items, sales, purchases, creditNotes, debitNotes, transfers, damages, openings, batches }
  }

  /** One SKU by id, as the ledger's subject — undefined when there is no such item. */
  async item(id: string) {
    const row = await this.items.itemRow(id)
    return row ? toItem(row) : undefined
  }

  /**
   * The two families a lot is made of: the batches that received finished goods and the invoices that drew on them.
   * A lot is what is left of one batch's receipt, so nothing else is read.
   */
  async lotSource(): Promise<LotSource> {
    const [batches, sales] = await Promise.all([this.batches.all(), this.sales.all()])
    return { batches, sales }
  }

  /** The batches the subcontracting register walks — it keeps the contractual ones itself. */
  async subconSource(): Promise<Batch[]> { return this.batches.all() }

  /** One item's ledger, restricted to a stock-holding branch when given. */
  async ledger(id: string, branchId?: string): Promise<ItemLedger | undefined> {
    const c = compat()
    const it = await this.item(id)
    if (!it) return undefined
    if (branchId && !c.stockBranches().some((b) => b.id === branchId)) throw new Problem(404, "Branch not found")
    return c.itemLedger(it, branchId, await this.source())
  }
}

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * Stock by branch (S4-05): every item with its quantity at each stock-holding branch, valued at cost and at sale
 * price, with the value each branch holds. `branch=<id>` keeps the items held there; `format=csv` adds a column per
 * branch. The mock's own spec, rows and columns, over the documents in the tables.
 */
@Controller("api/v1/stock")
export class StockController {
  constructor(@Inject(DerivedService) private readonly svc: DerivedService) {}

  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const { r, branches, branchValue } = c.stockRegister(sp, await this.svc.source())
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(r.all, c.branchCsvColumns(branches)), `stock-by-branch-${today()}.csv`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { all, ...page } = r
    res.json({ ...page, branches, branchValue })
  }
}

/**
 * The finished-goods lots: what each approved batch received and what the approved invoices have drawn on since, so
 * a sales invoice can only promise what a lot still holds. `?item=` keeps one SKU's lots, `?all=1` shows the empty
 * ones too and `?exclude=<sale id>` leaves one invoice out — which is how the sales form edits a draft. The mock's
 * own `lotsAnswer`, over the batches' and the invoices' rows.
 */
@Controller("api/v1/production/lots")
export class LotsController {
  constructor(@Inject(DerivedService) private readonly svc: DerivedService) {}

  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    res.json(compat().lotsAnswer(searchParams(req), await this.svc.lotSource()))
  }
}

/**
 * The subcontracting register (R6.2, RMG): the contractual production batches — the inputs sent to a contract
 * manufacturer under a Mushak 6.4 challan — what is still at the contractor, for how long, and what it is worth.
 * `?from`/`?to` default to the fiscal year the RMG registers run on, `?days=` moves the overdue threshold,
 * `?status=` keeps one state and `?format=csv` exports it. The mock's own range rule, rows and CSV columns, over the
 * batches' rows.
 */
@Controller("api/v1/production/subcontract")
export class SubcontractController {
  constructor(@Inject(DerivedService) private readonly svc: DerivedService) {}

  @Get() @Authed()
  async list(@Req() req: Request, @Res() res: Response) {
    const c = compat()
    const sp = searchParams(req)
    const range = c.subconParams(sp, TODAY)
    if ("status" in range) throw new Problem(range.status, range.title, range.errors)
    const reg = c.subconRegister(range.from, range.to, TODAY, range.days, await this.svc.subconSource())
    const rows = c.subconRows(reg, range.only)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(rows, c.SUBCON_CSV_COLUMNS), c.subconCsvName(range.from, range.to))
      return
    }
    res.json({ ...reg, rows })
  }
}

/**
 * One item's stock ledger (Mushak 6.1/6.2 style movement register): every approved document that moved it, sorted by
 * date and type with a running balance, plus the item's quantity at each branch. `?branch=<id>` restricts it to one
 * branch, where the transfers in and out appear (company-wide they net to zero).
 */
@Controller("api/v1/items")
export class ItemLedgerController {
  constructor(@Inject(DerivedService) private readonly svc: DerivedService) {}

  @Get(":id/ledger") @Authed()
  async ledger(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    const branch = searchParams(req).get("branch") || undefined
    const body = await this.svc.ledger(id, branch)
    if (!body) throw new Problem(404, "Item not found")
    res.json(body)
  }
}
