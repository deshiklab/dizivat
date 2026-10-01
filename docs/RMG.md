# RMG (ready-made garments) — VAT features (R6)

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
- The company profile is *RMG — deemed exporter (accessories / packaging)*: not 100 % export-oriented, manufacturer
  (AT 2 %), with its own bond licence.

## 4. Planned (R6.2+)

1. **UD / bond register:** UD quantities per item and consumption by deemed-export invoices, with an alert before a UD
   is exhausted, and bond licence renewals.
2. **Mushak 6.4** for subcontracted processes (printing, washing, embroidery) and the contractual-production register.
3. **Export proceeds realisation (PRC):** link bank realisation to EXP / invoices.
4. **SD decreasing adjustment** when inputs are exported within six months.
5. A garment-industry item and HS dataset (accessories, packaging, fabrics) for faster setup.
