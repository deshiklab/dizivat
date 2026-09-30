/**
 * Compat bundle (dist/compat.js): the mock route handlers plus the helpers the native modules need from the same
 * in-memory world. Loaded once at boot, after main.ts has put the saved state into the globals.
 */
export { routeModules } from "./routes.gen"
export { db, usedBranchIds } from "@/lib/mock/db"
export { unitUsage } from "@/lib/mock/units"
export { auditStore, dhakaDay, diff } from "@/lib/mock/audit"
export { tariff, TARIFF_FY } from "@/lib/mock/tariff"
export { userStore, DEMO_PASSWORD } from "@/lib/mock/users"
export { company } from "@/lib/mock/company"
