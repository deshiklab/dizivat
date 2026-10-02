# RMG (ready-made garments) — VAT features (R6 / R6.2 / R6.3 / R6.4 / R6.5 / R6.6)

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

## 6. R6.4 — bond consumption register and duty drawback

A bonded garment factory imports fabric, yarn and accessories **without paying duty**: the Bill of Entry is a
warehousing entry (IM-7) secured by the general bond, and the goods may only leave the bond inside exported garments.
Customs Act s.114 requires a register of these goods (s.114(3): duty-paid and locally bought inputs too); the Bond
Commissionerate settles each UD after export, audits the register every year and charges the full duty on anything
that is not accounted for. A direct garment exporter needs no annual entitlement — imports follow each UD and its master
LC — but the bond licence must be renewed every two years.

- **Bonded import:** *Purchases › New import* has a switch **Imported under bond (IM-7 warehousing entry)**. The duty
  stack (CD, RD, SD, VAT, AIT, AT) is still assessed from the tariff and kept on each line as `duty.foregone`, but the
  payable fields are 0: no TTI, no input tax credit, landed cost = assessable value. Mushak 9.1 reports the value in
  **note 11** (zero-rated import). The purchase shows an *Under bond* badge. Go-live bonded stock is brought forward on
  the opening-stock entry (`bond: {boeNo, boeDate, qty, dutyForegone}`) so its bonding period runs from the original
  Bill of Entry.
- **Consumption = the input–output coefficient:** every approved export invoice (direct and deemed) × the gross quantity
  (incl. wastage) of each input in the approved BOM (Mushak 4.3) in force on the export date. One chronological pass
  per input; consumption is met from **bonded lots (oldest Bill of Entry first)**, then **duty-paid imports** (drawback),
  then **local purchases / opening stock**; what is left is *unsourced*.
- **Register** (*NBR VAT › Bond consumption register*, `/vat/bond-consumption`): per input — bonded opening, bonded
  receipts, bonded quantity used in exports (with the total consumption and its duty-paid / local split), bonded
  balance, stock on hand, **shortfall** (book balance above stock on hand) and the duty on the balance / **at risk**
  (shortfall × duty per unit + Bills of Entry past the extension). States: *in balance*, *shortfall*, *over-consumed*
  (unsourced consumption), *not bonded*. A date range (`from` / `to`) re-computes the bonded opening; stock on hand is
  compared only when the range ends today.
- **Bills of Entry:** each bonded line with consumed / balance and the **24-month bonding period** (+ at most 6 months'
  extension by the Commissioner): *open*, *expiring* (≤ 90 days), *in extension*, *overdue* (duty payable), *cleared*.
- **Duty drawback:** customs duty + regulatory duty on the duty-paid import lines each export consumed, claimable on
  Mushak-22 at DEDO within **six months of the export** (*open*, *expiring* ≤ 30 days, *lapsed*). VAT / AT (input credit),
  SD (note 40) and AIT (income-tax advance) are not counted.
- CSV for each tab; the compliance centre lists the register (BOND); two bilingual help articles.

Demo data (R6.4): four bonded Bills of Entry — Jan 2026 denim (cleared by the Feb jeans export), Mar 2026 compact yarn
(part used by the polo exports), Jul 2026 denim + pocketing and Sep 2026 combed yarn + elastane (open) — and two go-live
carry-forwards: pocketing (BoE 5 Nov 2024, bonding period ends 5 Nov 2026 → *expiring*) and printing ink (BoE 20 Aug
2024 → *in extension*; book 76.32 kg vs 55 kg on the shelf → shortfall, about ৳9,072 at risk). Drawback: 13 exports
with duty-paid inputs, one claim window ending on 25 Sep 2026 and ৳1.07 m already lapsed. The bonded imports carry no
tax, so tax payable and the returns are unchanged.

API: `GET /vat/bond?from&to[&format=csv&view=register|lots|drawback]`; `POST /purchases` with `boe.bonded: true` — see
`docs/API.md`.

## 7. R6.5 — UD bond settlement and duty-drawback claims

R6.4 showed *where* bonded inputs and drawback stand; R6.5 adds the two workflows that close them out with customs.

### 7.1 Own UDs / UPs and their settlement

A direct exporter imports its bonded inputs against the **UD** (BGMEA / BKMEA) or **UP** (Bond Commissionerate) of each
export order. The R6.2 UD register holds *customers'* UDs (for our deemed exports); R6.5 adds **our own** UDs / UPs:

- **Bond consumption register › UD settlement** (`/vat/bond-consumption?tab=uds`) — one row per UD: garments ordered vs
  shipped, inputs brought in / used / left, duty on the balance, state (*in progress*, *ready to settle* once fully
  shipped or expired, *settled*) and warnings (imports beyond the UD, exports without a BOM, draft exports, expired).
- Links: a bonded import names the UD under **Imported against our UD / UP** (`boe.udNo`); an export or deemed-export
  invoice names it under **Shipped under our UD / UP** (`export.ownUdNo`). Unknown or already-settled UDs → 422.
- **Statement** per input: UD quantity, brought forward (from earlier settlements), imported, consumed (exports ×
  BOM gross coefficient on the export date), *from other stock* (consumption beyond the UD's own inputs — duty-paid or
  local), balance, excess import, duty foregone / per unit / on the balance.
- **Settlement** (`POST /vat/bond-uds/{id}/settle`, approvers): date, Bond Commissionerate reference, payment reference;
  every balance split between **cleared on duty** and **carried forward** to another open UD that lists the input. The
  statement is frozen; carried quantities appear as *brought forward* on the receiving UD; the cleared quantity leaves
  the bond register (the UD's own Bills of Entry first) and shows there as *cleared on duty*.
- Printable / PDF **settlement statement** (`UD-settlement_<no>.pdf`).

The statement is per UD, as customs settles it; the bond register follows the stock FIFO across UDs, so the two can
differ for an individual Bill of Entry while agreeing in total.

### 7.2 Duty-drawback claims

- On the **Duty drawback** tab, tick open exports (not lapsed, not already claimed) → **Create claim**: a draft with the
  CD + RD frozen per export and input, numbered `DBK-MMYY####`.
- Lifecycle: **draft → filed** (date inside every export's six-month window, DEDO reference) **→ sanctioned** (amount ≤
  claimed; a reason is required when less) **→ refunded** (amount ≤ sanctioned, payment reference); a filed claim can be
  **rejected** (reason), which frees its exports to be claimed again while their window is open. Drafts can be deleted.
- The drawback view shows each export's claim; *claimable / expiring / lapsed* now count only exports not on a claim,
  plus a new *on drawback claims* total. The **Drawback claims** tab totals drafts, pending, sanctioned, refunded and
  disallowed (claimed − sanctioned).
- Printable / PDF **claim statement** — the schedule that goes with the Mushak-22 application (`Drawback-claim_<no>.pdf`).

### 7.3 Demo data (seed r6.5)

| Own UD / UP | Order | Bonded BoE | Exports | State |
|---|---|---|---|---|
| BKMEA/UD/2026/02114 | 24,600 polo | C-1022835 compact yarn 10,000 kg | S-03260014, S-05260016 | Settled 15 Sep 2026: 7,025.76 kg consumed, 2,000 kg carried to 03390, 974.24 kg cleared on duty (৳ 121,591.00) |
| BGMEA/UD/2026/00412 | 11,800 jeans | C-1012264 denim 8,000 m | S-02260017 | Ready (expired); consumption beyond the UD came from duty-paid stock — nothing due |
| BGMEA/UD/2026/01980 | 9,000 jeans | C-1031147 denim + pocketing | — | In progress; pocketing 500 m beyond the UD |
| CUS/UP/2026/1187 | 16,000 kg single jersey | C-1036620 combed yarn + elastane | S-09260013 (deemed) | In progress, 31 % shipped |
| BKMEA/UD/2026/03390 | 30,000 polo | 2,000 kg brought forward | — | In progress |

Claims: DBK-11250001 (refunded, ৳ 2,395.08 disallowed for wastage above the coefficient), DBK-12250002 (refunded),
DBK-03260003 (sanctioned, awaiting refund), DBK-04260004 (rejected — its export has lapsed since), DBK-05260005 and
DBK-07260006 (filed), DBK-09260007 (draft). Still unclaimed: S-03260019 (window closes today) and the June jeans
shipment S-06260012 (৳ 804,310.70).

## 8. R6.6 — export proceeds from the bank's PRC file; Mushak 9.3 and 9.4

### 8.1 Export proceeds (`/vat/proceeds`)

Bangladesh Bank requires export proceeds to be repatriated within **four months (120 days) of shipment**; the AD bank
credits them, reports online and issues a **PRC** (proceeds realisation certificate), which is needed for incentives,
drawback and tax. R6.2 let a user record a PRC on one invoice; R6.6 reads the bank's file.

- **Outstanding:** tiles for outstanding / overdue / due in 30 days / realised this fiscal year, an ageing bar
  (overdue, ≤ 30, ≤ 60, later) and the open list (EXP / LC, outstanding in FC and taka, days left). CSV.
- **Import a bank file** (CSV or XLSX; template download; up to 500 rows). Each row is matched, in order, by **EXP
  number → invoice number → LC number → exact outstanding amount of one invoice**. Bulk credits on one LC are spread
  FIFO across its invoices. Rows come back as matched / partial / split / excess / ambiguous / unmatched / duplicate /
  invalid with the reason; suggestions (★) for unmatched rows. Amounts can be edited and invoices added before posting.
  A PRC number the system already has is a duplicate. Nothing is saved until **Post**.
- **Posting** creates one realisation per allocation (taka at the file's rate) as a **batch** (`PB-MMYY####`) with
  its own page and history. The server re-validates everything (known PRC, currency, before invoice, over the
  outstanding amount, over the row amount). An approver can **reverse** a batch (reason required); its realisations
  are removed and its PRC numbers can be imported again.
- **Feeds the bond side:** own UDs and drawback claims list each export's realisation (pills + PRC numbers) and warn
  while proceeds are unrealised or overdue. The drawback view shows the state per export.

### 8.2 Mushak 9.3 — application to file a return late (s.65, rule 48(1))

- Apply **within 7 days after the tax period ends**, for a date after the due date (15th of the next month) and **at
  most one month** later. One live application per period; not once the return is submitted.
- Draft → **filed** (operator) → **approved** (with a granted date ≤ requested) or **rejected** (reason) by an
  approver. If the Commissioner does not decide within **7 days** the application shows as **deemed approved**.
- Effect: inside the allowed extension the **late-return penalty (note 43) is waived**; **interest (§127, 1 % a month,
  notes 41 / 42) still runs** from the original due date. The penalty calculator and the compliance centre use the
  extension. Printable Mushak 9.3 (PDF); the return page shows the application and links to apply.

### 8.3 Mushak 9.4 — application to amend a submitted return (s.66, rule 49(2))

- Reasons: clerical error, tax underpaid, tax overpaid, other (not forgery). Within **4 years** of the original
  submission; the applicant declares that **no audit / enquiry** has started. Missed decreasing-adjustment / input-credit
  time limits cannot be revived by an amendment (those notes cannot be increased).
- The user enters corrected **source notes** of the 9.1 (as filed → corrected, with an explanation); the totals, net
  tax, payable and closing balance are recomputed and compared with the latest version of the return.
- **Net tax up:** after approval the difference is paid **with interest** from the original due date (no penalty);
  the amended return needs the challan, and a deposit below difference + interest is refused. Interest goes to note 41 /
  42 of the amended computation.
- **Net tax down:** the Commissioner decides within **30 days**, otherwise it is **deemed approved**; the reduction is
  taken as an approved **decreasing adjustment** (note 32 VAT / 39 SD) in a later open tax period.
- After approval the **amended return (9.1 type C, "Amended Return (Section 66)")** is filed with its own
  acknowledgement number; later amendments start from it. Printable Mushak 9.4 (PDF).

### 8.4 Demo data (seed r6.6)

| Record | State |
|---|---|
| PB-05260001, PB-06260002, PB-08260003 | Posted bank files (older realisations, incl. the part payment on S-05260016) |
| PB-09260004 | Reversed 19 Sep 2026 (PRC/26/051877 — wrong invoice) |
| LF-01260001 (Dec 2025) | Rejected — the Dec 2025 return was filed late and paid the penalty |
| LF-09260002 (Sep 2026) | Filed, awaiting the Commissioner (deemed approved after 1 Oct) |
| AM-05260001 (Mar 2026) | Amended — ৳ 48,750 underpaid + ৳ 975 interest deposited |
| AM-09260002 (Jul 2026) | Filed — ৳ 27,000 decrease, deemed approved after 10 Oct |

The demonstration bank file (*Use sample file*) is built from what is open today: one row each by EXP, invoice (short
by bank charges), LC and amount, an amount-only row that needs a manual pick, and a known PRC (duplicate).

## 9. Still planned

1. Drawback at the flat (schedule) rate and DEDO's electronic submission once it is available.
2. Bank file formats per AD bank (column mapping presets) and direct bank feeds.
