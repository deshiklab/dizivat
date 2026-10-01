/**
 * Language-neutral article registry: order, category, the app screens each article documents and related reading.
 * Small on purpose — the shell imports it for "Help for this page"; article text lives in ./en and ./bn.
 */
export const HELP_UPDATED = "2026-10-01"

export const CATEGORIES = ["gettingStarted", "sales", "purchase", "inventory", "production", "accounting", "nbrVat", "masterData", "reference"] as const
export type Category = (typeof CATEGORIES)[number]

interface Meta { category: Category; routes?: string[]; related?: string[] }

export const REGISTRY = {
  "welcome": { category: "gettingStarted", routes: ["/"], related: ["navigation", "sign-in-and-roles", "document-lifecycle"] },
  "sign-in-and-roles": { category: "gettingStarted", routes: ["/login"], related: ["users-and-roles", "welcome"] },
  "navigation": { category: "gettingStarted", related: ["lists-and-preferences", "welcome"] },
  "lists-and-preferences": { category: "gettingStarted", related: ["navigation"] },
  "using-this-help": { category: "gettingStarted", routes: ["/help"], related: ["welcome", "faq"] },

  "sales-invoices": { category: "sales", routes: ["/sales"], related: ["credit-notes", "document-lifecycle", "purchase-sales-books"] },
  "service-sales": { category: "sales", routes: ["/sales/services"], related: ["sales-invoices", "vds-certificates"] },
  "exports": { category: "sales", routes: ["/sales/exports"], related: ["sales-invoices", "vat-return-9-1"] },
  "credit-notes": { category: "sales", routes: ["/sales/credit-notes"], related: ["sales-invoices", "debit-notes"] },

  "local-purchases": { category: "purchase", routes: ["/purchases"], related: ["service-purchases-vds", "debit-notes", "purchase-sales-books"] },
  "service-purchases-vds": { category: "purchase", routes: ["/purchases/services"], related: ["vds-certificates", "local-purchases"] },
  "debit-notes": { category: "purchase", routes: ["/purchases/debit-notes"], related: ["credit-notes", "local-purchases"] },
  "opening-stock": { category: "purchase", routes: ["/purchases/opening"], related: ["items-and-hs-codes", "work-orders-and-batches"] },

  "items-and-hs-codes": { category: "inventory", routes: ["/inventory/items", "/inventory/master-items", "/master/units"], related: ["vat-settings-and-tariff", "bom"] },
  "transfers": { category: "inventory", routes: ["/inventory/transfers"], related: ["company-and-branches", "damage-and-finished-goods"] },
  "damage-and-finished-goods": { category: "inventory", routes: ["/inventory/damage", "/inventory/finished-goods"], related: ["work-orders-and-batches", "purchase-sales-books"] },

  "bom": { category: "production", routes: ["/production/bom", "/vat/mushak-4-3"], related: ["work-orders-and-batches", "items-and-hs-codes"] },
  "work-orders-and-batches": { category: "production", routes: ["/production/work-orders", "/production/batches", "/production/opening", "/production/config"], related: ["bom", "damage-and-finished-goods"] },
  "subcontracting": { category: "production", routes: ["/production/subcontract"], related: ["work-orders-and-batches", "bom"] },

  "receipts-and-payments": { category: "accounting", routes: ["/accounting/receipts", "/accounting/payments"], related: ["bank-accounts-and-statements", "local-purchases"] },
  "bank-accounts-and-statements": { category: "accounting", routes: ["/accounting/bank-accounts", "/accounting/statements", "/accounting/config"], related: ["receipts-and-payments"] },

  "compliance-centre": { category: "nbrVat", routes: ["/vat/mushak"], related: ["vat-return-9-1", "purchase-sales-books"] },
  "vat-return-9-1": { category: "nbrVat", routes: ["/vat/return-9-1"], related: ["treasury-tr6", "vat-adjustments", "vds-certificates"] },
  "treasury-tr6": { category: "nbrVat", routes: ["/vat/tr-6"], related: ["vat-return-9-1"] },
  "vds-certificates": { category: "nbrVat", routes: ["/vat/vds"], related: ["service-purchases-vds", "vat-return-9-1"] },
  "vat-adjustments": { category: "nbrVat", routes: ["/vat/adjustments"], related: ["vat-return-9-1", "credit-notes"] },
  "purchase-sales-books": { category: "nbrVat", routes: ["/vat/mushak-6-1", "/vat/mushak-6-2", "/vat/mushak-6-2-1", "/vat/mushak-6-10"], related: ["compliance-centre", "local-purchases", "sales-invoices"] },
  "rmg-exports-and-uds": { category: "nbrVat", routes: ["/vat/export-compliance", "/vat/ud-register"], related: ["exports", "sales-invoices"] },
  "vat-settings-and-tariff": { category: "nbrVat", routes: ["/vat/settings", "/vat/tariff"], related: ["items-and-hs-codes", "vat-return-9-1"] },

  "customers-and-vendors": { category: "masterData", routes: ["/master/customers", "/master/vendors"], related: ["sales-invoices", "local-purchases"] },
  "users-and-roles": { category: "masterData", routes: ["/master/users"], related: ["sign-in-and-roles", "audit-log"] },
  "company-and-branches": { category: "masterData", routes: ["/master/company"], related: ["transfers", "vat-settings-and-tariff"] },
  "audit-log": { category: "masterData", routes: ["/master/audit"], related: ["users-and-roles", "document-lifecycle"] },
  "backups-and-data-import": { category: "masterData", routes: ["/master/backups", "/master/import"], related: ["items-and-hs-codes", "customers-and-vendors"] },
  "vat-officer-access": { category: "masterData", related: ["users-and-roles", "audit-log"] },

  "document-lifecycle": { category: "reference", related: ["sales-invoices", "vat-return-9-1"] },
  "glossary": { category: "reference", related: ["faq"] },
  "faq": { category: "reference", related: ["glossary", "using-this-help"] },
} satisfies Record<string, Meta>

export type Slug = keyof typeof REGISTRY
export const SLUGS = Object.keys(REGISTRY) as Slug[]
export const isSlug = (s: string): s is Slug => Object.hasOwn(REGISTRY, s)

const meta = (s: Slug): Meta => REGISTRY[s]
export const categoryOf = (s: Slug) => meta(s).category
export const routesOf = (s: Slug) => meta(s).routes ?? []
export const relatedOf = (s: Slug) => (meta(s).related ?? []) as Slug[]
export const slugsIn = (c: Category) => SLUGS.filter((s) => meta(s).category === c)

/** The article documenting a (locale-less) app path — longest route prefix wins. */
export function helpForPath(pathname: string): Slug | null {
  let best: Slug | null = null
  let len = -1
  for (const s of SLUGS) {
    for (const r of routesOf(s)) {
      const hit = r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(r + "/")
      if (hit && r.length > len) { best = s; len = r.length }
    }
  }
  return best
}
