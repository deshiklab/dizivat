import type { ArticleText } from "../types"
import { h, list, note, p, steps, table, tip, warn } from "../blocks"

/** R6.5 articles: own UD / UP bond settlement and duty-drawback claims. */
export default {
  "ud-settlement": {
    title: "UD settlement (bond settlement of our own UDs / UPs)",
    summary: "Link bonded imports and exports to the UD or UP of each export order, see what is left to settle, and record the Bond Commissionerate's settlement — balances carried forward or cleared on duty.",
    keywords: ["ud", "up", "utilization declaration", "utilization permission", "settlement", "ud settlement", "bond settlement", "bgmea", "bkmea", "bond commissionerate", "carry forward", "duty paid", "excess import", "rmg", "garments", "bond"],
    body: [
      h("What settlement is"),
      p("A direct garment exporter imports its bonded inputs against the **UD** (BGMEA / BKMEA) or **UP** (Bond Commissionerate) of each export order. After the last shipment — or once the UD expires — the Bond Commissionerate **settles** it: the inputs imported against the UD are matched with what its exports consumed through the input–output coefficient (BOM, Mushak 4.3)."),
      list(
        "A **balance** left over is either **carried forward** to another of your UDs that lists the input, or **cleared on payment of the full duty**.",
        "Imports **beyond the UD quantity** attract duty unless the UD is amended.",
        "Consumption beyond what the UD brought in was met from other stock (duty-paid inputs — see [Drawback claims](help:drawback-claims) — or local purchases) and needs nothing at settlement.",
      ),
      h("Setting up a UD"),
      steps(
        "Open [Bond consumption register › UD settlement](/vat/bond-consumption?tab=uds) and choose **New UD / UP**.",
        "Enter the number, issuer, date, expiry and export LC, the **garments** the order exports and the **inputs** it permits under bond.",
        "When you record a bonded import, pick the UD under **Imported against our UD / UP**. On the export invoice, pick it under **Shipped under our UD / UP**.",
      ),
      h("Reading the register"),
      table(["Status / column", "Meaning"],
        ["In progress", "The order is still shipping and the UD has not expired"],
        ["Ready to settle", "Every garment is shipped, or the UD has expired"],
        ["Settled", "The settlement is recorded; the statement is frozen"],
        ["In · used · left", "Brought in (imports + brought forward), consumed by the UD's exports, balance to settle"],
        ["Duty on balance", "Duty foregone on the balance, pro rata to what was brought in"],
      ),
      h("Recording the settlement"),
      steps(
        "Open the UD and check the **Settlement statement**: brought forward, imported, consumed, from other stock and balance per input.",
        "Choose **Record settlement**, enter the date and the Bond Commissionerate's reference.",
        "For every input with a balance, split it between **Clear on duty** and **Carry forward** (pick the open UD it goes to). The two must add up to the balance.",
        "Save. The UD is **Settled**; carried quantities appear as **brought forward** on the receiving UD, and the cleared quantity leaves the bond register.",
      ),
      warn("Settle only after every draft export that quotes the UD has been approved or cancelled — DiziVAT refuses otherwise. Once settled, no more imports or exports can be linked to the UD."),
      note("The settlement statement is printable and downloadable as PDF for the Bond Commissionerate file."),
      tip("Related: [Bond consumption register](help:bond-consumption-register), [Drawback claims](help:drawback-claims), [Exports and UDs](help:rmg-exports-and-uds)."),
    ],
  },
  "drawback-claims": {
    title: "Duty-drawback claims (DEDO / Mushak-22)",
    summary: "Put open exports on a drawback claim, file it with DEDO inside the six-month window and track it through sanction and refund — or rejection.",
    keywords: ["drawback claim", "drawback", "dedo", "mushak-22", "refund", "sanction", "disallowed", "rejected", "claim", "customs duty", "regulatory duty", "rmg", "export"],
    body: [
      h("From the drawback view to a claim"),
      p("The [Duty drawback](/vat/bond-consumption?tab=drawback) tab works out, per export, the customs duty (CD) and regulatory duty (RD) paid on the imported inputs it consumed. A **claim** takes one or more of those exports to the Duty Exemption & Drawback Office (**DEDO**) on **Mushak-22**."),
      steps(
        "On the Duty drawback tab, tick the open exports to claim — lapsed exports and exports already on a claim cannot be ticked.",
        "Choose **Create claim**. A **draft** is created with the amounts frozen and a printable claim statement (the schedule of exports, Bills of Entry, inputs, CD and RD).",
        "Choose **File with DEDO** and enter the filing date and DEDO reference. Every export must still be inside its six-month window on that date.",
        "When DEDO decides, record the **sanction** (with the reason if less than claimed) or the **rejection**; when the money arrives, record the **refund**.",
      ),
      h("Statuses"),
      table(["Status", "Meaning"],
        ["Draft", "Prepared, not filed yet — watch the earliest claim date"],
        ["Filed", "With DEDO, awaiting a decision"],
        ["Sanctioned", "DEDO approved an amount — awaiting the refund"],
        ["Refunded", "Money received"],
        ["Rejected", "Refused — the exports can be claimed again while their window is open"],
      ),
      warn("The six-month window is strict. The page header and the drawback tab show what expires within 30 days — file those first."),
      note("Disallowed amounts (claimed − sanctioned) are totalled on the Claims tab so recurring reasons — for example wastage above the declared coefficient — can be fixed in the BOM."),
      tip("Related: [Duty drawback](help:duty-drawback), [UD settlement](help:ud-settlement)."),
    ],
  },
} satisfies Record<string, ArticleText>
