import { bondUdsGet, bondUdsPost } from "../../_r65"

/** R6.5 (RMG): our own UDs / UP — register with settlement statements (?state=, ?format=csv); POST = new UD / UP. */
export const GET = bondUdsGet
export const POST = bondUdsPost
