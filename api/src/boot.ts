/**
 * Boot: first start seeds PostgreSQL from the demo data set (the same one the mock and the Pages demo use);
 * later starts restore everything from PostgreSQL before the compat bundle initialises.
 */
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { gzip } from "node:zlib"
import { asc, eq, sql } from "drizzle-orm"
import { BACKUP_FORMAT, lastSlot } from "@/lib/backup-schedule"
import type { Preferences, User } from "@/lib/auth/roles"
import type {
  AccountingConfig, AuditEvent, Batch, Bom, CreditNote, Damage, DebitNote, Item, LateFiling, MasterItem, MoneyAccount, MoneyDoc, OpeningEntry, Party, PrcBatch, ProductionConfig, Purchase, ReturnAmendment, Sale, DrawbackClaim,
  BondUd, StockDoc, Transfer, TreasuryDeposit, UdRecord, Unit, VatAdjustment, VatReturn, VatSettings, VdsEntry, WorkOrder
} from "@/lib/types"
import { hashPassword } from "./common/password"
import { db } from "./db/client"
import { auditEvents, backups, batchConsumption, batchLines, batches, bomCosts, bomInputs, boms, bondUdGarments, bondUdInputs, bondUds, compatState, items, lateFilings, returnAmendments, masterItems, meta, noteLines, notes, openingEntries, parties, prcBatches, productionConfig, purchaseLines, purchases, drawbackClaims, deliveryLog, deliverySchedules, reminderSettings, reminders, saleLines, saleRealisations, sales, stockDocumentLines, stockDocuments, tariffLines, units, users, workOrderLines, workOrders, accountingConfig, moneyAccounts, moneyAllocations, moneyDocs, treasuryDeposits, udLines, uds, vatAdjustments, vatReturns, vatSettings, vdsEntries } from "./db/schema"
import { snapshot } from "./modules/backups"
import { chainValues, markPersisted, rawToEvent, sealUnchained } from "./modules/audit"
import { GENESIS_HASH } from "@/lib/integrity"
import { toUser } from "./modules/identity"
import { itemValues, markItems, markMasters, masterValues, toItem, toMaster } from "./modules/items"
import { assembleBatches, batchLineValues, batchValues, consumptionValues, markBatches } from "./modules/batches"
import { assembleNotes, markCreditNotes, markDebitNotes, noteLineValues, noteValues, type Note, type NoteKind } from "./modules/notes"
import { markOpenings, openingValues, toOpening } from "./modules/openings"
import { markParties, partyValues, toParty } from "./modules/parties"
import { assembleBoms, bomCostValues, bomInputValues, bomValues, configValues, DEFAULT_CONFIG, markBoms, markConfig, toConfig } from "./modules/production"
import { assemblePurchases, markPurchases, purchaseLineValues, purchaseValues } from "./modules/purchases"
import { assembleSales, markSales, realisationValues, saleLineValues, saleValues } from "./modules/sales"
import { assembleStockDocs, markStockDocs, stockDocValues, stockLineValues } from "./modules/stock"
import { assembleWorkOrders, markWorkOrders, refreshWorkOrderRows, workOrderLineValues, workOrderValues } from "./modules/workorders"
import {
  accountingConfigValues, applyAccountingDeltas, assembleMoneyDocs, markAccountingConfig, markMoneyAccounts, markMoneyDocs, moneyAccountValues, moneyAllocationValues, moneyDocValues,
  toAccountingConfig, toMoneyAccount,
} from "./modules/accounting"
import {
  adjustmentValues, applyVatDocDeltas, markAdjustments, markTreasury, markVds, toAdjustment, toTreasury, toVds,
  treasuryValues, vdsValues,
} from "./modules/vat"
import {
  markReturns, markVatSettings, toReturn, toVatSettings, returnValues, vatSettingsValues,
} from "./modules/returns"
import { assembleUds, markUds, udLineRows, udValues } from "./modules/uds"
import { assembleBondUds, bondUdGarmentRows, bondUdInputRows, bondUdValues, markBondUds } from "./modules/bonduds"
import { amendmentValues, lateFilingValues, markLateFilings, markReturnAmendments, toAmendment, toLateFiling } from "./modules/returnapps"
import { markPrcBatches, prcBatchValues, toPrcBatch } from "./modules/proceeds"
import { claimValues, markClaims, toClaim } from "./modules/claims"
import { deliveryLogValues, reminderValues, scheduleValues, toDeliveryLog, toDeliverySchedule, toFiredReminder } from "./modules/schedule"
import { DEFAULT_REMINDER_SETTINGS, seedDeliverySchedules } from "@/lib/mock/seed-r83"
import { loadCompany, saveCompany } from "./modules/reference"
import { G, loadCompat, mirror, restoreGlobals, type TrashEntry } from "./state"
import { lockState, setEpoch } from "./common/state-guard"

export const SEED_VERSION = "r6.6"

/**
 * Demo instances re-seed when the code ships a newer demo data set (SEED_VERSION differs from the stored one) —
 * after taking a backup of everything, so the old data can still be downloaded from Settings → Backups.
 * Customer installations set DEMO_RESEED=off and keep their data across upgrades.
 */
const demoReseed = () => (process.env.DEMO_RESEED ?? "on") !== "off"

export async function bootState(log: (m: string) => void) {
  // the finale drops compat_state once its snapshot is drained; a database written before the finale still
  // carries one (a skipped-release upgrade may even carry document arrays, which the adoption legs below read)
  const compatTable = (await db.execute(sql`select to_regclass('public.compat_state') as t`)).rows[0]?.t as string | null
  const [state] = compatTable
    ? await db.select().from(compatState).where(eq(compatState.key, "main"))
    : [undefined]
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  if (state && n) {
    await sealUnchained(log) // R6: upgrade — chain the events written by R5.1
    const [v] = await db.select().from(meta).where(eq(meta.key, "seed_version"))
    if (v?.value !== SEED_VERSION && demoReseed()) {
      log(`demo data set ${v?.value ?? "?"} → ${SEED_VERSION}: backing up, then re-seeding (DEMO_RESEED=off keeps the data)`)
      await backupBeforeReseed(v?.value ?? "?", log)
      return seed(log)
    }
    return restore(state.data as { db: Record<string, unknown>; notifRead: Record<string, { ids: string[] }> }, log)
  }
  // the finale: everything comes back from the tables — an empty `seq` (the counters re-derive from the rows)
  // and an empty `trash` (the undo buffer has been empty since the last mock route went native)
  if (n) return restore({ db: { seq: {}, trash: [] }, notifRead: {} }, log)
  return seed(log)
}

async function seed(log: (m: string) => void) {
  const t0 = Date.now()
  const m = loadCompat() // fresh globals: demo users, company, documents, audit history
  const demoHash = await Promise.all(m.userStore.users.map(() => hashPassword(m.DEMO_PASSWORD)))
  const events = m.auditStore.events
  // R5.2: the master data goes into its own tables (`ord` keeps each collection's insertion order)
  const demoParties = [...m.db.customers, ...m.db.vendors].map((x) => partyValues(x))
  const demoItems = m.db.items.map(itemValues)
  const demoMasters = m.db.masterItems.map(masterValues)
  // R5.3: the documents — stock transfers and damage entries, the sales invoices and the purchases, each with its
  // lines. A draft the demo data set has in the undo buffer is seeded as a stamped row, so its number stays retired.
  const demoStock: StockDoc[] = [...m.db.transfers, ...m.db.damages]
  const demoStockLines = demoStock.flatMap(stockLineValues)
  const demoSaleTrash = m.db.trash.filter((t) => t.kind === "sale")
  const demoSales: Sale[] = [...m.db.sales, ...demoSaleTrash.map((t) => t.doc as Sale)]
  const demoSaleRows = [
    ...m.db.sales.map((x) => saleValues(x)),
    ...demoSaleTrash.map((t) => ({ ...saleValues(t.doc as Sale), deletedAt: new Date(t.at) })),
  ]
  const demoSaleLines = demoSales.flatMap(saleLineValues)
  const demoSaleReals = demoSales.flatMap(realisationValues)
  const demoPurchaseTrash = m.db.trash.filter((t) => t.kind === "purchase")
  const demoPurchases: Purchase[] = [...m.db.purchases, ...demoPurchaseTrash.map((t) => t.doc as Purchase)]
  const demoPurchaseRows = [
    ...m.db.purchases.map((x) => purchaseValues(x)),
    ...demoPurchaseTrash.map((t) => ({ ...purchaseValues(t.doc as Purchase), deletedAt: new Date(t.at) })),
  ]
  const demoPurchaseLines = demoPurchases.flatMap(purchaseLineValues)
  // the two note families share one table: a deleted draft the demo data set has is seeded as a stamped row, so its
  // id and its number stay retired
  const demoNotes: Note[] = [...m.db.creditNotes, ...m.db.debitNotes]
  const demoNoteRows = demoNotes.map((x) => noteValues(x))
  const demoNoteLines = demoNotes.flatMap(noteLineValues)
  // R5.4: the opening stock entries — a deleted draft is seeded as a stamped row, so its id and number stay retired
  const demoOpenings: OpeningEntry[] = m.db.openings
  const demoOpeningRows = demoOpenings.map(openingValues)
  // R5.4: the production batches, each with the finished goods it produced and the inputs it consumed
  const demoBatches: Batch[] = m.db.batches
  const demoBatchRows = demoBatches.map(batchValues)
  const demoBatchLineRows = demoBatches.flatMap(batchLineValues)
  const demoBatchUseRows = demoBatches.flatMap(consumptionValues)
  // R5.5: the price declarations (Mushak 4.3), each with its inputs and its cost heads, and the configuration that
  // says how a batch is produced and what it consumes
  const demoBoms: Bom[] = m.db.boms
  const demoBomRows = demoBoms.map(bomValues)
  const demoBomInputRows = demoBoms.flatMap(bomInputValues)
  const demoBomCostRows = demoBoms.flatMap(bomCostValues)
  // R5.5: the work orders, each with the finished goods it asks for — the progress the demo batches have made on
  // them is recomputed below, exactly as the register recomputes it before it answers
  const demoWorkOrders: WorkOrder[] = m.db.workOrders
  const demoWorkOrderRows = demoWorkOrders.map(workOrderValues)
  const demoWorkOrderLineRows = demoWorkOrders.flatMap(workOrderLineValues)
  // R5.6: the accounting — the money accounts, the receipts and the payments with the invoices they settle, and the
  // configuration that closes the books
  const demoAccounts: MoneyAccount[] = m.db.moneyAccounts
  const demoMoney: MoneyDoc[] = m.db.moneyDocs
  // R5.6: the NBR VAT documents — the treasury deposits, the VDS certificates and the manual VAT adjustments
  const demoDeposits: TreasuryDeposit[] = m.db.treasury
  const demoCertificates: VdsEntry[] = m.db.vds
  const demoAdjustments: VatAdjustment[] = m.db.adjustments
  // R6.2: the exporters' Utilization Declarations
  const demoUds: UdRecord[] = m.db.uds
  // R6.5: our own UDs / UP with their bond settlements
  const demoBondUds: BondUd[] = m.db.bondUds
  // R6.6: the Mushak 9.3 late-filing and 9.4 amendment applications, and the bank-file PRC batches
  const demoLateFilings: LateFiling[] = m.db.lateFilings
  const demoReturnAmendments: ReturnAmendment[] = m.db.returnAmendments
  const demoPrcBatches: PrcBatch[] = m.db.prcBatches
  // R6.5: the duty-drawback claims (DEDO, Mushak-22)
  const demoDrawbackClaims: DrawbackClaim[] = m.db.drawbackClaims
  // R5.6: the Mushak 9.1 returns — one row per tax period, the period being its id — and the NBR settings row
  const demoReturns: VatReturn[] = m.db.returns
  const demoVatSettings: VatSettings = m.db.vatSettings
  const seededAt = new Date().toISOString()
  await db.transaction(async (tx) => {
    await lockState(tx, { checkEpoch: false }) // waits for any other instance's in-flight write (deploy overlap)
    // the append-only guard on audit_events lets this transaction (and only it) clear the table
    await tx.execute(sql`set local dizivat.reseed = 'on'`)
    for (const t of ["sessions", "saved_views", "login_failures", "users", "branches", "company", "units", "parties", "items", "master_items", "stock_documents", "stock_document_lines", "sales", "sale_lines", "sale_realisations", "purchases", "purchase_lines", "notes", "note_lines", "opening_entries", "batches", "batch_lines", "batch_consumption", "boms", "bom_inputs", "bom_costs", "production_config", "work_orders", "work_order_lines",
      "money_accounts", "money_docs", "money_allocations", "accounting_config", "treasury_deposits", "vds_entries", "vat_adjustments", "tariff_lines",
      "bank_statements", "bank_statement_lines",
      "uds", "ud_lines",
      "bond_uds", "bond_ud_inputs", "bond_ud_garments",
      "audit_events", "compat_state", "meta"])
      await tx.execute(sql.raw(`delete from ${t}`))
    await tx.insert(users).values(m.userStore.users.map((u, i) => ({
      id: u.id, username: u.username, name: u.name, designation: u.designation, initials: u.initials, email: u.email, role: u.role,
      mobile: u.mobile ?? null, department: u.department ?? null, active: u.active, mustChangePassword: !!u.mustChangePassword,
      accessUntil: u.role === "vatOfficer" ? u.accessUntil ?? null : null,
      passwordHash: demoHash[i], passwordIsDemo: true, preferences: {}, createdAt: new Date(u.createdAt),
      lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
    })))
    await saveCompany(tx, m.company)
    await tx.insert(units).values(m.db.units.map((u) => ({ id: u.id, code: u.code, name: u.name, decimals: u.decimals, active: u.active, createdAt: new Date(u.createdAt) })))
    for (let i = 0; i < demoParties.length; i += 500) await tx.insert(parties).values(demoParties.slice(i, i + 500))
    for (let i = 0; i < demoItems.length; i += 500) await tx.insert(items).values(demoItems.slice(i, i + 500))
    for (let i = 0; i < demoMasters.length; i += 500) await tx.insert(masterItems).values(demoMasters.slice(i, i + 500))
    for (let i = 0; i < demoStock.length; i += 500) await tx.insert(stockDocuments).values(demoStock.slice(i, i + 500).map(stockDocValues))
    for (let i = 0; i < demoStockLines.length; i += 500) await tx.insert(stockDocumentLines).values(demoStockLines.slice(i, i + 500))
    for (let i = 0; i < demoSaleRows.length; i += 500) await tx.insert(sales).values(demoSaleRows.slice(i, i + 500))
    for (let i = 0; i < demoSaleLines.length; i += 500) await tx.insert(saleLines).values(demoSaleLines.slice(i, i + 500))
    for (let i = 0; i < demoSaleReals.length; i += 500) await tx.insert(saleRealisations).values(demoSaleReals.slice(i, i + 500))
    for (let i = 0; i < demoPurchaseRows.length; i += 500) await tx.insert(purchases).values(demoPurchaseRows.slice(i, i + 500))
    for (let i = 0; i < demoPurchaseLines.length; i += 500) await tx.insert(purchaseLines).values(demoPurchaseLines.slice(i, i + 500))
    for (let i = 0; i < demoNoteRows.length; i += 500) await tx.insert(notes).values(demoNoteRows.slice(i, i + 500))
    for (let i = 0; i < demoNoteLines.length; i += 500) await tx.insert(noteLines).values(demoNoteLines.slice(i, i + 500))
    for (let i = 0; i < demoOpeningRows.length; i += 500) await tx.insert(openingEntries).values(demoOpeningRows.slice(i, i + 500))
    for (let i = 0; i < demoBatchRows.length; i += 500) await tx.insert(batches).values(demoBatchRows.slice(i, i + 500))
    for (let i = 0; i < demoBatchLineRows.length; i += 500) await tx.insert(batchLines).values(demoBatchLineRows.slice(i, i + 500))
    for (let i = 0; i < demoBatchUseRows.length; i += 500) await tx.insert(batchConsumption).values(demoBatchUseRows.slice(i, i + 500))
    for (let i = 0; i < demoBomRows.length; i += 500) await tx.insert(boms).values(demoBomRows.slice(i, i + 500))
    for (let i = 0; i < demoBomInputRows.length; i += 500) await tx.insert(bomInputs).values(demoBomInputRows.slice(i, i + 500))
    for (let i = 0; i < demoBomCostRows.length; i += 500) await tx.insert(bomCosts).values(demoBomCostRows.slice(i, i + 500))
    await tx.insert(productionConfig).values(configValues(m.db.productionConfig))
    for (let i = 0; i < demoWorkOrderRows.length; i += 500) await tx.insert(workOrders).values(demoWorkOrderRows.slice(i, i + 500))
    for (let i = 0; i < demoWorkOrderLineRows.length; i += 500) await tx.insert(workOrderLines).values(demoWorkOrderLineRows.slice(i, i + 500))
    await refreshWorkOrderRows(tx)
    for (let i = 0; i < demoAccounts.length; i += 500) await tx.insert(moneyAccounts).values(demoAccounts.slice(i, i + 500).map(moneyAccountValues))
    for (let i = 0; i < demoMoney.length; i += 500) await tx.insert(moneyDocs).values(demoMoney.slice(i, i + 500).map(moneyDocValues))
    const demoMoneyAllocationRows = demoMoney.flatMap(moneyAllocationValues)
    for (let i = 0; i < demoMoneyAllocationRows.length; i += 500) await tx.insert(moneyAllocations).values(demoMoneyAllocationRows.slice(i, i + 500))
    await tx.insert(accountingConfig).values(accountingConfigValues(m.db.accountingConfig))
    for (let i = 0; i < demoDeposits.length; i += 500) await tx.insert(treasuryDeposits).values(demoDeposits.slice(i, i + 500).map(treasuryValues))
    for (let i = 0; i < demoCertificates.length; i += 500) await tx.insert(vdsEntries).values(demoCertificates.slice(i, i + 500).map(vdsValues))
    for (let i = 0; i < demoAdjustments.length; i += 500) await tx.insert(vatAdjustments).values(demoAdjustments.slice(i, i + 500).map(adjustmentValues))
    for (let i = 0; i < demoReturns.length; i += 500) await tx.insert(vatReturns).values(demoReturns.slice(i, i + 500).map(returnValues))
    await tx.insert(vatSettings).values(vatSettingsValues(demoVatSettings))
    for (let i = 0; i < demoUds.length; i += 500) await tx.insert(uds).values(demoUds.slice(i, i + 500).map(udValues))
    const demoUdLineRows = demoUds.flatMap(udLineRows)
    for (let i = 0; i < demoUdLineRows.length; i += 500) await tx.insert(udLines).values(demoUdLineRows.slice(i, i + 500))
    for (let i = 0; i < demoBondUds.length; i += 500) await tx.insert(bondUds).values(demoBondUds.slice(i, i + 500).map(bondUdValues))
    const demoBondUdInputRows = demoBondUds.flatMap(bondUdInputRows)
    const demoBondUdGarmentRows = demoBondUds.flatMap(bondUdGarmentRows)
    for (let i = 0; i < demoBondUdInputRows.length; i += 500) await tx.insert(bondUdInputs).values(demoBondUdInputRows.slice(i, i + 500))
    for (let i = 0; i < demoBondUdGarmentRows.length; i += 500) await tx.insert(bondUdGarments).values(demoBondUdGarmentRows.slice(i, i + 500))
    for (let i = 0; i < demoLateFilings.length; i += 500) await tx.insert(lateFilings).values(demoLateFilings.slice(i, i + 500).map(lateFilingValues))
    for (let i = 0; i < demoReturnAmendments.length; i += 500) await tx.insert(returnAmendments).values(demoReturnAmendments.slice(i, i + 500).map(amendmentValues))
    for (let i = 0; i < demoPrcBatches.length; i += 500) await tx.insert(prcBatches).values(demoPrcBatches.slice(i, i + 500).map(prcBatchValues))
    for (let i = 0; i < demoDrawbackClaims.length; i += 500) await tx.insert(drawbackClaims).values(demoDrawbackClaims.slice(i, i + 500).map(claimValues))
    // R8.3: the schedule — the reminder settings row, the (empty) reminders, the delivery schedules and the seeded log
    await tx.insert(reminderSettings).values({ id: 1, settings: m.db.reminderSettings })
    for (let i = 0; i < m.db.reminders.length; i += 500) await tx.insert(reminders).values(m.db.reminders.slice(i, i + 500).map(reminderValues))
    for (let i = 0; i < m.db.deliverySchedules.length; i += 500) await tx.insert(deliverySchedules).values(m.db.deliverySchedules.slice(i, i + 500).map(scheduleValues))
    for (let i = 0; i < m.db.deliveryLog.length; i += 500) await tx.insert(deliveryLog).values(m.db.deliveryLog.slice(i, i + 500).map(deliveryLogValues))
    const unitSeq = (m.db.seq as Record<string, number>).unit
    await tx.execute(sql`select setval('unit_id_seq', ${unitSeq})`)
    for (let i = 0; i < m.tariff.length; i += 500)
      await tx.insert(tariffLines).values(m.tariff.slice(i, i + 500).map((t) => ({ fy: m.TARIFF_FY, ...t })))
    await tx.execute(sql`alter sequence audit_events_id_seq restart with 1`)
    let prev = GENESIS_HASH
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500)
      const chained = chainValues(chunk.map((e) => ({
        at: new Date(e.at), day: e.day, actor: e.actor, actorId: e.actorId ?? null, entity: e.entity, entityId: e.entityId ?? null,
        ref: e.ref, action: e.action, changes: e.changes?.length ? e.changes : null, note: e.note ?? null,
      })), prev)
      prev = chained.head
      const ids = await tx.insert(auditEvents).values(chained.rows).returning({ id: auditEvents.id })
      ids.forEach((r, j) => { chunk[j].id = `a${r.id}` })
    }
    await tx.insert(meta).values([
      { key: "seed_version", value: SEED_VERSION }, { key: "seeded_at", value: seededAt }, { key: "tariff_fy", value: m.TARIFF_FY },
    ])
  })
  setEpoch(seededAt)
  markParties([...m.db.customers, ...m.db.vendors])
  markItems(m.db.items)
  markMasters(m.db.masterItems)
  markStockDocs(demoStock)
  markSales(m.db.sales)
  markPurchases(m.db.purchases)
  markCreditNotes(m.db.creditNotes)
  markDebitNotes(m.db.debitNotes)
  markOpenings(m.db.openings)
  markBatches(m.db.batches)
  markBoms(m.db.boms)
  markConfig(m.db.productionConfig)
  markWorkOrders(m.db.workOrders)
  markMoneyAccounts(m.db.moneyAccounts)
  markMoneyDocs(m.db.moneyDocs)
  markAccountingConfig()
  markTreasury(m.db.treasury)
  markVds(m.db.vds)
  markAdjustments(m.db.adjustments)
  markUds(m.db.uds)
  markBondUds(m.db.bondUds)
  markLateFilings(m.db.lateFilings)
  markReturnAmendments(m.db.returnAmendments)
  markPrcBatches(m.db.prcBatches)
  markClaims(m.db.drawbackClaims)
  G.__dzAudit!.seq = events.reduce((mx, e) => Math.max(mx, Number(e.id.slice(1))), 0)
  markPersisted(events)
  await dropCompatState(log) // a fresh database never had snapshot contents — drop the empty table now
  log(`seeded demo data: ${m.userStore.users.length} users, ${m.db.units.length} units, ${demoParties.length} parties, ${demoItems.length} items, ${demoMasters.length} master items, ${demoStock.length} stock documents, ${m.db.sales.length} sales invoices, ${m.db.purchases.length} purchases, ${demoNotes.length} credit/debit notes, ${demoOpeningRows.length} opening entries, ${demoBatchRows.length} production batches, ${demoBomRows.length} price declarations, ${demoWorkOrderRows.length} work orders, ${demoMoney.length} receipts and payments, ${demoDeposits.length} treasury deposits, ${demoCertificates.length} VDS entries, ${demoAdjustments.length} VAT adjustments, ${demoReturns.length} tax returns, ${demoUds.length} UDs, ${demoBondUds.length} own UDs, ${demoLateFilings.length} late-filing applications, ${demoReturnAmendments.length} return amendments, ${demoPrcBatches.length} PRC batches, ${demoDrawbackClaims.length} drawback claims, ${m.tariff.length} tariff lines, ${events.length} audit events (${Date.now() - t0} ms)`)
}

/**
 * The finale: whatever the snapshot still carried is in the tables now — the collections the adoption legs
 * moved, the notification read-ids the migration moved to `users.notif_read`, and the counters re-derived
 * from the rows — so this boot drops `compat_state` for good. Under the state lock: a rolling deploy's older
 * instance may still be finishing a write to it; the lock waits that out, and its own save failing afterwards
 * is its 503-retry path, the one the epoch check already answers with.
 */
async function dropCompatState(log: (m: string) => void) {
  if ((await db.execute(sql`select to_regclass('public.compat_state') as t`)).rows[0]?.t) {
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.execute(sql`drop table if exists compat_state`)
    })
    log("compat_state dropped — the snapshot's last contents are table rows now")
  }
}

async function restore(state: { db: Record<string, unknown>; notifRead?: Record<string, { ids: string[] }> }, log: (m: string) => void) {
  const t0 = Date.now()
  // the mock's own module load reads `db.seq` — a drained pre-finale snapshot (or the finale's empty stand-in)
  // may not carry one, so default the two keys every snapshot always had
  state = { ...state, db: { seq: {}, trash: [], ...state.db } }
  const userRows = await db.select().from(users).orderBy(asc(users.ord))
  const prefs: Record<string, Preferences> = {}
  const notifRead: Record<string, { ids: string[] }> = Object.fromEntries(userRows.map((r) => [r.id, { ids: r.notifRead ?? [] }]))
  const list: User[] = userRows.map((r) => { prefs[r.id] = r.preferences as Preferences; return toUser(r) })
  const unitRows: Unit[] = (await db.select().from(units).orderBy(asc(units.ord))).map((r) => ({ id: r.id, code: r.code, name: r.name, decimals: r.decimals, active: r.active, createdAt: r.createdAt.toISOString() }))
  await adoptCompatRows(state, log)
  const partyRows = await db.select().from(parties).orderBy(asc(parties.ord))
  const live = (kind: "customer" | "vendor"): Party[] => partyRows.filter((r) => r.kind === kind && !r.deletedAt).map(toParty)
  const customers = live("customer"), vendors = live("vendor")
  const partyTrash: TrashEntry[] = partyRows.filter((r) => r.deletedAt)
    .map((r) => ({ kind: r.kind as TrashEntry["kind"], doc: toParty(r), at: r.deletedAt!.toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const itemRows: Item[] = (await db.select().from(items).orderBy(asc(items.ord))).map(toItem)
  const masterRows: MasterItem[] = (await db.select().from(masterItems).orderBy(asc(masterItems.ord))).map(toMaster)
  const stockRows: StockDoc[] = await assembleStockDocs(await db.select().from(stockDocuments).orderBy(asc(stockDocuments.ord)))
  const transfers = stockRows.filter((d): d is Transfer => d.kind === "transfer")
  const damages = stockRows.filter((d): d is Damage => d.kind === "damage")
  const saleRows = await db.select().from(sales).orderBy(asc(sales.ord))
  const stamped = new Map(saleRows.filter((r) => r.deletedAt).map((r) => [r.id, r.deletedAt!.toISOString()]))
  const allSales: Sale[] = await assembleSales(saleRows)
  const liveSales = allSales.filter((x) => !stamped.has(x.id))
  const saleTrash: TrashEntry[] = allSales.filter((x) => stamped.has(x.id))
    .map((x) => ({ kind: "sale" as const, doc: x, at: stamped.get(x.id)! }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const purchaseDbRows = await db.select().from(purchases).orderBy(asc(purchases.ord))
  const stampedPurchases = new Map(purchaseDbRows.filter((r) => r.deletedAt).map((r) => [r.id, r.deletedAt!.toISOString()]))
  const allPurchases: Purchase[] = await assemblePurchases(purchaseDbRows)
  const livePurchases = allPurchases.filter((x) => !stampedPurchases.has(x.id))
  const purchaseTrash: TrashEntry[] = allPurchases.filter((x) => stampedPurchases.has(x.id))
    .map((x) => ({ kind: "purchase" as const, doc: x, at: stampedPurchases.get(x.id)! }))
    .sort((a, b) => a.at.localeCompare(b.at))
  const noteRows = await db.select().from(notes).orderBy(asc(notes.ord))
  const allNotes = await assembleNotes(noteRows.filter((r) => !r.deletedAt))
  const creditNotes = allNotes.filter((n): n is CreditNote => "saleId" in n)
  const debitNotes = allNotes.filter((n): n is DebitNote => "purchaseId" in n)
  const openingDbRows = await db.select().from(openingEntries).orderBy(asc(openingEntries.ord))
  const liveOpenings = openingDbRows.filter((r) => !r.deletedAt).map(toOpening)
  const batchDbRows = await db.select().from(batches).orderBy(asc(batches.ord))
  const liveBatches = await assembleBatches(batchDbRows.filter((r) => !r.deletedAt))
  const bomDbRows = await db.select().from(boms).orderBy(asc(boms.ord))
  const liveBoms = await assembleBoms(bomDbRows.filter((r) => !r.deletedAt))
  const [configDbRow] = await db.select().from(productionConfig).where(eq(productionConfig.id, 1))
  const config = configDbRow ? toConfig(configDbRow) : DEFAULT_CONFIG
  const workOrderDbRows = await db.select().from(workOrders).orderBy(asc(workOrders.ord))
  const liveWorkOrders = await assembleWorkOrders(workOrderDbRows.filter((r) => !r.deletedAt))
  const liveAccounts: MoneyAccount[] = (await db.select().from(moneyAccounts).orderBy(asc(moneyAccounts.ord))).map(toMoneyAccount)
  const moneyDbRows = await db.select().from(moneyDocs).orderBy(asc(moneyDocs.ord))
  const liveMoney = await assembleMoneyDocs(moneyDbRows.filter((r) => !r.deletedAt))
  const [accountingConfigRow] = await db.select().from(accountingConfig).where(eq(accountingConfig.id, 1))
  const accountingCfg: AccountingConfig = accountingConfigRow ? toAccountingConfig(accountingConfigRow) : { allowAdvance: true, autoAllocate: true }
  const liveDeposits: TreasuryDeposit[] = (await db.select().from(treasuryDeposits).orderBy(asc(treasuryDeposits.ord)))
    .filter((r) => !r.deletedAt).map(toTreasury)
  const liveCertificates: VdsEntry[] = (await db.select().from(vdsEntries).orderBy(asc(vdsEntries.ord)))
    .filter((r) => !r.deletedAt).map(toVds)
  const liveAdjustments: VatAdjustment[] = (await db.select().from(vatAdjustments).orderBy(asc(vatAdjustments.ord)))
    .filter((r) => !r.deletedAt).map(toAdjustment)
  const liveReturns: VatReturn[] = (await db.select().from(vatReturns).orderBy(asc(vatReturns.ord))).map(toReturn)
  // R6.2: the declarations — the head rows with their inputs, in the order they were entered
  const liveUds: UdRecord[] = await assembleUds((await db.select().from(uds).orderBy(asc(uds.ord))).filter((r) => !r.deletedAt))
  // R6.5: our own UDs — the head rows with their inputs and garments
  const liveBondUds: BondUd[] = await assembleBondUds((await db.select().from(bondUds).orderBy(asc(bondUds.ord))).filter((r) => !r.deletedAt))
  // R6.6: the Mushak 9.3 / 9.4 applications — live rows; a deleted draft's row keeps its id retired
  const lateFilingDbRows = await db.select().from(lateFilings).orderBy(asc(lateFilings.ord))
  const liveLateFilings: LateFiling[] = lateFilingDbRows.filter((r) => !r.deletedAt).map(toLateFiling)
  const returnAmendmentDbRows = await db.select().from(returnAmendments).orderBy(asc(returnAmendments.ord))
  const liveReturnAmendments: ReturnAmendment[] = returnAmendmentDbRows.filter((r) => !r.deletedAt).map(toAmendment)
  // R6.6 (proceeds): the bank-file PRC batches — live rows; a batch has no delete, but a restored older backup can drop one
  const prcBatchDbRows = await db.select().from(prcBatches).orderBy(asc(prcBatches.ord))
  const livePrcBatches: PrcBatch[] = prcBatchDbRows.filter((r) => !r.deletedAt).map(toPrcBatch)
  // R6.5 (drawback claims): the DEDO claims — live rows; a deleted draft is stamped, its exports claimable again
  const drawbackClaimDbRows = await db.select().from(drawbackClaims).orderBy(asc(drawbackClaims.ord))
  const liveDrawbackClaims: DrawbackClaim[] = drawbackClaimDbRows.filter((r) => !r.deletedAt).map(toClaim)
  // R8.3: the schedule — the settings row, the fired reminders, the delivery schedules and their log. A database
  // seeded before R8.3 has none of them: it gets the default reminders settings and the two default schedules,
  // with an empty log (the first tick fills it) — the same defaults the fresh seed writes.
  const scheduleSettingsRow = (await db.select().from(reminderSettings).where(eq(reminderSettings.id, 1)))[0]
  const liveReminders = await db.select().from(reminders).orderBy(asc(reminders.at))
  let liveSchedules = (await db.select().from(deliverySchedules).orderBy(asc(deliverySchedules.ord))).map(toDeliverySchedule)
  let liveDeliveryLog = (await db.select().from(deliveryLog).orderBy(asc(deliveryLog.ord))).map(toDeliveryLog)
  if (!scheduleSettingsRow && !liveSchedules.length) {
    const defaults = seedDeliverySchedules()
    await db.transaction(async (tx) => {
      await lockState(tx)
      await tx.insert(reminderSettings).values({ id: 1, settings: DEFAULT_REMINDER_SETTINGS }).onConflictDoNothing()
      for (let i = 0; i < defaults.length; i += 500) await tx.insert(deliverySchedules).values(defaults.slice(i, i + 500).map(scheduleValues))
    })
    liveSchedules = (await db.select().from(deliverySchedules).orderBy(asc(deliverySchedules.ord))).map(toDeliverySchedule)
    log("adopted the R8.3 schedule defaults (reminder settings + 2 delivery schedules)")
  }
  const [vatSettingsDbRow] = await db.select().from(vatSettings).where(eq(vatSettings.id, 1))
  // the settings row is written by the seed and by the adoption below, so this fallback only guards a restore that
  // came from a backup older than both: the company's own zone, the one the NBR codes are filed under
  const vatSettingsCfg: VatSettings = vatSettingsDbRow ? toVatSettings(vatSettingsDbRow)
    : (state.db as { vatSettings?: VatSettings }).vatSettings ?? { zoneCode: "0015" }
  // a note deleted before this release left no trace but its number in the audit trail; the stamped rows now hold
  // the ids, so the counter the mock keeps in `db.seq` is never lower than the highest id the table has seen
  const seq = (state.db as { seq?: Record<string, number> }).seq ?? {}
  for (const [key, prefix, list] of [["creditNote", "cn", creditNotes], ["debitNote", "dn", debitNotes]] as const) {
    const highest = noteRows.filter((r) => r.kind === (prefix === "cn" ? "credit" : "debit"))
      .reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0)
    seq[key] = Math.max(seq[key] ?? list.length, highest)
  }
  // … and the opening entries' and the production batches' counters the same way
  seq.opening = Math.max(seq.opening ?? liveOpenings.length,
    openingDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  seq.batch = Math.max(seq.batch ?? liveBatches.length,
    batchDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  // … and the price declarations' the same way: a deleted draft's row holds its id, so the `bom` series never repeats
  seq.bom = Math.max(seq.bom ?? liveBoms.length,
    bomDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0))
  // … and the work orders' the same way
  seq.workOrder = Math.max(seq.workOrder ?? liveWorkOrders.length,
    workOrderDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  // … and the accounting's the same way (a receipt and a payment keep their own counters)
  seq.account = Math.max(seq.account ?? liveAccounts.length,
    liveAccounts.reduce((m, a) => Math.max(m, Number(a.id.slice(2)) || 0), 0))
  for (const kind of ["receipt", "payment"] as const) {
    const mine = moneyDbRows.filter((r) => r.kind === kind)
    seq[kind] = Math.max(seq[kind] ?? 0, mine.reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  }
  // … and the VAT documents' the same way: a deleted draft's row holds its id, so no series ever repeats
  seq.treasury = Math.max(seq.treasury ?? liveDeposits.length,
    (await db.select().from(treasuryDeposits)).reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  seq.vds = Math.max(seq.vds ?? liveCertificates.length,
    (await db.select().from(vdsEntries)).reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0))
  seq.adjustment = Math.max(seq.adjustment ?? liveAdjustments.length,
    (await db.select().from(vatAdjustments)).reduce((m, r) => Math.max(m, Number(r.id.slice(2)) || 0), 0))
  // … and the declarations' the same way: an id carries its own stamp after the number (`ud4-k3f9x`)
  seq.ud = Math.max(seq.ud ?? liveUds.length,
    (await db.select().from(uds)).reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  // …and our own UDs' the same way (`bu2-m1x9z`)
  seq.bondUd = Math.max(seq.bondUd ?? liveBondUds.length,
    (await db.select().from(bondUds)).reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  // …and the 9.3 / 9.4 applications' the same way (`lf3-k3f9x`, `am2-m1x9z`): a deleted draft retires its id
  seq.lateFiling = Math.max(seq.lateFiling ?? liveLateFilings.length,
    lateFilingDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  seq.amendment = Math.max(seq.amendment ?? liveReturnAmendments.length,
    returnAmendmentDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  // …and the bank-file batches' the same way (`pb2-m1x9z`): the counter the snapshot kept may be behind the rows
  seq.prcBatch = Math.max(seq.prcBatch ?? livePrcBatches.length,
    prcBatchDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  // …and the drawback claims' too (`dc2-m1x9z` — the seeded ones are bare `dc1`…`dc7`)
  seq.claim = Math.max(seq.claim ?? liveDrawbackClaims.length,
    drawbackClaimDbRows.reduce((m, r) => Math.max(m, Number(r.id.slice(2).split("-")[0]) || 0), 0))
  const [ep] = await db.select().from(meta).where(eq(meta.key, "seeded_at"))
  setEpoch(ep?.value)
  const raw = await db.execute(sql`select * from audit_events order by id`)
  const events: AuditEvent[] = (raw.rows as Parameters<typeof rawToEvent>[0][]).map(rawToEvent)
  // the id counters of the families whose deleted drafts leave a stamped row must also cover ids the rows no
  // longer carry — a stamp can be lost (a database rewound to its pre-port shape kept no rows for deleted
  // drafts at all), while the audit trail is append-only: its entityIds always know which ids were used.
  // The numbers of these families were always retired this way (`nextNo` reads the audit refs); now their
  // ids are too.
  for (const [entity, key, skip] of [
    ["sale", "sale", 1], ["purchase", "purchase", 1],
    ["creditNote", "creditNote", 2], ["debitNote", "debitNote", 2],
    ["opening", "opening", 2], ["batch", "batch", 2], ["bom", "bom", 3], ["workOrder", "workOrder", 2],
    ["receipt", "receipt", 2], ["payment", "payment", 2], ["account", "account", 2],
    ["treasury", "treasury", 2], ["vds", "vds", 3], ["adjustment", "adjustment", 2],
    ["ud", "ud", 2], ["bondUd", "bondUd", 2],
    ["lateFiling", "lateFiling", 2], ["returnAmendment", "amendment", 2], ["prcBatch", "prcBatch", 2],
    ["drawbackClaim", "claim", 2],
  ] as const) {
    const seen = events.reduce((m, e) =>
      e.entity === entity && e.entityId ? Math.max(m, Number(e.entityId.slice(skip).split("-")[0]) || 0) : m, 0)
    seq[key] = Math.max(seq[key] ?? 0, seen)
  }
  restoreGlobals({
    db: state.db as never, notifRead, users: list, prefs, company: await loadCompany(), units: unitRows,
    customers, vendors, partyTrash, items: itemRows, masterItems: masterRows, transfers, damages,
    sales: liveSales, saleTrash, purchases: livePurchases, purchaseTrash, creditNotes, debitNotes,
    openings: liveOpenings, batches: liveBatches, boms: liveBoms, productionConfig: config,
    workOrders: liveWorkOrders, moneyAccounts: liveAccounts, moneyDocs: liveMoney,
    treasury: liveDeposits, vds: liveCertificates, adjustments: liveAdjustments, uds: liveUds, bondUds: liveBondUds,
    lateFilings: liveLateFilings, returnAmendments: liveReturnAmendments, prcBatches: livePrcBatches, drawbackClaims: liveDrawbackClaims,
    accountingConfig: accountingCfg, returns: liveReturns, vatSettings: vatSettingsCfg, events,
    reminderSettings: scheduleSettingsRow?.settings ?? DEFAULT_REMINDER_SETTINGS, reminders: liveReminders.map(toFiredReminder),
    deliverySchedules: liveSchedules, deliveryLog: liveDeliveryLog,
  })
  loadCompat()
  markParties([...mirror.parties("customer"), ...mirror.parties("vendor")])
  markItems(mirror.items())
  markMasters(mirror.masterItems())
  markStockDocs(stockRows)
  markSales(liveSales)
  markPurchases(livePurchases)
  markCreditNotes(creditNotes)
  markDebitNotes(debitNotes)
  markOpenings(liveOpenings)
  markBatches(liveBatches)
  markBoms(liveBoms)
  markConfig(config)
  // a snapshot written before the work orders had rows may carry progress the batches have since moved on from
  await refreshWorkOrderRows()
  markWorkOrders(mirror.workOrders())
  markMoneyAccounts(mirror.moneyAccounts())
  markMoneyDocs(mirror.moneyDocs())
  markAccountingConfig()
  markTreasury(mirror.treasury())
  markVds(mirror.vds())
  markAdjustments(mirror.adjustments())
  markUds(mirror.uds())
  markBondUds(mirror.bondUds())
  markLateFilings(mirror.lateFilings())
  markReturnAmendments(mirror.returnAmendments())
  markPrcBatches(mirror.prcBatches())
  markClaims(mirror.drawbackClaims())
  markReturns(mirror.returns())
  markVatSettings()
  markPersisted(events)
  await dropCompatState(log)
  log(`restored from PostgreSQL: ${list.length} users, ${customers.length + vendors.length} parties, ${itemRows.length} items, ${masterRows.length} master items, ${stockRows.length} stock documents, ${liveSales.length} sales invoices, ${livePurchases.length} purchases, ${allNotes.length} credit/debit notes, ${liveOpenings.length} opening entries, ${liveBatches.length} production batches, ${liveBoms.length} price declarations, ${liveWorkOrders.length} work orders, ${liveMoney.length} receipts and payments, ${liveDeposits.length} treasury deposits, ${liveCertificates.length} VDS entries, ${liveAdjustments.length} VAT adjustments, ${liveReturns.length} tax returns, ${liveUds.length} UDs, ${liveBondUds.length} own UDs, ${liveLateFilings.length} late-filing applications, ${liveReturnAmendments.length} return amendments, ${livePrcBatches.length} PRC batches, ${liveDrawbackClaims.length} drawback claims, ${events.length} audit events (${Date.now() - t0} ms)`)
}

/** The collections R5.2, R5.3, R5.4 and R5.5 moved out of `compat_state` into their own tables. */
const ADOPTED = ["customers", "vendors", "items", "masterItems", "transfers", "damages", "sales", "purchases",
  "creditNotes", "debitNotes", "openings", "batches", "boms", "productionConfig", "workOrders",
  "moneyAccounts", "moneyDocs", "accountingConfig", "treasury", "vds", "adjustments", "returns",
  "vatSettings", "uds", "bondUds", "lateFilings", "returnAmendments", "prcBatches", "drawbackClaims"] as const

/**
 * Upgrade: a database written before these tables holds the collections inside `compat_state` (and deleted
 * parties in the undo buffer). Each is moved into its table once — customer data is never re-seeded — and the
 * snapshot is rewritten without them, so the tables are the only copy from then on. Also covers restoring an
 * older backup into a fresh database. R5.2 moved the master data, R5.3 the stock documents, the sales invoices and
 * the purchases (a deleted draft in the undo buffer becoming a `deleted_at` row). R5.4 the notes and the opening
 * stock entries and the production batches (whose deleted drafts became `deleted_at` rows too, since no family has
 * an undo), R6.5 our own UDs / UP with their bond settlements, and R6.6 the Mushak 9.3 / 9.4 applications.
 */
async function adoptCompatRows(state: { db: Record<string, unknown> }, log: (m: string) => void): Promise<boolean> {
  const s = state.db as {
    customers?: Party[]; vendors?: Party[]; items?: Item[]; masterItems?: MasterItem[]; transfers?: StockDoc[]
    damages?: StockDoc[]; sales?: Sale[]; purchases?: Purchase[]; creditNotes?: CreditNote[]; debitNotes?: DebitNote[]
    openings?: OpeningEntry[]; batches?: Batch[]; boms?: Bom[]; productionConfig?: ProductionConfig
    workOrders?: WorkOrder[]; moneyAccounts?: MoneyAccount[]; moneyDocs?: MoneyDoc[]; accountingConfig?: AccountingConfig
    treasury?: TreasuryDeposit[]; vds?: VdsEntry[]; adjustments?: VatAdjustment[]
    uds?: UdRecord[]
    bondUds?: BondUd[]
    lateFilings?: LateFiling[]
    returnAmendments?: ReturnAmendment[]
    prcBatches?: PrcBatch[]
    drawbackClaims?: DrawbackClaim[]
    returns?: VatReturn[]; vatSettings?: VatSettings
    trash?: TrashEntry[]
  }
  if (!ADOPTED.some((k) => Array.isArray(s[k]))) return false
  const trashed = (Array.isArray(s.trash) ? s.trash : []).filter((t) => t.kind === "customer" || t.kind === "vendor")
  const partyRows = [
    ...(s.customers ?? []).map((x) => partyValues(x)),
    ...(s.vendors ?? []).map((x) => partyValues(x)),
    ...trashed.map((t) => ({ ...partyValues(t.doc as Party), deletedAt: new Date(t.at) })),
  ]
  const itemRows = (s.items ?? []).map(itemValues)
  const masterRows = (s.masterItems ?? []).map(masterValues)
  const stockDocs: StockDoc[] = [...(s.transfers ?? []), ...(s.damages ?? [])]
  const stockRows = stockDocs.map(stockDocValues)
  const stockLineRows = stockDocs.flatMap(stockLineValues)
  const trashedSales = (Array.isArray(s.trash) ? s.trash : []).filter((t) => t.kind === "sale")
  const saleDocs: Sale[] = [...(s.sales ?? []), ...trashedSales.map((t) => t.doc as Sale)]
  const saleRows = [
    ...(s.sales ?? []).map(saleValues),
    ...trashedSales.map((t) => ({ ...saleValues(t.doc as Sale), deletedAt: new Date(t.at) })),
  ]
  const saleLineRows = saleDocs.flatMap(saleLineValues)
  const saleRealRows = saleDocs.flatMap(realisationValues)
  const trashedPurchases = (Array.isArray(s.trash) ? s.trash : []).filter((t) => t.kind === "purchase")
  const purchaseDocs: Purchase[] = [...(s.purchases ?? []), ...trashedPurchases.map((t) => t.doc as Purchase)]
  const purchaseRows = [
    ...(s.purchases ?? []).map(purchaseValues),
    ...trashedPurchases.map((t) => ({ ...purchaseValues(t.doc as Purchase), deletedAt: new Date(t.at) })),
  ]
  const purchaseLineRows = purchaseDocs.flatMap(purchaseLineValues)
  const noteDocs: Note[] = [...(s.creditNotes ?? []), ...(s.debitNotes ?? [])]
  const noteRows = noteDocs.map(noteValues)
  const noteLineRows = noteDocs.flatMap(noteLineValues)
  const openingRows = (s.openings ?? []).map(openingValues)
  const batchDocs: Batch[] = s.batches ?? []
  const batchRows = batchDocs.map(batchValues)
  const batchLineRows = batchDocs.flatMap(batchLineValues)
  const batchUseRows = batchDocs.flatMap(consumptionValues)
  const bomDocs: Bom[] = s.boms ?? []
  const bomRows = bomDocs.map(bomValues)
  const bomInputRows = bomDocs.flatMap(bomInputValues)
  const bomCostRows = bomDocs.flatMap(bomCostValues)
  const configRow = s.productionConfig
  const workOrderDocs: WorkOrder[] = s.workOrders ?? []
  const workOrderRows = workOrderDocs.map(workOrderValues)
  const workOrderLineRows = workOrderDocs.flatMap(workOrderLineValues)
  const accountDocs: MoneyAccount[] = s.moneyAccounts ?? []
  const accountRows = accountDocs.map(moneyAccountValues)
  const moneyRows = (s.moneyDocs ?? []).map(moneyDocValues)
  const moneyAllocationRows = (s.moneyDocs ?? []).flatMap(moneyAllocationValues)
  const accountingConfigRow = s.accountingConfig
  const depositDocs: TreasuryDeposit[] = s.treasury ?? []
  const certificateDocs: VdsEntry[] = s.vds ?? []
  const adjustmentDocs: VatAdjustment[] = s.adjustments ?? []
  const depositRows = depositDocs.map(treasuryValues)
  const certificateRows = certificateDocs.map(vdsValues)
  const adjustmentRows = adjustmentDocs.map(adjustmentValues)
  const returnDocs: VatReturn[] = s.returns ?? []
  const returnRows = returnDocs.map(returnValues)
  const vatSettingsDoc = s.vatSettings
  const udDocs: UdRecord[] = s.uds ?? []
  const udHeadRows = udDocs.map(udValues)
  const udInputRows = udDocs.flatMap(udLineRows)
  const bondUdDocs: BondUd[] = s.bondUds ?? []
  const bondUdHeadRows = bondUdDocs.map(bondUdValues)
  const bondUdOwnInputRows = bondUdDocs.flatMap(bondUdInputRows)
  const bondUdGarmentRowsToAdopt = bondUdDocs.flatMap(bondUdGarmentRows)
  const lateFilingDocs: LateFiling[] = s.lateFilings ?? []
  const lateFilingRowsToAdopt = lateFilingDocs.map(lateFilingValues)
  const returnAmendmentDocs: ReturnAmendment[] = s.returnAmendments ?? []
  const amendmentRowsToAdopt = returnAmendmentDocs.map(amendmentValues)
  const prcBatchDocs: PrcBatch[] = s.prcBatches ?? []
  const prcBatchRowsToAdopt = prcBatchDocs.map(prcBatchValues)
  const drawbackClaimDocs: DrawbackClaim[] = s.drawbackClaims ?? []
  const drawbackClaimRowsToAdopt = drawbackClaimDocs.map(claimValues)
  const [{ n: haveParties }] = await db.select({ n: sql<number>`count(*)::int` }).from(parties)
  const [{ n: haveItems }] = await db.select({ n: sql<number>`count(*)::int` }).from(items)
  const [{ n: haveMasters }] = await db.select({ n: sql<number>`count(*)::int` }).from(masterItems)
  const [{ n: haveStock }] = await db.select({ n: sql<number>`count(*)::int` }).from(stockDocuments)
  const [{ n: haveSales }] = await db.select({ n: sql<number>`count(*)::int` }).from(sales)
  const [{ n: havePurchases }] = await db.select({ n: sql<number>`count(*)::int` }).from(purchases)
  const [{ n: haveNotes }] = await db.select({ n: sql<number>`count(*)::int` }).from(notes)
  const [{ n: haveOpenings }] = await db.select({ n: sql<number>`count(*)::int` }).from(openingEntries)
  const [{ n: haveBatches }] = await db.select({ n: sql<number>`count(*)::int` }).from(batches)
  const [{ n: haveBoms }] = await db.select({ n: sql<number>`count(*)::int` }).from(boms)
  const [{ n: haveConfig }] = await db.select({ n: sql<number>`count(*)::int` }).from(productionConfig)
  const [{ n: haveWorkOrders }] = await db.select({ n: sql<number>`count(*)::int` }).from(workOrders)
  const [{ n: haveAccounts }] = await db.select({ n: sql<number>`count(*)::int` }).from(moneyAccounts)
  const [{ n: haveMoney }] = await db.select({ n: sql<number>`count(*)::int` }).from(moneyDocs)
  const [{ n: haveAccountingConfig }] = await db.select({ n: sql<number>`count(*)::int` }).from(accountingConfig)
  const [{ n: haveDeposits }] = await db.select({ n: sql<number>`count(*)::int` }).from(treasuryDeposits)
  const [{ n: haveCertificates }] = await db.select({ n: sql<number>`count(*)::int` }).from(vdsEntries)
  const [{ n: haveAdjustments }] = await db.select({ n: sql<number>`count(*)::int` }).from(vatAdjustments)
  const [{ n: haveReturns }] = await db.select({ n: sql<number>`count(*)::int` }).from(vatReturns)
  const [{ n: haveVatSettings }] = await db.select({ n: sql<number>`count(*)::int` }).from(vatSettings)
  const [{ n: haveUds }] = await db.select({ n: sql<number>`count(*)::int` }).from(uds)
  const [{ n: haveBondUds }] = await db.select({ n: sql<number>`count(*)::int` }).from(bondUds)
  const [{ n: haveLateFilings }] = await db.select({ n: sql<number>`count(*)::int` }).from(lateFilings)
  const [{ n: haveReturnAmendments }] = await db.select({ n: sql<number>`count(*)::int` }).from(returnAmendments)
  const [{ n: havePrcBatches }] = await db.select({ n: sql<number>`count(*)::int` }).from(prcBatches)
  const [{ n: haveDrawbackClaims }] = await db.select({ n: sql<number>`count(*)::int` }).from(drawbackClaims)
  const moved: string[] = [], movedDocs: string[] = [], movedR54: string[] = [], movedR55: string[] = [], movedR56: string[] = [], movedR62: string[] = [], movedR65: string[] = [], movedR66: string[] = []
  if ((!haveParties && partyRows.length) || (!haveItems && itemRows.length) || (!haveMasters && masterRows.length)
    || (!haveStock && stockRows.length) || (!haveSales && saleRows.length) || (!havePurchases && purchaseRows.length)
    || (!haveNotes && noteRows.length) || (!haveOpenings && openingRows.length)
    || (!haveBatches && batchRows.length) || (!haveBoms && bomRows.length) || (!haveConfig && configRow)
    || (!haveWorkOrders && workOrderRows.length) || (!haveAccounts && accountRows.length)
    || (!haveMoney && moneyRows.length) || (!haveAccountingConfig && accountingConfigRow)
    || (!haveDeposits && depositRows.length) || (!haveCertificates && certificateRows.length)
    || (!haveAdjustments && adjustmentRows.length) || (!haveReturns && returnRows.length)
    || (!haveVatSettings && vatSettingsDoc) || (!haveUds && udHeadRows.length)
    || (!haveBondUds && bondUdHeadRows.length)
    || (!haveLateFilings && lateFilingRowsToAdopt.length) || (!haveReturnAmendments && amendmentRowsToAdopt.length)
    || (!havePrcBatches && prcBatchRowsToAdopt.length)
    || (!haveDrawbackClaims && drawbackClaimRowsToAdopt.length)) {
    await db.transaction(async (tx) => {
      await lockState(tx) // waits out any other instance's in-flight write; the epoch is not set yet
      if (!haveParties && partyRows.length) {
        for (let i = 0; i < partyRows.length; i += 500) await tx.insert(parties).values(partyRows.slice(i, i + 500))
        moved.push(`${partyRows.length - trashed.length} customers/vendors (+ ${trashed.length} deleted)`)
      }
      if (!haveItems && itemRows.length) {
        for (let i = 0; i < itemRows.length; i += 500) await tx.insert(items).values(itemRows.slice(i, i + 500))
        moved.push(`${itemRows.length} items`)
      }
      if (!haveMasters && masterRows.length) {
        for (let i = 0; i < masterRows.length; i += 500) await tx.insert(masterItems).values(masterRows.slice(i, i + 500))
        moved.push(`${masterRows.length} master items`)
      }
      if (!haveStock && stockRows.length) {
        for (let i = 0; i < stockRows.length; i += 500) await tx.insert(stockDocuments).values(stockRows.slice(i, i + 500))
        for (let i = 0; i < stockLineRows.length; i += 500) await tx.insert(stockDocumentLines).values(stockLineRows.slice(i, i + 500))
        movedDocs.push(`${stockRows.length} stock documents (${stockLineRows.length} lines)`)
      }
      if (!haveSales && saleRows.length) {
        for (let i = 0; i < saleRows.length; i += 500) await tx.insert(sales).values(saleRows.slice(i, i + 500))
        for (let i = 0; i < saleLineRows.length; i += 500) await tx.insert(saleLines).values(saleLineRows.slice(i, i + 500))
        for (let i = 0; i < saleRealRows.length; i += 500) await tx.insert(saleRealisations).values(saleRealRows.slice(i, i + 500))
        movedDocs.push(`${saleRows.length - trashedSales.length} sales invoices (+ ${trashedSales.length} deleted, ${saleLineRows.length} lines)`)
      }
      if (!havePurchases && purchaseRows.length) {
        for (let i = 0; i < purchaseRows.length; i += 500) await tx.insert(purchases).values(purchaseRows.slice(i, i + 500))
        for (let i = 0; i < purchaseLineRows.length; i += 500) await tx.insert(purchaseLines).values(purchaseLineRows.slice(i, i + 500))
        movedDocs.push(`${purchaseRows.length - trashedPurchases.length} purchases (+ ${trashedPurchases.length} deleted, ${purchaseLineRows.length} lines)`)
      }
      if (!haveNotes && noteRows.length) {
        for (let i = 0; i < noteRows.length; i += 500) await tx.insert(notes).values(noteRows.slice(i, i + 500))
        for (let i = 0; i < noteLineRows.length; i += 500) await tx.insert(noteLines).values(noteLineRows.slice(i, i + 500))
        const cn = (s.creditNotes ?? []).length
        movedDocs.push(`${cn} credit notes and ${(s.debitNotes ?? []).length} debit notes (${noteLineRows.length} lines)`)
      }
      if (!haveOpenings && openingRows.length) {
        for (let i = 0; i < openingRows.length; i += 500) await tx.insert(openingEntries).values(openingRows.slice(i, i + 500))
        movedR54.push(`${openingRows.length} opening stock entries`)
      }
      if (!haveBatches && batchRows.length) {
        for (let i = 0; i < batchRows.length; i += 500) await tx.insert(batches).values(batchRows.slice(i, i + 500))
        for (let i = 0; i < batchLineRows.length; i += 500) await tx.insert(batchLines).values(batchLineRows.slice(i, i + 500))
        for (let i = 0; i < batchUseRows.length; i += 500) await tx.insert(batchConsumption).values(batchUseRows.slice(i, i + 500))
        movedR54.push(`${batchRows.length} production batches (${batchLineRows.length} lines, ${batchUseRows.length} consumed inputs)`)
      }
      if (!haveBoms && bomRows.length) {
        for (let i = 0; i < bomRows.length; i += 500) await tx.insert(boms).values(bomRows.slice(i, i + 500))
        for (let i = 0; i < bomInputRows.length; i += 500) await tx.insert(bomInputs).values(bomInputRows.slice(i, i + 500))
        for (let i = 0; i < bomCostRows.length; i += 500) await tx.insert(bomCosts).values(bomCostRows.slice(i, i + 500))
        movedR55.push(`${bomRows.length} price declarations (${bomInputRows.length} inputs, ${bomCostRows.length} cost heads)`)
      }
      if (!haveConfig && configRow) {
        await tx.insert(productionConfig).values(configValues(configRow))
        movedR55.push("the production configuration")
      }
      if (!haveWorkOrders && workOrderRows.length) {
        for (let i = 0; i < workOrderRows.length; i += 500) await tx.insert(workOrders).values(workOrderRows.slice(i, i + 500))
        for (let i = 0; i < workOrderLineRows.length; i += 500) await tx.insert(workOrderLines).values(workOrderLineRows.slice(i, i + 500))
        movedR55.push(`${workOrderRows.length} work orders (${workOrderLineRows.length} lines)`)
      }
      if (!haveAccounts && accountRows.length) {
        for (let i = 0; i < accountRows.length; i += 500) await tx.insert(moneyAccounts).values(accountRows.slice(i, i + 500))
        movedR56.push(`${accountRows.length} money accounts`)
      }
      if (!haveMoney && moneyRows.length) {
        for (let i = 0; i < moneyRows.length; i += 500) await tx.insert(moneyDocs).values(moneyRows.slice(i, i + 500))
        for (let i = 0; i < moneyAllocationRows.length; i += 500) await tx.insert(moneyAllocations).values(moneyAllocationRows.slice(i, i + 500))
        movedR56.push(`${moneyRows.length} receipts and payments (${moneyAllocationRows.length} allocations)`)
      }
      if (!haveAccountingConfig && accountingConfigRow) {
        await tx.insert(accountingConfig).values(accountingConfigValues(accountingConfigRow))
        movedR56.push("the accounting configuration")
      }
      if (!haveDeposits && depositRows.length) {
        for (let i = 0; i < depositRows.length; i += 500) await tx.insert(treasuryDeposits).values(depositRows.slice(i, i + 500))
        movedR56.push(`${depositRows.length} treasury deposits`)
      }
      if (!haveCertificates && certificateRows.length) {
        for (let i = 0; i < certificateRows.length; i += 500) await tx.insert(vdsEntries).values(certificateRows.slice(i, i + 500))
        movedR56.push(`${certificateRows.length} VDS entries`)
      }
      if (!haveAdjustments && adjustmentRows.length) {
        for (let i = 0; i < adjustmentRows.length; i += 500) await tx.insert(vatAdjustments).values(adjustmentRows.slice(i, i + 500))
        movedR56.push(`${adjustmentRows.length} VAT adjustments`)
      }
      if (!haveReturns && returnRows.length) {
        for (let i = 0; i < returnRows.length; i += 500) await tx.insert(vatReturns).values(returnRows.slice(i, i + 500))
        movedR56.push(`${returnRows.length} tax returns`)
      }
      if (!haveVatSettings && vatSettingsDoc) {
        await tx.insert(vatSettings).values(vatSettingsValues(vatSettingsDoc))
        movedR56.push("the NBR settings")
      }
      if (!haveUds && udHeadRows.length) {
        for (let i = 0; i < udHeadRows.length; i += 500) await tx.insert(uds).values(udHeadRows.slice(i, i + 500))
        for (let i = 0; i < udInputRows.length; i += 500) await tx.insert(udLines).values(udInputRows.slice(i, i + 500))
        movedR62.push(`${udHeadRows.length} UDs (${udInputRows.length} inputs)`)
      }
      if (!haveBondUds && bondUdHeadRows.length) {
        for (let i = 0; i < bondUdHeadRows.length; i += 500) await tx.insert(bondUds).values(bondUdHeadRows.slice(i, i + 500))
        for (let i = 0; i < bondUdOwnInputRows.length; i += 500) await tx.insert(bondUdInputs).values(bondUdOwnInputRows.slice(i, i + 500))
        for (let i = 0; i < bondUdGarmentRowsToAdopt.length; i += 500) await tx.insert(bondUdGarments).values(bondUdGarmentRowsToAdopt.slice(i, i + 500))
        movedR65.push(`${bondUdHeadRows.length} own UDs (${bondUdOwnInputRows.length} inputs, ${bondUdGarmentRowsToAdopt.length} garments)`)
      }
      if (!haveLateFilings && lateFilingRowsToAdopt.length) {
        for (let i = 0; i < lateFilingRowsToAdopt.length; i += 500) await tx.insert(lateFilings).values(lateFilingRowsToAdopt.slice(i, i + 500))
        movedR66.push(`${lateFilingRowsToAdopt.length} late-filing applications`)
      }
      if (!haveReturnAmendments && amendmentRowsToAdopt.length) {
        for (let i = 0; i < amendmentRowsToAdopt.length; i += 500) await tx.insert(returnAmendments).values(amendmentRowsToAdopt.slice(i, i + 500))
        movedR66.push(`${amendmentRowsToAdopt.length} return amendments`)
      }
      if (!havePrcBatches && prcBatchRowsToAdopt.length) {
        for (let i = 0; i < prcBatchRowsToAdopt.length; i += 500) await tx.insert(prcBatches).values(prcBatchRowsToAdopt.slice(i, i + 500))
        movedR66.push(`${prcBatchRowsToAdopt.length} PRC batches`)
      }
      if (!haveDrawbackClaims && drawbackClaimRowsToAdopt.length) {
        for (let i = 0; i < drawbackClaimRowsToAdopt.length; i += 500) await tx.insert(drawbackClaims).values(drawbackClaimRowsToAdopt.slice(i, i + 500))
        movedR65.push(`${drawbackClaimRowsToAdopt.length} drawback claims`)
      }
    })
    if (moved.length) log(`R5.2 upgrade: ${moved.join(", ")} moved out of compat_state into their own tables`)
    if (movedDocs.length) log(`R5.3 upgrade: ${movedDocs.join(", ")} moved out of compat_state into their own tables`)
    if (movedR54.length) log(`R5.4 upgrade: ${movedR54.join(", ")} moved out of compat_state into their own tables`)
    if (movedR55.length) log(`R5.5 upgrade: ${movedR55.join(", ")} moved out of compat_state into their own tables`)
    if (movedR56.length) log(`R5.6 upgrade: ${movedR56.join(", ")} moved out of compat_state into their own tables`)
    if (movedR62.length) log(`R6.2 upgrade: ${movedR62.join(", ")} moved out of compat_state into their own tables`)
    if (movedR65.length) log(`R6.5 upgrade: ${movedR65.join(", ")} moved out of compat_state into their own tables`)
    if (movedR66.length) log(`R6.6 upgrade: ${movedR66.join(", ")} moved out of compat_state into their own tables`)
  }
  return true
}

/** Pre-reseed safety net: one gzip snapshot of the database in the backups table (kept by the re-seed). */
async function backupBeforeReseed(from: string, log: (m: string) => void) {
  const { tables, counts } = await snapshot()
  const data = await promisify(gzip)(Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, at: new Date().toISOString(), storage: "postgres", reason: `before demo re-seed ${from} → ${SEED_VERSION}`, tables })))
  await db.insert(backups).values({
    kind: "manual", slot: lastSlot().slot, by: `System (before demo reset ${from} → ${SEED_VERSION})`,
    size: data.byteLength, sha256: createHash("sha256").update(data).digest("hex"), tables: counts, data,
  })
  log(`pre-reseed backup: ${Math.round(data.byteLength / 1024)} KB`)
}
