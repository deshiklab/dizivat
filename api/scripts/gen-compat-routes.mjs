// Generates src/compat/routes.gen.ts: a static import table of the mock route handlers (src/app/api/v1) that
// have not been ported to native NestJS modules yet. Run by `npm run build`; the output is committed.
import { readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const root = join(here, "../../src/app/api/v1")
/** Routes served by native NestJS modules (api/src/modules). Keep in sync with docs/BACKEND.md. */
export const NATIVE = [
  "auth/login", "auth/logout", "me", "me/password", "me/preferences", "me/views",
  "users", "users/[id]", "users/[id]/reset-password", "company", "audit", "audit/verify", "tariff", "units", "units/[id]",
  "backups", "backups/[id]", "backups/[id]/verify",
  // R5.2: customers and vendors live in the `parties` table
  "customers", "customers/[id]", "customers/[id]/restore", "vendors", "vendors/[id]", "vendors/[id]/restore",
  // R5.2: SKUs and master items live in `items` / `master_items` (the stock ledger and the branch split stay here)
  "items", "items/[id]", "master-items", "master-items/[id]",
  // R5.3: stock transfers and damage entries live in `stock_documents` (the ledger and the branch split derive
  // from every movement document, so they stay here until the rest have tables)
  "transfers", "transfers/[id]", "damage", "damage/[id]",
  // R5.3: sales invoices live in `sales` (their lines in `sale_lines`, their proceeds entries in
  // `sale_realisations`); the branch stock, the ledger and the VAT returns still derive from every document
  "sales", "sales/[id]", "sales/[id]/creditable", "sales/[id]/realisations", "sales/[id]/restore", "sales/bulk",
  "purchases", "purchases/[id]", "purchases/[id]/restore", "purchases/[id]/returnable", "purchases/bulk",
  "credit-notes", "credit-notes/[id]", "debit-notes", "debit-notes/[id]",
  "opening-stock", "opening-stock/[id]",
  // R5.4: production batches live in `batches` (their finished goods in `batch_lines`, the inputs they consume in
  // `batch_consumption`)
  "production/batches", "production/batches/[id]", "production/batches/[id]/receive",
  // R5.5: the work orders live in `work_orders`, their goods in `work_order_lines`, and the progress the approved
  // batches have made on them is columns of those rows
  "production/work-orders", "production/work-orders/[id]",
  // R5.5: the price declarations (Mushak 4.3) live in `boms` — their inputs in `bom_inputs`, their cost heads in
  // `bom_costs` — and the configuration that decides how a batch is produced is the one row of `production_config`
  "production/boms", "production/boms/[id]", "production/config",
  // R5.4: the derived stock — the branch split and an item's ledger add up every movement document, and every
  // family has a table now, so both are read back from the database instead of walked in memory
  "stock", "items/[id]/ledger",
  // R5.5: the two derived registers of production — the finished-goods lots and the subcontracting register add up
  // the batches and the invoices, so both are read back from the database as well
  "production/lots", "production/subcontract",
  // R5.6: accounting — the money accounts (`money_accounts`), the receipts and the payments with the invoices they
  // settle (`money_docs` + `money_allocations`) and the configuration that closes the books (`accounting_config`)
  "accounting/accounts", "accounting/accounts/[id]", "accounting/receipts", "accounting/receipts/[id]",
  "accounting/payments", "accounting/payments/[id]", "accounting/open-invoices", "accounting/statement", "accounting/config",
  // R5.6: the NBR VAT documents that are not invoices — the treasury deposits (`treasury_deposits`), the VDS
  // certificates (`vds_entries`) and the manual VAT adjustments (`vat_adjustments`)
  "vat/treasury", "vat/treasury/[id]", "vat/vds", "vat/vds/[id]", "vat/vds/eligible",
  "vat/adjustments", "vat/adjustments/[id]",
  // R6.2: the exporters' Utilization Declarations — `uds`, with the inputs each permits in `ud_lines`
  "vat/uds", "vat/uds/[id]", "vat/uds/fit",
  "vat/bond-uds", "vat/bond-uds/[id]", "vat/bond-uds/[id]/settle",
  "vat/late-filings", "vat/late-filings/[id]", "vat/late-filings/[id]/action",
  "vat/return-amendments", "vat/return-amendments/[id]", "vat/return-amendments/[id]/action",
  // R5.6: the Mushak 9.1 return (`vat_returns`, one row per tax period) with the note sub-forms behind its
  // computation, the tax periods it can be filed for, the compliance centre over one of them, and the NBR settings
  // (the one row of `vat_settings`)
  "vat/returns", "vat/returns/[period]", "vat/returns/[period]/notes/[note]", "vat/periods", "vat/compliance",
  "vat/settings",
  // R5.6: the readers — nothing here stores a row of its own. The Mushak books over one item and a range (6.1,
  // 6.2, 6.2.1, 6.10), the dashboard, the ⌘K search, the notifications and their mark-as-read, the two service-code
  // lists and the bulk master-data import.
  "mushak/[form]", "dashboard", "search", "notifications", "notifications/read", "services", "sale-services",
  "import",
]

const found = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (f === "route.ts") found.push(relative(root, dir).split(sep).join("/"))
  }
}
walk(root)
const compat = found.filter((r) => !NATIVE.includes(r)).sort()
const missing = NATIVE.filter((r) => !found.includes(r))
if (missing.length) throw new Error(`native routes without a mock counterpart: ${missing.join(", ")}`)

const lines = [
  "// AUTO-GENERATED by scripts/gen-compat-routes.mjs — do not edit.",
  `// ${compat.length} mock route modules run unchanged inside NestJS (R5.1 compat layer); ${NATIVE.length} are native.`,
  "/* eslint-disable */",
  ...compat.map((r, i) => `import * as m${i} from "@/app/api/v1/${r}/route"`),
  "",
  "export const routeModules: [string, Record<string, unknown>][] = [",
  ...compat.map((r, i) => `  [${JSON.stringify(r)}, m${i}],`),
  "]",
  "",
]
writeFileSync(join(here, "../src/compat/routes.gen.ts"), lines.join("\n"))
console.log(`compat routes: ${compat.length}, native: ${NATIVE.length}`)
