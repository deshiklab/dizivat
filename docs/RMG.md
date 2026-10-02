# RMG (ready-made garments) — VAT features (R6 / R6.2 / R6.3)

DiziVAT's main customer segment is the garment industry. That covers two kinds of business:

- **Direct exporters:** woven, knit and sweater factories that are 100 % export-oriented and work under a special
  bonded warehouse licence.
- **Deemed exporters:** accessory and packaging makers (cartons, labels, poly bags, buttons, hangers, flexible
  packaging …) that supply the exporters locally against back-to-back LCs.

Both kinds of supply are **zero-rated**: export goes in Mushak 9.1 note 1 and deemed export in note 2, and input VAT
stays recoverable. **But the zero rate only holds when the paperwork is complete.** R6 makes that paperwork part of the
invoice and flags gaps before the return is filed.

## 1. The NBR conditions

**Deemed export.** NBR's clarification of 9 October 2025 lists five conditions. All five must hold, otherwise VAT at
15 % applies:

| # | Condition | Where DiziVAT checks it |
|---|---|---|
| 1 | Supplied to the **actual exporter** | Customer › RMG / export profile › *Exporter type* is set |
| 2 | Against a **local back-to-back LC** | Invoice › LC no. + LC date |
| 3 | **Paid in foreign currency** | Invoice › currency (not BDT) + foreign-currency value |
| 4 | The exporter holds a **bonded / special bonded warehouse** licence | Bond licence on the invoice or the customer, not expired on the invoice date |
| 5 | The item is listed in the exporter's **UD / UP** (Utilization Declaration / Permission) | Invoice › UD / UP no. |

**Direct export.** The documents kept for audit are:
- the export LC or sales contract;
- the **EXP** form number;
- the Bill of Export (number and date);
- the foreign-currency value;
- the customs house and destination.

The rules live in `src/lib/rmg.ts` (`deemedChecks`, `directChecks`, `exportCompliance`). The sale form, the sale detail
and the register all use the same code.

## 2. In the app

- **Customer › RMG / export profile** (local customers): the exporter type (direct garment factory or deemed exporter),
  the bond licence and its expiry, and the BGMEA / BKMEA / BGAPMEA membership. An expired licence shows a warning,
  because deemed exports to that customer stop qualifying.
- **Sale form › Export documents / Deemed export:** the existing LC, customs and Bill of Export fields plus:
  - **UD / UP no. and date** (deemed export);
  - the **exporter's bond licence**, which falls back to the customer's;
  - the **EXP no.** (direct export);
  - **currency, foreign-currency value and exchange rate**, with the taka equivalent shown.
  A live **NBR zero-rating conditions** checklist ticks each condition as it is filled in. Missing items do not block
  saving: the invoice is still zero-rated, but it is flagged *at risk*.
- **Sale detail › export card:** the same documents and the checklist (not shown for cancelled invoices).
- **NBR VAT › Export register** (`/vat/export-compliance`, also linked from the compliance centre as *EXP*): every
  export and deemed-export invoice since 1 July of the previous fiscal year. Each row shows the LC / BBLC, UD, EXP,
  B/E, FC value and rate, the taka value and the conditions met or missing.
  - Totals: direct, deemed and **zero-rating at risk**.
  - Filters: type, *incomplete only* and dates, all kept in the URL.
  - CSV, PDF and print.
- **Business profile** (VAT settings):
  - set the segment to *RMG — direct / deemed / composite*;
  - mark a **100 % export-oriented unit** — Mushak 4.3 then shows the Rule 21 note (price declarations are not
    required);
  - record your own bond licence (warned 90 days before it expires).
- **Advance tax:** import lines are pre-filled with AT at **2 %** for manufacturers (7.5 % for commercial importers),
  per Finance Ordinance 2025.

API: `GET /api/v1/vat/exports?from&to&kind=direct|deemed&risk=1&format=csv`. Customer and invoice fields are listed in
`docs/API.md`.

## 3. Demo data

- **AURORA KNIT COMPOSITE LTD** (Dhaka EPZ) is set up as a direct exporter with bond licence
  `CUS-BOND/DEPZ/B-2231/2020` (valid to 31 Dec 2027) and BKMEA membership.
- Of its two deemed exports in September 2026, the approved one meets all five conditions. The draft still lacks the
  UD, so it shows *at risk*.
- Direct exports carry EXP numbers and USD values at Tk 122. The latest shipment is still waiting for its EXP number.
- Since R6.3 the demo company itself is a garment maker: **KANCHANJHARA APPAREL COMPOSITE LTD** (fictional), a knit +
  woven composite in Konabari, Gazipur (BIN `004937518-0102`, bond `CUS-BOND/DHK/G-1186/2021`, BKMEA-2864) with a
  factory, a Gulshan head office and an Ashulia finished-goods store. The profile is *RMG — composite*, manufacturer
  (AT 2 %). Items are yarn, knit / denim / poplin fabric, trims and packaging (inputs) and T-shirts, polo shirts,
  hoodies, rib and single-jersey fabric and denim jeans (finished goods); BOMs, production batches, an embroidery
  subcontractor and stock are seeded to match.

## 4. R6.2 — deeper RMG

- **UD / bond register** (*NBR VAT › UD / bond register*, `/vat/ud-register`): each exporter's Utilization Declaration
  (or UP) with its items and quantities, the master export LC and buyer, and expiry. Quantities supplied are summed from
  the deemed-export invoices that quote the UD; the register shows used %, remaining and state — *ok*, *warn* (≥ 80 %),
  *exhausted*, *over*, *expired*, *closed*. A second tab lists **bond licences** (your own and every exporter
  customer's), warning 90 days ahead. Once a UD is used, its number and exporter are locked and it cannot be deleted.
- **UD fit on the invoice:** when a deemed-export invoice quotes a UD from the register, the checklist on the sale form
  (live) and the invoice view adds a sixth check — the items are on the UD, the UD is valid on the invoice date and the
  quantities fit what is left. A UD that is not in the register adds no check.
- **Export proceeds (PRC):** on approved foreign-currency exports, record each bank realisation — date, PRC number,
  bank, FC amount and rate (0.5 % over-payment tolerance, PRC numbers unique). The export register shows realised /
  outstanding / **overdue** (unrealised 120 days after shipment) with totals, a filter and a *Record PRC* button; the
  invoice has an *Export proceeds* card. Removing a PRC needs an approver and is audited.
- **Subcontracting (Mushak 6.4) register** (*Production › Subcontracting register*): contractual batches with the
  process (manufacture, printing, embroidery, washing, dyeing, lamination), inputs still at the contractor, days out and
  value; overdue after 30 days by default; CSV.
- **Mushak 6.2.1** purchase-sales book for traded goods and **Mushak 6.5** challan print on stock transfers.
- **RMG starter catalogue** in *Data import*: 31 common garment inputs, trims, labels, packaging and garments with HS
  codes.

Demo data (R6.2): AURORA KNIT has three UDs — the current one 83 % used (warn), a fresh one, and last year's, expired.
Older direct exports are fully realised; two are overdue (one part-paid) and two are still inside the 120-day window.

API: `GET/POST /vat/uds`, `GET/PUT/DELETE /vat/uds/{id}`, `POST /vat/uds/fit`, `POST/DELETE /sales/{id}/realisations`,
`GET /production/subcontract`, `GET /mushak/6.2.1`, `POST /import` — see `docs/API.md`.

## 5. R6.3 — RMG demo company, SD on exported inputs, UD amendments, BB-LC values

- **SD paid on inputs of exported goods (Mushak 9.1 note 40):** polybags, gum tape and export cartons carry SD at
  import. When the goods they go into are **exported within six months of the purchase**, the SD can be taken back as a
  decreasing adjustment of SD (note 40 reduces note 36). *NBR VAT › VAT adjustments* opens with a **six-month register**
  of every SD-paid purchase line — claimed, remaining, the last qualifying export date and the state (*open*, *ends
  soon* < 30 days, *lapsed*, *fully claimed*). **Claim** opens an adjustment of kind *SD on exported inputs* linked to
  the purchase line and a direct-export invoice; the amount is the line's SD pro rata to the quantity claimed. Rules
  (422): approved purchase with SD on the line, an approved direct export shipped inside the window, the claim dated
  before the window ends, tax period not before the export, quantity not above what is unclaimed (drafts reserve
  theirs). Approving re-checks.
- **UD amendments:** changing a UD's quantities, line values or export LC value records a numbered amendment (date,
  reason, before → after); once invoices use the UD the reason is required and a line cannot go below what is
  supplied. The UD sheet lists the amendments.
- **Back-to-back LC values:** UD lines can carry the permitted value (USD) and the UD the export LC value. The BB-LCs
  on the deemed-export invoices that cite the UD are summed per LC and compared with the UD value — *within* (< 80 %),
  *near* (≥ 80 %), *above*. The register shows the used value per UD.

Demo data (R6.3): three SD-paid imports — February's polybags and gum tape (window lapsed, part unclaimed),
April's polybags and cartons (window ends 6 Oct 2026; one approved claim and one draft), August's (open, no export
yet). UD 08812 has a $268,500 export LC, BB-LC `BB-LC-0934-26-0117` at 78.8 % of the UD value and one amendment.

API: `GET /vat/sd-eligible`, `POST /vat/adjustments` with `kind: "sdExport"`, `PUT /vat/uds/{id}` with `amendReason` —
see `docs/API.md`.

## 6. Still planned

1. Duty drawback / bond consumption register (inputs imported under bond vs used in exports).
2. Export proceeds matched automatically from the bank's PRC file.
