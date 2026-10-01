import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

/** R6.2 articles: RMG exports & UDs, subcontracting, backups & data import, VAT-officer access. */
export default {
  "rmg-exports-and-uds": {
    title: "RMG exports: zero-rating checklist, UD register and export proceeds",
    summary: "Keep exports and deemed exports zero-rated: the NBR conditions on each invoice, the exporters' UDs and bond licences, and bank realisation (PRC).",
    keywords: ["rmg", "garments", "export", "deemed export", "ud", "up", "utilization declaration", "bond", "bond licence", "bblc", "back to back lc", "prc", "proceeds", "realisation", "exp", "zero rated", "bkmea", "bgmea"],
    body: [
      h("The checklist on every export invoice"),
      p("A deemed export (supplies to a bonded garment exporter) is zero-rated only when the paperwork is complete. On the [sales form](/sales/new?type=export) and on the invoice, the **NBR zero-rating conditions** list ticks each condition as you fill it in: back-to-back LC, foreign-currency payment, the exporter's bond licence, the UD / UP number and the exporter itself."),
      p("When the UD is in the **UD register**, a sixth check is added: the items are on the UD, the UD is valid on the invoice date, and the quantities fit what is left. Missing items never block saving, but the invoice is flagged *at risk* in the [export register](/vat/export-compliance)."),
      h("The UD / bond register"),
      steps(
        "Open [UD / bond register](/vat/ud-register) and click **New UD**.",
        "Enter the UD or UP number, the exporter (customers marked as exporters), dates, the master export LC and buyer, and one line per item with the quantity allowed.",
        "Save. Every deemed-export invoice that quotes this UD number now counts against it.",
      ),
      table(["State", "Meaning"],
        ["OK", "Quantities left on every line"],
        ["Warn", "80 % or more of a line is used — ask the exporter for an amended UD in time"],
        ["Exhausted / Over", "A line is fully used, or invoices exceed it"],
        ["Expired / Closed", "Past the expiry date, or closed by you"],
      ),
      p("The **Bond licences** tab lists your own licence and every exporter customer's, and warns 90 days before one expires."),
      note("Once an invoice uses a UD, its number and exporter can no longer be changed and it cannot be deleted — close it instead."),
      h("Export proceeds (PRC)"),
      steps(
        "In the [export register](/vat/export-compliance), filter **Proceeds** by *Overdue* or *Outstanding*.",
        "Click **Record PRC** on the invoice (approved foreign-currency invoices only).",
        "Enter the realisation date, PRC number, bank and branch, amount realised and exchange rate, and save.",
      ),
      p("An invoice is **overdue** when proceeds are still outstanding 120 days after shipment. Part payments show as *Partial*; a small over-payment (0.5 %) is accepted. Each PRC is listed on the invoice under **Export proceeds**; only approvers can remove one, and the removal is audited."),
      tip("Related: [Exports](help:exports) for the export invoice itself."),
    ],
  },

  "subcontracting": {
    title: "Subcontracting register (Mushak 6.4)",
    summary: "Inputs sent to contractors for printing, embroidery, washing or manufacture: what is still out, for how long, and what came back.",
    keywords: ["subcontract", "subcontracting", "contractual production", "job work", "6.4", "mushak 6.4", "printing", "embroidery", "washing", "dyeing", "lamination", "contractor"],
    body: [
      h("Where batches come from"),
      p("A **contractual** [production batch](/production/batches) sends inputs to a contractor under a Mushak 6.4 challan. Choose the **process** on the batch — manufacture, printing, embroidery, washing, dyeing, lamination or other."),
      h("Reading the register"),
      p("[Subcontracting register](/production/subcontract) lists every contractual batch in the period with the quantities issued, received back as finished goods, recorded as wastage, and still **pending** at the contractor."),
      list(
        "**At contractors**: batches with inputs still out.",
        "**Material still out**: value of the pending inputs, in proportion to the quantity not yet back.",
        "**Out more than N days**: change the threshold in the filters (30 days by default).",
        "**Returned**: batches fully received.",
      ),
      tip("Export the register to CSV for the contractor reconciliation. Related: [Work orders and batches](help:work-orders-and-batches)."),
    ],
  },

  "backups-and-data-import": {
    title: "Backups and bulk data import",
    summary: "Automatic backups twice a day as NBR requires for enlisted software, and loading items, customers or vendors from a spreadsheet.",
    keywords: ["backup", "backups", "restore", "sha-256", "checksum", "import", "bulk import", "excel", "xlsx", "csv", "upload", "template", "catalogue", "rmg catalogue", "migration"],
    body: [
      h("Backups"),
      p("NBR requires enlisted VAT software to back up transaction data at least twice a day. DiziVAT takes a backup at **02:00 and 14:00** (Bangladesh time) and keeps the last 30. If the server was asleep at that time, the backup is taken as soon as it wakes."),
      steps(
        "Open [Backups](/master/backups) (administrators).",
        "Click **Back up now** before a large change, such as an import or year-end work.",
        "Use **Verify** to re-check a backup's SHA-256 checksum, and **Download** to keep a copy off-site.",
      ),
      note("A backup contains every table — documents, masters, users (without passwords) and the audit trail. Downloads are recorded in the audit trail."),
      h("Bulk import"),
      steps(
        "Open [Data import](/master/import) and choose **Items**, **Customers** or **Vendors**.",
        "Click **Download template**, fill it in Excel, and save it as .xlsx or .csv. Column names such as *HS code*, *UoM* or *Item code* are recognised.",
        "Choose the file. The first rows are shown so you can check the columns.",
        "Click **Validate**. Every row is checked with the same rules as the entry forms; problems are listed by sheet row.",
        "When all rows pass, click **Import**. Nothing is saved until every row passes.",
      ),
      p("Records already on file (same SKU, BIN or name) are skipped. A garment business can load the **RMG starter catalogue** (31 common inputs, trims, packaging and garments with HS codes) instead of a file, then set prices."),
      warn("Check each HS code against the current tariff after importing — see [Items and HS codes](help:items-and-hs-codes)."),
    ],
  },

  "vat-officer-access": {
    title: "Giving a VAT officer audit access",
    summary: "A read-only login for an NBR official, limited in time, with every page they open recorded in the audit trail.",
    keywords: ["vat officer", "nbr officer", "audit", "inspection", "read only", "access", "expiry", "access until", "access log", "revenue officer"],
    body: [
      h("Create the login"),
      steps(
        "Open [Users & roles](/master/users) and click **Invite user**.",
        "Choose the role **VAT officer** and set **Access until** — at most 90 days ahead.",
        "Give the officer the username and the temporary password shown once.",
      ),
      h("What the officer can do"),
      list(
        "See every register, document, return and report, and download CSV / PDF.",
        "Open the audit trail and run the integrity check.",
        "Nothing else: no entry, edit, approval, settings or user management.",
      ),
      p("After the **Access until** date the officer can no longer sign in, and an open session stops working. Extend or end the access by editing the user."),
      h("The access log"),
      p("Every page the officer opens is written to the [audit trail](/master/audit) as *Access · viewed*, with the page and filters, so you can show exactly what was inspected."),
      tip("Related: [Managing users](help:users-and-roles), [Audit trail](help:audit-log)."),
    ],
  },
} satisfies Record<string, ArticleText>
