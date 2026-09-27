import type { Unit, UnitRow } from "../types"
import { db } from "./db"

/** Number of items using a unit code (a unit in use cannot be deleted or re-coded). */
export const unitUsage = (code: string) => db.items.filter((i) => i.unit === code).length
export const unitRow = (u: Unit): UnitRow => ({ ...u, inUse: unitUsage(u.code) })
/** Item unit must be a known unit; a new/changed choice must also be active. */
export function badUnit(code: string, previous?: string) {
  const u = db.units.find((x) => x.code === code)
  if (!u || (!u.active && code !== previous)) return { unit: ["unknownUnit"] }
  return null
}
