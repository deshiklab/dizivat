import type { Company, CompanySummary } from "../types"

/**
 * Company profile — values from the legacy "Manage Organization" screen (public registration data).
 * Personal identifiers (owner/signatory NID, owner mobile) are demo placeholders, not the real numbers.
 */
const seed = (): Company => ({
  name: "PUL INDUSTRIES LTD",
  vatSlab: "standard",
  bin: "001925823-0404",
  tin: "794189966697",
  mobile: "01918-072816",
  phone: "02-28919534",
  email: "factory@pul-group.com",
  address: "House # 08, Chaybaria, Dhamrai, Dhaka - 1350, Bangladesh",
  owner: { name: "NOOR MAHMUD KHAN", nid: "1990000000001", mobile: "01700-000001", designation: "Managing Director" },
  signatory: { name: "Md. Chanchal Mahmud", designation: "Shift-In-Charge", mobile: "01918-072816", email: "factory@pul-group.com", nid: "1990000000002" },
  branches: [
    { id: "b1", name: "Factory — Dhamrai", address: "House # 08, Chaybaria, Dhamrai, Dhaka - 1350", category: "factory", code: "0404" },
    { id: "b2", name: "Head office — Dhanmondi", address: "Road 27 (old), Dhanmondi, Dhaka - 1209", category: "office" },
    { id: "b3", name: "Finished goods store — Savar", address: "Hemayetpur, Savar, Dhaka - 1340", category: "warehouse" },
  ],
  updatedAt: "2026-07-01T04:00:00.000Z",
  updatedBy: "System Administrator",
})

const g = globalThis as unknown as { __rbsCompany?: Company }
export const company: Company = (g.__rbsCompany ??= seed())
export const companySummary = (): CompanySummary => ({ name: company.name, bin: company.bin, address: company.address, vatSlab: company.vatSlab })
