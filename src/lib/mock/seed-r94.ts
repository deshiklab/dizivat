/**
 * R9.4 seed: the asset classes of the NBR Third Schedule (Income Tax Act 2023) and a garment factory's
 * fixed assets — commissioned across the demo's life, one revalued, one already sold, one still a draft
 * (it posts nothing). Depreciation itself is never seeded: the posting rules derive it from these rows,
 * the same way the register derives every other posting.
 */
import type { AssetClass, FixedAsset } from "../types"

const at = (date: string, h = 6) => `${date}T${String(h).padStart(2, "0")}:${String(10 + h).padStart(2, "0")}:00.000Z`
const trail = (date: string, by: string) => [
  { at: at(date), by, action: "created" as const },
  { at: at(date, 1), by, action: "approved" as const },
]

/** The classes the register offers, each with the rate the Third Schedule gives it. */
export function seedAssetClasses(): AssetClass[] {
  return [
    { id: "building", name: "Building (non-factory)", rate: 5, active: true, note: "NBR Third Schedule (ITA 2023) serial 1" },
    { id: "factoryBuilding", name: "Factory building", rate: 10, active: true, note: "NBR Third Schedule (ITA 2023) serial 2" },
    { id: "plant", name: "Plant and machinery (factory)", rate: 15, active: true, note: "NBR Third Schedule (ITA 2023) serial 14 — factory machinery" },
    { id: "equipment", name: "Machinery and equipment (general)", rate: 10, active: true, note: "NBR Third Schedule (ITA 2023) serial 15 — the general rate" },
    { id: "furniture", name: "Furniture and fittings", rate: 10, active: true, note: "NBR Third Schedule (ITA 2023) serial 3" },
    { id: "officeEquipment", name: "Office equipment", rate: 10, active: true, note: "NBR Third Schedule (ITA 2023) serial 4" },
    { id: "computer", name: "Computer hardware", rate: 25, active: true, note: "NBR Third Schedule (ITA 2023) serial 12" },
    { id: "vehicle", name: "Motor vehicles", rate: 10, active: true, note: "NBR Third Schedule (ITA 2023) serial 10 — not for hire" },
  ]
}

/** A factory's fixed assets: the plant, the building it sits in, the office it is run from — and one machine already sold. */
export function seedAssets(): FixedAsset[] {
  const mk = (i: number, no: string, name: string, classId: string, date: string, cost: number, rest: Partial<FixedAsset> = {}): FixedAsset => ({
    id: `fa${i}`, no, name, classId, date, cost, salvage: 0, inputVat: 0, creditable: true,
    process: "Approved", revaluations: [], issuedBy: "Arif Hossain", createdAt: at(date), history: trail(date, "Arif Hossain"),
    ...rest,
  })
  return [
    mk(1, "AS-07250001", "Factory building — Gazuria main plant", "factoryBuilding", "2025-07-05", 42_000_000, {
      revaluations: [{ date: "2026-07-01", toValue: 45_000_000, reason: "Valuer's report — Gazuria industrial land and construction rates moved up.", at: at("2026-07-01"), by: "Arif Hossain" }],
      history: [...trail("2025-07-05", "Arif Hossain"), { at: at("2026-07-01"), by: "Arif Hossain", action: "edited", note: "Revalued to 45,000,000 — valuer's report." }],
    }),
    mk(2, "AS-07250002", "Industrial lockstitch sewing machines (120 units)", "plant", "2025-07-15", 18_500_000, {
      inputVat: 2_775_000, creditable: true, branchId: "b1",
    }),
    mk(3, "AS-09250001", "Diesel generator — 1,000 kVA", "plant", "2025-09-01", 6_800_000),
    mk(4, "AS-11250001", "Managing director's sedan (imported)", "vehicle", "2025-11-20", 4_800_000, {
      inputVat: 720_000, creditable: false, // VAT Act 2012 s.46(2)(a): no input credit on a passenger vehicle
    }),
    mk(5, "AS-01260001", "Product-design workstation lab (12 units)", "computer", "2026-01-10", 1_440_000),
    mk(6, "AS-03260001", "Effluent treatment plant (ETP)", "equipment", "2026-03-01", 5_600_000),
    mk(7, "AS-07250003", "Six-head embroidery machine", "plant", "2025-07-01", 4_200_000, {
      disposal: { date: "2026-08-15", proceeds: 3_550_000, reason: "Replaced with a wider-format machine; sold to a smaller factory in Tongi.", at: at("2026-08-15", 2), by: "Arif Hossain" },
      history: [...trail("2025-07-01", "Arif Hossain"), { at: at("2026-08-15", 2), by: "Arif Hossain", action: "edited", note: "Sold for 3,550,000 — replaced with a wider-format machine." }],
    }),
    {
      ...mk(8, "AS-09260002", "Automatic label printing machine", "plant", "2026-09-10", 1_250_000, {
        salvage: 250_000, branchId: "b1",
      }),
      process: "Created",
      history: [{ at: at("2026-09-22"), by: "Farzana Akter", action: "created" }],
      issuedBy: "Farzana Akter", createdAt: at("2026-09-22"),
    },
  ]
}
