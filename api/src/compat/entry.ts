/**
 * Compat bundle (dist/compat.js): the mock route handlers plus the helpers the native modules need from the same
 * in-memory world. Loaded once at boot, after main.ts has put the saved state into the globals.
 */
export { routeModules } from "./routes.gen"
export { db, usedBranchIds, withStock } from "@/lib/mock/db"
export { badUnit, unitUsage } from "@/lib/mock/units"
export { auditStore, dhakaDay, diff } from "@/lib/mock/audit"
export { tariff, TARIFF_FY } from "@/lib/mock/tariff"
export { userStore, DEMO_PASSWORD } from "@/lib/mock/users"
export { company } from "@/lib/mock/company"
// R5.2: the party rules (aggregates, duplicate/mode checks, stored shape, ids) are shared with the native module,
// so the PostgreSQL API and the mock handlers cannot drift. They read the documents, which are still compat state.
export {
  buildParty, newPartyId, normaliseParty, partyCsvColumns, partyDocs, partyErrors, partyLabel, partyRow, partySpec, PARTY_FIELDS,
} from "@/app/api/v1/_parties"
// R5.2: the item and master-item rules, shared the same way. `withStock` derives `remain` from the item's own
// counters; the branch split and the ledger stay derived from documents (compat state) until R5.3.
export {
  buildItem, buildMaster, flatMaster, itemCsvColumns, itemEdit, ITEM_FIELDS, itemSpec, itemStockValue, masterCsvColumns,
  MASTER_FIELDS, masterErrors, masterFields, masterRow, masterSpec, newItemId, skuTaken,
} from "@/app/api/v1/_items"
