/**
 * R10 — POS integration (PostgreSQL + shared R10.1–R10.4 rules):
 *   R10.1 Counter POS: catalog, sales, shifts, X/Z reports, Mushak 6.3 QR & e-bill
 *   R10.2 Settlement reconciliation: card / MFS terminal statement import, auto-matching & fee charge lines
 *   R10.3 External POS API: registers, scoped API tokens, idempotent external endpoints, offline queue & webhooks
 *   R10.4 Print & labels: 80mm thermal receipt, item barcode labels (Code-128B), Finance Act 2026 NBR e-invoice adapter
 */
import { Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Put, Req, Res } from "@nestjs/common"
import { eq } from "drizzle-orm"
import type { Request, Response } from "express"
import { ROLE_PERMS, type Permission, type Role, type User } from "@/lib/auth/roles"
import { toCSV } from "@/lib/mock/query"
import type {
  Line,
  NbrEInvoiceAdapter,
  PosApiToken,
  PosLabelFormat,
  PosQueueEntry,
  PosRegister,
  PosSale,
  PosScope,
  PosShift,
  PosTender,
  PosTerminalLine,
  PosTerminalStatement,
  PosWebhook,
  PosWebhookDelivery,
  PosWebhookEvent,
} from "@/lib/types"
import { Authed, CurrentUser, SessionService, type AuthedRequest } from "../common/auth"
import { jsonBody, Problem, sendCsv, toIso } from "../common/http"
import { db, type Tx } from "../db/client"
import {
  posQueue as posQueueTable,
  posRegisters as posRegistersTable,
  posSales as posSalesTable,
  posSettlementLines as posSettlementLinesTable,
  posSettlements as posSettlementsTable,
  posShifts as posShiftsTable,
  posTokens as posTokensTable,
  posWebhookDeliveries as posWebhookDeliveriesTable,
  posWebhooks as posWebhooksTable,
} from "../db/schema"
import { compat, G, mirror } from "../state"
import { AuditService } from "./audit"

const num = (v: string | number | null | undefined) => Number(v ?? 0)
const dt = (v: string | Date) => (v instanceof Date ? v : new Date(v))
const dtOpt = (v: string | Date | null | undefined) => (v ? dt(v) : null)
const reqUrl = (req: Request) => new URL(req.originalUrl, "http://x")
const mdb = () => G.__dzDb! as never
const seqMap = () => G.__dzDb!.seq as Record<string, number>

function bumpSeq(name: string, fallback = 10): number {
  const s = seqMap()
  const next = (s[name] ?? fallback) + 1
  s[name] = next
  return next
}

/* ── Row Mappers (PostgreSQL <-> Domain) ──────────────────────────────────── */

export function posRegisterValues(r: PosRegister, ord = 0) {
  return {
    id: r.id,
    ord,
    code: r.code,
    name: r.name,
    branchId: r.branchId,
    branchName: r.branchName,
    cashAccountId: r.cashAccountId,
    cardAccountId: r.cardAccountId,
    bkashAccountId: r.bkashAccountId,
    nagadAccountId: r.nagadAccountId,
    terminalId: r.terminalId ?? null,
    active: r.active,
    lastSeqNo: r.lastSeqNo,
    lastSeenAt: dtOpt(r.lastSeenAt),
    createdAt: dt(r.createdAt),
  }
}

export function toPosRegister(r: typeof posRegistersTable.$inferSelect): PosRegister {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    branchId: r.branchId,
    branchName: r.branchName,
    cashAccountId: r.cashAccountId,
    cardAccountId: r.cardAccountId,
    bkashAccountId: r.bkashAccountId,
    nagadAccountId: r.nagadAccountId,
    ...(r.terminalId ? { terminalId: r.terminalId } : {}),
    active: r.active,
    lastSeqNo: r.lastSeqNo,
    ...(r.lastSeenAt ? { lastSeenAt: toIso(r.lastSeenAt) } : {}),
    createdAt: toIso(r.createdAt),
  }
}

export function posShiftValues(s: PosShift, ord = 0) {
  return {
    id: s.id,
    ord,
    no: s.no,
    registerId: s.registerId,
    registerCode: s.registerCode,
    registerName: s.registerName,
    branchId: s.branchId,
    branchName: s.branchName,
    cashAccountId: s.cashAccountId,
    date: s.date,
    status: s.status,
    openingFloat: s.openingFloat,
    openedAt: dt(s.openedAt),
    openedBy: s.openedBy,
    closedAt: dtOpt(s.closedAt),
    closedBy: s.closedBy ?? null,
    zNo: s.zNo ?? null,
    expectedCash: s.expectedCash ?? null,
    countedCash: s.countedCash ?? null,
    variance: s.variance ?? null,
    note: s.note ?? null,
    history: s.history ?? [],
  }
}

export function toPosShift(r: typeof posShiftsTable.$inferSelect): PosShift {
  return {
    id: r.id,
    no: r.no,
    registerId: r.registerId,
    registerCode: r.registerCode,
    registerName: r.registerName,
    branchId: r.branchId,
    branchName: r.branchName,
    cashAccountId: r.cashAccountId,
    date: r.date,
    status: r.status as PosShift["status"],
    openingFloat: num(r.openingFloat),
    openedAt: toIso(r.openedAt),
    openedBy: r.openedBy,
    ...(r.closedAt ? { closedAt: toIso(r.closedAt) } : {}),
    ...(r.closedBy ? { closedBy: r.closedBy } : {}),
    ...(r.zNo ? { zNo: r.zNo } : {}),
    ...(r.expectedCash != null ? { expectedCash: num(r.expectedCash) } : {}),
    ...(r.countedCash != null ? { countedCash: num(r.countedCash) } : {}),
    ...(r.variance != null ? { variance: num(r.variance) } : {}),
    ...(r.note ? { note: r.note } : {}),
    history: (r.history as PosShift["history"]) ?? [],
  }
}

export function posSaleValues(s: PosSale, ord = 0) {
  return {
    id: s.id,
    ord,
    invoiceNo: s.invoiceNo,
    challanNo: s.challanNo,
    issueDate: s.issueDate,
    issueTime: s.issueTime,
    process: s.process,
    registerId: s.registerId,
    registerCode: s.registerCode,
    registerName: s.registerName,
    shiftId: s.shiftId,
    shiftNo: s.shiftNo,
    branchId: s.branchId,
    branchName: s.branchName,
    customerId: s.customerId,
    customerName: s.customerName,
    customerBin: s.customerBin,
    customerMobile: s.customerMobile ?? null,
    customerAddress: s.customerAddress,
    lines: s.lines,
    subtotal: s.subtotal,
    sd: s.sd,
    vat: s.vat,
    discount: s.discount,
    netTotal: s.netTotal,
    tenders: s.tenders,
    tenderedTotal: s.tenderedTotal,
    changeGiven: s.changeGiven,
    idempotencyKey: s.idempotencyKey ?? null,
    seqNo: s.seqNo ?? null,
    source: s.source,
    nbrAdapter: s.nbrAdapter,
    issuedBy: s.issuedBy,
    designation: s.designation,
    note: s.note ?? null,
    cancelReason: s.cancelReason ?? null,
    createdAt: dt(s.createdAt),
    updatedAt: dtOpt(s.updatedAt),
    history: s.history ?? [],
  }
}

export function toPosSale(r: typeof posSalesTable.$inferSelect): PosSale {
  return {
    id: r.id,
    invoiceNo: r.invoiceNo,
    challanNo: r.challanNo,
    issueDate: r.issueDate,
    issueTime: r.issueTime,
    process: r.process as PosSale["process"],
    registerId: r.registerId,
    registerCode: r.registerCode,
    registerName: r.registerName,
    shiftId: r.shiftId,
    shiftNo: r.shiftNo,
    branchId: r.branchId,
    branchName: r.branchName,
    customerId: r.customerId,
    customerName: r.customerName,
    customerBin: r.customerBin,
    ...(r.customerMobile ? { customerMobile: r.customerMobile } : {}),
    customerAddress: r.customerAddress,
    lines: (r.lines as Line[]) ?? [],
    subtotal: num(r.subtotal),
    sd: num(r.sd),
    vat: num(r.vat),
    discount: num(r.discount),
    netTotal: num(r.netTotal),
    tenders: (r.tenders as PosTender[]) ?? [],
    tenderedTotal: num(r.tenderedTotal),
    changeGiven: num(r.changeGiven),
    ...(r.idempotencyKey ? { idempotencyKey: r.idempotencyKey } : {}),
    ...(r.seqNo != null ? { seqNo: r.seqNo } : {}),
    source: r.source as PosSale["source"],
    nbrAdapter: r.nbrAdapter as NbrEInvoiceAdapter,
    issuedBy: r.issuedBy,
    designation: r.designation,
    ...(r.note ? { note: r.note } : {}),
    ...(r.cancelReason ? { cancelReason: r.cancelReason } : {}),
    createdAt: toIso(r.createdAt),
    ...(r.updatedAt ? { updatedAt: toIso(r.updatedAt) } : {}),
    history: (r.history as PosSale["history"]) ?? [],
  }
}

export function posSettlementValues(s: PosTerminalStatement, ord = 0) {
  return {
    id: s.id,
    ord,
    no: s.no,
    accountId: s.accountId,
    accountName: s.accountName,
    channel: s.channel,
    source: s.source,
    from: s.from,
    to: s.to,
    importedAt: dt(s.importedAt),
    importedBy: s.importedBy,
    lineCount: s.lineCount,
    grossTotal: s.totals.gross,
    feeTotal: s.totals.fee,
    netTotal: s.totals.net,
  }
}

export function toPosSettlement(r: typeof posSettlementsTable.$inferSelect): PosTerminalStatement {
  return {
    id: r.id,
    no: r.no,
    accountId: r.accountId,
    accountName: r.accountName,
    channel: r.channel as PosTerminalStatement["channel"],
    source: r.source,
    from: r.from,
    to: r.to,
    importedAt: toIso(r.importedAt),
    importedBy: r.importedBy,
    lineCount: r.lineCount,
    totals: {
      gross: num(r.grossTotal),
      fee: num(r.feeTotal),
      net: num(r.netTotal),
    },
  }
}

export function posSettlementLineValues(l: PosTerminalLine) {
  return {
    id: l.id,
    statementId: l.statementId,
    rowNo: l.rowNo,
    date: l.date,
    channel: l.channel,
    reference: l.reference,
    narration: l.narration,
    gross: l.gross,
    fee: l.fee,
    net: l.net,
    status: l.status,
    saleId: l.saleId ?? null,
    invoiceNo: l.invoiceNo ?? null,
    tenderMethod: l.tenderMethod ?? null,
    expectedFee: l.expectedFee ?? null,
    note: l.note ?? null,
    suggestion: l.suggestion ?? null,
  }
}

export function toPosSettlementLine(r: typeof posSettlementLinesTable.$inferSelect): PosTerminalLine {
  return {
    id: r.id,
    statementId: r.statementId,
    rowNo: r.rowNo,
    date: r.date,
    channel: r.channel as PosTerminalLine["channel"],
    reference: r.reference,
    narration: r.narration,
    gross: num(r.gross),
    fee: num(r.fee),
    net: num(r.net),
    status: r.status as PosTerminalLine["status"],
    ...(r.saleId ? { saleId: r.saleId } : {}),
    ...(r.invoiceNo ? { invoiceNo: r.invoiceNo } : {}),
    ...(r.tenderMethod ? { tenderMethod: r.tenderMethod as PosTerminalLine["tenderMethod"] } : {}),
    ...(r.expectedFee != null ? { expectedFee: num(r.expectedFee) } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(r.suggestion ? { suggestion: r.suggestion as PosTerminalLine["suggestion"] } : {}),
  }
}

export function posTokenValues(t: PosApiToken, ord = 0) {
  return {
    id: t.id,
    ord,
    name: t.name,
    registerId: t.registerId,
    registerCode: t.registerCode,
    prefix: t.prefix,
    tokenHash: t.tokenHash,
    scopes: t.scopes,
    active: t.active,
    createdAt: dt(t.createdAt),
    createdBy: t.createdBy,
    lastUsedAt: dtOpt(t.lastUsedAt),
    revokedAt: dtOpt(t.revokedAt),
  }
}

export function toPosToken(r: typeof posTokensTable.$inferSelect): PosApiToken {
  return {
    id: r.id,
    name: r.name,
    registerId: r.registerId,
    registerCode: r.registerCode,
    prefix: r.prefix,
    tokenHash: r.tokenHash,
    scopes: (r.scopes as PosScope[]) ?? [],
    active: r.active,
    createdAt: toIso(r.createdAt),
    createdBy: r.createdBy,
    ...(r.lastUsedAt ? { lastUsedAt: toIso(r.lastUsedAt) } : {}),
    ...(r.revokedAt ? { revokedAt: toIso(r.revokedAt) } : {}),
  }
}

export function posWebhookValues(w: PosWebhook, ord = 0) {
  return {
    id: w.id,
    ord,
    name: w.name,
    url: w.url,
    events: w.events,
    secret: w.secret,
    active: w.active,
    createdAt: dt(w.createdAt),
    createdBy: w.createdBy,
    lastDeliveryAt: dtOpt(w.lastDeliveryAt),
    lastStatus: w.lastStatus ?? null,
  }
}

export function toPosWebhook(r: typeof posWebhooksTable.$inferSelect): PosWebhook {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    events: (r.events as PosWebhookEvent[]) ?? [],
    secret: r.secret,
    active: r.active,
    createdAt: toIso(r.createdAt),
    createdBy: r.createdBy,
    ...(r.lastDeliveryAt ? { lastDeliveryAt: toIso(r.lastDeliveryAt) } : {}),
    ...(r.lastStatus ? { lastStatus: r.lastStatus as PosWebhook["lastStatus"] } : {}),
  }
}

export function posWebhookDeliveryValues(d: PosWebhookDelivery, ord = 0) {
  return {
    id: d.id,
    ord,
    webhookId: d.webhookId,
    webhookName: d.webhookName,
    event: d.event,
    ref: d.ref,
    payload: d.payload,
    signature: d.signature,
    status: d.status,
    deliveredAt: dt(d.deliveredAt),
  }
}

export function toPosWebhookDelivery(r: typeof posWebhookDeliveriesTable.$inferSelect): PosWebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhookId,
    webhookName: r.webhookName,
    event: r.event as PosWebhookEvent,
    ref: r.ref,
    payload: (r.payload as Record<string, unknown>) ?? {},
    signature: r.signature,
    status: r.status as PosWebhookDelivery["status"],
    deliveredAt: toIso(r.deliveredAt),
  }
}

export const posDeliveryValues = posWebhookDeliveryValues
export const toPosDelivery = toPosWebhookDelivery

export function posQueueValues(q: PosQueueEntry, ord = 0) {
  return {
    id: q.id,
    ord,
    registerId: q.registerId,
    registerCode: q.registerCode,
    seqNo: q.seqNo,
    idempotencyKey: q.idempotencyKey,
    saleId: q.saleId,
    invoiceNo: q.invoiceNo,
    netTotal: q.netTotal,
    clientCreatedAt: dt(q.clientCreatedAt),
    syncedAt: dt(q.syncedAt),
    status: q.status,
  }
}

export function toPosQueue(r: typeof posQueueTable.$inferSelect): PosQueueEntry {
  return {
    id: r.id,
    registerId: r.registerId,
    registerCode: r.registerCode,
    seqNo: r.seqNo,
    idempotencyKey: r.idempotencyKey,
    saleId: r.saleId,
    invoiceNo: r.invoiceNo,
    netTotal: num(r.netTotal),
    clientCreatedAt: toIso(r.clientCreatedAt),
    syncedAt: toIso(r.syncedAt),
    status: r.status as PosQueueEntry["status"],
  }
}

/* ── Service ──────────────────────────────────────────────────────────────── */

function rethrowPosError(e: unknown): never {
  if (e instanceof compat().PosRuleError) {
    const pe = e as { status: number; title: string; errors?: Record<string, string[]> }
    throw new Problem(pe.status, pe.title, pe.errors)
  }
  throw e
}

@Injectable()
export class PosService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private async persistDeliveries(tx: Tx, deliveries: PosWebhookDelivery[]) {
    for (const d of deliveries) {
      await tx.insert(posWebhookDeliveriesTable).values(posWebhookDeliveryValues(d))
      const wh = mirror.posWebhooks().find((w) => w.id === d.webhookId)
      if (wh) {
        await tx
          .update(posWebhooksTable)
          .set({ lastDeliveryAt: dtOpt(wh.lastDeliveryAt), lastStatus: wh.lastStatus ?? null })
          .where(eq(posWebhooksTable.id, wh.id))
      }
    }
  }

  /** Authenticate either a scoped POS token (`Authorization: Bearer dzpos_...` / `X-POS-Token`) or a user session. */
  async resolveExternalOrSession(
    req: Request,
    scope: PosScope,
    perm: Permission | null,
  ): Promise<{ actor: User | string; name: string; role: Role; registerId?: string }> {
    const rawTok = compat().extractBearerOrPosToken(req.headers)
    if (rawTok) {
      try {
        const tok = compat().authenticatePosToken(mdb(), rawTok, scope)
        await db
          .update(posTokensTable)
          .set({ lastUsedAt: dtOpt(tok.lastUsedAt) })
          .where(eq(posTokensTable.id, tok.id))
        return {
          actor: `POS Token (${tok.name})`,
          name: `POS Token (${tok.name})`,
          role: "operator",
          registerId: tok.registerId,
        }
      } catch (e) {
        rethrowPosError(e)
      }
    }

    const s = await this.sessions.resolve(req)
    if (!s) throw new Problem(401, "Authentication required")
    if (perm && !ROLE_PERMS[s.user.role].includes(perm)) {
      throw new Problem(403, `Permission '${perm}' required`)
    }
    return {
      actor: s.user,
      name: s.user.name,
      role: s.user.role,
    }
  }

  async createSale(
    body: unknown,
    actor: { actor: User | string; name: string; role: Role; designation?: string },
    opts: { source?: PosSale["source"]; requireIdempotencyKey?: boolean; headerIdempotencyKey?: string },
  ) {
    try {
      const nextSaleSeq = await bumpSeq("posSale", 10)
      let delivSeq = seqMap().posDelivery ?? 10
      const res = compat().buildPosSale(
        mdb(),
        body,
        { name: actor.name, role: actor.role, designation: actor.designation ?? "POS Cashier" },
        {
          nextId: () => `ps${nextSaleSeq}`,
          nextDeliveryId: () => `pwd${++delivSeq}`,
          source: opts.source ?? "counter",
          requireIdempotencyKey: opts.requireIdempotencyKey,
          headerIdempotencyKey: opts.headerIdempotencyKey,
        },
      )
      seqMap().posDelivery = delivSeq
      if (!res.idempotentReplay) {
        await db.transaction(async (tx) => {
          await tx.insert(posSalesTable).values(posSaleValues(res.sale))
          const reg = mirror.posRegisters().find((r) => r.id === res.sale.registerId)
          if (reg) {
            await tx
              .update(posRegistersTable)
              .set({ lastSeenAt: dtOpt(reg.lastSeenAt) })
              .where(eq(posRegistersTable.id, reg.id))
          }
          await this.persistDeliveries(tx, res.deliveries)
        })
        await this.audit.record({
          actor: actor.actor,
          entity: "posSale",
          entityId: res.sale.id,
          ref: res.sale.invoiceNo,
          action: "created",
          note: `${res.sale.registerCode} · ৳${res.sale.netTotal}`,
        })
      }
      return res
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async cancelSale(id: string, body: unknown, actor: { actor: User | string; name: string; role: Role }) {
    try {
      let delivSeq = seqMap().posDelivery ?? 10
      const { sale, deliveries } = compat().cancelPosSale(
        mdb(),
        id,
        body,
        { name: actor.name, role: actor.role },
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      await db.transaction(async (tx) => {
        await tx.update(posSalesTable).set(posSaleValues(sale)).where(eq(posSalesTable.id, sale.id))
        await this.persistDeliveries(tx, deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posSale",
        entityId: sale.id,
        ref: sale.invoiceNo,
        action: "cancelled",
        note: sale.cancelReason,
      })
      return sale
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async openShift(body: unknown, actor: { actor: User | string; name: string; role: Role }) {
    try {
      const seq = await bumpSeq("posShift", 5)
      let delivSeq = seqMap().posDelivery ?? 10
      const { shift, deliveries } = compat().openPosShift(
        mdb(),
        body,
        { name: actor.name, role: actor.role },
        () => `sh${seq}`,
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      await db.transaction(async (tx) => {
        await tx.insert(posShiftsTable).values(posShiftValues(shift))
        await this.persistDeliveries(tx, deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posShift",
        entityId: shift.id,
        ref: shift.no,
        action: "created",
        note: `${shift.registerCode} · float ৳${shift.openingFloat}`,
      })
      return shift
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async closeShift(id: string, body: unknown, actor: { actor: User | string; name: string; role: Role }) {
    try {
      let delivSeq = seqMap().posDelivery ?? 10
      const { shift, report, deliveries } = compat().closePosShift(
        mdb(),
        id,
        body,
        { name: actor.name, role: actor.role },
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      await db.transaction(async (tx) => {
        await tx.update(posShiftsTable).set(posShiftValues(shift)).where(eq(posShiftsTable.id, shift.id))
        await this.persistDeliveries(tx, deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posShift",
        entityId: shift.id,
        ref: shift.zNo ?? shift.no,
        action: "closed",
        note: `Counted ৳${shift.countedCash} vs expected ৳${shift.expectedCash} (variance ৳${shift.variance})`,
      })
      return { shift, report }
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async importSettlement(body: unknown, actor: { actor: User | string; name: string }) {
    try {
      const seq = await bumpSeq("posSettlement", 5)
      let delivSeq = seqMap().posDelivery ?? 10
      const res = compat().importTerminalStatement(
        mdb(),
        body,
        { name: actor.name },
        () => `ts${seq}`,
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      if (res.dryRun) return res
      await db.transaction(async (tx) => {
        await tx.insert(posSettlementsTable).values(posSettlementValues(res.view.statement))
        if (res.storedLines.length) {
          await tx.insert(posSettlementLinesTable).values(res.storedLines.map(posSettlementLineValues))
        }
        await this.persistDeliveries(tx, res.deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posSettlement",
        entityId: res.view.statement.id,
        ref: res.view.statement.no,
        action: "created",
        note: `${res.view.statement.channel} · ${res.view.statement.lineCount} lines`,
      })
      return res
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async deleteSettlement(id: string, actor: { actor: User | string; name: string }) {
    try {
      const removed = compat().deleteTerminalStatement(mdb(), id)
      await db.transaction(async (tx) => {
        await tx.delete(posSettlementLinesTable).where(eq(posSettlementLinesTable.statementId, removed.id))
        await tx.delete(posSettlementsTable).where(eq(posSettlementsTable.id, removed.id))
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posSettlement",
        entityId: removed.id,
        ref: removed.no,
        action: "deleted",
      })
      return { ok: true, id: removed.id }
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async patchSettlementLine(id: string, lineId: string, body: unknown, actor: { actor: User | string; name: string }) {
    try {
      let delivSeq = seqMap().posDelivery ?? 10
      const { line, view, deliveries } = compat().patchTerminalLine(
        mdb(),
        id,
        lineId,
        body,
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      await db.transaction(async (tx) => {
        await tx
          .update(posSettlementLinesTable)
          .set(posSettlementLineValues(line))
          .where(eq(posSettlementLinesTable.id, line.id))
        await this.persistDeliveries(tx, deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posSettlement",
        entityId: view.statement.id,
        ref: view.statement.no,
        action: "updated",
        note: `Line #${line.rowNo} → ${line.status}`,
      })
      return view
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async matchSettlementLine(id: string, lineId: string, body: unknown, actor: { actor: User | string; name: string }) {
    try {
      let delivSeq = seqMap().posDelivery ?? 10
      const { line, view, deliveries } = compat().matchTerminalLineToSale(
        mdb(),
        id,
        lineId,
        body,
        () => `pwd${++delivSeq}`,
      )
      seqMap().posDelivery = delivSeq
      await db.transaction(async (tx) => {
        await tx
          .update(posSettlementLinesTable)
          .set(posSettlementLineValues(line))
          .where(eq(posSettlementLinesTable.id, line.id))
        await this.persistDeliveries(tx, deliveries)
      })
      await this.audit.record({
        actor: actor.actor,
        entity: "posSettlement",
        entityId: view.statement.id,
        ref: view.statement.no,
        action: "updated",
        note: `Line #${line.rowNo} matched to ${line.invoiceNo}`,
      })
      return view
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async createRegister(body: unknown, actor: { actor: User | string; name: string }) {
    try {
      const seq = await bumpSeq("posRegister", 5)
      const reg = compat().buildPosRegister(mdb(), body, () => `reg${seq}`)
      await db.insert(posRegistersTable).values(posRegisterValues(reg))
      await this.audit.record({
        actor: actor.actor,
        entity: "posRegister",
        entityId: reg.id,
        ref: `${reg.code} · ${reg.name}`,
        action: "created",
      })
      return reg
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async updateRegister(id: string, body: unknown, actor: { actor: User | string; name: string }) {
    try {
      const reg = compat().updatePosRegister(mdb(), id, body)
      await db.update(posRegistersTable).set(posRegisterValues(reg)).where(eq(posRegistersTable.id, reg.id))
      await this.audit.record({
        actor: actor.actor,
        entity: "posRegister",
        entityId: reg.id,
        ref: `${reg.code} · ${reg.name}`,
        action: "updated",
      })
      return reg
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async createToken(body: unknown, actor: { actor: User | string; name: string }) {
    try {
      const seq = await bumpSeq("posToken", 5)
      const { token, fullRow, secret } = compat().issuePosToken(
        mdb(),
        body,
        { name: actor.name },
        () => `ptk${seq}`,
      )
      await db.insert(posTokensTable).values(posTokenValues(fullRow))
      await this.audit.record({
        actor: actor.actor,
        entity: "posToken",
        entityId: token.id,
        ref: `${token.name} (${token.registerCode})`,
        action: "created",
        note: `Scopes: ${token.scopes.join(", ")}`,
      })
      return { token, secret }
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async revokeToken(id: string, actor: { actor: User | string; name: string }) {
    try {
      const token = compat().revokePosToken(mdb(), id)
      const fullRow = mirror.posTokens().find((t) => t.id === token.id)!
      await db.update(posTokensTable).set(posTokenValues(fullRow)).where(eq(posTokensTable.id, token.id))
      await this.audit.record({
        actor: actor.actor,
        entity: "posToken",
        entityId: token.id,
        ref: `${token.name} (${token.registerCode})`,
        action: "deactivated",
      })
      return token
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async syncQueue(body: unknown, actor: { actor: User | string; name: string; role: Role }) {
    try {
      let saleSeq = seqMap().posSale ?? 10
      let queueSeq = seqMap().posQueue ?? 10
      let delivSeq = seqMap().posDelivery ?? 10
      const res = compat().processPosQueueBatch(
        mdb(),
        body,
        { name: actor.name, role: actor.role },
        {
          nextSaleId: () => `ps${++saleSeq}`,
          nextQueueId: () => `pq${++queueSeq}`,
          nextDeliveryId: () => `pwd${++delivSeq}`,
        },
      )
      seqMap().posSale = saleSeq
      seqMap().posQueue = queueSeq
      seqMap().posDelivery = delivSeq

      if (res.newSales.length || res.newQueueEntries.length) {
        await db.transaction(async (tx) => {
          for (const s of res.newSales) {
            await tx.insert(posSalesTable).values(posSaleValues(s))
          }
          for (const q of res.newQueueEntries) {
            await tx.insert(posQueueTable).values(posQueueValues(q))
          }
          const reg = mirror.posRegisters().find((r) => r.id === res.registerId)
          if (reg) {
            await tx
              .update(posRegistersTable)
              .set({ lastSeqNo: reg.lastSeqNo, lastSeenAt: dtOpt(reg.lastSeenAt) })
              .where(eq(posRegistersTable.id, reg.id))
          }
          await this.persistDeliveries(tx, res.newDeliveries)
        })
        for (const s of res.newSales) {
          await this.audit.record({
            actor: actor.actor,
            entity: "posSale",
            entityId: s.id,
            ref: s.invoiceNo,
            action: "created",
            note: `Offline queue seq #${s.seqNo} (${s.registerCode})`,
          })
        }
      }
      return res
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async createWebhook(body: unknown, actor: { actor: User | string; name: string }) {
    try {
      const seq = await bumpSeq("posWebhook", 5)
      const wh = compat().buildPosWebhook(mdb(), body, { name: actor.name }, () => `pwh${seq}`)
      await db.insert(posWebhooksTable).values(posWebhookValues(wh))
      await this.audit.record({
        actor: actor.actor,
        entity: "posWebhook",
        entityId: wh.id,
        ref: wh.name,
        action: "created",
        note: wh.url,
      })
      return wh
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async deleteWebhook(id: string, actor: { actor: User | string; name: string }) {
    try {
      const wh = compat().deletePosWebhook(mdb(), id)
      await db.delete(posWebhooksTable).where(eq(posWebhooksTable.id, wh.id))
      await this.audit.record({
        actor: actor.actor,
        entity: "posWebhook",
        entityId: wh.id,
        ref: wh.name,
        action: "deleted",
      })
      return { ok: true, id: wh.id }
    } catch (e) {
      rethrowPosError(e)
    }
  }

  async testWebhook(id: string) {
    try {
      const seq = await bumpSeq("posDelivery", 10)
      const delivery = compat().testPosWebhook(mdb(), id, () => `pwd${seq}`)
      await db.transaction(async (tx) => {
        await this.persistDeliveries(tx, [delivery])
      })
      return delivery
    } catch (e) {
      rethrowPosError(e)
    }
  }
}

/* ── Controller ───────────────────────────────────────────────────────────── */

@Controller("api/v1/pos")
export class PosController {
  constructor(@Inject(PosService) private readonly svc: PosService) {}

  @Get("catalog")
  @Authed()
  catalog(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    res.json(
      compat().posCatalogView(mdb(), {
        registerId: url.searchParams.get("registerId") ?? undefined,
        branchId: url.searchParams.get("branchId") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      }),
    )
  }

  @Get("sales")
  @Authed()
  listSales(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    const { rows, page } = compat().posSalesPage(mdb(), url)
    if (url.searchParams.get("format") === "csv") {
      return sendCsv(res, toCSV(rows, compat().POS_SALE_CSV_COLUMNS), "pos-sales.csv")
    }
    res.json(page)
  }

  @Post("sales")
  @Authed("doc.create")
  async createSale(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const { sale, idempotentReplay } = await this.svc.createSale(
      jsonBody(req),
      { actor: user, name: user.name, role: user.role, designation: "POS Cashier" },
      {
        source: "counter",
        headerIdempotencyKey: req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : undefined,
      },
    )
    res.status(idempotentReplay ? 200 : 201).json({ ...sale, idempotentReplay })
  }

  @Get("sales/:id")
  @Authed()
  getSale(@Param("id") id: string, @Res() res: Response) {
    try {
      res.json(compat().posSaleDetail(mdb(), id))
    } catch (e) {
      rethrowPosError(e)
    }
  }

  @Patch("sales/:id")
  @Authed("doc.cancel")
  async patchSale(@Param("id") id: string, @Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const sale = await this.svc.cancelSale(id, jsonBody(req), {
      actor: user,
      name: user.name,
      role: user.role,
    })
    res.json(sale)
  }

  @Get("sales/:id/ebill")
  @Authed()
  getSaleEbill(@Param("id") id: string, @Res() res: Response) {
    try {
      res.json(compat().posSaleEbill(mdb(), id))
    } catch (e) {
      rethrowPosError(e)
    }
  }

  @Get("shifts")
  @Authed()
  listShifts(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    const { rows, page } = compat().posShiftsPage(mdb(), url)
    if (url.searchParams.get("format") === "csv") {
      return sendCsv(res, toCSV(rows, compat().POS_SHIFT_CSV_COLUMNS), "pos-shifts.csv")
    }
    res.json(page)
  }

  @Post("shifts")
  @Authed("doc.create")
  async openShift(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const shift = await this.svc.openShift(jsonBody(req), {
      actor: user,
      name: user.name,
      role: user.role,
    })
    res.status(201).json(shift)
  }

  @Get("shifts/:id")
  @Authed()
  getShift(@Param("id") id: string, @Res() res: Response) {
    try {
      res.json(compat().posShiftDetail(mdb(), id))
    } catch (e) {
      rethrowPosError(e)
    }
  }

  @Get("shifts/:id/report")
  @Authed()
  getShiftReport(@Param("id") id: string, @Res() res: Response) {
    try {
      res.json(compat().posShiftDetail(mdb(), id).report)
    } catch (e) {
      rethrowPosError(e)
    }
  }

  @Post("shifts/:id/close")
  @Authed("doc.create")
  async closeShift(@Param("id") id: string, @Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.closeShift(id, jsonBody(req), {
      actor: user,
      name: user.name,
      role: user.role,
    })
    res.json(out)
  }

  @Get("settlements")
  @Authed()
  listSettlements(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    const { rows, page } = compat().terminalStatementsPage(mdb(), url)
    if (url.searchParams.get("format") === "csv") {
      return sendCsv(res, toCSV(rows, compat().POS_SETTLEMENT_CSV_COLUMNS), "pos-settlements.csv")
    }
    res.json(page)
  }

  @Post("settlements")
  @Authed("doc.create")
  async createSettlement(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.importSettlement(jsonBody(req), {
      actor: user,
      name: user.name,
    })
    if (out.dryRun) return res.status(200).json(out.plan)
    res.status(201).json(out.view)
  }

  @Post("settlements/import")
  @Authed("doc.create")
  async importSettlement(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.importSettlement(jsonBody(req), {
      actor: user,
      name: user.name,
    })
    if (out.dryRun) return res.status(200).json(out.plan)
    res.status(201).json(out.view)
  }

  @Get("settlements/:id")
  @Authed()
  getSettlement(@Param("id") id: string, @Res() res: Response) {
    const st = mirror.posSettlements().find((s) => s.id === id || s.no === id)
    if (!st) throw new Problem(404, "Terminal statement not found")
    res.json(compat().terminalStatementView(mdb(), st))
  }

  @Delete("settlements/:id")
  @Authed("doc.delete")
  async deleteSettlement(@Param("id") id: string, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.deleteSettlement(id, {
      actor: user,
      name: user.name,
    })
    res.json(out)
  }

  @Patch("settlements/lines/:lineId")
  @Authed("doc.edit")
  async patchSettlementLineDirect(
    @Param("lineId") lineId: string,
    @Req() req: AuthedRequest,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const view = await this.svc.patchSettlementLine("", lineId, jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.json(view)
  }

  @Post("settlements/lines/:lineId/match")
  @Authed("doc.edit")
  async matchSettlementLineDirect(
    @Param("lineId") lineId: string,
    @Req() req: AuthedRequest,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const view = await this.svc.matchSettlementLine("", lineId, jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.json(view)
  }

  @Patch("settlements/:id/lines/:lineId")
  @Authed("doc.edit")
  async patchSettlementLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Req() req: AuthedRequest,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const view = await this.svc.patchSettlementLine(id, lineId, jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.json(view)
  }

  @Post("settlements/:id/lines/:lineId/match")
  @Authed("doc.edit")
  async matchSettlementLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Req() req: AuthedRequest,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const view = await this.svc.matchSettlementLine(id, lineId, jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.json(view)
  }

  @Get("registers")
  @Authed()
  listRegisters(@Res() res: Response) {
    res.json(compat().posRegistersList(mdb()))
  }

  @Post("registers")
  @Authed("settings.manage")
  async createRegister(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const reg = await this.svc.createRegister(jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.status(201).json(reg)
  }

  @Put("registers/:id")
  @Authed("settings.manage")
  async updateRegister(@Param("id") id: string, @Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const reg = await this.svc.updateRegister(id, jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.json(reg)
  }

  @Get("tokens")
  @Authed()
  listTokens(@Res() res: Response) {
    res.json(compat().posTokensList(mdb()))
  }

  @Post("tokens")
  @Authed("settings.manage")
  async createToken(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.createToken(jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.status(201).json(out)
  }

  @Delete("tokens/:id")
  @Authed("settings.manage")
  async revokeToken(@Param("id") id: string, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.revokeToken(id, {
      actor: user,
      name: user.name,
    })
    res.json(out)
  }

  /* ── External POS API (supports Scoped Bearer Token OR Session Cookie) ──── */

  @Get("external/catalog")
  async externalCatalog(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.svc.resolveExternalOrSession(req, "pos:catalog.read", null)
    const url = reqUrl(req)
    res.json(
      compat().posCatalogView(mdb(), {
        registerId: url.searchParams.get("registerId") ?? ctx.registerId,
        branchId: url.searchParams.get("branchId") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
      }),
    )
  }

  @Get("external/stock/:sku")
  async externalStock(@Param("sku") sku: string, @Req() req: Request, @Res() res: Response) {
    const ctx = await this.svc.resolveExternalOrSession(req, "pos:stock.read", null)
    const url = reqUrl(req)
    try {
      res.json(compat().posStockLookup(mdb(), decodeURIComponent(sku), url.searchParams.get("registerId") ?? ctx.registerId))
    } catch (e) {
      rethrowPosError(e)
    }
  }

  @Post("external/sales")
  async externalSale(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.svc.resolveExternalOrSession(req, "pos:sales.write", "doc.create")
    const body = jsonBody(req) as Record<string, unknown> | null
    const merged = body && ctx.registerId && !body.registerId ? { ...body, registerId: ctx.registerId } : body
    const { sale, idempotentReplay } = await this.svc.createSale(
      merged,
      { actor: ctx.actor, name: ctx.name, role: ctx.role, designation: "External POS API" },
      {
        source: "external",
        requireIdempotencyKey: true,
        headerIdempotencyKey: req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : undefined,
      },
    )
    res.status(idempotentReplay ? 200 : 201).json({ ...sale, sale, replayed: idempotentReplay, idempotentReplay })
  }

  @Get("queue")
  @Authed()
  getQueue(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    res.json(compat().posQueueView(mdb(), url.searchParams.get("registerId") ?? undefined))
  }

  @Post("external/queue")
  async syncQueueRoot(@Req() req: Request, @Res() res: Response) {
    return this.syncQueue(req, res)
  }

  @Post("external/queue/sync")
  async syncQueue(@Req() req: Request, @Res() res: Response) {
    const ctx = await this.svc.resolveExternalOrSession(req, "pos:queue.sync", "doc.create")
    const body = jsonBody(req) as Record<string, unknown> | null
    const merged = body && ctx.registerId && !body.registerId ? { ...body, registerId: ctx.registerId } : body
    const out = await this.svc.syncQueue(merged, ctx)
    res.status(out.processed > 0 ? 201 : 200).json({
      registerId: out.registerId,
      registerCode: out.registerCode,
      lastSeqNo: out.lastSeqNo,
      processed: out.processed,
      replayed: out.replayed,
      appliedCount: out.processed,
      replayedCount: out.replayed,
      results: out.results,
    })
  }

  @Get("webhooks")
  @Authed()
  listWebhooks(@Res() res: Response) {
    res.json(compat().posWebhooksView(mdb()))
  }

  @Post("webhooks")
  @Authed("settings.manage")
  async createWebhook(@Req() req: AuthedRequest, @CurrentUser() user: User, @Res() res: Response) {
    const wh = await this.svc.createWebhook(jsonBody(req), {
      actor: user,
      name: user.name,
    })
    res.status(201).json(wh)
  }

  @Delete("webhooks/:id")
  @Authed("settings.manage")
  async deleteWebhook(@Param("id") id: string, @CurrentUser() user: User, @Res() res: Response) {
    const out = await this.svc.deleteWebhook(id, {
      actor: user,
      name: user.name,
    })
    res.json(out)
  }

  @Post("webhooks/:id/test")
  @Authed("settings.manage")
  async testWebhook(@Param("id") id: string, @Res() res: Response) {
    const out = await this.svc.testWebhook(id)
    res.status(201).json(out)
  }

  @Get("labels")
  @Authed()
  getLabels(@Req() req: Request, @Res() res: Response) {
    const url = reqUrl(req)
    const fmt = (url.searchParams.get("format") ?? "38x25") as PosLabelFormat
    const validFmt: PosLabelFormat = fmt === "50x30" || fmt === "a4-24" ? fmt : "38x25"
    res.json(compat().posLabelsView(mdb(), validFmt))
  }

  @Post("labels")
  @Authed()
  createLabels(@Req() req: Request, @Res() res: Response) {
    try {
      const parsed = compat().posLabelInput.safeParse(jsonBody(req))
      if (!parsed.success) {
        throw new Problem(422, "Validation failed", compat().zodErrors(parsed.error))
      }
      const specs = parsed.data.specs ?? parsed.data.items
      if (!specs || specs.length === 0) {
        throw new Problem(422, "Validation failed", { specs: ["atLeastOneLine"] })
      }
      for (const sp of specs) {
        if (!mirror.items().some((it) => it.id === sp.itemId || it.sku === sp.itemId)) {
          throw new Problem(422, "Validation failed", { specs: ["unknownItem"] })
        }
      }
      res.json(compat().posLabelsView(mdb(), parsed.data.format, specs))
    } catch (e) {
      rethrowPosError(e)
    }
  }
}
