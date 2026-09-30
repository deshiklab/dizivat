import type { ArticleText } from "../types"
import { dl, h, list, note, p, steps, table, tip, warn } from "../blocks"

export default {
  "receipts-and-payments": {
    title: "Receipts and payments",
    summary: "Record money received from customers and paid to suppliers, and allocate it to their open invoices and bills.",
    keywords: ["receipt", "payment", "money receipt", "payment voucher", "collection", "allocate", "allocation", "advance", "on account", "cheque", "bkash", "nagad", "mobile banking", "bank transfer", "cash", "charge"],
    body: [
      h("Record a receipt"),
      steps(
        "Open [Receipts](/accounting/receipts) and click **New receipt**. From an unpaid invoice you can also click **Record receipt**.",
        "Choose the **Customer**. Their open invoices appear with total, due and age.",
        "Enter the **Date** and **Method**. The method decides the account kind and any extra fields (see the table below).",
        "Choose the account under **Received into**. Only active accounts of the matching kind are offered.",
        "Enter the **Amount** and any **Bank / wallet charge**. For wallets the charge is suggested from the account's service charge %.",
        "Under **Allocate to invoices**, click **Oldest first** or type an amount per invoice. Anything left is held **On account (advance)** and settles future invoices.",
        "**Save & approve**. Invoice dues update and the receipt appears in the customer's statement.",
      ),
      table(["Method", "Account kind", "Extra fields"],
        ["Bank transfer", "Bank", "Reference / bank ref."],
        ["Cheque", "Bank", "Cheque no., cheque date, cheque bank"],
        ["Mobile banking", "Mobile wallet", "Transaction ID"],
        ["Cash", "Cash", "none"],
      ),
      p("Open a receipt and choose the **Money receipt** tab to print it, with *Prepared by*, *Checked by*, *Received by* and *Authorised by* signature lines and the amount in words."),
      h("Record a payment"),
      p("[Payments](/accounting/payments) work the same way for suppliers: choose the **Supplier**, pick the account under **Paid from**, allocate to their open bills and print the **Payment voucher**."),
      warn("For purchases above ৳1,00,000, pay by bank transfer, cheque or mobile banking. Cash payments of that size lose the input tax credit (9.1 note 25)."),
      h("Rules to know"),
      list(
        "Dues change only when the receipt or payment is **approved**. Drafts don't affect them.",
        "You can't allocate more than an invoice's due, or more than the amount received.",
        "The party can't change on a saved draft. Delete it and create a new one instead.",
        "Nothing can be dated on or before the **books closed** date set in [Accounting config](help:bank-accounts-and-statements).",
        "Advances are allowed only if *Allow advances* is on.",
      ),
      tip("VAT withheld by a customer (VDS) also settles their invoice. Record it under [VDS](help:vds-certificates), not as a receipt."),
    ],
  },

  "bank-accounts-and-statements": {
    title: "Bank accounts, statements and accounting config",
    summary: "Maintain bank, mobile-wallet and cash accounts, print party statements with ageing, and close the books.",
    keywords: ["bank account", "wallet", "bkash", "nagad", "cash account", "balance", "statement", "ledger", "ageing", "aging", "reconcile", "books closed", "close period", "accounting config"],
    body: [
      h("Bank & mobile accounts"),
      p("[Bank & mobile accounts](/accounting/bank-accounts) lists every account used for receipts, payments and treasury deposits, with inflow, outflow, balance and last movement."),
      steps(
        "Click **New account** and choose the kind: **Add bank account**, **Add mobile wallet** or **Add cash account**. The kind can't change later.",
        "For banks, enter bank, branch, account no., account type and authorised signatory. For wallets, enter provider, wallet number, wallet type, account holder and **Service charge (%)**.",
        "Enter the **Opening balance** and **Opening date**.",
        "Keep **Active** on so the account is available for new documents.",
      ),
      p("Open an account to see its recent movements and history. An account with transactions can't be deleted; deactivate it instead."),
      h("Party statements"),
      steps(
        "Open [Party statements](/accounting/statements) and choose **Customer** or **Supplier**.",
        "Pick the party and the **From**–**To** period.",
        "Read the **Ledger**: opening balance, invoices, receipts or payments, VDS withheld and advances, with a running balance and the **Closing balance**.",
      ),
      list(
        "**Reconciled** confirms the closing balance agrees with the invoice dues less advances.",
        "**Ageing** splits the due into 0–30, 31–60, 61–90 and over 90 days.",
        "**Open invoices** lists what is not yet settled.",
        "**Print** gives a customer or supplier statement to send; **Export CSV** downloads it.",
      ),
      h("Accounting config"),
      p("[Accounting config](/accounting/config) (administrators) holds the rules for receipts and payments:"),
      dl(
        ["Books closed up to", "Receipts and payments dated on or before this date are rejected. Approve or delete open drafts in that range before closing."],
        ["Allow advances", "Amounts not allocated to invoices stay on account and settle later invoices."],
        ["Allocate oldest first", "New receipts and payments pre-fill allocations, oldest invoice first."],
      ),
      note("Treasury deposits (TR-6) can be linked to a bank account. The account then needs enough balance for the deposit."),
    ],
  },
} satisfies Record<string, ArticleText>
