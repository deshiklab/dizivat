/**
 * R5.4 — the two derived endpoints: the branch split (`/stock`) and one item's stock ledger (`/items/{id}/ledger`).
 * They store nothing of their own. Each adds up every movement document — purchases, sales, credit and debit notes,
 * transfers, damage entries, opening entries and production batches — and after this slice every one of those
 * families has a table, so both are served from the database: the documents are read back from their tables by the
 * modules that own them, and the derivation is the mock's own code (`src/app/api/v1/_derived.ts`, `_ledger.ts` and
 * `branchSplit` in `src/lib/mock/db.ts`, reused through the compat bundle), so the rows, the facets, the valuations,
 * the CSV columns, the running balance and the totals cannot drift between the two runtimes.
 *
 * That is the end of the derived stock's dependence on the in-memory copies: until now an approval had to write back
 * into the snapshot's arrays for `/stock` and the ledger to see it. The write-backs stay — the VAT returns, the Mushak
 * books, the work orders' progress, the subcontracting register and the finished-goods lots are still compat routes
 * and still read memory — but these two endpoints now answer from the tables alone.
 *
 * Both are reads, so there is nothing to migrate: no new table, no snapshot change and no upgrade path of their own.
 * What they read is what the R5.2–R5.4 migrations already put there.
 */
import { Controller, Get, Inject, Injectable, Param, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"
import type { MovementSource } from "@/lib/mock/db"
import { toCSV } from "@/lib/mock/query"
import type { CreditNote, Damage, DebitNote, ItemLedger, Transfer } from "@/lib/types"
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
