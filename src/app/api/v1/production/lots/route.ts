import { lotsRoute } from "../../_r3"

/**
 * Finished-goods lots with stock left (`?item=`, `?all=1` includes empty lots, `?exclude=<sale id>` when editing).
 *
 * R5.5: what a lot is made of — the batches that received goods and the invoices that drew on them — is a table each,
 * and the answer is `_r3`'s own `lotsAnswer`, so the API's native register (api/src/modules/derived.ts) answers from
 * the rows with the same code.
 */
export const GET = lotsRoute
