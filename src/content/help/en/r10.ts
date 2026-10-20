import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

/** R10 articles: counter POS & thermal receipts/labels, terminal settlement reconciliation, and external POS API. */
export default {
  "counter-pos": {
    title: "Counter POS, thermal receipts and barcode labels",
    summary: "Ring counter sales by scanning barcodes or typing SKUs, split payments across cash, card, bKash and Nagad, close shifts with X/Z reports, and print 80 mm receipts, Mushak 6.3 with QR, and barcode labels.",
    keywords: ["pos", "counter", "barcode", "sku", "mixed tender", "cash", "card", "bkash", "nagad", "shift", "x report", "z report", "variance", "80mm", "thermal receipt", "mushak 6.3", "qr", "irn", "finance act 2026", "labels"],
    body: [
      h("What the counter POS does"),
      p("The [Counter POS](/sales/pos) screen is built for factory outlet counters and retail showrooms. Every item carries its own statutory VAT and supplementary duty rate from the item master, and every completed counter sale issues an approved `POS-MMYYNNNN` invoice with an R8.1 verification QR and a Finance Act 2026 self-issued Mushak 6.3 e-invoice payload."),
      steps(
        "Open [Counter POS](/sales/pos), choose your register (`REG-01`, `REG-02`) and make sure a shift is open.",
        "Scan a barcode into the search box (and press Enter) or click any item tile to add it to the basket.",
        "Split the payment across **Cash**, **Card**, **bKash** or **Nagad** using **Add tender leg**, then click **Complete sale & issue 6.3**.",
      ),
      note("Cash change is computed automatically whenever the cash tender exceeds the remaining payable balance; non-cash tenders (card, bKash, Nagad) require an authorisation or transaction reference."),
      h("Shifts, X reports and Z reports"),
      table(["Action", "What it records", "Who can run it"],
        ["Open shift", "Starts an `SH-MMYYNNNN` shift on the register with the opening cash float", "Anyone who can create documents (`doc.create`)"],
        ["X report", "Live mid-shift snapshot of sales, VAT by rate, tenders and expected drawer cash", "Any signed-in user"],
        ["Close shift (Z report)", "Seals the shift with a `Z-MMYYNNNN` number, records counted cash and computes drawer variance", "Anyone who can approve documents (`doc.approve`)"],
      ),
      h("80 mm receipts, Mushak 6.3 QR and barcode labels"),
      list(
        "**80 mm thermal receipt:** formatted for 80 mm roll printers with Code-128B invoice barcode, Finance Act 2026 IRN and the signed Mushak 6.3 verification QR.",
        "**Statutory Mushak 6.3 & FA 2026 JSON:** switch between the A4 statutory Mushak 6.3 form and the `nbr.gov.bd/mushak-6.3/fa2026-v1` e-invoice adapter JSON inside any POS invoice dialog.",
        "**Barcode labels:** open the **Barcode labels** tab to print `38 × 25 mm`, `50 × 30 mm` or `A4 24-up` Code-128B item stickers with tax-inclusive retail prices.",
      ),
      warn("Once a shift is closed with a Z report, counter invoices inside that shift cannot be voided directly — issue a [Credit note](/sales/credit-notes) if a customer returns goods on a later day."),
      tip("Related: [POS settlement reconciliation](help:pos-settlement), [POS registers & external API](help:pos-external-api), [Sales invoices (Mushak 6.3)](help:sales-invoices), [QR verification on Mushak 6.3](help:invoice-qr)."),
    ],
  },

  "pos-settlement": {
    title: "POS terminal settlement reconciliation",
    summary: "Import card and MFS (bKash / Nagad) terminal settlement statements, auto-match lines against POS invoices, and park MDR commissions and terminal service charges as charge lines.",
    keywords: ["pos", "settlement", "reconciliation", "terminal", "card", "visa", "mastercard", "bkash", "nagad", "mfs", "mdr", "commission", "service charge", "charge line", "match"],
    body: [
      h("Why terminal statements differ from gross POS sales"),
      p("When a customer pays by card, bKash or Nagad at the counter, the POS invoice records the full tender amount, while the acquiring bank or MFS provider settles the batch net of merchant discount rate (MDR) commissions and monthly terminal rental fees. [POS settlement reconciliation](/accounting/pos-reconcile) applies the R8.2 bank-statement matcher pattern to card and MFS terminals."),
      steps(
        "Open [POS settlement reconciliation](/accounting/pos-reconcile) and click **Import terminal batch**.",
        "Pick the settlement money account (`Dutch-Bangla Bank PLC`, `bKash`, `Nagad`) and channel, then click **Preview match plan** to run a dry-run match.",
        "Click **Import statement** to save the statement (`TS-MMYYNNNN`), then review any remaining open lines and click **Park as charge** for terminal fees or **Match POS invoice** for unmatched tenders.",
      ),
      table(["Line status", "Meaning", "Effect on reconciliation"],
        ["matched", "Linked to an approved POS invoice tender by auth reference, invoice number or date + gross amount", "Explains the gross tender and records the MDR fee against the expected account service charge"],
        ["charge", "Terminal rental, gateway fee or standalone commission parked as a charge line", "Explains the fee deduction so the statement reaches 0 unexplained"],
        ["open", "Unmatched settlement line awaiting review", "Counts toward unexplained balance until matched, parked as a charge or ignored"],
      ),
      tip("Related: [Counter POS](help:counter-pos), [Bank reconciliation](help:bank-reconciliation), [Bank & mobile accounts](help:bank-accounts-and-statements)."),
    ],
  },

  "pos-external-api": {
    title: "POS registers, scoped API tokens, webhooks and offline queue",
    summary: "Configure counter registers, issue scoped bearer tokens for third-party POS terminals, verify idempotent sales and sequence-numbered offline queues, and inspect HMAC-SHA256 webhooks.",
    keywords: ["pos", "api", "external", "register", "device", "token", "bearer", "scope", "idempotency", "offline queue", "sequence", "webhook", "hmac", "sha256"],
    body: [
      h("Managing registers and scoped tokens"),
      p("External POS front-ends, handheld barcode terminals and price-checker kiosks connect to DiziVAT through [POS registers & API](/master/pos-devices). Each register binds a physical counter to a branch and default Cash, Card, bKash and Nagad money accounts."),
      steps(
        "Open [POS registers & API](/master/pos-devices) to review registers (`REG-01`, `REG-02`) or add a new counter.",
        "Switch to **Scoped API tokens** and click **Issue scoped token** to generate a `dzpos_…` bearer secret restricted to the scopes that device needs.",
        "Pass the token in `Authorization: Bearer dzpos_…` or `X-POS-Token` when calling `/api/v1/pos/external/*`.",
      ),
      table(["Scope", "Allowed endpoints", "Typical device"],
        ["pos:catalog.read", "`GET /api/v1/pos/external/catalog`", "Price-checker kiosk or tablet catalog"],
        ["pos:stock.read", "`GET /api/v1/pos/external/stock/{sku}`", "Aisle barcode scanner"],
        ["pos:sales.write", "`POST /api/v1/pos/external/sales` (requires `idempotencyKey`)", "Third-party checkout register"],
        ["pos:queue.sync", "`POST /api/v1/pos/external/queue/sync` (sequential `seqNo`)", "Offline-capable counter terminal"],
      ),
      h("Offline sequence queue and signed webhooks"),
      list(
        "**Idempotent sales:** repeating `POST /api/v1/pos/external/sales` with the same `idempotencyKey` and payload replays the original invoice (`200 OK`, `idempotentReplay: true`); reusing a key with different lines or amounts returns `409 Conflict`.",
        "**Offline sequence numbers:** `/api/v1/pos/external/queue/sync` enforces gap-free per-register sequence numbers (`seqNo = lastSeqNo + 1`) while safely replaying already-synced sequence numbers.",
        "**HMAC-SHA256 webhooks:** every sale, void, shift open/close and reconciled terminal statement signs its JSON payload with `sha256=<hex>` using the webhook's secret.",
      ),
      tip("Related: [Counter POS](help:counter-pos), [POS settlement reconciliation](help:pos-settlement), [Audit trail](help:audit-log)."),
    ],
  },
} satisfies Record<string, ArticleText>
