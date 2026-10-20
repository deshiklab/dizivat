import type { HelpTexts } from ".."
import gettingStarted from "./getting-started"
import sales from "./sales"
import purchase from "./purchase"
import inventoryProduction from "./inventory-production"
import accounting from "./accounting"
import nbrVat from "./nbr-vat"
import adminReference from "./admin-reference"
import r62 from "./r62"
import r63 from "./r63"
import r64 from "./r64"
import r65 from "./r65"
import r66 from "./r66"
import r83 from "./r83"
import r10 from "./r10"

/** English knowledge base. `satisfies` makes a missing or unknown article a type error. */
export const EN = { ...gettingStarted, ...sales, ...purchase, ...inventoryProduction, ...accounting, ...nbrVat, ...adminReference, ...r62, ...r63, ...r64, ...r65, ...r66, ...r83, ...r10 } satisfies HelpTexts
