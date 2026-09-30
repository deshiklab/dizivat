import type { ArticleText } from "../types"
import { dl, h, list, note, p, steps, table, tip, warn } from "../blocks"

export default {
  "items-and-hs-codes": {
    title: "Items, master items, HS codes and units",
    summary: "Set up products and materials with the right HS code, VAT and SD, and keep the tax profile in line with the NBR tariff.",
    keywords: ["item", "product", "sku", "hs code", "hs", "tariff", "master item", "unit", "uom", "unit of measure", "vat rate", "sd rate", "reorder", "raw material", "finished goods", "stock ledger"],
    body: [
      h("Items"),
      p("[Items](/inventory/items) are the SKUs you buy, produce and sell: raw materials, consumables, packing materials and finished goods. The list shows stock movement columns (opening, purchased, production receive and issue, sold, damage) and **In hand**, with *Low* or *Out of stock* badges."),
      steps(
        "Click **New item**.",
        "Optionally pick a **Master item**. Its HS code, group, unit and VAT/SD rates are copied.",
        "Enter **Item name**, **SKU**, the 8-digit **HS code**, **Item group** and **Unit of measure**.",
        "DiziVAT checks the HS code against the NBR tariff and shows its VAT, SD and CD. If your rates differ, click **Use tariff rates** or keep yours deliberately.",
        "Enter **Purchase price**, **Sale price**, **VAT rate**, **SD rate** and a **Re-order level**. The dashboard warns when stock falls below it.",
        "Save.",
      ),
      warn("Returns with unknown HS codes are rejected by NBR. If DiziVAT says a code *isn't in the NBR tariff*, check it before you use the item."),
      h("Master items"),
      p("[Master items](/inventory/master-items) hold the HS-level tax profile that several SKUs share, for example one laminate HS code with many sizes. Creation takes three steps: **HS code** → **Identity** → **Tax profile**."),
      list(
        "Rates default to the tariff. Changed rates are highlighted as **Overridden** and need a **Reason for override**, which is kept in the audit log.",
        "**Linked SKUs** shows the items using the profile and warns if one of them uses a different VAT rate.",
        "Categories (General, Commercial importer, Medicine, Petroleum, Super-shop) and the price method (Weighted average or Standard cost) describe how the item is valued.",
      ),
      h("Units of measure"),
      p("[Units of measure](/master/units) are the units items are counted in and documents print, such as Kg, Pcs or Sq.m. **Quantity precision** sets how many decimals quantities may have. A unit used by items can't be deleted or have its code changed; deactivate it instead."),
      h("Stock ledger and tariff"),
      dl(
        ["Stock ledger", "Every item has a **Stock ledger**: each movement with date, document and running balance. Open it from the item row menu."],
        ["Tariff & HS codes", "[Tariff & HS codes](/vat/tariff) lists customs and VAT rates by HS code: CD, SD, VAT, AIT, RD, AT and TTI, where TTI is the total tax on import as a % of assessable value."],
      ),
    ],
  },

  "transfers": {
    title: "Stock transfers (Mushak 6.5)",
    summary: "Move goods between your own branches with a transfer challan. Company stock stays the same; only its location changes.",
    keywords: ["transfer", "stock transfer", "6.5", "mushak 6.5", "branch", "warehouse", "move stock", "challan", "vehicle"],
    body: [
      h("Create a transfer"),
      steps(
        "Open [Stock transfers](/inventory/transfers) and click **New transfer**. From [Finished goods](/inventory/finished-goods) you can also click **Transfer** on a product row.",
        "Choose **From branch** and **To branch**. They must differ.",
        "Enter the **Date** and the **Vehicle** registration number, for example *Dhaka Metro-Ta 11-4821*.",
        "Add items and quantities. For each item, the form shows *Available at [branch]*. Values are at cost.",
        "**Save & approve** to move the stock now, or **Save draft**.",
      ),
      p("A transfer never changes company stock, only where it is. It is the NBR **Mushak 6.5** transfer challan; the data you record is what the challan carries."),
      h("Short stock and cancellation"),
      list(
        "If a quantity exceeds the stock at the source branch, you can save a draft but not approve it until the stock is there.",
        "Cancelling an approved transfer moves the goods back, if they are still at the receiving branch.",
        "A deleted draft's number is not reused, and the audit trail keeps the record.",
      ),
      tip("Filter the list by **From**, **To** or **Status**. The **awaiting approval** count in the summary line shows drafts still to approve."),
    ],
  },

  "damage-and-finished-goods": {
    title: "Damage, wastage and finished goods",
    summary: "Write off damaged, expired, wasted or lost stock, and see finished-goods value by branch.",
    keywords: ["damage", "wastage", "write off", "expired", "lost", "stolen", "gd", "finished goods", "fg", "stock value", "process loss"],
    body: [
      h("Record damage or wastage"),
      steps(
        "Open [Damage & wastage](/inventory/damage) and click **New damage entry**.",
        "Choose the **Branch** and a **Reason**.",
        "Add the items and quantities. They are valued at each item's cost price when you save.",
        "In **Note**, give the QA report, GD or insurance reference.",
        "**Save & approve**. The stock leaves the branch.",
      ),
      table(["Reason", "Use for"],
        ["**Damaged**", "Physically damaged in store or handling"],
        ["**Expired**", "Past shelf life or rejected by QA"],
        ["**Process wastage**", "Normal process loss, such as set-up waste or edge trim"],
        ["**Lost / stolen**", "Missing or stolen. The note **must** give the GD or insurance reference"],
      ),
      note("Normal process wastage for production is already part of each [price declaration](help:bom) through its wastage %. Use damage entries for losses outside it."),
      h("Finished goods"),
      p("[Finished goods](/inventory/finished-goods) shows finished-goods stock by branch, valued **at cost** and **at sale price**, with each branch's share of the total. From a row you can open the stock ledger at a branch or start a **Transfer**."),
      tip("Finished goods enter stock when a production batch is approved or its goods are received. See [Work orders and batches](help:work-orders-and-batches)."),
    ],
  },

  "bom": {
    title: "Price declarations and BOM (Mushak 4.3)",
    summary: "Declare input–output coefficients and the price of each finished good. Batches consume inputs at these rates.",
    keywords: ["bom", "bill of materials", "price declaration", "4.3", "mushak 4.3", "input output coefficient", "coefficient", "wastage", "value addition", "declared price", "amend", "version", "where is mushak 4.3", "print 4.3", "4.3 pdf"],
    body: [
      h("What a declaration contains"),
      p("A **price declaration** (Mushak 4.3) states, for **1 unit** of a finished good, the inputs used and their wastage, the value addition, and the resulting **declared price**. DiziVAT keeps one row per version. Only the **Active** version is used by new batches."),
      h("Create a declaration"),
      steps(
        "Open [Bill of materials](/production/bom) and click **New declaration**.",
        "Pick the **Finished good**. The form shows the unit and the current sale price.",
        "Set **Effective from**: batches issued on or after this date use this version. Optionally set **Submitted on** (the date you filed it with the VAT circle).",
        "Add each **input** with **Qty** per unit, **Wastage %** and **Unit price**. DiziVAT shows the wastage and gross quantity per line.",
        "Enter the **value addition** per unit: labour; power, gas and fuel; factory overhead; packing; administrative; financial; other; and profit.",
        "Check the **Declared price**. DiziVAT warns if it is above the item's sale price.",
        "**Save & approve**, or **Save draft**.",
      ),
      h("Amending a declaration"),
      steps(
        "Open the active declaration and click **Amend (new version)**.",
        "Change coefficients or prices and give the **Reason for amendment**, for example a film price increase.",
        "Approve. The new version becomes **Active** and the old one is **Superseded**, but kept for the batches produced under it.",
      ),
      p("**Compare versions** shows the changes side by side, marked *increase*, *decrease*, *added* or *removed*. **Print 4.3** prints the official form."),
      h("Find and print Mushak 4.3"),
      steps(
        "Open **NBR VAT › [Mushak 4.3](/vat/mushak-4-3)**. It is also listed first under [Mushak reports](/vat/mushak), and {{Ctrl+K}} → *4.3* finds it.",
        "Choose what to **Show**: *Current (active)*, *Drafts awaiting approval* or *All versions*. Search by item, SKU, HS code or input.",
        "Click a declaration on the left. The official form appears on the right.",
        "Click **PDF** to download the form as an A4 PDF file, or **Print** to print it.",
      ),
      p("In [Bill of materials](/production/bom), the **Mushak 4.3** tab and **Print 4.3** of a declaration do the same. **Open in Bill of materials** takes you back there to amend or approve."),
      warn("NBR may question supplies priced below the declaration. If an item's sale price falls below its declared price, DiziVAT shows the gap as a percentage."),
      tip("Only one draft per item is allowed. Edit or cancel the existing draft first."),
    ],
  },

  "work-orders-and-batches": {
    title: "Work orders, batches and Mushak 6.4",
    summary: "Plan production with work orders, issue inputs and receive finished goods in batches, in-house or through a contractor.",
    keywords: ["production", "batch", "work order", "requisition", "6.4", "mushak 6.4", "contract manufacturing", "contractual", "in-house", "consumption", "production opening", "production config", "goods in process"],
    body: [
      h("Work orders"),
      p("A [work order](/production/work-orders) says what the floor must produce and by when. Only items with an approved [price declaration](help:bom) can be ordered."),
      steps(
        "Click **New work order**, enter the **Requisition no.**, **Issue date** and **Due date**.",
        "Add the finished goods and quantities. The form shows current stock and disables items with *no approved BOM*.",
        "**Save & approve**. The order is **Open**. As batches reference it, it moves to **In progress** and then **Completed**, and shows as *overdue* after the due date.",
      ),
      h("Production batches"),
      table(["Batch type", "Use when"],
        ["**In-house**", "Produced in your factory. Inputs are issued and goods received in one document."],
        ["**Contractual**", "Inputs are sent to a contract manufacturer with Mushak 6.4. Goods come back later."],
      ),
      steps(
        "Open [Production batches](/production/batches) and click **New batch**, or click **New batch from this work order**.",
        "Choose the **Batch type**. For contractual batches, pick the contract manufacturer and delivery address.",
        "Add finished goods with **Issue qty**, and the **Work order** if the procedure requires one. The line shows the BOM version and unit cost.",
        "Review **Input consumption**. Under the standard method it is the gross BOM quantity × issue quantity. Under the actual method you enter the quantities really used.",
        "**Save & approve**. Inputs leave stock as issued to production. In-house goods enter stock at the BOM unit cost.",
      ),
      p("For contractual batches, click **Receive goods** when the contractor returns them. Enter **Receive qty** and any **Damage qty**; received plus damaged can't exceed the quantity issued. Click **Print 6.4** to print the challan that goes with the inputs."),
      warn("If an input is short at the factory, the batch can be saved as a draft but not approved."),
      h("Production opening and settings"),
      dl(
        ["Production opening", "[Production opening](/production/opening) brings forward goods in process at go-live. No inputs are consumed; the quantity enters stock at the unit cost."],
        ["Production config", "[Production config](/production/config) (administrators) sets the **procedure** (*Direct stock*, where work orders are optional, or *Through work orders*, where every batch line needs one) and the **consumption method** (*Standard (BOM)* or *Actual*). Changes apply to new batches only."],
      ),
      note("Finished goods produced here appear in the [Mushak 6.2 sales book](help:purchase-sales-books) as *Produced / in*, and inputs in the 6.1 book as *Consumed / out*."),
    ],
  },
} satisfies Record<string, ArticleText>
