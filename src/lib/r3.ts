/**
 * R3 (Sales & Production) reference data shared by the mock API and the client forms.
 * Service codes and rates are an ILLUSTRATIVE subset — R4 replaces them with the NBR service-code list of the fiscal year.
 */
import type { BatchMode, CostHead, CreditReason, SaleService } from "./types"

/** Services the company sells (knitting, dyeing and printing job work on customer material, samples, testing …). */
export const SALE_SERVICES: SaleService[] = [
  { id: "ss1", code: "S004.00", name: "Fabric dyeing job work (customer greige)", vatRate: 15, vds: true, unit: "Kg" },
  { id: "ss2", code: "S004.10", name: "Screen print & embroidery job work (per lot)", vatRate: 15, vds: true, unit: "Lot" },
  { id: "ss3", code: "S021.00", name: "Sample development & pattern making", vatRate: 15, vds: true, unit: "Job" },
  { id: "ss4", code: "S024.00", name: "Knitting job work (commission, customer yarn)", vatRate: 10, vds: true, unit: "Kg" },
  { id: "ss5", code: "S020.00", name: "Laboratory testing (fabric & garment)", vatRate: 15, vds: true, unit: "Job" },
  { id: "ss6", code: "S066.00", name: "Warehouse rent (finished goods of customer)", vatRate: 15, vds: true, unit: "Month" },
]
export const findSaleService = (id: string) => SALE_SERVICES.find((s) => s.id === id)

export const CREDIT_REASONS: CreditReason[] = ["damaged", "quality", "excess", "wrongItem", "priceAdjustment"]
export const CREDIT_REASON_TONE = { damaged: "danger", quality: "warning", excess: "info", wrongItem: "neutral", priceAdjustment: "neutral" } as const

export const EXPORT_COUNTRIES = ["UAE", "Sri Lanka", "India", "Nepal", "Bhutan", "Myanmar", "Saudi Arabia", "Kenya", "Nigeria", "Vietnam", "Philippines", "Germany", "USA", "United Kingdom", "Spain", "Netherlands", "France", "Poland", "Canada", "Japan"] as const

/** Value-addition heads of the 4.3 price declaration, in the NBR form's order. */
export const COST_HEADS: CostHead[] = ["labour", "power", "overhead", "packing", "admin", "finance", "other", "profit"]

export const BATCH_MODES: BatchMode[] = ["inHouse", "contractual", "opening"]
export const BATCH_MODE_TONE = { inHouse: "info", contractual: "warning", opening: "neutral" } as const
