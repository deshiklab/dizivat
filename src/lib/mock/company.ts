import type { Company, CompanySummary } from "../types"

/**
 * Company profile — same fields as the legacy "Manage Organization" screen.
 * Fictitious demo company: every name, number and address here is made up.
 */
const seed = (): Company => ({
  name: "KANCHANJHARA APPAREL COMPOSITE LTD",
  vatSlab: "standard",
  bin: "004937518-0102",
  tin: "512378904461",
  mobile: "01700-555101",
  phone: "02-27701234",
  email: "compliance@kanchanjhara-apparel.example",
  address: "Plot 22-25, BSCIC Road, Konabari, Gazipur - 1346, Bangladesh",
  owner: { name: "AHSAN KABIR CHOWDHURY", nid: "1990000000001", mobile: "01700-000001", designation: "Managing Director" },
  signatory: { name: "Md. Arif Hossain", designation: "Shift-In-Charge", mobile: "01700-555101", email: "compliance@kanchanjhara-apparel.example", nid: "1990000000002" },
  branches: [
    { id: "b1", name: "Factory — Konabari (knit + woven)", address: "Plot 22-25, BSCIC Road, Konabari, Gazipur - 1346", category: "factory", code: "0102" },
    { id: "b2", name: "Head office — Gulshan", address: "House 31, Road 113, Gulshan-2, Dhaka - 1212", category: "office" },
    { id: "b3", name: "Finished goods store — Ashulia", address: "Zirabo, Ashulia, Savar, Dhaka - 1341", category: "warehouse" },
  ],
  updatedAt: "2026-07-01T04:00:00.000Z",
  updatedBy: "System Administrator",
})

const g = globalThis as unknown as { __dzCompany?: Company }
export const company: Company = (g.__dzCompany ??= seed())
export const companySummary = (): CompanySummary => ({ name: company.name, bin: company.bin, address: company.address, vatSlab: company.vatSlab })
