import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

export default {
  "local-purchases": {
    title: "Local and import purchases",
    summary: "Record goods bought locally or imported against a Bill of Entry, and claim the right input tax credit.",
    keywords: ["purchase", "buy", "vendor", "supplier", "challan", "import", "bill of entry", "boe", "lc", "customs", "rebate", "input tax credit", "itc", "at", "advance tax", "tti", "cash purchase", "1 lakh"],
    body: [
      h("Local purchase"),
      steps(
        "Open [Purchases](/purchases) and click **New local purchase**.",
        "Under **Supplier & challan**, pick the **vendor** (Local or Non-registered). Enter the **Vendor challan no.** and **Challan date** exactly as printed on the supplier's Mushak 6.3, and the **Receive date**.",
        "Choose the **Receiving branch**. Goods are added to its stock on approval.",
        "Add each item with **Qty** and **Unit price**. SD % and VAT % come from the item.",
        "Leave **Rebate** on for lines eligible for input tax credit. Switch it off for items you may not claim, for example goods not used in taxable supplies.",
        "Choose the **Payment method** and enter any amount **Paid**.",
        "**Save & approve**, or **Save as draft**.",
      ),
      h("Input tax credit rules DiziVAT applies"),
      table(["Situation", "Effect in Mushak 9.1"],
        ["Registered supplier, standard rate, rebate on", "Credit in note 14 (15% local) or note 16 (other rates)"],
        ["**Non-registered** supplier", "No credit; shown in note 20"],
        ["Rebate switched off", "No credit; shown in note 21"],
        ["Supply over ৳1,00,000 paid in **Cash**", "Credit reversed in note 25 (payment not through a banking channel)"],
      ),
      warn("Pay suppliers of more than ৳1,00,000 through a bank, cheque or mobile banking. A cash payment of that size loses the input tax credit."),
      h("Import purchase"),
      steps(
        "Click **New import** in [Purchases](/purchases).",
        "Under **Bill of Entry**, pick the foreign supplier and enter the **Bill of Entry no.** and **date**, **LC no.** and **date** (on or before the BoE date), **Customs house**, **Country of origin**, **C&F agent** and receiving address.",
        "For each line, enter **Qty**, **Value (USD)** and **Rate (৳/USD)**. The assessable value (AV) is USD × rate. If customs re-assessed it, type the **Assessed (৳)** figure instead.",
        "Duty rates pre-fill from the [tariff](/vat/tariff) for the item's HS code (*Rates from tariff HS …*). If the HS code isn't in the tariff, enter the rates from the BoE.",
        "Check the **Duty summary**: assessable value, total tax incidence (TTI), input tax credit and landed cost per unit.",
        "**Save & approve**.",
      ),
      p("CD, RD, SD, VAT, AIT and AT are computed per line. Only **VAT** (note 15, or 17 at other rates) and **AT** (note 30) are creditable. CD, RD, SD and AIT become part of the item's cost."),
      h("After approval"),
      list(
        "Stock increases at the receiving branch and the purchase appears in the [Mushak 6.1 purchase book](help:purchase-sales-books).",
        "The **Due** is paid through [Payments](help:receipts-and-payments). The **Outstanding payables** view lists what you owe.",
        "If goods go back to the supplier, raise a [debit note](help:debit-notes) with **Raise debit note** on the purchase.",
      ),
      tip("Approved purchases can't be edited. Cancel with a reason and re-enter while the period is open."),
    ],
  },

  "service-purchases-vds": {
    title: "Service purchases and VDS",
    summary: "Record services received (transport, security, C&F, repairs…) and withhold VAT at source where required.",
    keywords: ["service purchase", "service", "vds", "vat deducted at source", "withhold", "transport", "security", "c&f", "repair", "rent", "6.6"],
    body: [
      h("Record a service purchase"),
      steps(
        "Open [Service purchases](/purchases/services) and click **New service purchase**.",
        "Pick the local vendor and enter their challan number and date. Foreign vendors can't supply a local service purchase.",
        "Add a line per service using its **NBR service code**. The VAT rate comes from the code, and **VDS** is pre-ticked for services where VAT must be deducted at source.",
        "Enter any amount paid now, then **Save & approve**.",
      ),
      p("Service purchases move no stock. They have their own list with numbers starting **PS-**, and their creditable VAT goes to Part 4 of the return like goods."),
      h("Withholding VAT (VDS)"),
      p("When you are a VDS withholding entity and the service is on the VDS list, you pay the supplier the price **less the VAT** and deposit that VAT to the treasury yourself. DiziVAT tracks this as follows:"),
      steps(
        "After approval, the purchase appears under **To issue** on the [VDS](/vat/vds) page.",
        "Click **Issue for …** (or **Issue VDS certificate (6.6)** on the purchase). The VAT left to withhold pre-fills.",
        "Deposit the withheld VAT with a [TR-6 challan](help:treasury-tr6) under the head *VAT deducted at source* and link that challan to the certificate.",
        "**Save & approve** and print the **Mushak 6.6** certificate for the supplier.",
      ),
      note("Withheld VAT counts in **note 24** of your 9.1 return, and the deposit counts in note 58. See [VDS and Mushak 6.6](help:vds-certificates) for the full rules."),
    ],
  },

  "debit-notes": {
    title: "Debit notes (Mushak 6.8)",
    summary: "Return goods to a supplier. This reduces stock and reverses the input tax credit you claimed.",
    keywords: ["debit note", "6.8", "mushak 6.8", "purchase return", "return to vendor", "supplier return", "reverse rebate", "note 26"],
    body: [
      h("Raise a debit note"),
      steps(
        "Open [Debit notes](/purchases/debit-notes) and click **New debit note**, or click **Raise debit note** on the purchase.",
        "Choose the **Purchase**. Only approved goods purchases with quantity left to return are listed.",
        "Enter the **Return qty** per item. You see purchased, already returned and left. Values are the returned share of the purchase line, including import duties.",
        "Pick a **Reason** (damaged in transit, quality rejected, excess supply, wrong item or price dispute) and add a note.",
        "**Save & approve**, or **Save draft**.",
      ),
      h("What approval does"),
      list(
        "The returned quantity leaves stock at the purchase's branch.",
        "The input tax credit on it is reversed as an increasing adjustment in **note 26** of Mushak 9.1.",
        "The supplier's payable falls by the returned amount.",
      ),
      p("Click **Print 6.8** to print the official debit note and give it to the supplier with the goods."),
      tip("A quantity greater than what is left on the purchase is rejected. Check earlier debit notes on the same purchase first."),
    ],
  },

  "opening-stock": {
    title: "Opening stock",
    summary: "Bring forward stock held before go-live or at the start of the fiscal year, with its value and input-tax class.",
    keywords: ["opening", "opening stock", "opening balance", "brought forward", "go live", "fiscal year", "initial stock"],
    body: [
      h("When to use it"),
      p("Use [Opening stock](/purchases/opening) once per item and branch when you start using DiziVAT, or at the start of a fiscal year if you migrate balances. For finished goods still in production at go-live, use [Production opening](help:work-orders-and-batches) instead."),
      h("Create an opening entry"),
      steps(
        "Click **New opening entry**.",
        "Choose the **item** (the current opening balance is shown) and the **branch**.",
        "Enter **Qty** and **Unit cost**: the purchase price, or the production cost for finished goods.",
        "Choose the **Input tax** class: *Standard (15%)*, *Reduced rate*, *Zero-rated* or *Exempt*.",
        "Enter **VAT paid**, the input VAT already paid on this stock. It is recorded but not claimed again.",
        "**Save & approve**.",
      ),
      p("Approving adds the quantity to the branch stock and to the opening row of the item's Mushak 6.1 or 6.2 book. From the entry you can open the **Mushak book** or **Stock ledger** for the item."),
      warn("Opening entries don't create input tax credit. Credit for stock bought before go-live must already have been claimed in the old system."),
    ],
  },
} satisfies Record<string, ArticleText>
