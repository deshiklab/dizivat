/**
 * R6.6 (proceeds): the export-proceeds register and the bank PRC file — `vat/proceeds` (the open list with its
 * ageing, the CSV, the demonstration bank file), `vat/proceeds/match` (allocations proposed, nothing saved),
 * `vat/proceeds/batches` (the posted batches; POST posts the confirmed allocations as realisations) and one batch
 * with its reversal.
 *
 * The rules are the mock's own, re-exported by `api/src/compat/entry.ts` from `_r66.ts` (`prcBatchCreate`,
 * `prcBatchReverse` with `newPrcBatchTag`; `matchPrc`, `postCheck`, `proceedsOverview`, `sampleBankFile` and
 * `openExports` are `src/lib/proceeds.ts`'s, shared with the pages already) — the EXP / invoice / LC / amount
 * matching, the oldest-first spread, what a posted row may not do and what a reversal takes out — so the rows, the
 * error codes, the frozen batch lines and the audit events cannot drift between the two runtimes.
 *
 * A batch is a row of `prc_batches` (its lines with their allocations travel as JSONB, the way a settlement travels
 * with its UD: a frozen record of what was posted). The proceeds entries themselves are `sale_realisations` rows —
 * they move with the invoices through the sales write-back, so the registers the invoices feed cannot disagree.
 */
import { TODAY } from "@/lib/company"
import { matchPrc, proceedsOverview, sampleBankFile } from "@/lib/proceeds"
import { prcMatchInput, prcPostInput, prcReverseInput } from "@/lib/schemas"
import type { PrcBatch, Sale } from "@/lib/types"
import type { z } from "zod"
import type { ZodError } from "zod"
import type { PrcAudit, PrcSource } from "@/app/api/v1/_r66"
import { Authed, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, searchParams, sendCsv, uniqueViolation, zodErrors } from "../common/http"
import { toCSV } from "@/lib/mock/query"
import { lockState } from "../common/state-guard"
import { WriteBack } from "../common/writeback"
import { db, type Tx } from "../db/client"
import { prcBatches } from "../db/schema"
import { compat, mirror } from "../state"
import { applySaleDelta, commitSaleDelta, saleDelta } from "./sales"
import { AuditService } from "./audit"
import { asc, desc, eq, sql } from "drizzle-orm"
import { Controller, Get, HttpCode, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"

type PrcDb = typeof prcBatches.$inferSelect
const LABEL = "Batch not found"

/** A row as the rules and the pages know the batch: optional fields absent, not null. */
export function toPrcBatch(r: PrcDb): PrcBatch {
  const b: PrcBatch = {
    id: r.id, no: r.no, fileName: r.fileName, status: r.status, lines: r.lines, skipped: r.skipped,
    invoices: r.invoices, fcTotals: r.fcTotals, bdt: r.bdt, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }
  if (r.reversedOn) b.reversedOn = r.reversedOn
  if (r.reverseReason) b.reverseReason = r.reverseReason
  if (r.updatedAt) b.updatedAt = r.updatedAt.toISOString()
  if (r.history) b.history = r.history
  return b
}

/** The batch as the columns hold it. */
export const prcBatchValues = (b: PrcBatch) => ({
  id: b.id, no: b.no, fileName: b.fileName, status: b.status, lines: b.lines, skipped: b.skipped, invoices: b.invoices,
  fcTotals: b.fcTotals, bdt: b.bdt, reversedOn: b.reversedOn ?? null, reverseReason: b.reverseReason ?? null,
  createdBy: b.createdBy, createdAt: new Date(b.createdAt), updatedAt: b.updatedAt ? new Date(b.updatedAt) : null,
  history: b.history ?? null,
})

/** What the create / reverse rules answer: the write itself, or the problem the caller turns into a response. */
type PrcWrite = { batch: PrcBatch; touched: Sale[]; at: string; audit: PrcAudit[] }
type PrcReverseWrite = { batch: PrcBatch; touched: Sale[]; removed: number; at: string; audit: PrcAudit[] }
type RuleProblemShape = { status: number; title: string; errors?: Record<string, string[]> }

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class ProceedsService {
  /** Every live batch, newest first — the order the mock's sorted array had (ties keep the posting order). */
  async allBatches(): Promise<PrcBatch[]> {
    const rows = await db.select().from(prcBatches).where(sql`${prcBatches.deletedAt} is null`).orderBy(desc(prcBatches.createdAt), asc(prcBatches.ord))
    return rows.map(toPrcBatch)
  }

  /** One batch by id or by number, the way the mock's routes found them. */
  async batchByIdOrNo(idOrNo: string): Promise<PrcBatch | undefined> {
    const rows = await db.select().from(prcBatches).where(sql`${prcBatches.deletedAt} is null and (${prcBatches.id} = ${idOrNo} or ${prcBatches.no} = ${idOrNo})`)
    return rows.length ? toPrcBatch(rows[0]) : undefined
  }

  /**
   * Posts a batch. `make` runs the rules inside the lock — which is where the number is claimed, the proceeds
   * entries pushed onto the invoices' in-memory copies and the batch pushed into the in-memory list — so two
   * creates in flight cannot take the same id or number. The invoices the rule touched are written through the
   * sales write-back (their proceeds entries are child rows of the invoice), and the batch row lands beside them
   * in the same transaction. A failure puts the in-memory copies back the way they were.
   */
  async createBatch(make: () => PrcWrite | RuleProblemShape): Promise<PrcWrite> {
    let before: Sale[] | undefined
    let made: PrcBatch | undefined
    try {
      const { saved, sold, write } = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        before = w.touched.map((s) => structuredClone(s)) // the rules edit in place: what a failed write restores
        made = w.batch
        const sold = saleDelta() // the invoices the rule touched are live rows the write-back already holds
        await applySaleDelta(tx, sold)
        const [row] = await tx.insert(prcBatches).values(prcBatchValues(w.batch)).returning()
        return { saved: toPrcBatch(row), sold, write: w }
      })
      commitSaleDelta(sold)
      mirror.putPrcBatch(saved)
      markPrcBatches([saved])
      return { ...write, batch: saved }
    } catch (e) {
      if (before) for (const s of before) mirror.putSale(s)
      if (made) mirror.removePrcBatch(made.id)
      if (uniqueViolation(e) !== null) throw new Problem(409, "That batch number was just taken — please try again.")
      throw e as Error
    }
  }

  /**
   * Reverses a batch: every proceeds entry it posted is taken back out of its invoice (the lines carry the
   * realisation ids for exactly that), the row is stamped and its history says why. The same transaction shape as
   * the create — the invoices' rows and the batch's row move together.
   */
  async reverseBatch(id: string, make: () => PrcReverseWrite | RuleProblemShape): Promise<PrcReverseWrite> {
    let before: Sale[] | undefined
    try {
      const { saved, sold, write } = await db.transaction(async (tx) => {
        await lockState(tx)
        const w = make()
        if ("status" in w) throw new Problem(w.status, w.title, w.errors)
        before = w.touched.map((s) => structuredClone(s))
        const sold = saleDelta()
        await applySaleDelta(tx, sold)
        const [row] = await tx.update(prcBatches).set(prcBatchValues(w.batch)).where(eq(prcBatches.id, id)).returning()
        if (!row) throw new Problem(404, LABEL)
        return { saved: toPrcBatch(row), sold, write: w }
      })
      commitSaleDelta(sold)
      mirror.putPrcBatch(saved)
      markPrcBatches([saved])
      return { ...write, batch: saved }
    } catch (e) {
      if (before) for (const s of before) mirror.putSale(s)
      throw e as Error
    }
  }
}

/* ── write-back: what the unported handlers changed ─────────────────────── */

/**
 * The batches are rows now, but the in-memory copy stays: the proceeds overview lists them beside the invoices the
 * mirror holds, and a restored backup replaces the whole in-memory world at once. A handler that writes through
 * the mock's array is written back here. See common/writeback.ts.
 */
const prcBatchWb = new WriteBack<PrcBatch>("prcBatches", () => mirror.prcBatches(), (x) => x.id)
export const markPrcBatches = (list: PrcBatch[]) => prcBatchWb.mark(list)
export const forgetPrcBatch = (id: string) => prcBatchWb.forget(id)
export const prcBatchDelta = () => prcBatchWb.delta()
type PrcBatchDelta = ReturnType<typeof prcBatchDelta>
export const commitPrcBatchDelta = (d: PrcBatchDelta) => prcBatchWb.commit(d)

/**
 * Applies the delta inside the persist transaction and reads the saved batch back into memory, so a value a column
 * type rounded is not rewritten on every request.
 *
 * A batch that left the in-memory list was dropped by a handler that still runs the mock's code (a restored older
 * backup): the row is stamped, which retires its number — and the write-back forgets it.
 */
export async function applyPrcBatchDelta(tx: Tx, d: PrcBatchDelta) {
  for (const b of [...d.insert, ...d.update]) {
    const values = prcBatchValues(b)
    const [row] = await tx.insert(prcBatches).values(values).onConflictDoUpdate({ target: prcBatches.id, set: values }).returning()
    mirror.putPrcBatch(toPrcBatch(row))
    markPrcBatches([b])
  }
  for (const id of d.missing) {
    const stored = prcBatchWb.stored(id)
    if (stored) {
      await tx.update(prcBatches).set({ ...prcBatchValues(stored), deletedAt: new Date() }).where(eq(prcBatches.id, id))
      mirror.removePrcBatch(id)
      forgetPrcBatch(id)
      continue
    }
    console.warn(`[prcBatches] ${id} vanished from the in-memory state and has no stored row`)
  }
}

/* ── what the rules read ───────────────────────────────────────────────── */

/** The invoices the rules match and post against: the in-memory copies, which the write-backs keep in step. */
const saleSource = () => mirror.sales()

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * The proceeds register: the open exports with their ageing, the bank file's demonstration download, and the
 * matcher that proposes allocations without saving anything.
 */
@Controller("api/v1/vat/proceeds")
export class ProceedsController {
  constructor(@Inject(ProceedsService) private readonly svc: ProceedsService) {}

  /** The page's overview: outstanding / overdue / due-soon tiles, ageing, the open list and the batches. */
  @Get() @Authed()
  async overview(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    const o = proceedsOverview(saleSource(), await this.svc.allBatches(), TODAY)
    if (sp.get("format") === "csv") {
      sendCsv(res, toCSV(o.open, compat().proceedsOpenCsvColumns as never[]), `export-proceeds-open-${TODAY}.csv`)
      return
    }
    res.json(o)
  }

  /** A demonstration bank PRC file built from today's open exports, so there is always something to match. */
  @Get("sample") @Authed()
  async sample(@Res() res: Response) {
    sendCsv(res, sampleBankFile(saleSource(), TODAY), `bank-prc-sample-${TODAY}.csv`)
  }

  /** Match the rows of a bank file to export invoices — nothing is saved. */
  @Post("match") @HttpCode(200) @Authed("doc.edit")
  async match(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = prcMatchInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    res.json(matchPrc(parsed.data.rows, saleSource(), TODAY))
  }
}

/**
 * The bank-file batches: the register, and the POST that turns the confirmed allocations into proceeds entries on
 * the invoices. A reversal is the approver's own step, on the batch itself.
 */
@Controller("api/v1/vat/proceeds/batches")
export class PrcBatchesController {
  constructor(
    @Inject(ProceedsService) private readonly svc: ProceedsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The posted / reversed batches, newest first, with their lines and allocations. */
  @Get() @Authed()
  async list(@Res() res: Response) {
    res.json({ rows: await this.svc.allBatches() })
  }

  /** Post the confirmed allocations as realisations — one batch per file. */
  @Post() @Authed("doc.edit")
  async create(@Req() req: AuthedRequest, @Res() res: Response) {
    const parsed = prcPostInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const src: PrcSource = { sales: saleSource(), prcBatches: mirror.prcBatches() }
    const w = await this.svc.createBatch(() => compat().prcBatchCreate(parsed.data, user, src, new Date().toISOString(), Date.now().toString(36)))
    for (const a of w.audit) await this.audit.record({ at: w.at, actor: user, ...a })
    res.status(201).json(w.batch)
  }

  /** One batch with its PRC lines and allocations. */
  @Get(":id") @Authed()
  async one(@Param("id") id: string, @Res() res: Response) {
    const cur = await this.svc.batchByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    res.json(cur)
  }

  /** Reverse a batch — removes every realisation it posted (approvers). A reversed one is refused first. */
  @Post(":id/reverse") @Authed("doc.approve") @HttpCode(200)
  async reverse(@Param("id") id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const cur = await this.svc.batchByIdOrNo(id)
    if (!cur) throw new Problem(404, LABEL)
    if (cur.status === "reversed") throw new Problem(409, `${cur.no} was reversed on ${cur.reversedOn}.`)
    const parsed = prcReverseInput.safeParse(jsonBody(req))
    if (!parsed.success) throw new Problem(422, "Validation failed", zodErrors(parsed.error as ZodError))
    const user = req.dz!.user
    const src: PrcSource = { sales: saleSource(), prcBatches: mirror.prcBatches() }
    const w = await this.svc.reverseBatch(id, () => compat().prcBatchReverse(cur, parsed.data, user, src, new Date().toISOString()))
    for (const a of w.audit) await this.audit.record({ at: w.at, actor: user, ...a })
    res.json(w.batch)
  }
}
