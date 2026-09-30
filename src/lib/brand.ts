/** Product name: one place, so a future rebrand is a one-line change. */
export const BRAND = "DiziVAT"

/** Copyright / credit line shown in the app footer, sign-in page, help centre and exported/printed manuals. */
export const CREDIT = {
  owner: "BITSCOL",
  web: "www.bitscol.com",
  url: "https://www.bitscol.com",
  email: "sales@bitscol.com",
  mobile: "+8801711853769",
} as const

/** Plain-text credit line (exports, Markdown, metadata). `labels` localises "Email"/"Mobile". */
export const creditText = (labels: { email: string; mobile: string } = { email: "Email", mobile: "Mobile" }) =>
  `© ${CREDIT.owner} (${CREDIT.web}), ${labels.email}: ${CREDIT.email}, ${labels.mobile}: ${CREDIT.mobile}`
