/**
 * R6 (the last four readers) — the bond register, the RMG export register, the late-payment penalty and the
 * SD-eligible inputs, served natively.
 *
 * Nothing here stores a row of its own: each register adds up documents other modules own. The bond register
 * walks the purchases, the invoices, the BOMs and the openings (with the own UDs and the drawback claims that
 * take balances out of the bond), the export register the invoices and the exporters' declarations, the penalty
 * the returns' own computation world, and the SD-eligible list the purchase lines and the exports they rode.
 * Every one of those families has a table; the mirror keeps in-memory copies of them in step, and the
 * computation is the mock's own (`bondRegisterFrom` / the CSV columns in `_r64.ts`, `exportRegisterOf` in
 * `src/lib/rmg.ts`, `penaltyExposureOf` / `penaltyQuoteOf` in `_r63.ts`, `sdEligible` in `src/lib/sd-export.ts`),
 * called with the mirror's copies of the same collections the mock passes its own db — so the rows, the totals,
 * the CSV columns and the 422s cannot drift between the two runtimes.
 *
 * With these four, no route is left in the compat table: what remains of the compat layer is the state it still
 * carries (the user store, the notifications, the sequence counters) and the lock that serialises it, until the
 * finale moves those too.
 */
import { Controller, Get, Inject, Injectable, Req, Res } from "@nestjs/common"
import type { Request, Response } from "express"
import { TODAY } from "@/lib/company"
import { toCSV } from "@/lib/mock/query"
import { EXPORT_CSV_COLUMNS, exportRegisterOf, exportRegisterRows, registerFrom } from "@/lib/rmg"
import { sdEligible } from "@/lib/sd-export"
import type { BondWorld } from "@/app/api/v1/_r64"
import { Authed, type AuthedRequest } from "../common/auth"
import { Problem, searchParams, sendCsv } from "../common/http"
import { compat, mirror } from "../state"
import { returnSource } from "./returns"

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const validDay = (d: string) => DAY_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

/* ── service ───────────────────────────────────────────────────────────── */

@Injectable()
export class RegistersService {
  /** The bond register's world: the mirror's copies of the collections the mock's own db holds. */
  bondWorld(): BondWorld {
    return {
      purchases: mirror.purchases(), sales: mirror.sales(), boms: mirror.boms(), items: mirror.items(), openings: mirror.openings(),
      bondUds: mirror.bondUds(), drawbackClaims: mirror.drawbackClaims(), vatSettings: mirror.vatSettings(),
    }
  }

  /** The penalty's world: everything a return's computation reads, built from the tables by the returns module. */
  penaltySource() {
    return returnSource()
  }
}

/* ── controllers ───────────────────────────────────────────────────────── */

/**
 * GET /vat/bond — ?from=&to= (YYYY-MM-DD, to ≤ today; physical stock is compared only when the range ends today),
 * ?format=csv&view=register|lots|drawback. The register itself is `src/lib/bond.ts`'s; the mock passes its db,
 * this passes the mirror's copies of the same collections.
 */
@Controller("api/v1/vat/bond")
export class BondController {
  constructor(@Inject(RegistersService) private readonly svc: RegistersService) {}

  @Get() @Authed()
  async register(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    const from = sp.get("from") || undefined
    const to = sp.get("to") || undefined
    const errors: Record<string, string[]> = {}
    if (from && !validDay(from)) errors.from = ["date"]
    if (to && (!validDay(to) || to > TODAY)) errors.to = [validDay(to) ? "afterToday" : "date"]
    if (!errors.from && !errors.to && from && to && from > to) errors.to = ["beforeFrom"]
    if (Object.keys(errors).length) throw new Problem(422, "Validation failed", errors)
    const reg = compat().bondRegisterFrom(this.svc.bondWorld(), from, to)
    if (sp.get("format") === "csv") {
      const view = sp.get("view") ?? "register"
      const stamp = reg.to
      if (view === "lots") return sendCsv(res, toCSV(reg.lots.map((l) => ({ ...l })), compat().BOND_LOTS_CSV), compat().bondCsvName(view, stamp))
      if (view === "drawback") return sendCsv(res, toCSV(compat().drawbackCsvRows(reg.drawback.rows), compat().BOND_DRAWBACK_CSV), compat().bondCsvName(view, stamp))
      return sendCsv(res, toCSV(reg.rows.map((r) => ({ ...r, physical: r.physical ?? "" })), compat().BOND_REGISTER_CSV), compat().bondCsvName(view, stamp))
    }
    res.json(reg)
  }
}

/**
 * GET /vat/exports — the RMG export & deemed-export register for a date range: every zero-rated export invoice
 * with its LC / EXP / UD documents and the NBR conditions it meets. ?kind=direct|deemed, ?risk=1 (incomplete
 * only), ?proceeds=open|overdue|partial|realised, ?format=csv. The computation is `src/lib/rmg.ts`'s own.
 */
@Controller("api/v1/vat/exports")
export class ExportsController {
  constructor(@Inject(RegistersService) private readonly svc: RegistersService) {}

  @Get() @Authed()
  async register(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    const from = sp.get("from") || registerFrom(TODAY), to = sp.get("to") || TODAY
    const { rows: all, totals } = exportRegisterOf(
      { sales: mirror.sales(), customers: mirror.parties("customer"), uds: mirror.uds() }, from, to, TODAY,
    )
    const rows = exportRegisterRows(all, { kind: sp.get("kind") ?? undefined, risk: sp.get("risk") === "1", proceeds: sp.get("proceeds") ?? undefined })
    if (sp.get("format") === "csv") return sendCsv(res, toCSV(rows, EXPORT_CSV_COLUMNS), `export-register-${from}-${to}.csv`)
    res.json({ from, to, rows, totals })
  }
}

/**
 * GET /vat/penalty — without `period`: every tax period's exposure as of today (unpaid tax and late filing).
 * With `period`: a quote — `vat`, `sd`, `paidOn`, `filedOn` and `latePenalty` can be overridden for a what-if.
 * The rules are `_r63.ts`'s own, called with the returns module's source.
 */
@Controller("api/v1/vat/penalty")
export class PenaltyController {
  constructor(@Inject(RegistersService) private readonly svc: RegistersService) {}

  @Get() @Authed()
  async quote(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    const period = sp.get("period")
    const src = await this.svc.penaltySource()
    if (!period) return res.json(compat().penaltyExposureOf(src))
    const out = compat().penaltyQuoteOf(
      period,
      { vat: sp.get("vat") ?? undefined, sd: sp.get("sd") ?? undefined, latePenalty: sp.get("latePenalty") ?? undefined, paidOn: sp.get("paidOn") ?? undefined, filedOn: sp.get("filedOn") ?? undefined },
      src,
    )
    if ("status" in out) throw new Problem(out.status, out.title, out.errors)
    res.json(out)
  }
}

/**
 * GET /vat/sd-eligible — the SD-paid purchase lines that a 9.1 note-40 claim may still draw on, with the
 * six-month export window each is inside (`exclude` = the claim being edited). `sdEligible` is
 * `src/lib/sd-export.ts`'s own, fed the mirror's copies.
 */
@Controller("api/v1/vat/sd-eligible")
export class SdEligibleController {
  @Get() @Authed()
  async eligible(@Req() req: AuthedRequest, @Res() res: Response) {
    const sp = searchParams(req)
    res.json(sdEligible({ purchases: mirror.purchases(), sales: mirror.sales(), adjustments: mirror.adjustments() }, TODAY, sp.get("exclude") ?? undefined))
  }
}
