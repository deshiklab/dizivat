import type { TariffLine } from "@/lib/types"
import { findTariff, tariff, tariffFy } from "@/lib/mock/tariff"
import { csvResponse, delay, runQuery, toCSV } from "@/lib/mock/query"
import { json, problem, withAuth } from "../_lib"

const spec = {
  search: (t: TariffLine) => `${t.hsCode} ${t.hsCode.slice(0, 4)}.${t.hsCode.slice(4, 6)}.${t.hsCode.slice(6)} ${t.description}`,
  facets: { vat: (t: TariffLine) => String(t.vat), chapter: (t: TariffLine) => t.chapter, sd: (t: TariffLine) => (t.sd > 0 ? "yes" : "no") },
}

/** NBR tariff. ?hs=12345678 → single line (404 if unknown); ?view=table → Page; ?format=csv. Since R7.1 the
 * active year is runtime state — an import (/vat/tariff/import) replaces it. */

export const GET = withAuth(null, async (req) => {
  const sp = new URL(req.url).searchParams
  const fy = tariffFy()
  const hs = sp.get("hs")
  if (hs) {
    const t = findTariff(hs)
    return t ? json(t) : problem(404, `HS code ${hs} is not in the tariff (FY ${fy}).`)
  }
  if (!sp.get("sort")) sp.set("sort", "hsCode.asc")
  const r = runQuery(tariff, sp, spec)
  if (sp.get("format") === "csv") {
    return csvResponse(toCSV(r.all, [
      { key: "hsCode", label: "HS code" }, { key: "description", label: "Description" },
      ...(["cd", "sd", "vat", "ait", "rd", "at", "tti"] as const).map((k) => ({ key: k, label: k.toUpperCase() })),
    ]), `tariff-${fy}.csv`)
  }
  await delay(150)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { all, ...page } = r
  return json({ ...page, fy })
})
