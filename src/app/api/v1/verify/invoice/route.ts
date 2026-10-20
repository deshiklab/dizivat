import { verifyInvoiceAnswer } from "@/lib/invoice-qr"
import { company } from "@/lib/mock/company"
import { db } from "@/lib/mock/db"
import { posSaleAsSale } from "@/lib/pos"

/**
 * R8.1 (e-invoicing): public verification of a Mushak 6.3 — GET /verify/invoice?token=<the QR's token>.
 * No session: anyone holding a printed copy (buyer, NBR) can check it. The answer recomputes the signature
 * over the invoice as it stands in the books, so a genuine copy of an unaltered invoice verifies (cancelled
 * included — the answer says so), while an edited or hand-crafted token does not.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? ""
  const invNo = token.split(".")[0]
  const posSale = db.posSales.find((s) => s.invoiceNo === invNo)
  const sale = db.sales.find((s) => s.invoiceNo === invNo) ?? (posSale ? posSaleAsSale(posSale) : null)
  return Response.json(await verifyInvoiceAnswer(token, sale, { bin: company.bin, name: company.name }))
}
