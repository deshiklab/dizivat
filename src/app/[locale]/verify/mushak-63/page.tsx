import { getTranslations, setRequestLocale } from "next-intl/server"
import { STATIC_DEMO } from "@/lib/base-path"
import { verifyInvoiceAnswer } from "@/lib/invoice-qr"
import { company } from "@/lib/mock/company"
import { db } from "@/lib/mock/db"
import { posSaleAsSale } from "@/lib/pos"

/**
 * R8.1 (e-invoice): the public half of the Mushak 6.3 QR. Anyone holding a printed copy — buyer, bank,
 * NBR — scans the QR and lands here; no sign-in. The answer is computed the same way in both runtimes
 * (src/lib/invoice-qr.ts), fetched from the API when the frontend proxies to it (login page discipline).
 */
export default async function VerifyInvoicePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ t?: string }> }) {
  const { locale } = await params
  // In the static demo searchParams is never read — the page prerenders as the informational card
  const token = STATIC_DEMO ? "" : ((await searchParams).t ?? "")
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "verify" })

  // Static demo: no server, nothing to verify against — say so instead of pretending.
  let answer: Awaited<ReturnType<typeof verifyInvoiceAnswer>> = { token, valid: false, reason: "malformed" }
  if (!STATIC_DEMO) {
    const upstream = process.env.API_UPSTREAM?.replace(/\/$/, "")
    if (upstream) {
      const res = await fetch(`${upstream}/api/v1/verify/invoice?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      answer = (await res.json()) as typeof answer
    } else {
      const invNo = token.split(".")[0]
      const posSale = db.posSales.find((x) => x.invoiceNo === invNo)
      const sale = db.sales.find((x) => x.invoiceNo === invNo) ?? (posSale ? posSaleAsSale(posSale) : null)
      answer = await verifyInvoiceAnswer(token, sale, { bin: company.bin, name: company.name })
    }
  }

  const inv = "invoice" in answer ? answer.invoice : undefined
  const reasons = { malformed: t("malformed"), notFound: t("notFound"), altered: t("altered"), badSignature: t("badSignature") } as const
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10">
      <article className="rounded-lg border bg-white p-6 text-neutral-900 shadow-sm">
        <header className="mb-4 border-b border-neutral-200 pb-3 text-center">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-xs text-neutral-500">{t("subtitle")}</p>
        </header>
        {STATIC_DEMO ? (
          <p className="text-sm text-neutral-600">{t("demo")}</p>
        ) : answer.valid && inv ? (
          <>
            <p className="mb-4 flex items-center gap-2 text-base font-semibold text-green-700" role="status">
              <span aria-hidden>✓</span> {t("authentic")}
            </p>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-neutral-500">{t("invoiceNo")}</dt><dd className="font-mono">{inv.invoiceNo}</dd>
              <dt className="text-neutral-500">{t("issueDate")}</dt><dd>{inv.issueDate}</dd>
              <dt className="text-neutral-500">{t("seller")}</dt><dd>{inv.seller.name} · {inv.seller.bin}</dd>
              <dt className="text-neutral-500">{t("buyer")}</dt><dd>{inv.buyer.name}{inv.buyer.bin ? ` · ${inv.buyer.bin}` : ""}</dd>
              <dt className="text-neutral-500">{t("netTotal")}</dt><dd>৳ {inv.netTotal.toLocaleString(locale === "bn" ? "bn-BD" : "en-IN")}</dd>
              <dt className="text-neutral-500">{t("vat")}</dt><dd>৳ {inv.vat.toLocaleString(locale === "bn" ? "bn-BD" : "en-IN")}</dd>
              <dt className="text-neutral-500">{t("status")}</dt>
              <dd>{inv.process === "Cancelled" ? t("cancelled") : inv.process === "Approved" ? t("approved") : t("draft")}</dd>
            </dl>
            {inv.process === "Cancelled" && <p className="mt-3 text-xs text-amber-700">{t("cancelledNote")}</p>}
            <p className="mt-4 text-xs text-neutral-500">{t("footnote")}</p>
          </>
        ) : (
          <>
            <p className="mb-2 flex items-center gap-2 text-base font-semibold text-red-700" role="alert">
              <span aria-hidden>✗</span> {t("invalid")}
            </p>
            <p className="text-sm text-neutral-600">{reasons[("reason" in answer ? answer.reason : "malformed") as keyof typeof reasons]}</p>
            <p className="mt-4 text-xs text-neutral-500">{t("footnote")}</p>
          </>
        )}
      </article>
    </main>
  )
}
