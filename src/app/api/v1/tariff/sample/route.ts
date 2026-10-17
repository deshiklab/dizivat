import { csvResponse } from "@/lib/mock/query"
import { tariffTemplateCsv } from "@/lib/sheet"
import { withAuth } from "../../_lib"

/** R7.1 — the expected tariff sheet: the header and two example lines (rates in %, TTI is computed). */
export const GET = withAuth(null, async () => csvResponse(tariffTemplateCsv(), "tariff-template.csv"))
