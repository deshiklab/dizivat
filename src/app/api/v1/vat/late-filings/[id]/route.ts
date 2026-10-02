import { lateDelete, lateOne, latePut } from "../../../_r66"

/** R6.6: one Mushak 9.3 application; PUT / DELETE drafts only. */
export const GET = lateOne
export const PUT = latePut
export const DELETE = lateDelete
