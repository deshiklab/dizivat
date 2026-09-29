import type { Company, CompanySummary } from "../types"

/**
 * Company profile — same fields as the legacy "Manage Organization" screen.
 * Fictitious demo company: every name, number and address here is made up.
 */
const seed = (): Company => ({
  name: "RUPSHA FLEXIPACK LTD",
  vatSlab: "standard",
  bin: "004817362-0105",
  tin: "512378904461",
  mobile: "01700-555101",
  phone: "02-27701234",
  email: "factory@rupsha-flexipack.example",
  address: "Plot 14, Hi-Tech Park Road, Kaliakair, Gazipur - 1750, Bangladesh",
  owner: { name: "AHSAN KABIR CHOWDHURY", nid: "1990000000001", mobile: "01700-000001", designation: "Managing Director" },
  signatory: { name: "Md. Arif Hossain", designation: "Shift-In-Charge", mobile: "01700-555101", email: "factory@rupsha-flexipack.example", nid: "1990000000002" },
  branches: [
    { id: "b1", name: "Factory — Kaliakair", address: "Plot 14, Hi-Tech Park Road, Kaliakair, Gazipur - 1750", category: "factory", code: "0105" },
    { id: "b2", name: "Head office — Banani", address: "House 9, Road 11, Banani, Dhaka - 1213", category: "office" },
    { id: "b3", name: "Finished goods store — Mirpur", address: "Section 7, Mirpur, Dhaka - 1216", category: "warehouse" },
  ],
  updatedAt: "2026-07-01T04:00:00.000Z",
  updatedBy: "System Administrator",
})

const g = globalThis as unknown as { __dzCompany?: Company }
export const company: Company = (g.__dzCompany ??= seed())
export const companySummary = (): CompanySummary => ({ name: company.name, bin: company.bin, address: company.address, vatSlab: company.vatSlab })
