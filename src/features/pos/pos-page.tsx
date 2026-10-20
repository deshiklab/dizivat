"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import qrcode from "qrcode-generator"
import {
  Barcode,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  Lock,
  Minus,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  Unlock,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { useCan, useCompany } from "@/components/auth/me-provider"
import { PageHeader } from "@/components/common/page-header"
import { Pill, ProcessBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mushak63 } from "@/features/sales/mushak-63"
import { appUrl, BASE_PATH } from "@/lib/base-path"
import { fmtDate, fmtMoney } from "@/lib/format"
import { encodeCode128B, posSaleAsSale } from "@/lib/pos"
import type {
  Page,
  PosBarcodeLabel,
  PosLabelFormat,
  PosRegister,
  PosSale,
  PosShift,
  PosShiftReport,
  PosTenderMethod,
} from "@/lib/types"
import { calcLine, round2 } from "@/lib/vat"

const apiUrl = (path: string) => `${BASE_PATH}/api/v1${path}`

interface CatalogResponse {
  register: PosRegister | null
  openShift: PosShift | null
  branchId: string
  items: {
    id: string
    sku: string
    name: string
    hsCode: string
    group: string
    unit: string
    salePrice: number
    sdRate: number
    vatRate: number
    priceInclTax: number
    warehouseRemain: number
    posSold: number
    available: number
    barcode: string
  }[]
  accounts: { id: string; kind: string; provider: string; accountNo: string; serviceCharge: number }[]
  customers: { id: string; name: string; bin: string; mobile: string; address: string }[]
}

interface CartLine {
  itemId: string
  sku: string
  name: string
  hsCode: string
  unit: string
  qty: number
  price: number
  sdRate: number
  vatRate: number
  available: number
}

interface TenderDraft {
  id: string
  method: PosTenderMethod
  accountId: string
  amount: string
  reference: string
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { title?: string })?.title || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}

export function Code128Svg({
  bars,
  height = 34,
  className = "w-full max-w-[220px]",
  label,
}: {
  bars: string
  height?: number
  className?: string
  label?: string
}) {
  const pattern = bars || encodeCode128B("POS")
  return (
    <svg
      viewBox={`0 0 ${pattern.length + 8} ${height}`}
      className={className}
      role="img"
      aria-label={label || "POS"}
    >
      <rect x="0" y="0" width={pattern.length + 8} height={height} fill="white" />
      {Array.from(pattern).map((bit, i) =>
        bit === "1" ? <rect key={i} x={i + 4} y={2} width={1} height={height - 4} fill="black" /> : null,
      )}
    </svg>
  )
}

function ThermalReceipt80mm({ sale }: { sale: PosSale }) {
  const t = useTranslations("posPage")
  const company = useCompany()
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])
  const qrSrc = useMemo(() => {
    if (!sale.qr || !origin) return ""
    const qr = qrcode(0, "M")
    qr.addData(`${origin}${appUrl(`/verify/mushak-63?t=${sale.qr}`)}`)
    qr.make()
    return qr.createDataURL(3, 0)
  }, [sale.qr, origin])

  return (
    <article
      className="print-area print-thermal-80mm mx-auto w-full max-w-[320px] rounded-md border border-neutral-300 bg-white p-4 font-mono text-[11px] leading-snug text-neutral-950 shadow-xs"
      aria-label={sale.invoiceNo}
      data-testid="pos-thermal-receipt"
    >
      <div className="border-b border-dashed border-neutral-400 pb-2 text-center">
        <div className="text-xs font-bold uppercase tracking-tight">{company.name}</div>
        <div className="text-[10px] text-neutral-700">{sale.branchName}</div>
        <div className="mt-0.5 text-[10px] font-semibold">BIN: {company.bin}</div>
        <div className="mt-1 inline-block rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] font-bold">
          মূসক-৬.৩ · MUSHAK 6.3 (FA 2026)
        </div>
      </div>

      <div className="my-2 space-y-0.5 border-b border-dashed border-neutral-400 pb-2 text-[10px]">
        <div className="flex justify-between">
          <span>{t("receipt.invoice")}:</span>
          <span className="font-bold">{sale.invoiceNo}</span>
        </div>
        <div className="flex justify-between">
          <span>{t("receipt.challan")}:</span>
          <span>#{sale.challanNo}</span>
        </div>
        <div className="flex justify-between">
          <span>{t("receipt.dateTime")}:</span>
          <span>
            {sale.issueDate} {sale.issueTime}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{t("receipt.registerShift")}:</span>
          <span>
            {sale.registerCode} · {sale.shiftNo}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{t("receipt.buyer")}:</span>
          <span className="truncate pl-2">{sale.customerName}</span>
        </div>
        {sale.customerBin && sale.customerBin !== "—" && (
          <div className="flex justify-between">
            <span>{t("receipt.buyerBin")}:</span>
            <span>{sale.customerBin}</span>
          </div>
        )}
      </div>

      <table className="w-full border-b border-dashed border-neutral-400 pb-2 text-[10px]">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <th className="py-1">{t("col.itemVat")}</th>
            <th className="py-1 text-right">{t("col.qtyPrice")}</th>
            <th className="py-1 text-right">{t("col.total")}</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l, idx) => (
            <tr key={idx} className="border-b border-dotted border-neutral-200 align-top">
              <td className="py-1 pr-1">
                <div className="font-semibold">{l.name}</div>
                <div className="text-[9px] text-neutral-600">
                  HS {l.hsCode} · VAT {l.vatRate}% (৳{l.vat.toFixed(2)})
                </div>
              </td>
              <td className="py-1 text-right whitespace-nowrap">
                {l.qty}×{l.price.toFixed(0)}
              </td>
              <td className="py-1 text-right font-semibold whitespace-nowrap">{l.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 space-y-0.5 border-b border-dashed border-neutral-400 pb-2 text-[10px]">
        <div className="flex justify-between">
          <span>{t("receipt.subtotalExcl")}</span>
          <span>৳{sale.subtotal.toFixed(2)}</span>
        </div>
        {sale.sd > 0 && (
          <div className="flex justify-between">
            <span>{t("receipt.sd")}</span>
            <span>৳{sale.sd.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{t("receipt.vatTotal")}</span>
          <span>৳{sale.vat.toFixed(2)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span>{t("receipt.discount")}</span>
            <span>-৳{sale.discount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-300 pt-1 text-xs font-bold">
          <span>{t("receipt.netPayable")}</span>
          <span>৳{sale.netTotal.toFixed(2)}</span>
        </div>
      </div>

      <div className="my-2 space-y-0.5 border-b border-dashed border-neutral-400 pb-2 text-[10px]">
        <div className="font-semibold uppercase text-neutral-700">{t("receipt.tenders")}</div>
        {sale.tenders.map((tRow, idx) => (
          <div key={idx} className="flex justify-between">
            <span className="uppercase">
              {tRow.method}
              {tRow.reference ? ` (${tRow.reference})` : ""}
            </span>
            <span>৳{tRow.amount.toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between font-semibold">
          <span>{t("receipt.changeGiven")}</span>
          <span>৳{sale.changeGiven.toFixed(2)}</span>
        </div>
      </div>

      <div className="space-y-1.5 pt-1 text-center text-[9px]">
        <div className="truncate font-semibold" title={sale.nbrAdapter.irn}>
          {sale.nbrAdapter.irn}
        </div>
        <div className="flex justify-center">
          <Code128Svg bars={encodeCode128B(sale.invoiceNo)} height={28} label={sale.invoiceNo} />
        </div>
        {qrSrc && (
          <div className="flex flex-col items-center gap-1 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt={t("receipt.qrAlt")} className="h-20 w-20 border border-neutral-300 p-0.5" />
            <span className="text-[8px] text-neutral-600">{t("receipt.qrCaption")}</span>
          </div>
        )}
      </div>
    </article>
  )
}

export function PosPage() {
  const t = useTranslations("posPage")
  const locale = useLocale()
  const qc = useQueryClient()
  const can = useCan()
  const company = useCompany()
  const sp = useSearchParams()

  const [tab, setTab] = useState<"counter" | "sales" | "shifts" | "labels">("counter")
  const [registerId, setRegisterId] = useState<string>("reg1")
  const [scanInput, setScanInput] = useState("")
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState("walkin")
  const [customerName] = useState("")
  const [customerBin] = useState("")
  const [customerMobile, setCustomerMobile] = useState("")
  const [discountStr, setDiscountStr] = useState("0")
  const [tenders, setTenders] = useState<TenderDraft[]>([
    { id: "t1", method: "cash", accountId: "ac6", amount: "", reference: "" },
  ])

  // Modals / Drawers
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(sp.get("sale"))
  const [receiptMode, setReceiptMode] = useState<"thermal" | "mushak63" | "ebill">("thermal")
  const [voidReason, setVoidReason] = useState("")
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(sp.get("shift"))
  const [openShiftModal, setOpenShiftModal] = useState(false)
  const [openingFloatStr, setOpeningFloatStr] = useState("10000")
  const [closeShiftModal, setCloseShiftModal] = useState(false)
  const [countedCashStr, setCountedCashStr] = useState("")
  const [closeShiftNote, setCloseShiftNote] = useState("")
  const [salesSearch, setSalesSearch] = useState("")
  const [labelFormat, setLabelFormat] = useState<PosLabelFormat>("38x25")
  const [labelSpecQty, setLabelSpecQty] = useState<Record<string, number>>({ i17: 2, i18: 2, i19: 2 })

  const registersQ = useQuery({
    queryKey: ["pos", "registers"],
    queryFn: () => fetchJson<PosRegister[]>("/pos/registers"),
  })

  const catalogQ = useQuery({
    queryKey: ["pos", "catalog", registerId],
    queryFn: () => fetchJson<CatalogResponse>(`/pos/catalog?registerId=${encodeURIComponent(registerId)}`),
  })

  const salesQ = useQuery({
    queryKey: ["pos", "sales", salesSearch],
    queryFn: () => fetchJson<Page<PosSale>>(`/pos/sales?q=${encodeURIComponent(salesSearch)}&size=50`),
  })

  const shiftsQ = useQuery({
    queryKey: ["pos", "shifts"],
    queryFn: () =>
      fetchJson<Page<PosShift & { salesCount: number; voidedCount: number; netSales: number; vat: number }>>(
        "/pos/shifts?size=50",
      ),
  })

  const saleDetailQ = useQuery({
    queryKey: ["pos", "sale", selectedSaleId],
    queryFn: () =>
      fetchJson<PosSale & { mushak63: ReturnType<typeof posSaleAsSale>; ebill: Record<string, unknown> }>(
        `/pos/sales/${encodeURIComponent(selectedSaleId!)}`,
      ),
    enabled: Boolean(selectedSaleId),
  })

  const shiftDetailQ = useQuery({
    queryKey: ["pos", "shift", selectedShiftId],
    queryFn: () =>
      fetchJson<{ shift: PosShift; report: PosShiftReport }>(
        `/pos/shifts/${encodeURIComponent(selectedShiftId!)}`,
      ),
    enabled: Boolean(selectedShiftId),
  })

  const labelsQ = useQuery({
    queryKey: ["pos", "labels", labelFormat, labelSpecQty],
    queryFn: () =>
      fetchJson<{ format: PosLabelFormat; totalLabels: number; labels: PosBarcodeLabel[] }>("/pos/labels", {
        method: "POST",
        body: JSON.stringify({
          format: labelFormat,
          items: Object.entries(labelSpecQty)
            .filter(([, q]) => q > 0)
            .map(([itemId, qty]) => ({ itemId, qty })),
        }),
      }),
  })

  const activeReg = catalogQ.data?.register ?? registersQ.data?.[0] ?? null
  const openShift = catalogQ.data?.openShift ?? null
  const catalogItems = useMemo(() => catalogQ.data?.items ?? [], [catalogQ.data?.items])

  const filteredCatalog = useMemo(() => {
    const q = scanInput.trim().toLowerCase()
    if (!q) return catalogItems
    return catalogItems.filter(
      (it) =>
        it.sku.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.hsCode.toLowerCase().includes(q),
    )
  }, [catalogItems, scanInput])

  function addItemToCart(itemId: string) {
    const item = catalogItems.find((x) => x.id === itemId || x.sku.toLowerCase() === itemId.toLowerCase())
    if (!item) {
      toast.error(`SKU "${itemId}" not found in counter catalog`)
      return
    }
    if (item.available <= 0) {
      toast.error(`${item.name} is out of stock at this branch`)
      return
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id)
      if (existing) {
        if (existing.qty + 1 > item.available) {
          toast.error(`Only ${item.available} ${item.unit} available at this counter`)
          return prev
        }
        return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...prev,
        {
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          hsCode: item.hsCode,
          unit: item.unit,
          qty: 1,
          price: item.salePrice,
          sdRate: item.sdRate,
          vatRate: item.vatRate,
          available: item.available,
        },
      ]
    })
  }

  function updateCartQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.itemId !== itemId) return l
          const nextQty = Math.min(l.available, l.qty + delta)
          return { ...l, qty: nextQty }
        })
        .filter((l) => l.qty > 0),
    )
  }

  const cartTotals = useMemo(() => {
    let subtotal = 0
    let sd = 0
    let vat = 0
    for (const l of cart) {
      const c = calcLine({ qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate })
      subtotal = round2(subtotal + c.subtotal)
      sd = round2(sd + c.sd)
      vat = round2(vat + c.vat)
    }
    const discount = Math.max(0, round2(Number(discountStr) || 0))
    const netTotal = Math.max(0, round2(subtotal + sd + vat - discount))
    return { subtotal, sd, vat, discount, netTotal }
  }, [cart, discountStr])

  useEffect(() => {
    if (tenders.length === 1 && cart.length > 0) {
      setTenders((prev) => [{ ...prev[0], amount: String(cartTotals.netTotal) }])
    }
  }, [cartTotals.netTotal, cart.length, tenders.length])

  const tenderSummary = useMemo(() => {
    const tendered = round2(tenders.reduce((a, r) => a + (Number(r.amount) || 0), 0))
    const diff = round2(tendered - cartTotals.netTotal)
    return {
      tendered,
      changeDue: diff > 0 ? diff : 0,
      remainingDue: diff < 0 ? round2(-diff) : 0,
    }
  }, [tenders, cartTotals.netTotal])

  function defaultAccountFor(method: PosTenderMethod): string {
    if (!activeReg) return method === "cash" ? "ac6" : method === "card" ? "ac1" : method === "bkash" ? "ac4" : "ac5"
    return method === "cash"
      ? activeReg.cashAccountId
      : method === "card"
        ? activeReg.cardAccountId
        : method === "bkash"
          ? activeReg.bkashAccountId
          : activeReg.nagadAccountId
  }

  function addTenderRow() {
    const rem = tenderSummary.remainingDue > 0 ? String(tenderSummary.remainingDue) : "0"
    setTenders((prev) => [
      ...prev,
      {
        id: `t${Date.now()}`,
        method: "card",
        accountId: defaultAccountFor("card"),
        amount: rem,
        reference: "AUTH-991002",
      },
    ])
  }

  const createSaleMut = useMutation({
    mutationFn: async () => {
      const cust = catalogQ.data?.customers.find((c) => c.id === customerId)
      return fetchJson<PosSale>("/pos/sales", {
        method: "POST",
        body: JSON.stringify({
          registerId: activeReg?.id ?? registerId,
          shiftId: openShift?.id,
          customerId,
          customerName: cust ? cust.name : customerName.trim() || "Walk-in customer",
          customerBin: cust ? cust.bin : customerBin.trim() || "—",
          customerMobile: cust ? cust.mobile : customerMobile.trim(),
          customerAddress: cust ? cust.address : activeReg?.branchName || "Counter sale",
          discount: cartTotals.discount,
          lines: cart.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            price: l.price,
            sdRate: l.sdRate,
            vatRate: l.vatRate,
          })),
          tenders: tenders.map((tRow) => ({
            method: tRow.method,
            accountId: tRow.accountId || defaultAccountFor(tRow.method),
            amount: Number(tRow.amount) || 0,
            reference: tRow.reference.trim(),
          })),
        }),
      })
    },
    onSuccess: (sale) => {
      toast.success(`Issued ${sale.invoiceNo} (Mushak 6.3 · ৳${sale.netTotal.toFixed(2)})`)
      setCart([])
      setDiscountStr("0")
      setTenders([{ id: "t1", method: "cash", accountId: defaultAccountFor("cash"), amount: "", reference: "" }])
      setSelectedSaleId(sale.id)
      setReceiptMode("thermal")
      void qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const voidSaleMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      fetchJson<PosSale>(`/pos/sales/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ process: "Cancelled", reason }),
      }),
    onSuccess: (sale) => {
      toast.success(`${sale.invoiceNo} voided`)
      setVoidReason("")
      void qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openShiftMut = useMutation({
    mutationFn: async () =>
      fetchJson<PosShift>("/pos/shifts", {
        method: "POST",
        body: JSON.stringify({
          registerId: activeReg?.id ?? registerId,
          openingFloat: Number(openingFloatStr) || 0,
          note: "Counter shift opened",
        }),
      }),
    onSuccess: (sh) => {
      toast.success(`Opened shift ${sh.no}`)
      setOpenShiftModal(false)
      void qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const closeShiftMut = useMutation({
    mutationFn: async () => {
      if (!openShift) throw new Error("No open shift")
      return fetchJson<{ shift: PosShift; report: PosShiftReport }>(`/pos/shifts/${encodeURIComponent(openShift.id)}/close`, {
        method: "POST",
        body: JSON.stringify({
          countedCash: Number(countedCashStr) || 0,
          note: closeShiftNote.trim() || "Z close from counter POS",
        }),
      })
    },
    onSuccess: ({ shift }) => {
      toast.success(`Closed ${shift.no} → ${shift.zNo} (variance ৳${shift.variance ?? 0})`)
      setCloseShiftModal(false)
      setSelectedShiftId(shift.id)
      void qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="pos-register-select" className="sr-only">
              {t("register")}
            </label>
            <select
              id="pos-register-select"
              aria-label={t("register")}
              value={registerId}
              onChange={(e) => setRegisterId(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-3 text-sm font-medium"
            >
              {(registersQ.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>

            {openShift ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedShiftId(openShift.id)}
                  data-testid="pos-x-report-btn"
                >
                  <FileText className="mr-1.5 size-4" />
                  {t("xReportBtn")} ({openShift.no})
                </Button>
                {can("doc.approve") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCountedCashStr(String(openShift.openingFloat))
                      setCloseShiftModal(true)
                    }}
                    data-testid="pos-close-shift-btn"
                  >
                    <Lock className="mr-1.5 size-4" />
                    {t("closeShiftBtn")}
                  </Button>
                )}
              </>
            ) : (
              can("doc.create") && (
                <Button size="sm" onClick={() => setOpenShiftModal(true)} data-testid="pos-open-shift-btn">
                  <Unlock className="mr-1.5 size-4" />
                  {t("openShiftBtn")}
                </Button>
              )
            )}
          </div>
        }
      />

      {/* Top shift status & navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t("workspaceTabs")}>
          {(["counter", "sales", "shifts", "labels"] as const).map((k) => (
            <Button
              key={k}
              role="tab"
              aria-selected={tab === k}
              variant={tab === k ? "default" : "ghost"}
              size="sm"
              onClick={() => setTab(k)}
              data-testid={`pos-tab-${k}`}
            >
              {k === "counter" && <ShoppingBag className="mr-1.5 size-4" />}
              {k === "sales" && <Receipt className="mr-1.5 size-4" />}
              {k === "shifts" && <FileText className="mr-1.5 size-4" />}
              {k === "labels" && <Barcode className="mr-1.5 size-4" />}
              {t(`tabs.${k}`)}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs">
          {openShift ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 font-medium text-success">
              <CheckCircle2 className="size-3.5" />
              {openShift.no} · {t("float")} {fmtMoney(openShift.openingFloat, locale)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 font-medium text-warning">
              <Lock className="size-3.5" />
              {t("shiftClosed")}
            </span>
          )}
        </div>
      </div>

      {/* TAB 1: COUNTER CHECKOUT */}
      {tab === "counter" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left 7 cols: Barcode scanner + item tiles */}
          <section className="space-y-3 rounded-lg border bg-surface p-4 lg:col-span-7" aria-label={t("catalogRegion")}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input
                  aria-label={t("scanLabel")}
                  placeholder={t("scanPlaceholder")}
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && scanInput.trim()) {
                      e.preventDefault()
                      const exact = catalogItems.find(
                        (it) =>
                          it.sku.toLowerCase() === scanInput.trim().toLowerCase() ||
                          it.id.toLowerCase() === scanInput.trim().toLowerCase(),
                      )
                      if (exact) {
                        addItemToCart(exact.id)
                        setScanInput("")
                      } else if (filteredCatalog.length === 1) {
                        addItemToCart(filteredCatalog[0].id)
                        setScanInput("")
                      } else {
                        toast.error(`No single SKU matched "${scanInput.trim()}"`)
                      }
                    }
                  }}
                  className="pl-9"
                  data-testid="pos-scan-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredCatalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.available <= 0}
                  onClick={() => addItemToCart(item.id)}
                  data-testid={`pos-item-${item.id}`}
                  className="flex flex-col justify-between rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-accent/30 disabled:opacity-50"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">{item.sku}</span>
                      <Pill tone="info">VAT {item.vatRate}%</Pill>
                    </div>
                    <div className="mt-1 font-medium leading-snug text-foreground">{item.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      HS {item.hsCode} · {t("stock")}: {item.available} {item.unit}
                    </div>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between border-t pt-2">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        {t("excl")}: {fmtMoney(item.salePrice, locale)}
                      </div>
                      <div className="text-sm font-bold text-primary">
                        {fmtMoney(item.priceInclTax, locale)}{" "}
                        <span className="text-[10px] font-normal">{t("inclVat")}</span>
                      </div>
                    </div>
                    <Plus className="size-4 text-primary" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Right 5 cols: Basket + Mixed Tender + Issue Mushak 6.3 */}
          <section className="space-y-4 rounded-lg border bg-surface p-4 lg:col-span-5" aria-label={t("cart")}>
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="text-sm font-semibold">{t("cart")}</h2>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setCart([])}>
                  <Trash2 className="mr-1 size-3.5" />
                  {t("clearCart")}
                </Button>
              )}
            </div>

            {/* Customer picker */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="pos-customer-select" className="text-xs">
                  {t("customer")}
                </Label>
                <select
                  id="pos-customer-select"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="walkin">{t("walkIn")}</option>
                  {(catalogQ.data?.customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.bin})
                    </option>
                  ))}
                </select>
              </div>
              {customerId === "walkin" && (
                <div>
                  <Label htmlFor="pos-customer-mobile" className="text-xs">
                    {t("customerMobile")}
                  </Label>
                  <Input
                    id="pos-customer-mobile"
                    value={customerMobile}
                    onChange={(e) => setCustomerMobile(e.target.value)}
                    placeholder="017XX-XXXXXX"
                    className="mt-1 h-9 text-xs"
                  />
                </div>
              )}
            </div>

            {/* Basket lines */}
            {cart.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                {t("emptyCart")}
              </div>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {cart.map((l) => {
                  const calc = calcLine({ qty: l.qty, price: l.price, sdRate: l.sdRate, vatRate: l.vatRate })
                  return (
                    <div
                      key={l.itemId}
                      className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtMoney(l.price, locale)} × {l.qty} {l.unit} · VAT {l.vatRate}% ({fmtMoney(calc.vat, locale)})
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          aria-label={l.name}
                          onClick={() => updateCartQty(l.itemId, -1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-7 text-center font-mono font-semibold">{l.qty}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          aria-label={l.name}
                          onClick={() => updateCartQty(l.itemId, 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                      <div className="w-20 text-right font-mono font-semibold">{fmtMoney(calc.total, locale)}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Totals box */}
            <div className="space-y-1.5 rounded-md bg-muted/60 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("subtotal")}</span>
                <span className="font-mono">{fmtMoney(cartTotals.subtotal, locale)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("vat")}</span>
                <span className="font-mono">{fmtMoney(cartTotals.vat, locale)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pos-discount-input" className="text-xs text-muted-foreground">
                  {t("discount")}
                </Label>
                <Input
                  id="pos-discount-input"
                  type="number"
                  min="0"
                  value={discountStr}
                  onChange={(e) => setDiscountStr(e.target.value)}
                  className="h-7 w-28 text-right font-mono text-xs"
                />
              </div>
              <div className="flex justify-between border-t pt-1.5 text-sm font-bold">
                <span>{t("netTotal")}</span>
                <span className="font-mono text-primary" data-testid="pos-payable-total">
                  {fmtMoney(cartTotals.netTotal, locale)}
                </span>
              </div>
            </div>

            {/* Mixed Tender Split */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{t("tenders")}</span>
                <Button variant="outline" size="sm" onClick={addTenderRow} data-testid="pos-add-tender">
                  <Plus className="mr-1 size-3.5" />
                  {t("addTender")}
                </Button>
              </div>

              {tenders.map((row, idx) => (
                <div key={row.id} className="grid grid-cols-12 items-center gap-1.5 text-xs">
                  <select
                    aria-label={t("tenders")}
                    value={row.method}
                    onChange={(e) => {
                      const m = e.target.value as PosTenderMethod
                      setTenders((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                method: m,
                                accountId: defaultAccountFor(m),
                                reference: m === "cash" ? "" : x.reference || `${m.toUpperCase()}-90211`,
                              }
                            : x,
                        ),
                      )
                    }}
                    className="col-span-4 h-8 rounded border border-input bg-background px-2 text-xs"
                    data-testid={`pos-tender-method-${idx}`}
                  >
                    <option value="cash">{t("tenderMethod.cash")}</option>
                    <option value="card">{t("tenderMethod.card")}</option>
                    <option value="bkash">{t("tenderMethod.bkash")}</option>
                    <option value="nagad">{t("tenderMethod.nagad")}</option>
                  </select>

                  <Input
                    aria-label={t("tendered")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) =>
                      setTenders((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                    }
                    className="col-span-4 h-8 text-right font-mono text-xs"
                    data-testid={`pos-tender-amount-${idx}`}
                  />

                  {row.method !== "cash" ? (
                    <Input
                      aria-label={t("tenderRefPlaceholder")}
                      placeholder={t("tenderRefPlaceholder")}
                      value={row.reference}
                      onChange={(e) =>
                        setTenders((prev) => prev.map((x, i) => (i === idx ? { ...x, reference: e.target.value } : x)))
                      }
                      className="col-span-3 h-8 font-mono text-xs"
                      data-testid={`pos-tender-ref-${idx}`}
                    />
                  ) : (
                    <span className="col-span-3 text-center text-[11px] text-muted-foreground">{t("drawer")}</span>
                  )}

                  {tenders.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="col-span-1 size-7"
                      aria-label={t("clearCart")}
                      onClick={() => setTenders((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <XCircle className="size-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}

              <div className="flex justify-between pt-1 text-xs">
                <span className="text-muted-foreground">{t("changeDue")}:</span>
                <span className="font-mono font-semibold text-success">
                  {fmtMoney(tenderSummary.changeDue, locale)}
                </span>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={
                cart.length === 0 ||
                !openShift ||
                tenderSummary.remainingDue > 0 ||
                createSaleMut.isPending ||
                !can("doc.create")
              }
              onClick={() => createSaleMut.mutate()}
              data-testid="pos-complete-sale"
            >
              <QrCode className="mr-2 size-4" />
              {createSaleMut.isPending ? t("completing") : t("completeSale")}
            </Button>
          </section>
        </div>
      )}

      {/* TAB 2: POS INVOICES */}
      {tab === "sales" && (
        <section className="space-y-3 rounded-lg border bg-surface p-4" aria-label={t("tabs.sales")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input
              aria-label={t("searchSales")}
              placeholder={t("searchSales")}
              value={salesSearch}
              onChange={(e) => setSalesSearch(e.target.value)}
              className="max-w-sm"
            />
            <Button variant="outline" size="sm" render={<a href={apiUrl("/pos/sales?format=csv")} download="pos-sales.csv" />}>
              <Download className="mr-1.5 size-4" />
              CSV
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("col.invoice")}</th>
                  <th className="py-2 pr-3">{t("col.dateShift")}</th>
                  <th className="py-2 pr-3">{t("col.customer")}</th>
                  <th className="py-2 pr-3">{t("col.tenders")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.vat")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.netTotal")}</th>
                  <th className="py-2 pr-3">{t("col.source")}</th>
                  <th className="py-2 text-right">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {(salesQ.data?.data ?? []).map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => {
                      setSelectedSaleId(s.id)
                      setReceiptMode("thermal")
                    }}
                    className="cursor-pointer border-b transition hover:bg-muted/50"
                    data-testid={`pos-sale-row-${s.invoiceNo}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-mono font-semibold text-primary">{s.invoiceNo}</div>
                      <div className="text-[11px] text-muted-foreground">{s.nbrAdapter.irn}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <div>
                        {fmtDate(s.issueDate, locale)} · {s.issueTime}
                      </div>
                      <div className="text-muted-foreground">
                        {s.registerCode} · {s.shiftNo}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <div className="font-medium">{s.customerName}</div>
                      <div className="text-muted-foreground">{s.customerBin}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {s.tenders.map((td, i) => (
                          <span key={i} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] uppercase">
                            {td.method}: {fmtMoney(td.netAmount, locale)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">{fmtMoney(s.vat, locale)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold">{fmtMoney(s.netTotal, locale)}</td>
                    <td className="py-2.5 pr-3 text-xs capitalize">{s.source}</td>
                    <td className="py-2.5 text-right">
                      <ProcessBadge value={s.process} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: SHIFTS & X/Z REPORTS */}
      {tab === "shifts" && (
        <section className="space-y-3 rounded-lg border bg-surface p-4" aria-label={t("tabs.shifts")}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("tabs.shifts")}</h2>
            <Button variant="outline" size="sm" render={<a href={apiUrl("/pos/shifts?format=csv")} download="pos-shifts.csv" />}>
              <Download className="mr-1.5 size-4" />
              CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t("col.shiftNo")}</th>
                  <th className="py-2 pr-3">{t("col.register")}</th>
                  <th className="py-2 pr-3">{t("col.date")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.openingFloat")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.netSales")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.expectedCash")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.countedCash")}</th>
                  <th className="py-2 pr-3 text-right">{t("col.variance")}</th>
                  <th className="py-2 text-right">{t("col.report")}</th>
                </tr>
              </thead>
              <tbody>
                {(shiftsQ.data?.data ?? []).map((sh) => (
                  <tr
                    key={sh.id}
                    onClick={() => setSelectedShiftId(sh.id)}
                    className="cursor-pointer border-b transition hover:bg-muted/50"
                    data-testid={`pos-shift-row-${sh.no}`}
                  >
                    <td className="py-2.5 pr-3 font-mono font-semibold">
                      {sh.no}
                      {sh.zNo ? <span className="ml-1.5 text-xs text-primary">({sh.zNo})</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">{sh.registerCode}</td>
                    <td className="py-2.5 pr-3 text-xs">{fmtDate(sh.date, locale)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">{fmtMoney(sh.openingFloat, locale)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">{fmtMoney(sh.netSales, locale)}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">
                      {sh.expectedCash !== undefined ? fmtMoney(sh.expectedCash, locale) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">
                      {sh.countedCash !== undefined ? fmtMoney(sh.countedCash, locale) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs">
                      {sh.variance !== undefined ? (
                        <span className={sh.variance < 0 ? "font-semibold text-danger" : "text-success"}>
                          {fmtMoney(sh.variance, locale)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <Pill tone={sh.status === "closed" ? "info" : "success"}>
                        {sh.status === "closed" ? `Z (${sh.zNo})` : "X"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: R10.4 BARCODE LABELS */}
      {tab === "labels" && (
        <section className="space-y-4 rounded-lg border bg-surface p-4" aria-label={t("tabs.labels")}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="pos-label-format" className="text-xs font-medium">
                {t("labelFormat")}
              </Label>
              <select
                id="pos-label-format"
                value={labelFormat}
                onChange={(e) => setLabelFormat(e.target.value as PosLabelFormat)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                data-testid="pos-label-format"
              >
                <option value="38x25">{t("label38x25")}</option>
                <option value="50x30">{t("label50x30")}</option>
                <option value="a4-24">{t("labelA4")}</option>
              </select>
            </div>
            <Button size="sm" onClick={() => window.print()} data-testid="pos-print-labels">
              <Printer className="mr-1.5 size-4" />
              {t("printLabels")} ({labelsQ.data?.totalLabels ?? 0})
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {catalogItems.slice(0, 6).map((it) => (
              <div key={it.id} className="flex items-center justify-between rounded-md border p-2.5 text-xs">
                <div className="min-w-0 pr-2">
                  <div className="truncate font-medium">{it.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {it.sku} · {fmtMoney(it.priceInclTax, locale)} {t("inclVat")}
                  </div>
                </div>
                <Input
                  aria-label={it.sku}
                  type="number"
                  min="0"
                  max="50"
                  value={labelSpecQty[it.id] ?? 0}
                  onChange={(e) =>
                    setLabelSpecQty((prev) => ({ ...prev, [it.id]: Math.max(0, Number(e.target.value) || 0) }))
                  }
                  className="h-8 w-16 text-right font-mono text-xs"
                />
              </div>
            ))}
          </div>

          <div
            className="print-area print-labels grid grid-cols-2 gap-3 rounded-lg border bg-white p-4 text-neutral-900 sm:grid-cols-3 md:grid-cols-4"
            data-testid="pos-barcode-sheet"
          >
            {(labelsQ.data?.labels ?? []).flatMap((lbl) =>
              Array.from({ length: lbl.qty }).map((_, copyIdx) => (
                <div
                  key={`${lbl.itemId}-${copyIdx}`}
                  className="flex flex-col items-center justify-between rounded border border-dashed border-neutral-400 p-2.5 text-center"
                >
                  <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-600">{company.name}</div>
                  <div className="mt-0.5 line-clamp-1 text-xs font-semibold">{lbl.name}</div>
                  <div className="my-1">
                    <Code128Svg bars={lbl.bars} height={30} label={lbl.sku} />
                  </div>
                  <div className="font-mono text-[10px] font-semibold">{lbl.sku}</div>
                  <div className="mt-0.5 text-xs font-bold">
                    ৳{lbl.priceInclTax.toFixed(2)}{" "}
                    <span className="text-[9px] font-normal text-neutral-600">
                      ({t("inclVat")} {lbl.vatRate}%)
                    </span>
                  </div>
                </div>
              )),
            )}
          </div>
        </section>
      )}

      {/* DIALOG 1: POS SALE RECEIPT / MUSHAK 6.3 / FA 2026 E-BILL */}
      <Dialog open={Boolean(selectedSaleId)} onOpenChange={(o) => !o && setSelectedSaleId(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono">{saleDetailQ.data?.invoiceNo ?? "POS"}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant={receiptMode === "thermal" ? "default" : "outline"}
                  onClick={() => setReceiptMode("thermal")}
                  data-testid="pos-view-thermal"
                >
                  <Receipt className="mr-1 size-3.5" />
                  {t("thermal80")}
                </Button>
                <Button
                  size="sm"
                  variant={receiptMode === "mushak63" ? "default" : "outline"}
                  onClick={() => setReceiptMode("mushak63")}
                  data-testid="pos-view-mushak63"
                >
                  <QrCode className="mr-1 size-3.5" />
                  {t("mushak63")}
                </Button>
                <Button
                  size="sm"
                  variant={receiptMode === "ebill" ? "default" : "outline"}
                  onClick={() => setReceiptMode("ebill")}
                  data-testid="pos-view-ebill"
                >
                  <FileCode2 className="mr-1 size-3.5" />
                  {t("ebillAdapter")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1 size-3.5" />
                  {receiptMode === "thermal" ? t("printReceipt") : t("print63")}
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              {saleDetailQ.data?.registerCode} · {saleDetailQ.data?.shiftNo} · IRN: {saleDetailQ.data?.nbrAdapter.irn}
            </DialogDescription>
          </DialogHeader>

          {saleDetailQ.data && (
            <div className="space-y-4">
              {receiptMode === "thermal" && <ThermalReceipt80mm sale={saleDetailQ.data} />}
              {receiptMode === "mushak63" && <Mushak63 sale={posSaleAsSale(saleDetailQ.data)} />}
              {receiptMode === "ebill" && (
                <pre
                  className="max-h-96 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs"
                  data-testid="pos-ebill-json"
                >
                  {JSON.stringify(saleDetailQ.data.ebill, null, 2)}
                </pre>
              )}

              {saleDetailQ.data.process === "Approved" && can("doc.cancel") && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Input
                    aria-label={t("voidReason")}
                    placeholder={t("voidReason")}
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    className="max-w-xs text-xs"
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={voidReason.trim().length < 3 || voidSaleMut.isPending}
                    onClick={() =>
                      voidSaleMut.mutate({ id: saleDetailQ.data!.id, reason: voidReason.trim() })
                    }
                  >
                    {t("voidSale")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: X / Z SHIFT REPORT */}
      <Dialog open={Boolean(selectedShiftId)} onOpenChange={(o) => !o && setSelectedShiftId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>
                {shiftDetailQ.data?.report.kind} — {shiftDetailQ.data?.shift.no}{" "}
                {shiftDetailQ.data?.shift.zNo ? `(${shiftDetailQ.data.shift.zNo})` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="mr-1.5 size-4" />
                {t("printBtn")}
              </Button>
            </DialogTitle>
            <DialogDescription>
              {shiftDetailQ.data?.shift.registerCode} · {shiftDetailQ.data?.shift.registerName}
            </DialogDescription>
          </DialogHeader>

          {shiftDetailQ.data && (
            <div className="print-area space-y-4 text-xs" data-testid="pos-shift-report">
              <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">{t("receipt.approvedSales")}</div>
                  <div className="text-sm font-bold">{shiftDetailQ.data.report.salesCount}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("receipt.voided")}</div>
                  <div className="text-sm font-bold">{shiftDetailQ.data.report.voidedCount}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("receipt.netSalesIncl")}</div>
                  <div className="font-mono text-sm font-bold">
                    {fmtMoney(shiftDetailQ.data.report.netSales, locale)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t("receipt.totalVat")}</div>
                  <div className="font-mono text-sm font-bold">{fmtMoney(shiftDetailQ.data.report.vat, locale)}</div>
                </div>
              </div>

              {/* Tender summary */}
              <div>
                <h3 className="mb-1.5 font-semibold">{t("receipt.tenderBreakdown")}</h3>
                <table className="w-full border text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2">{t("col.method")}</th>
                      <th className="p-2 text-right">{t("col.count")}</th>
                      <th className="p-2 text-right">{t("col.tendered")}</th>
                      <th className="p-2 text-right">{t("col.changeGiven")}</th>
                      <th className="p-2 text-right">{t("col.netCollected")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftDetailQ.data.report.tenders.map((tr) => (
                      <tr key={tr.method} className="border-b">
                        <td className="p-2 font-medium uppercase">{tr.method}</td>
                        <td className="p-2 text-right font-mono">{tr.count}</td>
                        <td className="p-2 text-right font-mono">{fmtMoney(tr.tendered, locale)}</td>
                        <td className="p-2 text-right font-mono">{fmtMoney(tr.changeGiven, locale)}</td>
                        <td className="p-2 text-right font-mono font-semibold">{fmtMoney(tr.netAmount, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cash Drawer Variance */}
              <div className="space-y-1 rounded-md border bg-muted/40 p-3">
                <h3 className="font-semibold">{t("receipt.cashDrawerReconcile")}</h3>
                <div className="flex justify-between">
                  <span>{t("col.openingFloat")}</span>
                  <span className="font-mono">{fmtMoney(shiftDetailQ.data.report.cashDrawer.openingFloat, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("receipt.netCashSales")}</span>
                  <span className="font-mono">{fmtMoney(shiftDetailQ.data.report.cashDrawer.netCashSales, locale)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>{t("expectedCash")}</span>
                  <span className="font-mono">{fmtMoney(shiftDetailQ.data.report.cashDrawer.expectedCash, locale)}</span>
                </div>
                {shiftDetailQ.data.report.cashDrawer.countedCash !== undefined && (
                  <>
                    <div className="flex justify-between">
                      <span>{t("countedCash")}</span>
                      <span className="font-mono">
                        {fmtMoney(shiftDetailQ.data.report.cashDrawer.countedCash, locale)}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>{t("variance")}</span>
                      <span
                        className={
                          (shiftDetailQ.data.report.cashDrawer.variance ?? 0) < 0
                            ? "font-mono text-danger"
                            : "font-mono text-success"
                        }
                      >
                        {fmtMoney(shiftDetailQ.data.report.cashDrawer.variance ?? 0, locale)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: OPEN SHIFT */}
      <Dialog open={openShiftModal} onOpenChange={setOpenShiftModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("openShiftBtn")}</DialogTitle>
            <DialogDescription>{activeReg?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pos-opening-float">{t("openingFloat")}</Label>
              <Input
                id="pos-opening-float"
                type="number"
                min="0"
                value={openingFloatStr}
                onChange={(e) => setOpeningFloatStr(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => openShiftMut.mutate()} disabled={openShiftMut.isPending}>
              {t("openShiftBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 4: CLOSE SHIFT (Z REPORT) */}
      <Dialog open={closeShiftModal} onOpenChange={setCloseShiftModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("closeShiftBtn")}</DialogTitle>
            <DialogDescription>
              {t("closeShiftDesc", { no: openShift?.no ?? "", code: activeReg?.code ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pos-counted-cash">{t("countedCash")}</Label>
              <Input
                id="pos-counted-cash"
                type="number"
                min="0"
                value={countedCashStr}
                onChange={(e) => setCountedCashStr(e.target.value)}
                className="mt-1 font-mono"
                data-testid="pos-counted-cash-input"
              />
            </div>
            <div>
              <Label htmlFor="pos-close-note">{t("noteLabel")}</Label>
              <Input
                id="pos-close-note"
                value={closeShiftNote}
                onChange={(e) => setCloseShiftNote(e.target.value)}
                placeholder={t("closeNotePlaceholder")}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => closeShiftMut.mutate()}
              disabled={closeShiftMut.isPending}
              data-testid="pos-confirm-close-shift"
            >
              {t("closeShiftBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
