import type { HelpTexts } from ".."
import gettingStarted from "./getting-started"
import sales from "./sales"
import purchase from "./purchase"
import inventoryProduction from "./inventory-production"
import accounting from "./accounting"
import nbrVat from "./nbr-vat"
import adminReference from "./admin-reference"

/** English knowledge base. `satisfies` makes a missing or unknown article a type error. */
export const EN = { ...gettingStarted, ...sales, ...purchase, ...inventoryProduction, ...accounting, ...nbrVat, ...adminReference } satisfies HelpTexts
