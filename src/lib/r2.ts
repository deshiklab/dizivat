/**
 * R2 (Purchase & Inventory) reference data shared by the mock API and the client forms.
 * Service codes and rates are an ILLUSTRATIVE subset — R4 replaces them with the NBR service-code list of the fiscal year.
 */
import type { DebitReason, InputTaxClass, MasterCategory, PriceMethod, ServiceType } from "./types"

/** Customs stations printed on the Bill of Entry (legacy dropdown: code + name). */
export const CUSTOMS_HOUSES = [
  { code: "101", name: "Dhaka Custom House (Airport)" },
  { code: "301", name: "Chattogram Custom House" },
  { code: "501", name: "Mongla Custom House" },
  { code: "601", name: "Benapole Custom House" },
] as const
export const customsHouseName = (code?: string) => CUSTOMS_HOUSES.find((c) => c.code === code)?.name ?? code ?? ""

export const ORIGIN_COUNTRIES = ["China", "Korea", "India", "Japan", "Germany", "Thailand", "Malaysia", "Singapore", "Taiwan", "Turkey", "UAE", "USA"] as const

export const SERVICES: ServiceType[] = [
  { id: "sv1", code: "S031.20", name: "Goods transport (truck / covered van)", vatRate: 10, vds: true, unit: "Trip" },
  { id: "sv2", code: "S037.00", name: "Security services", vatRate: 15, vds: true, unit: "Month" },
  { id: "sv3", code: "S009.00", name: "Clearing & forwarding (C&F) agent", vatRate: 15, vds: true, unit: "Job" },
  { id: "sv4", code: "S024.00", name: "Repair & servicing of machinery", vatRate: 10, vds: true, unit: "Job" },
  { id: "sv5", code: "S099.20", name: "IT-enabled services", vatRate: 5, vds: true, unit: "Month" },
  { id: "sv6", code: "S045.00", name: "Legal & professional advisory", vatRate: 15, vds: true, unit: "Job" },
  { id: "sv7", code: "S066.00", name: "Rent of warehouse / premises", vatRate: 15, vds: true, unit: "Month" },
  { id: "sv8", code: "S020.00", name: "Survey & inspection", vatRate: 15, vds: true, unit: "Job" },
]
export const findService = (id: string) => SERVICES.find((s) => s.id === id)

export const DEBIT_REASONS: DebitReason[] = ["damaged", "quality", "excess", "wrongItem", "priceDispute"]
export const INPUT_TAX_CLASSES: InputTaxClass[] = ["standard", "reduced", "zero", "exempt"]
export const MASTER_CATEGORIES: MasterCategory[] = ["general", "commercialImporter", "medicine", "petroleum", "superShop"]
export const PRICE_METHODS: PriceMethod[] = ["average", "standard"]
export const TAX_KEYS = ["vat", "sd", "cd", "rd", "ait", "at"] as const
