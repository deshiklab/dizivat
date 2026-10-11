/**
 * The in-process world shared with the compat bundle. Native modules own users, company, units, (R5.2) the
 * parties and items, (R5.3) the stock documents, the sales invoices, the purchases and the credit and debit notes
 * and (R5.4) the opening stock entries and the production batches, and (R5.5) the Mushak 4.3 price declarations and
 * the production configuration in PostgreSQL, and write every change through to these globals, so unported handlers
 * (which read them) see the same data. One instance per database — the compat layer is single-writer by design until R5.6 removes it.
 */
import { createRequire } from "node:module"
import { join } from "node:path"
import type { Preferences, SavedView, User } from "@/lib/auth/roles"
import type {
  AccountingConfig, AuditEvent, Batch, Bom, Company, CreditNote, DebitNote, Item, MasterItem, MoneyAccount, MoneyDoc, OpeningEntry, Party, ProductionConfig, Purchase, Sale, StockDoc, StockDocKind,
  TreasuryDeposit, UdRecord, Unit, VatAdjustment, VatReturn, VatSettings, VdsEntry, WorkOrder,
} from "@/lib/types"

export type PartyKind = "customer" | "vendor"
/** The undo buffer: deleted documents (compat state), deleted parties (R5.2) and deleted sales and purchases
 *  (R5.3), the latter three rebuilt from their table's `deleted_at`. */
export interface TrashEntry { kind: PartyKind | "sale" | "purchase"; doc: Party | Sale | Purchase; at: string }

export type CompatModule = typeof import("./compat/entry")

interface UserStore {
  users: User[]; passwords: Record<string, string>; prefs: Record<string, Preferences>
  views: Record<string, Record<string, SavedView[]>>; failures: Record<string, { n: number; until: number }>
  notifRead: Record<string, { ids: string[]; allBefore?: string }>; revokedBefore: Record<string, number>
}
interface Globals {
  __dzDb?: Record<string, unknown> & {
    units: Unit[]; customers: Party[]; vendors: Party[]; items: Item[]; masterItems: MasterItem[]
    transfers: StockDoc[]; damages: StockDoc[]; sales: Sale[]; purchases: Purchase[]
    creditNotes: CreditNote[]; debitNotes: DebitNote[]; openings: OpeningEntry[]; batches: Batch[]
    boms: Bom[]; productionConfig: ProductionConfig; workOrders: WorkOrder[]
    moneyAccounts: MoneyAccount[]; moneyDocs: MoneyDoc[]; treasury: TreasuryDeposit[]; vds: VdsEntry[]
    adjustments: VatAdjustment[]
    uds: UdRecord[]
    accountingConfig: AccountingConfig
    returns: VatReturn[]; vatSettings: VatSettings
    trash: TrashEntry[]
  }
  __dzUsers?: UserStore
  __dzAudit?: { events: AuditEvent[]; seq: number }
  __dzCompany?: Company
  __dzNoDelay?: boolean
}
export const G = globalThis as unknown as Globals

let mod: CompatModule | null = null
/** Requires dist/compat.js (next to dist/main.js). Call only after the globals are restored. */
export function loadCompat(): CompatModule {
  if (!mod) {
    G.__dzNoDelay = true // the mock's artificial latency is for the browser demo only
    mod = createRequire(__filename)(join(__dirname, "compat.js")) as CompatModule
  }
  return mod
}
export const compat = (): CompatModule => {
  if (!mod) throw new Error("compat bundle not loaded")
  return mod
}

/** Restores saved state before the compat bundle initialises (its stores use `globalThis.x ??= seed()`). */
export function restoreGlobals(s: {
  db: Record<string, unknown>; notifRead: UserStore["notifRead"]; users: User[]; prefs: Record<string, Preferences>; company: Company
  units: Unit[]; customers: Party[]; vendors: Party[]; partyTrash: TrashEntry[]; items: Item[]; masterItems: MasterItem[]
  transfers: StockDoc[]; damages: StockDoc[]; sales: Sale[]; saleTrash: TrashEntry[]
  purchases: Purchase[]; purchaseTrash: TrashEntry[]
  creditNotes: CreditNote[]; debitNotes: DebitNote[]; openings: OpeningEntry[]; batches: Batch[]
  boms: Bom[]; productionConfig: ProductionConfig; workOrders: WorkOrder[]
  moneyAccounts: MoneyAccount[]; moneyDocs: MoneyDoc[]; treasury: TreasuryDeposit[]; vds: VdsEntry[]
  adjustments: VatAdjustment[]
  uds: UdRecord[]
  accountingConfig: AccountingConfig
  returns: VatReturn[]; vatSettings: VatSettings
  events: AuditEvent[]
}) {
  // documents only: an older snapshot's deleted parties, sales and purchases are rebuilt from their `deleted_at` rows
  const docsTrash = ((s.db as { trash?: TrashEntry[] }).trash ?? [])
    .filter((t) => t.kind !== "customer" && t.kind !== "vendor" && t.kind !== "sale" && t.kind !== "purchase")
  G.__dzDb = {
    ...s.db, units: s.units, customers: s.customers, vendors: s.vendors, items: s.items, masterItems: s.masterItems,
    transfers: s.transfers, damages: s.damages, sales: s.sales, purchases: s.purchases,
    creditNotes: s.creditNotes, debitNotes: s.debitNotes, openings: s.openings, batches: s.batches,
    boms: s.boms, productionConfig: s.productionConfig, workOrders: s.workOrders,
    moneyAccounts: s.moneyAccounts, moneyDocs: s.moneyDocs, treasury: s.treasury, vds: s.vds,
    adjustments: s.adjustments, uds: s.uds,
    accountingConfig: s.accountingConfig,
    returns: s.returns ?? [], vatSettings: s.vatSettings,
    trash: [...docsTrash, ...s.partyTrash, ...s.saleTrash, ...s.purchaseTrash],
  }
  G.__dzUsers = { users: s.users, passwords: {}, prefs: s.prefs, views: {}, failures: {}, notifRead: s.notifRead ?? {}, revokedBefore: {} }
  G.__dzAudit = { events: s.events, seq: s.events.reduce((m, e) => Math.max(m, Number(e.id.slice(1)) || 0), 0) }
  G.__dzCompany = s.company
}

/* ── write-through mirror (mutate in place: the compat modules hold references) ── */

const replaceObject = <T extends object>(target: T, next: T) => {
  for (const k of Object.keys(target)) delete (target as Record<string, unknown>)[k]
  Object.assign(target, next)
}

export const mirror = {
  users: (): User[] => G.__dzUsers!.users,
  findUser: (id: string) => G.__dzUsers!.users.find((u) => u.id === id),
  findUserByName: (name: string) => G.__dzUsers!.users.find((u) => u.name === name),
  putUser(u: User, prefs: Preferences) {
    const list = G.__dzUsers!.users
    const cur = list.find((x) => x.id === u.id)
    if (cur) replaceObject(cur, u)
    else list.push(u)
    G.__dzUsers!.prefs[u.id] = prefs
    return cur ?? u
  },
  /** The notification ids one user has read — the mock keeps them in the user store, inside the snapshot. */
  notifRead: (id: string): string[] => G.__dzUsers!.notifRead[id]?.ids ?? [],
  putNotifRead(id: string, ids: string[]) { G.__dzUsers!.notifRead[id] = { ids } },
  company: (): Company => G.__dzCompany!,
  putCompany: (c: Company) => replaceObject(G.__dzCompany!, c),
  units: (): Unit[] => G.__dzDb!.units,
  putUnits(list: Unit[]) { const u = G.__dzDb!.units; u.splice(0, u.length, ...list) },
  /** R5.2: the live parties of one kind — the array the unported handlers read (mutated in place) */
  parties: (kind: PartyKind): Party[] => (kind === "customer" ? G.__dzDb!.customers : G.__dzDb!.vendors),
  putParties(kind: PartyKind, list: Party[]) { const a = mirror.parties(kind); a.splice(0, a.length, ...list) },
  findParty: (kind: PartyKind, id: string) => mirror.parties(kind).find((p) => p.id === id),
  putParty(p: Party) {
    const list = mirror.parties(p.kind)
    const cur = list.find((x) => x.id === p.id)
    if (cur) replaceObject(cur, p)
    else list.push(p)
    return cur ?? p
  },
  removeParty(kind: PartyKind, id: string) {
    const list = mirror.parties(kind)
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.2: the SKUs — documents move their counters, the register lists them */
  items: (): Item[] => G.__dzDb!.items,
  putItems(list: Item[]) { const a = mirror.items(); a.splice(0, a.length, ...list) },
  findItem: (id: string) => mirror.items().find((i) => i.id === id),
  putItem(it: Item) {
    const list = mirror.items()
    const cur = list.find((x) => x.id === it.id)
    if (cur) replaceObject(cur, it)
    else list.push(it)
    return cur ?? it
  },
  removeItem(id: string) {
    const list = mirror.items()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.2: the HS-code master items (a SKU references one by name) */
  masterItems: (): MasterItem[] => G.__dzDb!.masterItems,
  putMasterItems(list: MasterItem[]) { const a = mirror.masterItems(); a.splice(0, a.length, ...list) },
  findMasterItem: (id: string) => mirror.masterItems().find((m) => m.id === id),
  putMasterItem(m: MasterItem) {
    const list = mirror.masterItems()
    const cur = list.find((x) => x.id === m.id)
    if (cur) replaceObject(cur, m)
    else list.push(m)
    return cur ?? m
  },
  /** R5.3: the live sales invoices — every register, a customer's credit and the VAT returns read them */
  sales: (): Sale[] => G.__dzDb!.sales,
  putSales(list: Sale[]) { const a = mirror.sales(); a.splice(0, a.length, ...list) },
  findSale: (idOrNo: string) => mirror.sales().find((s) => s.id === idOrNo || s.invoiceNo === idOrNo),
  putSale(sale: Sale) {
    const list = mirror.sales()
    const cur = list.find((x) => x.id === sale.id)
    if (cur) replaceObject(cur, sale)
    else list.push(sale)
    return cur ?? sale
  },
  removeSale(id: string) {
    const list = mirror.sales()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.3: the live purchases — the debit notes, the bond register and the VAT returns read them */
  purchases: (): Purchase[] => G.__dzDb!.purchases,
  putPurchases(list: Purchase[]) { const a = mirror.purchases(); a.splice(0, a.length, ...list) },
  findPurchase: (idOrNo: string) => mirror.purchases().find((p) => p.id === idOrNo || p.invoiceNo === idOrNo),
  putPurchase(p: Purchase) {
    const list = mirror.purchases()
    const cur = list.find((x) => x.id === p.id)
    if (cur) replaceObject(cur, p)
    else list.push(p)
    return cur ?? p
  },
  removePurchase(id: string) {
    const list = mirror.purchases()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.3: the credit notes — what is still returnable on an invoice, a customer's credit and the VAT return read them */
  creditNotes: (): CreditNote[] => G.__dzDb!.creditNotes,
  putCreditNotes(list: CreditNote[]) { const a = mirror.creditNotes(); a.splice(0, a.length, ...list) },
  findCreditNote: (idOrNo: string) => mirror.creditNotes().find((n) => n.id === idOrNo || n.no === idOrNo),
  putCreditNote(n: CreditNote) {
    const list = mirror.creditNotes()
    const cur = list.find((x) => x.id === n.id)
    if (cur) replaceObject(cur, n)
    else list.push(n)
    return cur ?? n
  },
  removeCreditNote(id: string) {
    const list = mirror.creditNotes()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.3: the debit notes — what is still returnable on a purchase and the input tax a period reverses */
  debitNotes: (): DebitNote[] => G.__dzDb!.debitNotes,
  putDebitNotes(list: DebitNote[]) { const a = mirror.debitNotes(); a.splice(0, a.length, ...list) },
  findDebitNote: (idOrNo: string) => mirror.debitNotes().find((n) => n.id === idOrNo || n.no === idOrNo),
  putDebitNote(n: DebitNote) {
    const list = mirror.debitNotes()
    const cur = list.find((x) => x.id === n.id)
    if (cur) replaceObject(cur, n)
    else list.push(n)
    return cur ?? n
  },
  removeDebitNote(id: string) {
    const list = mirror.debitNotes()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.4: the opening stock entries — the VAT returns and the Mushak books read them (the derived stock reads the rows) */
  openings: (): OpeningEntry[] => G.__dzDb!.openings,
  putOpenings(list: OpeningEntry[]) { const a = mirror.openings(); a.splice(0, a.length, ...list) },
  findOpening: (idOrNo: string) => mirror.openings().find((o) => o.id === idOrNo || o.no === idOrNo),
  putOpening(o: OpeningEntry) {
    const list = mirror.openings()
    const cur = list.find((x) => x.id === o.id)
    if (cur) replaceObject(cur, o)
    else list.push(o)
    return cur ?? o
  },
  removeOpening(id: string) {
    const list = mirror.openings()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.4: the production batches — the lot a sales approval checks, a work order's open quantity and the VAT
   *  returns read them (the lots and subcontracting registers themselves read the rows, see derived.ts) */
  batches: (): Batch[] => G.__dzDb!.batches,
  putBatches(list: Batch[]) { const a = mirror.batches(); a.splice(0, a.length, ...list) },
  findBatch: (idOrNo: string) => mirror.batches().find((b) => b.id === idOrNo || b.no === idOrNo),
  putBatch(b: Batch) {
    const list = mirror.batches()
    const cur = list.find((x) => x.id === b.id)
    if (cur) replaceObject(cur, b)
    else list.push(b)
    return cur ?? b
  },
  removeBatch(id: string) {
    const list = mirror.batches()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.5: the price declarations — a batch's lines are priced and consumed from the version in force, and the
   *  bond, the settlement and the VAT registers read them */
  boms: (): Bom[] => G.__dzDb!.boms,
  putBoms(list: Bom[]) { const a = mirror.boms(); a.splice(0, a.length, ...list) },
  findBom: (idOrNo: string) => mirror.boms().find((b) => b.id === idOrNo || b.no === idOrNo),
  putBom(b: Bom) {
    const list = mirror.boms()
    const cur = list.find((x) => x.id === b.id)
    if (cur) replaceObject(cur, b)
    else list.push(b)
    return cur ?? b
  },
  removeBom(id: string) {
    const list = mirror.boms()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.5: the work orders — a batch draws the quantity it issues from one, and its progress follows the batches */
  workOrders: (): WorkOrder[] => G.__dzDb!.workOrders,
  putWorkOrders(list: WorkOrder[]) { const a = mirror.workOrders(); a.splice(0, a.length, ...list) },
  findWorkOrder: (idOrNo: string) => mirror.workOrders().find((w) => w.id === idOrNo || w.no === idOrNo),
  putWorkOrder(w: WorkOrder) {
    const list = mirror.workOrders()
    const cur = list.find((x) => x.id === w.id)
    if (cur) replaceObject(cur, w)
    else list.push(w)
    return cur ?? w
  },
  removeWorkOrder(id: string) {
    const list = mirror.workOrders()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the money accounts — a receipt or payment names one, and the treasury deposits leave from one */
  moneyAccounts: (): MoneyAccount[] => G.__dzDb!.moneyAccounts,
  putMoneyAccounts(list: MoneyAccount[]) { const a = mirror.moneyAccounts(); a.splice(0, a.length, ...list) },
  findMoneyAccount: (id: string) => mirror.moneyAccounts().find((a) => a.id === id),
  putMoneyAccount(a: MoneyAccount) {
    const list = mirror.moneyAccounts()
    const cur = list.find((x) => x.id === a.id)
    if (cur) replaceObject(cur, a)
    else list.push(a)
    return cur ?? a
  },
  removeMoneyAccount(id: string) {
    const list = mirror.moneyAccounts()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the receipts and the payments — what a party has paid, and what an invoice still owes */
  moneyDocs: (): MoneyDoc[] => G.__dzDb!.moneyDocs,
  putMoneyDocs(list: MoneyDoc[]) { const a = mirror.moneyDocs(); a.splice(0, a.length, ...list) },
  findMoneyDoc: (idOrNo: string) => mirror.moneyDocs().find((m) => m.id === idOrNo || m.no === idOrNo),
  putMoneyDoc(m: MoneyDoc) {
    const list = mirror.moneyDocs()
    const cur = list.find((x) => x.id === m.id)
    if (cur) replaceObject(cur, m)
    else list.push(m)
    return cur ?? m
  },
  removeMoneyDoc(id: string) {
    const list = mirror.moneyDocs()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the treasury deposits (TR-6) — what Mushak 9.1 counts as tax already paid, and what a VDS quotes */
  treasury: (): TreasuryDeposit[] => G.__dzDb!.treasury,
  putTreasury(list: TreasuryDeposit[]) { const a = mirror.treasury(); a.splice(0, a.length, ...list) },
  findTreasury: (idOrNo: string) => mirror.treasury().find((t) => t.id === idOrNo || t.no === idOrNo),
  putTreasuryDoc(t: TreasuryDeposit) {
    const list = mirror.treasury()
    const cur = list.find((x) => x.id === t.id)
    if (cur) replaceObject(cur, t)
    else list.push(t)
    return cur ?? t
  },
  removeTreasury(id: string) {
    const list = mirror.treasury()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the VDS entries (Mushak 6.6) — an approved certificate settles part of an invoice */
  vds: (): VdsEntry[] => G.__dzDb!.vds,
  putVds(list: VdsEntry[]) { const a = mirror.vds(); a.splice(0, a.length, ...list) },
  findVds: (idOrNo: string) => mirror.vds().find((v) => v.id === idOrNo || v.no === idOrNo),
  putVdsDoc(v: VdsEntry) {
    const list = mirror.vds()
    const cur = list.find((x) => x.id === v.id)
    if (cur) replaceObject(cur, v)
    else list.push(v)
    return cur ?? v
  },
  removeVds(id: string) {
    const list = mirror.vds()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the VAT adjustments — the 9.1 notes no book can derive, including SD on the inputs of exported goods */
  adjustments: (): VatAdjustment[] => G.__dzDb!.adjustments,
  putAdjustments(list: VatAdjustment[]) { const a = mirror.adjustments(); a.splice(0, a.length, ...list) },
  findAdjustment: (idOrNo: string) => mirror.adjustments().find((a) => a.id === idOrNo || a.no === idOrNo),
  putAdjustment(a: VatAdjustment) {
    const list = mirror.adjustments()
    const cur = list.find((x) => x.id === a.id)
    if (cur) replaceObject(cur, a)
    else list.push(a)
    return cur ?? a
  },
  removeAdjustment(id: string) {
    const list = mirror.adjustments()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the Mushak 9.1 returns — one per tax period, and the lock every document reads before it is written */
  returns: (): VatReturn[] => G.__dzDb!.returns,
  putReturns(list: VatReturn[]) { const a = mirror.returns(); a.splice(0, a.length, ...list) },
  findReturn: (idOrPeriod: string) => mirror.returns().find((r) => r.id === idOrPeriod || r.period === idOrPeriod),
  putReturn(r: VatReturn) {
    const list = mirror.returns()
    const cur = list.find((x) => x.id === r.id)
    if (cur) replaceObject(cur, r)
    else list.push(r)
    return cur ?? r
  },
  removeReturn(id: string) {
    const list = mirror.returns()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R6.2: the exporters' Utilization Declarations — the bond register, the export statements and the sales form's
   *  fit check read them (their own register reads the rows, see uds.ts) */
  uds: (): UdRecord[] => G.__dzDb!.uds,
  putUds(list: UdRecord[]) { const a = mirror.uds(); a.splice(0, a.length, ...list) },
  findUd: (idOrNo: string) => mirror.uds().find((u) => u.id === idOrNo || u.no === idOrNo),
  putUd(u: UdRecord) {
    const list = mirror.uds()
    const cur = list.find((x) => x.id === u.id)
    if (cur) replaceObject(cur, u)
    else list.push(u)
    return cur ?? u
  },
  removeUd(id: string) {
    const list = mirror.uds()
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** R5.6: the NBR settings — one object, replaced in place so the period lock reads the new zone and deadline */
  vatSettings: (): VatSettings => G.__dzDb!.vatSettings,
  putVatSettings(v: VatSettings) { replaceObject(G.__dzDb!.vatSettings, v) },
  /** R5.6: the accounting configuration — one object, replaced in place so a receipt reads the closed books */
  accountingConfig: (): AccountingConfig => G.__dzDb!.accountingConfig,
  putAccountingConfig(c: AccountingConfig) { replaceObject(G.__dzDb!.accountingConfig, c) },
  /** R5.5: the production configuration — one object, replaced in place so `buildBatch` reads the new procedure */
  productionConfig: (): ProductionConfig => G.__dzDb!.productionConfig,
  putProductionConfig(c: ProductionConfig) { replaceObject(G.__dzDb!.productionConfig, c) },
  /** R5.3: the stock documents of one kind — the VAT returns and the Mushak books derive from them */
  stockDocs: (kind: StockDocKind): StockDoc[] => (kind === "transfer" ? G.__dzDb!.transfers : G.__dzDb!.damages),
  putStockDocs(kind: StockDocKind, list: StockDoc[]) { const a = mirror.stockDocs(kind); a.splice(0, a.length, ...list) },
  findStockDoc: (kind: StockDocKind, id: string) => mirror.stockDocs(kind).find((d) => d.id === id || d.no === id),
  putStockDoc(d: StockDoc) {
    const list = mirror.stockDocs(d.kind)
    const cur = list.find((x) => x.id === d.id)
    if (cur) replaceObject(cur, d)
    else list.push(d)
    return cur ?? d
  },
  removeStockDoc(kind: StockDocKind, id: string) {
    const list = mirror.stockDocs(kind)
    const i = list.findIndex((x) => x.id === id)
    return i < 0 ? undefined : list.splice(i, 1)[0]
  },
  /** Deleted documents and parties (the 10-second undo); party entries mirror `parties.deleted_at`. */
  trash: (): TrashEntry[] => G.__dzDb!.trash,
  audit: () => G.__dzAudit!,
}
