import { z } from "zod"

/** Shared between the client forms (RHF) and the mock API — same contract Symfony will validate. */
export const lineInput = z.object({
  itemId: z.string().min(1, "required"),
  qty: z.number({ error: "required" }).positive("positive"),
  price: z.number({ error: "required" }).min(0, "min0"),
  sdRate: z.number().min(0).max(500),
  vatRate: z.number().min(0).max(100),
  rebateable: z.boolean().optional(),
  vds: z.boolean().optional(),
  /** R3 (sales): production batch (lot) the goods ship from — optional */
  batchId: z.string().max(40).optional(),
})

/**
 * R3: export header. A direct export needs the customs station, destination and Bill of Export; a deemed export
 * (local supply against a back-to-back LC) needs only the LC.
 */
export const exportInput = z.object({
  deemed: z.boolean(),
  lcNo: z.string().trim().min(1, "required").max(40),
  lcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
  customsHouse: z.string().max(10).optional().default(""),
  country: z.string().trim().max(40).optional().default(""),
  billNo: z.string().trim().max(40).optional().default(""),
  billDate: z.string().max(10).optional().default(""),
  shippingAddress: z.string().trim().max(250).optional().default(""),
  cnfFirm: z.string().trim().max(120).optional().default(""),
}).superRefine((e, ctx) => {
  if (e.deemed) return
  const need = (k: "customsHouse" | "country" | "billNo" | "shippingAddress") => { if (!e[k]) ctx.addIssue({ code: "custom", path: [k], message: "required" }) }
  need("customsHouse"); need("country"); need("billNo"); need("shippingAddress")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.billDate)) ctx.addIssue({ code: "custom", path: ["billDate"], message: "required" })
})
export type ExportInput = z.input<typeof exportInput>

export const saleInput = z.object({
  customerId: z.string().min(1, "required"),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
  issueTime: z.string().min(1, "required"),
  deliveryAddress: z.string().max(250).optional().default(""),
  vehicle: z.string().max(80).optional().default(""),
  method: z.enum(["Bank", "Cash", "Cheque", "Mobile"]),
  discount: z.number().min(0, "min0"),
  paid: z.number().min(0, "min0"),
  vds: z.boolean(),
  issuedBy: z.string().min(2, "required"),
  designation: z.string().min(2, "required"),
  narration: z.string().max(500).optional().default(""),
  process: z.enum(["Created", "Approved"]),
  /** branch the goods leave from; "" = main (factory) branch */
  branchId: z.string().max(40).optional().default(""),
  lines: z.array(lineInput).min(1, "atLeastOneLine"),
  /** R3: "service" = service sale (lines reference the sale-service list, no stock) */
  category: z.enum(["goods", "service"]).optional().default("goods"),
  /** R3: export / deemed-export documents — required for a foreign customer */
  export: exportInput.optional(),
})
export type SaleInput = z.input<typeof saleInput>

export const purchaseInput = z.object({
  vendorId: z.string().min(1, "required"),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
  challanNo: z.string().min(1, "required").max(40),
  challanDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required"),
  method: z.enum(["Bank", "Cash", "Cheque", "Mobile", "Transaction"]),
  discount: z.number().min(0, "min0"),
  paid: z.number().min(0, "min0"),
  issuedBy: z.string().min(2, "required"),
  designation: z.string().min(2, "required"),
  narration: z.string().max(500).optional().default(""),
  process: z.enum(["Created", "Approved"]),
  /** branch receiving the goods; "" = main (factory) branch */
  branchId: z.string().max(40).optional().default(""),
  lines: z.array(lineInput).min(1, "atLeastOneLine"),
  /** R2: "service" = service purchase (lines reference the service-code list, no stock) */
  category: z.enum(["goods", "service"]).optional().default("goods"),
})
export type PurchaseInput = z.input<typeof purchaseInput>

/* ── R2 ────────────────────────────────────────────────────────────────── */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required")
const pct = (max = 100) => z.number({ error: "required" }).min(0, "min0").max(max)

/** Import purchase: the challan fields carry the Bill of Entry no./date; lines are priced in USD. */
export const importLineInput = lineInput.extend({
  usd: z.number({ error: "required" }).positive("positive"),
  usdRate: z.number({ error: "required" }).positive("positive"),
  /** customs-assessed value in BDT when it differs from USD × rate (optional) */
  av: z.number().min(0, "min0").optional(),
  price: z.number().min(0).optional().default(0),
  cdRate: pct(400), rdRate: pct(), aitRate: pct(), atRate: pct(),
  sdRate: pct(500),
})
export const boeInput = z.object({
  lcNo: z.string().trim().min(1, "required").max(40),
  lcDate: date,
  customsHouse: z.string().min(1, "required").max(10),
  origin: z.string().trim().min(2, "required").max(40),
  cnfFirm: z.string().trim().max(120).optional().default(""),
  receiveAddress: z.string().trim().max(250).optional().default(""),
})
export const importInput = purchaseInput.extend({
  lines: z.array(importLineInput).min(1, "atLeastOneLine"),
  boe: boeInput,
})
export type ImportInput = z.input<typeof importInput>

export const debitNoteInput = z.object({
  purchaseId: z.string().min(1, "required"),
  issueDate: date,
  issueTime: z.string().min(1, "required"),
  reason: z.enum(["damaged", "quality", "excess", "wrongItem", "priceDispute"], { error: "required" }),
  note: z.string().max(500).optional().default(""),
  issuedBy: z.string().min(2, "required"),
  designation: z.string().min(2, "required"),
  process: z.enum(["Created", "Approved"]),
  /** return quantity per purchase line (0 = not returned) */
  lines: z.array(z.object({ itemId: z.string().min(1), qty: z.number({ error: "required" }).min(0, "min0") })).min(1, "atLeastOneLine"),
})
export type DebitNoteInput = z.input<typeof debitNoteInput>

export const openingInput = z.object({
  itemId: z.string().min(1, "required"),
  branchId: z.string().min(1, "required"),
  date,
  inputTax: z.enum(["standard", "reduced", "zero", "exempt"]),
  qty: z.number({ error: "required" }).positive("positive"),
  price: z.number({ error: "required" }).min(0, "min0"),
  vatPaid: z.number().min(0, "min0").optional().default(0),
  note: z.string().max(300).optional().default(""),
  process: z.enum(["Created", "Approved"]),
})
export type OpeningInput = z.input<typeof openingInput>

export const taxProfileInput = z.object({ vat: pct(), sd: pct(500), cd: pct(400), rd: pct(), ait: pct(), at: pct() })
export const masterItemInput = z.object({
  hsCode: z.string().regex(/^\d{8}$/, "hs8"),
  name: z.string().trim().min(2, "required").max(120),
  group: z.enum(["Raw Material", "Consumable", "Packing Materials", "Finished Goods"]),
  category: z.enum(["general", "commercialImporter", "medicine", "petroleum", "superShop"]),
  unit: z.string().trim().min(1, "required").max(12),
  priceMethod: z.enum(["average", "standard"]),
  description: z.string().trim().max(300).optional().default(""),
  rates: taxProfileInput,
  /** mandatory when a rate differs from the tariff (checked by the API, which knows the tariff) */
  overrideReason: z.string().trim().max(300).optional().default(""),
  active: z.boolean(),
})
export type MasterItemInput = z.input<typeof masterItemInput>

export const itemInput = z.object({
  name: z.string().min(2, "required").max(120),
  hsCode: z.string().regex(/^\d{8}$/, "hs8"),
  group: z.enum(["Raw Material", "Consumable", "Packing Materials", "Finished Goods"]),
  /** code from the Units master — existence is checked by the API */
  unit: z.string().trim().min(1, "required").max(12),
  sku: z.string().min(2, "required").max(30),
  purchasePrice: z.number().min(0, "min0"),
  salePrice: z.number().min(0, "min0"),
  vatRate: z.number().min(0).max(100),
  sdRate: z.number().min(0).max(500),
  reorderLevel: z.number().min(0, "min0"),
  active: z.boolean(),
  /** R2: master item (HS-level product) this SKU belongs to */
  masterItemId: z.string().max(20).optional(),
})
export type ItemInput = z.input<typeof itemInput>

/** BIN as issued by NBR: 9 digits, hyphen, 4-digit branch code (e.g. 004817362-0105). */
export const BIN_RE = /^\d{9}-\d{4}$/
/** Bangladesh NID: 10, 13 or 17 digits (optional "NID " prefix as stored by the legacy system). */
export const NID_RE = /^(NID )?(\d{10}|\d{13}|\d{17})$/
/** Bangladesh mobile: 01[3-9]XXXXXXXX, optional +880 and a hyphen after the operator code. */
export const MOBILE_RE = /^(\+?880[- ]?)?01[3-9]\d{2}-?\d{6}$/

export const partyInput = z
  .object({
    name: z.string().trim().min(2, "required").max(120),
    mode: z.enum(["Local", "Foreign", "Non-registered"]),
    /** BIN (Local), NID (Non-registered) or foreign reference (Foreign) */
    bin: z.string().trim().max(40).default(""),
    country: z.string().trim().max(60).default(""),
    mobile: z.string().trim().max(30).default(""),
    email: z.string().trim().max(120).default(""),
    contactPerson: z.string().trim().max(80).default(""),
    address: z.string().trim().min(5, "required").max(250),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "Local" && !BIN_RE.test(v.bin)) ctx.addIssue({ code: "custom", path: ["bin"], message: "bin" })
    if (v.mode === "Non-registered" && v.bin && !NID_RE.test(v.bin)) ctx.addIssue({ code: "custom", path: ["bin"], message: "nid" })
    if (v.mode === "Foreign" && !v.country) ctx.addIssue({ code: "custom", path: ["country"], message: "required" })
    if (v.mobile && v.mode !== "Foreign" && !MOBILE_RE.test(v.mobile)) ctx.addIssue({ code: "custom", path: ["mobile"], message: "mobile" })
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) ctx.addIssue({ code: "custom", path: ["email"], message: "email" })
  })
export type PartyInput = z.input<typeof partyInput>

export const cancelInput = z.object({ reason: z.string().trim().min(10, "reasonMin").max(300) })

/* ── Sprint 3 ─────────────────────────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const optMobile = z.string().trim().max(30).refine((v) => !v || MOBILE_RE.test(v), "mobile")
const reqMobile = z.string().trim().min(1, "required").refine((v) => MOBILE_RE.test(v), "mobile")
const reqEmail = z.string().trim().min(1, "required").max(120).refine((v) => EMAIL_RE.test(v), "email")

/** Admin: create (invite) or edit a user. Username is immutable after creation. */
export const userInput = z.object({
  username: z.string().trim().toLowerCase().min(1, "required").regex(/^[a-z][a-z0-9._-]{2,29}$/, "username"),
  name: z.string().trim().min(2, "required").max(80),
  designation: z.string().trim().min(2, "required").max(60),
  email: reqEmail,
  mobile: optMobile,
  department: z.string().trim().max(60),
  role: z.enum(["admin", "approver", "operator", "viewer"]),
  active: z.boolean(),
})
export type UserInput = z.input<typeof userInput>
export const userUpdate = userInput.omit({ username: true })

/** Password policy: 8–64 chars with at least one letter and one digit. */
export const newPassword = z.string().min(8, "pwLength").max(64, "pwLength")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "pwMix")
export const passwordChange = z.object({
  current: z.string().min(1, "required"),
  next: newPassword,
  confirm: z.string().min(1, "required"),
}).superRefine((v, ctx) => {
  if (v.next !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "pwMatch" })
  if (v.current && v.next === v.current) ctx.addIssue({ code: "custom", path: ["next"], message: "pwSame" })
})
export type PasswordChange = z.input<typeof passwordChange>

/** Company profile ("Manage Organization"). BIN/TIN formats per NBR. */
export const companyInput = z.object({
  name: z.string().trim().min(2, "required").max(120),
  vatSlab: z.enum(["standard", "truncated", "turnover", "exempt"]),
  bin: z.string().trim().regex(BIN_RE, "bin"),
  tin: z.string().trim().regex(/^\d{12}$/, "tin"),
  mobile: reqMobile,
  phone: z.string().trim().max(30).optional().default(""),
  email: reqEmail,
  address: z.string().trim().min(5, "required").max(300),
  owner: z.object({
    name: z.string().trim().min(2, "required").max(80),
    nid: z.string().trim().optional().default("").refine((v) => !v || /^(\d{10}|\d{13}|\d{17})$/.test(v), "nid"),
    mobile: reqMobile,
    designation: z.string().trim().max(60).optional().default(""),
  }),
  signatory: z.object({
    name: z.string().trim().min(2, "required").max(80),
    designation: z.string().trim().min(2, "required").max(60),
    mobile: reqMobile,
    email: reqEmail,
    nid: z.string().trim().refine((v) => /^(\d{10}|\d{13}|\d{17})$/.test(v) || /^[A-Z]{1,2}\d{7}$/.test(v), "nidOrPassport"),
  }),
  branches: z.array(z.object({
    id: z.string().optional().default(""),
    name: z.string().trim().min(2, "required").max(80),
    address: z.string().trim().min(5, "required").max(200),
    category: z.enum(["factory", "warehouse", "office", "sales"]),
    code: z.string().trim().optional().default("").refine((v) => !v || /^\d{4}$/.test(v), "branchCode"),
  })).min(1, "branchMin").max(30),
})
export type CompanyInput = z.input<typeof companyInput>

/* ── Sprint 4 ─────────────────────────────────────────────────────────────── */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "required")

/** Units-of-measure master. The code is what documents print (Kg, Pcs …) and cannot change once in use. */
export const unitInput = z.object({
  code: z.string().trim().min(1, "required").regex(/^[A-Za-z][A-Za-z0-9.]{0,11}$/, "unitCode"),
  name: z.string().trim().min(2, "required").max(40),
  decimals: z.number({ error: "required" }).int().min(0).max(3),
  active: z.boolean(),
})
export type UnitInput = z.input<typeof unitInput>

export const stockLineInput = z.object({
  itemId: z.string().min(1, "required"),
  qty: z.number({ error: "required" }).positive("positive"),
})
const stockLines = z.array(stockLineInput).min(1, "atLeastOneLine").max(50)

/** Inter-branch stock transfer (NBR Mushak 6.5). Stock moves on approval. */
export const transferInput = z.object({
  fromBranchId: z.string().min(1, "required"),
  toBranchId: z.string().min(1, "required"),
  date: isoDate,
  vehicle: z.string().trim().max(40).optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
  process: z.enum(["Created", "Approved"]),
  lines: stockLines,
}).superRefine((v, ctx) => {
  if (v.fromBranchId && v.fromBranchId === v.toBranchId) ctx.addIssue({ code: "custom", path: ["toBranchId"], message: "sameBranch" })
})
export type TransferInput = z.input<typeof transferInput>

/** Damage / expiry / wastage / loss write-off. Stock leaves the branch on approval. */
export const damageInput = z.object({
  branchId: z.string().min(1, "required"),
  date: isoDate,
  reason: z.enum(["damaged", "expired", "wastage", "lost"]),
  note: z.string().trim().max(300).optional().default(""),
  process: z.enum(["Created", "Approved"]),
  lines: stockLines,
}).superRefine((v, ctx) => {
  // A loss must be explained (NBR may ask for the police GD / insurance claim reference)
  if (v.reason === "lost" && (v.note ?? "").trim().length < 10) ctx.addIssue({ code: "custom", path: ["note"], message: "lostNote" })
})
export type DamageInput = z.input<typeof damageInput>

/* ── R3 ────────────────────────────────────────────────────────────────── */

export const creditNoteInput = z.object({
  saleId: z.string().min(1, "required"),
  issueDate: date,
  issueTime: z.string().min(1, "required"),
  reason: z.enum(["damaged", "quality", "excess", "wrongItem", "priceAdjustment"], { error: "required" }),
  note: z.string().max(500).optional().default(""),
  issuedBy: z.string().min(2, "required"),
  designation: z.string().min(2, "required"),
  process: z.enum(["Created", "Approved"]),
  /** return quantity per sales line (0 = not returned) */
  lines: z.array(z.object({ itemId: z.string().min(1), qty: z.number({ error: "required" }).min(0, "min0") })).min(1, "atLeastOneLine"),
})
export type CreditNoteInput = z.input<typeof creditNoteInput>

export const bomInput = z.object({
  itemId: z.string().min(1, "required"),
  effectiveDate: date,
  licenseDate: z.string().max(10).optional().default(""),
  inputs: z.array(z.object({
    itemId: z.string().min(1, "required"),
    qty: z.number({ error: "required" }).positive("positive"),
    wastagePct: z.number({ error: "required" }).min(0, "min0").max(50, "max50"),
    price: z.number({ error: "required" }).min(0, "min0"),
  })).min(1, "atLeastOneInput"),
  costs: z.array(z.object({
    head: z.enum(["labour", "power", "overhead", "packing", "admin", "finance", "profit", "other"]),
    amount: z.number({ error: "required" }).min(0, "min0"),
  })),
  /** required for version 2+ (checked by the API, which knows the versions) */
  amendmentReason: z.string().trim().max(300).optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
  process: z.enum(["Created", "Approved"]),
})
export type BomFormInput = z.input<typeof bomInput>

export const workOrderInput = z.object({
  requisitionNo: z.string().trim().max(40).optional().default(""),
  issueDate: date,
  dueDate: z.string().max(10).optional().default(""),
  remark: z.string().trim().max(300).optional().default(""),
  lines: z.array(z.object({ itemId: z.string().min(1, "required"), qty: z.number({ error: "required" }).positive("positive") })).min(1, "atLeastOneLine"),
  process: z.enum(["Created", "Approved"]),
})
export type WorkOrderInput = z.input<typeof workOrderInput>

export const batchInput = z.object({
  mode: z.enum(["inHouse", "contractual", "opening"]),
  issueDate: date,
  receiveDate: z.string().max(10).optional().default(""),
  vendorId: z.string().max(40).optional().default(""),
  address: z.string().trim().max(250).optional().default(""),
  remark: z.string().trim().max(300).optional().default(""),
  issuedBy: z.string().min(2, "required"),
  designation: z.string().min(2, "required"),
  lines: z.array(z.object({
    itemId: z.string().min(1, "required"),
    workOrderId: z.string().max(40).optional().default(""),
    issueQty: z.number({ error: "required" }).positive("positive"),
    receiveQty: z.number().min(0, "min0").optional().default(0),
    damageQty: z.number().min(0, "min0").optional().default(0),
    /** opening batches: value per unit brought forward */
    unitCost: z.number().min(0, "min0").optional(),
  })).min(1, "atLeastOneLine"),
  /** consumption method "actual": quantities actually used (defaults to the BOM) */
  consumption: z.array(z.object({ itemId: z.string().min(1), qty: z.number().min(0, "min0") })).optional(),
  process: z.enum(["Created", "Approved"]),
})
export type BatchInput = z.input<typeof batchInput>

/** Contractual batch: finished goods received back from the contract manufacturer. */
export const batchReceiveInput = z.object({
  receiveDate: date,
  lines: z.array(z.object({ receiveQty: z.number({ error: "required" }).min(0, "min0"), damageQty: z.number().min(0, "min0").optional().default(0) })).min(1),
})
export type BatchReceiveInput = z.input<typeof batchReceiveInput>

export const productionConfigInput = z.object({
  procedure: z.enum(["directStock", "workOrder"]),
  consumption: z.enum(["standard", "actual"]),
})
export type ProductionConfigInput = z.input<typeof productionConfigInput>
