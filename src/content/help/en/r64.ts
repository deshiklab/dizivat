import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

/** R6.4 articles: bond consumption register (Customs Act s.114) and duty drawback. */
export default {
  "bond-consumption-register": {
    title: "Bond consumption register (bonded inputs vs exports)",
    summary: "Track fabric, yarn and accessories imported duty-free under the customs bond against their use in exports, age every Bill of Entry against the 24-month bonding period and find shortfalls before the bond audit.",
    keywords: ["bond", "bonded warehouse", "bond register", "im-7", "warehousing", "bill of entry", "boe", "coefficient", "input output", "bom", "shortfall", "bond audit", "bonding period", "24 months", "extension", "ud", "rmg", "garments", "s.114", "duty foregone"],
    body: [
      h("Why the register matters"),
      p("A bonded garment factory imports its inputs without paying customs duty, SD or VAT: the Bill of Entry is a **warehousing entry (IM-7)** secured by the general bond, and the goods may only leave the bond inside exported garments. Customs Act section 114 requires a register of these goods; the Bond Commissionerate settles each UD after export, audits the register every year and charges the **full duty** on anything it cannot account for."),
      p("[Bond consumption register](/vat/bond-consumption) keeps that register for you from the documents already in DiziVAT: bonded imports, the BOMs (Mushak 4.3) and the export invoices."),
      h("Recording a bonded import"),
      steps(
        "Open **Purchases › New import** and fill in the Bill of Entry as usual.",
        "Switch on **Imported under bond (IM-7 warehousing entry)**. The duty stack is still calculated from the tariff, but it is shown as **Duty foregone (under bond)**: nothing is payable and no input tax is claimed.",
        "Save and approve. The purchase shows an **Under bond** badge, it is reported in Mushak 9.1 **note 11** (zero-rated import) and it appears in the register.",
      ),
      note("Bonded stock that was already in the warehouse at go-live is brought forward on the opening stock with its Bill of Entry, so its bonding period is tracked from the original date."),
      h("How consumption is counted"),
      p("Customs does not count fabric at the cutting table; it uses the **input–output coefficient**. For every approved export invoice (direct or deemed), DiziVAT multiplies each garment quantity by the gross quantity of every input — including wastage — in the BOM in force on the export date."),
      list(
        "Exports use **bonded stock first**, oldest Bill of Entry first.",
        "What bonded stock cannot cover comes from **duty-paid imports** (these qualify for drawback), then from **local purchases and opening stock**.",
        "Anything left is **unsourced**: the BOM or the stock records are out of line with what was shipped.",
      ),
      h("Reading the register"),
      table(["Column / status", "Meaning"],
        ["Bonded opening / receipts", "Bonded balance at the start of the period and bonded Bills of Entry received in it"],
        ["Used in exports", "Bonded quantity consumed by exports; the line below shows the total consumption and how much came from duty-paid and local stock"],
        ["Bonded balance", "What the bond book says should still be in the warehouse"],
        ["Stock on hand", "Actual stock today (only when the period ends today)"],
        ["Shortfall", "The bond book shows more than the stock on hand — the duty on the difference is at risk at the audit"],
        ["Over-consumed", "Exports needed more of the input than all recorded receipts"],
        ["Not bonded", "Inputs consumed by exports that were never imported under bond (listed as s.114(3) requires)"],
      ),
      h("Bills of Entry and the bonding period"),
      p("The **Bills of Entry** tab lists every bonded Bill of Entry with what exports have used from it. Bonded goods must be exported within **24 months**; the Commissioner can extend this by at most **6 months**."),
      table(["Status", "Meaning"],
        ["Open", "Inside the bonding period"],
        ["Expiring", "Fewer than 90 days left — plan exports or apply for an extension"],
        ["In extension", "Past 24 months — an extension from the Commissioner is needed"],
        ["Overdue", "Past the extension — the duty on the balance is payable"],
        ["Cleared", "Fully consumed by exports"],
      ),
      warn("Duty at risk = shortfall × duty per unit, plus the duty on Bills of Entry past their extension. Clear it before the annual bond audit: find the missing stock, correct the BOM, or pay the duty."),
      tip("Related: [Duty drawback](help:duty-drawback), [Exports and UDs](help:rmg-exports-and-uds), [Local purchases and imports](help:local-purchases)."),
    ],
  },
  "duty-drawback": {
    title: "Duty drawback on duty-paid inputs",
    summary: "See the customs and regulatory duty paid on imported inputs that went into each export, the six-month claim window and what has lapsed.",
    keywords: ["drawback", "duty drawback", "dedo", "mushak-22", "refund", "customs duty", "cd", "rd", "regulatory duty", "six months", "6 months", "export", "rmg", "claim"],
    body: [
      h("What can be claimed"),
      p("When a duty-paid imported input goes into an export, the **customs duty (CD)** and **regulatory duty (RD)** paid on it are refundable as duty drawback. You claim on **Mushak-22** at the Duty Exemption & Drawback Office (**DEDO**) within **six months of the export**."),
      list(
        "VAT and AT paid at import are already input tax credit in the Mushak 9.1 return.",
        "SD on inputs of exported goods is taken back through note 40 — see [SD on exported inputs](help:sd-on-exported-inputs).",
        "AIT is an advance of income tax and is not refundable as drawback.",
      ),
      h("The drawback tab"),
      p("In [Bond consumption register](/vat/bond-consumption?tab=drawback), each export lists the duty-paid import lines it consumed (through the BOM coefficient), the CD and RD on that quantity, the last day to claim and the status: **Open**, **Expiring** (30 days or less) or **Lapsed**."),
      steps(
        "Filter the period, open an export and check the import lines it consumed.",
        "Download **Drawback CSV** for the supporting schedule: export invoice, bill of export, Bill of Entry, quantity, CD and RD per line.",
        "File the claim with DEDO before the claim date, with the export documents and the Bills of Entry.",
      ),
      note("Bonded inputs never carry duty, so they never appear here: a factory that imports everything under bond has little or no drawback. Drawback matters for inputs bought duty-paid — for example a rush order bought before the UD was issued."),
      tip("Related: [Bond consumption register](help:bond-consumption-register), [Mushak 9.1 return](help:vat-return-9-1)."),
    ],
  },
} satisfies Record<string, ArticleText>
