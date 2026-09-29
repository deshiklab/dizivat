import { creditableRoute } from "../../../_r3"

/** Per line item: sold, already returned (non-cancelled credit notes) and still returnable. `?exclude=<cn id>` when editing a draft. */
export const GET = creditableRoute
